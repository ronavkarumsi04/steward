/**
 * Reconciliation and run-lifecycle tests against a real PostgreSQL (DATABASE_URL). Skipped when the database
 * is unreachable so unit-only runs still pass.
 *
 * These cover the failures that only appear when something else failed first: a launch lost to a Temporal
 * outage, a run that stopped moving, an approval whose run already finished, and a task parked waiting for an
 * approval that no longer exists. They also pin the run state machine, because the reconciliation path depends
 * on a finished run staying finished.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { approvals as approvalRows, createDb, type Db } from "@steward/db";
import type { TenantScope } from "@steward/schema";
import pg from "pg";
import { AuthService } from "./auth.js";
import { CompanyService } from "./companies.js";
import { ApprovalService } from "./approvals.js";
import { ReconcileService } from "./reconcile.js";
import { AgentService, RunService, TaskService } from "./work.js";
import { EventService } from "./events.js";

const url = process.env.DATABASE_URL ?? "postgres://steward:steward@localhost:5432/steward";
let available = false;
let db: Db;
let pool: pg.Pool;
const uniq = () => Math.random().toString(36).slice(2, 10);

beforeAll(async () => {
  const probe = new pg.Pool({ connectionString: url, connectionTimeoutMillis: 1500 });
  try {
    await probe.query("select 1");
    available = true;
  } catch (error) {
    available = false;
    if (process.env.CI) throw error;
    return;
  } finally { await probe.end(); }
  ({ db, pool } = createDb(url));
});
afterAll(async () => {
  await pool?.end();
});

const d = (name: string, fn: () => Promise<void>) =>
  it(name, async (context) => {
    if (!available) return context.skip();
    await fn();
  });

/** A registered owner with a company (which seeds the default agents) and its tenant scope. */
async function tenant() {
  const auth = new AuthService(db);
  const reg = await auth.register({ email: `r-${uniq()}@example.com`, password: "correct horse battery", name: "Owner" });
  const orgScope: TenantScope = { organizationId: reg.organization.id, userId: reg.user.id, role: "owner", actor: { type: "user", userId: reg.user.id } };
  const company = await new CompanyService(db).create(orgScope, { name: `Reconcile ${uniq()}` });
  const scope: TenantScope = { ...orgScope, companyId: company.id };
  const agent = (await new AgentService(db).list(scope)).find((a) => a.kind === "orchestrator")!;
  return { scope, agentId: agent.id, userId: reg.user.id };
}

async function backdate(runId: string, interval: string) {
  await db.execute(sql.raw(`update agent_runs set created_at = now() - interval '${interval}', updated_at = now() - interval '${interval}' where id = '${runId}'`));
}

describe("run state machine", () => {
  d("refuses to reopen a finished run and keeps the durable status", async () => {
    const { scope, agentId } = await tenant();
    const runs = new RunService(db);
    const run = await runs.create(scope, { agentId, trigger: { kind: "user", instruction: "Finish" } });
    expect(await runs.setStatus(scope, run.id, "executing")).not.toBeNull();
    expect((await runs.setStatus(scope, run.id, "succeeded", { result: { summary: "done" } }))?.status).toBe("succeeded");

    // A late activity trying to rewrite the outcome is refused, and the run keeps its real result.
    expect(await runs.setStatus(scope, run.id, "failed", { error: "late failure" })).toBeNull();
    const after = await runs.get(scope, run.id);
    expect(after?.status).toBe("succeeded");
    expect(after?.error).toBeNull();

    // Idempotent re-writes of the same status stay allowed: activity retries are normal.
    expect((await runs.setStatus(scope, run.id, "succeeded"))?.status).toBe("succeeded");
  });
});

