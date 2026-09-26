import { and, eq, inArray, isNull, lt, notInArray, sql } from "drizzle-orm";
import { agentRuns, approvals, emitEvent, tasks, type Db } from "@steward/db";
import type { RunStatus } from "@steward/schema";

/** Reconciliation acts as the deployment itself, not as any one tenant's user or agent. */
type Scope = { organizationId: string; companyId: string };
const RECONCILER = { type: "system", component: "reconciliation" } as const;

/**
 * Reconciliation: repairs the states a distributed system can get stuck in.
 *
 * Three ways a run can be left behind, each with a different correct answer:
 *   - the run row exists but its workflow was never started (Temporal was down, the process died mid-launch)
 *     → start it. Starting is idempotent at the run's deterministic workflow id, so retrying is safe.
 *   - the run has no workflow id at all and nothing ever drove it → start it if we can, otherwise it is
 *     honest to fail it: no worker will ever pick it up.
 *   - the run stopped moving while still claiming to be working → mark it for human review instead of
 *     leaving an "executing" run that will never execute anything.
 *
 * It also releases the records that hang off a finished run: approvals nobody can act on, and tasks left
 * waiting for an approval that no longer exists.
 */

export interface RunLauncher {
  start(input: { runId: string; scope: { organizationId: string; companyId: string } }): Promise<unknown>;
}

export interface ReconcileReport {
  startsRetried: number;
  runsFailedWithoutWorkflow: number;
  runsMarkedStale: number;
  approvalsExpired: number;
  tasksReleased: number;
}

const DEFAULTS = {
  /** How long a freshly queued run may sit before we assume its launch was lost. */
  queuedGraceMs: 2 * 60 * 1000,
  /** How long without a single recorded step before a working run is called stalled. */
  staleAfterMs: 6 * 60 * 60 * 1000,
  /** After this long with no workflow, a run is failed rather than retried forever. */
  giveUpAfterMs: 24 * 60 * 60 * 1000,
  limit: 200,
};

/** Statuses that mean the run is over; nothing may wait on them. */
const TERMINAL: RunStatus[] = ["succeeded", "failed", "cancelled"];

/** A run in one of these is legitimately parked and must not be treated as stalled. */
const WAITING: RunStatus[] = ["waiting_approval", "waiting_budget"];

