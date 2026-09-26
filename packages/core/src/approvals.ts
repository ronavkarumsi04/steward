import { and, desc, eq, lt } from "drizzle-orm";
import { approvals, auditLog, emitEvent, scoped, type Db } from "@steward/db";
import type { ApprovalRequest, ApprovalStatus, TenantScope } from "@steward/schema";

export interface ApprovalSignal {
  /** Called after an approval is resolved so the durable workflow can resume. */
  notify(workflowId: string, approvalId: string, decision: { status: "approved" | "denied"; note?: string; editedPayload?: Record<string, unknown> }): Promise<void>;
}

/** An approval row plus whether the workflow waiting on it actually took the decision: `true` delivered,
 * `false` attempted or impossible and not delivered, `null` nothing was attached to deliver to. */
export type ResolvedApproval = typeof approvals.$inferSelect & { signalDelivered: boolean | null };

export class ApprovalService {
  constructor(private readonly db: Db, private readonly signal?: ApprovalSignal) {}

  async list(scope: TenantScope, status?: ApprovalStatus, limit = 50) {
    return this.db
      .select()
      .from(approvals)
      .where(scoped(scope, { organizationId: approvals.organizationId, companyId: approvals.companyId }, status ? eq(approvals.status, status) : undefined))
      .orderBy(desc(approvals.createdAt))
      .limit(limit);
  }

  async get(scope: TenantScope, id: string) {
    const [a] = await this.db.select().from(approvals).where(scoped(scope, { organizationId: approvals.organizationId, companyId: approvals.companyId }, eq(approvals.id, id))).limit(1);
    return a ?? null;
  }

  async request(scope: TenantScope, req: ApprovalRequest & { runId?: string; taskId?: string; agentId?: string; workflowId?: string; expiresInMs?: number }) {
    return this.db.transaction(async (tx) => {
      const [a] = await tx
        .insert(approvals)
        .values({
          organizationId: scope.organizationId,
          companyId: scope.companyId!,
          runId: req.runId,
          taskId: req.taskId,
          agentId: req.agentId,
          action: req.action,
          reason: req.reason,
          payload: req.payload,
          risk: req.risk,
          dimension: req.dimension,
          estimatedCostUsd: req.estimatedCostUsd !== undefined ? req.estimatedCostUsd.toFixed(4) : null,
          affectedSystem: req.affectedSystem,
          alternatives: req.alternatives ?? [],
          expiresAt: new Date(Date.now() + (req.expiresInMs ?? 1000 * 60 * 60 * 24 * 3)),
          workflowId: req.workflowId,
        })
        .returning();
      await emitEvent(tx, { organizationId: scope.organizationId, companyId: scope.companyId, type: "approval.requested", actor: scope.actor, payload: { approvalId: a!.id, action: req.action, risk: req.risk, dimension: req.dimension, estimatedCostUsd: req.estimatedCostUsd, affectedSystem: req.affectedSystem }, correlation: { runId: req.runId ?? "", taskId: req.taskId ?? "" } });
      return a!;
    });
  }

  /**
   * Records a human decision and, best effort, wakes the workflow that was waiting for it.
   *
   * The row is committed first on purpose: a decision is durable the moment it is taken. Delivery to the
   * workflow is then attempted separately, and its outcome is reported rather than thrown, because a
   * connection to Temporal being down must not turn a recorded decision into an error the founder reads as
   * "nothing happened" — the row has already changed, and a second attempt would be refused as not pending.
   * An undelivered decision is written to the event stream so the run's stalled state is not silent.
   */
  async resolve(scope: TenantScope, id: string, decision: { status: "approved" | "denied"; note?: string; editedPayload?: Record<string, unknown> }): Promise<ResolvedApproval | null> {
    if (scope.actor.type !== "user") throw new Error("Only users can resolve approvals");
    const resolvedBy = scope.actor.userId;
    const a = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(approvals)
        .set({ status: decision.status, resolvedBy, resolvedAt: new Date(), resolution: { note: decision.note ?? "", editedPayload: decision.editedPayload ?? null } })
        .where(scoped(scope, { organizationId: approvals.organizationId, companyId: approvals.companyId }, eq(approvals.id, id), eq(approvals.status, "pending")))
        .returning();
      if (!row) return null;
      await emitEvent(tx, { organizationId: scope.organizationId, companyId: scope.companyId, type: "approval.resolved", actor: scope.actor, payload: { approvalId: id, status: decision.status, action: row.action }, correlation: { runId: row.runId ?? "" } });
      await tx.insert(auditLog).values({ organizationId: scope.organizationId, companyId: scope.companyId, actor: scope.actor as Record<string, unknown>, action: `approval.${decision.status}`, target: id, metadata: { action: row.action, risk: row.risk } });
      return row;
    });
    if (!a) return null;
    // Nothing was waiting on it: a decision can only ever be a record here.
    if (!a.workflowId) return { ...a, signalDelivered: null };
    const undelivered = async (error: string) => {
      await emitEvent(this.db, {
        organizationId: a.organizationId,
        companyId: a.companyId,
        type: "approval.signal_failed",
        actor: { type: "system", component: "approvals" },
        payload: { approvalId: a.id, status: a.status, workflowId: a.workflowId, error },
        correlation: { runId: a.runId ?? "" },
      }).catch(() => undefined);
      return { ...a, signalDelivered: false };
    };
    // A workflow is attached but this deployment has no client to reach it (Temporal never connected). Saying
    // nothing here would let the surface promise a resume that cannot happen.
    if (!this.signal) return undelivered("no workflow client is configured in this deployment");
    try {
      await this.signal.notify(a.workflowId, id, decision);
      return { ...a, signalDelivered: true };
    } catch (e) {
      return undelivered(e instanceof Error ? e.message : String(e));
    }
  }

  /** Marks pending approvals past their expiry; the workflow's own timer handles resumption. */
  async expireDue(now = new Date()) {
    const rows = await this.db.update(approvals).set({ status: "expired", resolvedAt: now }).where(and(eq(approvals.status, "pending"), lt(approvals.expiresAt, now))).returning();
    for (const r of rows) await emitEvent(this.db, { organizationId: r.organizationId, companyId: r.companyId, type: "approval.expired", actor: { type: "system", component: "approvals" }, payload: { approvalId: r.id, action: r.action } });
    return rows.length;
  }

  async expireOne(scope: TenantScope, id: string, now = new Date()) {
    const [row] = await this.db.update(approvals).set({ status: "expired", resolvedAt: now }).where(scoped(scope, { organizationId: approvals.organizationId, companyId: approvals.companyId }, eq(approvals.id, id), eq(approvals.status, "pending"))).returning();
    if (row) await emitEvent(this.db, { organizationId: row.organizationId, companyId: row.companyId, type: "approval.expired", actor: { type: "system", component: "approvals" }, payload: { approvalId: row.id, action: row.action }, correlation: { runId: row.runId ?? "" } });
    return !!row;
  }

  async pendingCount(scope: TenantScope) {
    const rows = await this.db.select({ id: approvals.id }).from(approvals).where(scoped(scope, { organizationId: approvals.organizationId, companyId: approvals.companyId }, eq(approvals.status, "pending")));
    return rows.length;
  }
}