describe("reconciliation", () => {
  d("recovers a persisted human decision after signal loss and stops after the run resumes", async () => {
    const { scope, agentId } = await tenant();
    const runs = new RunService(db);
    const id = crypto.randomUUID();
    const run = await runs.create(scope, { id, workflowId: `run-${id}`, agentId, trigger: { kind: "user", instruction: "Approval recovery" } });
    await runs.setStatus(scope, run.id, "waiting_approval");
    const approvals = new ApprovalService(db, { notify: async () => { throw new Error("Bearer secret-fixture"); } });
    const approval = await approvals.request(scope, { action: "email.send", reason: "Review", payload: {}, risk: "HIGH", dimension: "email_send", affectedSystem: "resend", alternatives: [], expiresInSeconds: 3600, runId: id, workflowId: `run-${id}` });
    expect((await approvals.resolve(scope, approval.id, { status: "approved", note: "reviewed", editedPayload: { subject: "Approved subject" } }))?.signalDelivered).toBe(false);
    const events = new EventService(db);
    const failed = await events.since(scope, 0, 200, ["approval.signal_failed"]);
    expect(JSON.stringify(failed)).not.toContain("secret-fixture");
    const delivered: { workflowId: string; approvalId: string; decision: unknown }[] = [];
    const service = new ReconcileService(db, null, undefined, { notify: async (workflowId, approvalId, decision) => { delivered.push({ workflowId, approvalId, decision }); } });
    expect((await service.sweep({ limit: 10_000 })).approvalSignalsDelivered).toBeGreaterThanOrEqual(1);
    expect(delivered).toContainEqual({ workflowId: `run-${id}`, approvalId: approval.id, decision: { status: "approved", note: "reviewed", editedPayload: { subject: "Approved subject" } } });
    expect((await events.since(scope, 0, 200, ["approval.signal_retried"])).map((e) => e.payload)).toContainEqual({ approvalId: approval.id, status: "approved", workflowId: `run-${id}` });
    // A failed retry leaves the original human decision intact; later sweeps may safely redeliver.
    const failing = new ReconcileService(db, null, undefined, { notify: async () => { throw new Error("transport unavailable"); } });
    expect((await failing.sweep({ limit: 10_000 })).approvalSignalsFailed).toBeGreaterThanOrEqual(1);
    expect((await approvals.get(scope, approval.id))?.status).toBe("approved");
    await runs.setStatus(scope, id, "executing");
    delivered.length = 0;
    await service.sweep({ limit: 10_000 });
    expect(delivered.some((item) => item.approvalId === approval.id)).toBe(false);
    await runs.setStatus(scope, id, "cancelled");
  });

  d("refuses cross-tenant workflow metadata and decisions past their approval window", async () => {
    const a = await tenant(); const b = await tenant();
    const runs = new RunService(db);
    const id = crypto.randomUUID();
    await runs.create(b.scope, { id, workflowId: `run-${id}`, agentId: b.agentId, trigger: { kind: "user", instruction: "Isolated approval" } });
    await runs.setStatus(b.scope, id, "waiting_approval");
    const approvals = new ApprovalService(db);
    const request = { action: "email.send", reason: "Review", payload: {}, risk: "HIGH" as const, dimension: "email_send" as const, affectedSystem: "resend", alternatives: [], expiresInSeconds: 3600, runId: id, workflowId: `run-${id}` };
    const crossed = await approvals.request(a.scope, request);
    await approvals.resolve(a.scope, crossed.id, { status: "denied" });
    const expired = await approvals.request(b.scope, { ...request, expiresInMs: -1 });
    expect(await approvals.resolve(b.scope, expired.id, { status: "approved" })).toBeNull();
    // A legacy/inconsistent late resolution must also be refused by recovery.
    await db.update(approvalRows).set({ status: "approved", resolvedBy: b.userId, resolvedAt: new Date() }).where(eq(approvalRows.id, expired.id));
    const delivered: string[] = [];
    await new ReconcileService(db, null, undefined, { notify: async (_workflow, approvalId) => { delivered.push(approvalId); } }).sweep({ limit: 10_000 });
    expect(delivered).not.toContain(crossed.id); expect(delivered).not.toContain(expired.id);
    await runs.setStatus(b.scope, id, "cancelled");
  });

  d("starts a run whose launch was lost, instead of leaving it queued forever", async () => {
    const { scope, agentId } = await tenant();
    const runs = new RunService(db);
    const runId = crypto.randomUUID();
    const run = await runs.create(scope, { id: runId, workflowId: `run-${runId}`, agentId, trigger: { kind: "user", instruction: "Lost launch" } });
    expect(run.status).toBe("queued");

    const started: string[] = [];
    const service = new ReconcileService(db, { start: async (input) => void started.push(input.runId) });
    // The sweep is deployment-wide, and `limit` is a batch size rather than a filter: a development database
    // accumulates hundreds of launches that were never started, so a sweep that asked for the default batch could
    // legitimately not reach the run this test just made. Asking for a batch big enough to hold everything is what
    // "assert on the run you created" means against a shared database, and the run is still the thing asserted.
    const report = await service.sweep({ queuedGraceMs: 0, limit: 10_000 });
    expect(started).toContain(runId);
    expect(report.startsRetried).toBeGreaterThanOrEqual(1);
    expect((await runs.get(scope, runId))?.status).toBe("queued"); // still queued: the workflow owns it now
  });

  d("marks a stalled run for human review rather than leaving it 'executing'", async () => {
    const { scope, agentId } = await tenant();
    const runs = new RunService(db);
    const run = await runs.create(scope, { agentId, trigger: { kind: "user", instruction: "Stall" } });
    await runs.setStatus(scope, run.id, "executing");
    await backdate(run.id, "7 hours");

    const report = await new ReconcileService(db, null).sweep({ staleAfterMs: 6 * 60 * 60 * 1000 });
    expect(report.runsMarkedStale).toBeGreaterThanOrEqual(1);
    const after = await runs.get(scope, run.id);
    expect(after?.status).toBe("needs_review");
    expect(after?.error).toContain("stalled");
  });

  d("never touches a run that is legitimately waiting for approval", async () => {
    const { scope, agentId } = await tenant();
    const runs = new RunService(db);
    const run = await runs.create(scope, { agentId, trigger: { kind: "user", instruction: "Wait" } });
    await runs.setStatus(scope, run.id, "waiting_approval");
    await backdate(run.id, "7 hours");

    await new ReconcileService(db, null).sweep({ staleAfterMs: 6 * 60 * 60 * 1000 });
    expect((await runs.get(scope, run.id))?.status).toBe("waiting_approval");
  });

  d("expires approvals whose run already finished", async () => {
    const { scope, agentId } = await tenant();
    const runs = new RunService(db);
    const approvals = new ApprovalService(db);
    const run = await runs.create(scope, { agentId, trigger: { kind: "user", instruction: "Approve then finish" } });
    const approval = await approvals.request(scope, { action: "email.send", reason: "Outreach", payload: { to: "x@example.com" }, risk: "HIGH", dimension: "email_send", affectedSystem: "resend", alternatives: [], expiresInSeconds: 3600, runId: run.id });
    await runs.setStatus(scope, run.id, "executing");
    await runs.setStatus(scope, run.id, "succeeded", { result: { summary: "done" } });

    const report = await new ReconcileService(db, null).sweep();
    expect(report.approvalsExpired).toBeGreaterThanOrEqual(1);
    expect((await approvals.get(scope, approval.id))?.status).toBe("expired");
  });

  d("releases a task parked on an approval that no longer exists", async () => {
    const { scope, agentId } = await tenant();
    const tasks = new TaskService(db);
    const runs = new RunService(db);
    const task = await tasks.create(scope, { title: "Parked", assigneeAgentId: agentId });
    const run = await runs.create(scope, { agentId, taskId: task.id, trigger: { kind: "task", instruction: "Parked work" } });
    await tasks.update(scope, task.id, { status: "waiting_approval" });
    await runs.setStatus(scope, run.id, "failed", { error: "provider outage" });

    const report = await new ReconcileService(db, null).sweep();
    expect(report.tasksReleased).toBeGreaterThanOrEqual(1);
    expect((await tasks.get(scope, task.id))?.status).toBe("review");
  });

  d("fails a run that never had a workflow and can no longer be adopted", async () => {
    const { scope, agentId } = await tenant();
    const runs = new RunService(db);
    const run = await runs.create(scope, { agentId, trigger: { kind: "user", instruction: "Orphan" } });
    await backdate(run.id, "2 days");

    const report = await new ReconcileService(db, null).sweep({ giveUpAfterMs: 24 * 60 * 60 * 1000 });
    expect(report.runsFailedWithoutWorkflow).toBeGreaterThanOrEqual(1);
    const after = await runs.get(scope, run.id);
    expect(after?.status).toBe("failed");
    expect(after?.error).toContain("No workflow ever ran this run");
  });
});