export class ReconcileService {
  constructor(
    private readonly db: Db,
    private readonly launcher: RunLauncher | null,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async sweep(opts: { queuedGraceMs?: number; staleAfterMs?: number; giveUpAfterMs?: number; limit?: number } = {}): Promise<ReconcileReport> {
    const cfg = { ...DEFAULTS, ...opts };
    const at = this.now();
    const report: ReconcileReport = { startsRetried: 0, runsFailedWithoutWorkflow: 0, runsMarkedStale: 0, approvalsExpired: 0, tasksReleased: 0 };

    report.startsRetried = await this.retryLostLaunches(new Date(at.getTime() - cfg.queuedGraceMs), cfg.limit);
    report.runsFailedWithoutWorkflow = await this.failUnstartableRuns(new Date(at.getTime() - cfg.giveUpAfterMs), cfg.limit);
    report.runsMarkedStale = await this.markStaleRuns(new Date(at.getTime() - cfg.staleAfterMs), cfg.limit);
    report.approvalsExpired = await this.expireOrphanApprovals(cfg.limit);
    report.tasksReleased = await this.releaseWaitingTasks(cfg.limit);
    return report;
  }

  /** Runs that recorded a workflow id but are still queued: the launch was interrupted. Start it again. */
  private async retryLostLaunches(before: Date, limit: number): Promise<number> {
    const stuck = await this.db
      .select({ id: agentRuns.id, organizationId: agentRuns.organizationId, companyId: agentRuns.companyId })
      .from(agentRuns)
      .where(and(eq(agentRuns.status, "queued"), lt(agentRuns.createdAt, before)))
      .limit(limit);
    if (!stuck.length) return 0;

    let retried = 0;
    for (const run of stuck) {
      if (!this.launcher) {
        // No worker exists in this deployment (embedded mode); leave the row alone rather than fail it here.
        await this.record({ organizationId: run.organizationId, companyId: run.companyId }, run.id, "queued without launcher", "no workflow launcher in this deployment").catch(() => undefined);
        continue;
      }
      try {
        await this.launcher.start({ runId: run.id, scope: { organizationId: run.organizationId, companyId: run.companyId } });
        retried += 1;
      } catch (err) {
        // Leave it queued: the next sweep tries again. Nothing is lost by waiting, and nothing is invented.
        await this.record({ organizationId: run.organizationId, companyId: run.companyId }, run.id, "launch retry failed", err instanceof Error ? err.message : String(err)).catch(() => undefined);
      }
    }
    return retried;
  }

  /**
   * Runs with no workflow id at all. They predate launch persistence, or their launch was interrupted before
   * the id was recorded — either way the workflow id is derivable from the run id, so try to start it. Once a
   * run has been unattached for long enough that retrying is hopeless, fail it visibly instead of leaving it
   * "queued" forever.
   */
  private async failUnstartableRuns(giveUpBefore: Date, limit: number): Promise<number> {
    const orphans = await this.db
      .select({ id: agentRuns.id, organizationId: agentRuns.organizationId, companyId: agentRuns.companyId, createdAt: agentRuns.createdAt })
      .from(agentRuns)
      .where(and(isNull(agentRuns.workflowId), notInArray(agentRuns.status, TERMINAL)))
      .limit(limit);
    if (!orphans.length) return 0;

    let failed = 0;
    for (const run of orphans) {
      // Inside the retry window this is not an orphan: its launch may be in flight in another process, and a
      // sweeper without a launcher (embedded mode) must not fail a run another deployment is about to start.
      if (run.createdAt >= giveUpBefore) {
        if (!this.launcher) continue;
        try {
          await this.launcher.start({ runId: run.id, scope: { organizationId: run.organizationId, companyId: run.companyId } });
        } catch (err) {
          await this.record({ organizationId: run.organizationId, companyId: run.companyId }, run.id, "adopting untracked run failed", err instanceof Error ? err.message : String(err)).catch(() => undefined);
        }
        continue;
      }
      const reason = "No workflow ever ran this run (it has no workflow id and the retry window has passed). Reconciliation marked it failed.";
      const updated = await this.setTerminal({ organizationId: run.organizationId, companyId: run.companyId }, run.id, "failed", reason);
      if (updated) failed += 1;
    }
    return failed;
  }

  /** Runs that claim to be working but have not recorded activity for hours. Hand them to a human. */
  private async markStaleRuns(before: Date, limit: number): Promise<number> {
    const stalled = await this.db
      .select({ id: agentRuns.id, organizationId: agentRuns.organizationId, companyId: agentRuns.companyId, status: agentRuns.status })
      .from(agentRuns)
      // `needs_review` is excluded on purpose: a human owns that run now, and re-marking it every sweep
      // would bury the event stream in duplicates.
      .where(and(notInArray(agentRuns.status, [...TERMINAL, ...WAITING, "needs_review"]), lt(agentRuns.updatedAt, before)))
      .limit(limit);

    let marked = 0;
    for (const run of stalled) {
      const reason = `Run stalled in "${run.status}" with no recorded activity. Reconciliation stopped it for review; resume it if the work is still wanted.`;
      const updated = await this.setTerminal({ organizationId: run.organizationId, companyId: run.companyId }, run.id, "needs_review", reason);
      if (updated) marked += 1;
    }
    return marked;
  }

  /** Approvals whose run has already finished: nobody can act on them, and they clutter the inbox forever. */
  private async expireOrphanApprovals(limit: number): Promise<number> {
    const pending = await this.db
      .select({ id: approvals.id, runId: approvals.runId, organizationId: approvals.organizationId, companyId: approvals.companyId })
      .from(approvals)
      .where(eq(approvals.status, "pending"))
      .limit(limit);
    if (!pending.length) return 0;

    const runIds = pending.map((a) => a.runId).filter((id): id is string => Boolean(id));
    const finished = runIds.length
      ? new Set(
          (await this.db.select({ id: agentRuns.id }).from(agentRuns).where(and(inArray(agentRuns.id, runIds), inArray(agentRuns.status, TERMINAL)))).map((r) => r.id),
        )
      : new Set<string>();

    let expired = 0;
    for (const approval of pending) {
      const orphaned = approval.runId ? finished.has(approval.runId) : false;
      if (!orphaned) continue;
      const outcome = await this.db.transaction(async (tx) => {
        const [row] = await tx
          .update(approvals)
          .set({ status: "expired", resolvedAt: this.now(), resolution: { note: "The run finished before a decision was made.", expiredBy: "reconciliation" } })
          .where(and(eq(approvals.id, approval.id), eq(approvals.status, "pending")))
          .returning();
        if (!row) return false;
        await emitEvent(tx, { organizationId: row.organizationId, companyId: row.companyId, type: "approval.expired", actor: RECONCILER, payload: { approvalId: row.id, action: row.action, reason: "run already finished" }, correlation: { runId: row.runId ?? "" } });
        return true;
      });
      if (outcome) expired += 1;
    }
    return expired;
  }

  /** Tasks parked in "waiting_approval" when no approval — and no live run — is waiting on them. */
  private async releaseWaitingTasks(limit: number): Promise<number> {
    const rows = await this.db.execute(sql`
      select t.id, t.organization_id, t.company_id
      from tasks t
      where t.status = 'waiting_approval'
        and not exists (select 1 from approvals a where a.task_id = t.id and a.status = 'pending')
        and not exists (select 1 from agent_runs r where r.task_id = t.id and r.status not in ('succeeded','failed','cancelled'))
      limit ${limit}
    `);
    const waiting = rows.rows as Array<{ id: string; organization_id: string; company_id: string }>;
    let released = 0;
    for (const task of waiting) {
      const changed = await this.db.transaction(async (tx) => {
        const [row] = await tx
          .update(tasks)
          .set({ status: "review", updatedAt: this.now() })
          .where(and(eq(tasks.id, task.id), eq(tasks.status, "waiting_approval")))
          .returning();
        if (!row) return false;
        await emitEvent(tx, { organizationId: row.organizationId, companyId: row.companyId, type: "task.updated", actor: RECONCILER, payload: { taskId: row.id, status: row.status, reason: "no approval is pending" }, correlation: { taskId: row.id } });
        return true;
      });
      if (changed) released += 1;
    }
    return released;
  }

  /** Moves a run to a terminal-ish state through the same guarded path as every other status write. */
  private async setTerminal(scope: Scope, runId: string, status: RunStatus, reason: string): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [current] = await tx.select({ status: agentRuns.status }).from(agentRuns).where(eq(agentRuns.id, runId)).for("update").limit(1);
      if (!current || TERMINAL.includes(current.status as RunStatus)) return false;
      const [row] = await tx
        .update(agentRuns)
        .set({ status, error: reason, updatedAt: this.now(), ...(status === "needs_review" ? {} : { finishedAt: this.now() }) })
        .where(eq(agentRuns.id, runId))
        .returning();
      if (!row) return false;
      await emitEvent(tx, { organizationId: scope.organizationId, companyId: scope.companyId, type: "run.reconciled", actor: RECONCILER, payload: { runId, from: current.status, to: status, reason }, correlation: { runId } });
      return true;
    });
  }

  /**
   * Records what reconciliation attempted without changing the run's status: a failed retry is not a run
   * failure, but it should be visible in the event stream rather than disappearing into a log line.
   */
  private async record(scope: Scope, runId: string, attempt: string, detail: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await emitEvent(tx, {
        organizationId: scope.organizationId,
        companyId: scope.companyId,
        type: "run.reconciled",
        actor: RECONCILER,
        payload: { runId, attempt, detail: detail.slice(0, 500) },
        correlation: { runId },
      });
    });
  }
}
