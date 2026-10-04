/**
 * Integration tests against a real PostgreSQL (DATABASE_URL, default docker-compose). Skipped when the
 * database is unreachable so unit-only CI still passes; `pnpm verify:boot` runs them with the DB up.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { EnvMasterKeyProvider, EnvelopeCrypto } from "@steward/crypto";
import { createDb, type Db } from "@steward/db";
import type { TenantScope } from "@steward/schema";
import pg from "pg";
import { AuthService } from "./auth.js";
import { CompanyService, DEFAULT_AGENTS } from "./companies.js";
import { ApprovalService } from "./approvals.js";
import { BudgetExhaustedError, BudgetService } from "./budgets.js";
import { ProviderCredentialService } from "./providers.js";
import { IntegrationService } from "./integrations.js";
import { EventService } from "./events.js";
import { RunService, TaskService } from "./work.js";
import { TenantError } from "@steward/db";

const url = process.env.DATABASE_URL ?? "postgres://steward:steward@localhost:5432/steward";
let available = false;
let db: Db;
let pool: pg.Pool;
const crypto = new EnvelopeCrypto(new EnvMasterKeyProvider("c".repeat(64)));
const uniq = () => Math.random().toString(36).slice(2, 10);

beforeAll(async () => {
  try {
    const probe = new pg.Pool({ connectionString: url, connectionTimeoutMillis: 1500 });
    await probe.query("select 1");
    await probe.end();
    available = true;
  } catch {
    available = false;
    return;
  }
  ({ db, pool } = createDb(url));
});
afterAll(async () => {
  await pool?.end();
});

const d = (name: string, fn: () => Promise<void>) => it(name, async () => {
  if (!available) return;
  await fn();
});

describe("core services (postgres)", () => {
  d("register → login → session rotation → revoke", async () => {
    const auth = new AuthService(db);
    const email = `u-${uniq()}@example.com`;
    const reg = await auth.register({ email, password: "correct horse battery", name: "Test" });
    expect(reg.user.email).toBe(email);
    expect(reg.organization.id).toBeTruthy();
    await expect(auth.register({ email, password: "correct horse battery", name: "Dup" })).rejects.toThrow();
    await expect(auth.login({ email, password: "wrong password!!" })).rejects.toThrow(/Invalid email or password/);
    await expect(auth.login({ email: "nobody@example.com", password: "wrong password!!" })).rejects.toThrow(/Invalid email or password/);
    const login = await auth.login({ email, password: "correct horse battery" });
    expect(login?.id).toBe(reg.user.id);
    const sess = await auth.createSession(reg.user.id, { ip: "127.0.0.1" });
    const resolved = await auth.resolveSession(sess.token);
    expect(resolved?.user.id).toBe(reg.user.id);
    expect(resolved?.session.rotatedToken).toBeUndefined();
    expect(await auth.revokeSession(sess.token)).toBe(true);
    expect(await auth.resolveSession(sess.token)).toBeNull();
    expect(await auth.resolveSession("bogus")).toBeNull();
  });

  d("company creation seeds agents, policies and budgets; tenancy is enforced", async () => {
    const auth = new AuthService(db);
    const reg = await auth.register({ email: `c-${uniq()}@example.com`, password: "correct horse battery", name: "Owner" });
    const orgScope: TenantScope = { organizationId: reg.organization.id, userId: reg.user.id, role: "owner", actor: { type: "user", userId: reg.user.id } };
    const companies = new CompanyService(db);
    const company = await companies.create(orgScope, { name: "Acme Widgets", autonomyLevel: 2, profile: { tagline: "Widgets for all" } });
    expect(company.slug).toBe("acme-widgets");
    const scope: TenantScope = { ...orgScope, companyId: company.id };
    const list = await companies.list(orgScope);
    expect(list.map((c) => c.id)).toContain(company.id);
    const policyRows = await companies.policies(scope);
    expect(policyRows.length).toBeGreaterThan(5);
    expect(policyRows.every((p) => ["allow", "approve", "deny"].includes(p.mode))).toBe(true);
    const budgets = await new BudgetService(db).list(scope);
    expect(budgets.map((b) => b.category).sort()).toEqual(["ai", "total"]);
    const profile = await companies.profile(scope);
    expect(profile?.version).toBe(1);
    expect(profile?.profile.tagline).toBe("Widgets for all");
    const v2 = await companies.saveProfile(scope, { ...profile!.profile, tagline: "v2" }, "user");
    expect(v2.version).toBe(2);

    // A second org cannot read the company.
    const other = await auth.register({ email: `o-${uniq()}@example.com`, password: "correct horse battery", name: "Other" });
    const foreign: TenantScope = { organizationId: other.organization.id, companyId: company.id, actor: { type: "user", userId: other.user.id } };
    expect(await companies.get(foreign)).toBeNull();
    expect(await companies.policies(foreign)).toEqual([]);
    // Company-scoped tables reject scopes without companyId.
    expect(() => new TaskService(db).list(orgScope)).toThrow(TenantError);

    const { AgentService } = await import("./work.js");
    const agentRows = await new AgentService(db).list(scope);
    expect(agentRows.map((a) => a.kind).sort()).toEqual(DEFAULT_AGENTS.map((a) => a.kind).sort());
  });

  d("approvals, tasks, runs and events are durable and correlated", async () => {
    const auth = new AuthService(db);
    const reg = await auth.register({ email: `a-${uniq()}@example.com`, password: "correct horse battery", name: "Owner" });
    const orgScope: TenantScope = { organizationId: reg.organization.id, userId: reg.user.id, role: "owner", actor: { type: "user", userId: reg.user.id } };
    const company = await new CompanyService(db).create(orgScope, { name: "Beta Co" });
    const scope: TenantScope = { ...orgScope, companyId: company.id };
    const events = new EventService(db);
    const before = await events.latestSeq();

    const tasks = new TaskService(db);
    const task = await tasks.create(scope, { title: "Ship landing page" });
    const runs = new RunService(db);
    const { AgentService } = await import("./work.js");
    const eng = (await new AgentService(db).list(scope)).find((a) => a.kind === "engineering")!;
    const run = await runs.create(scope, { agentId: eng.id, taskId: task.id, trigger: { kind: "user", instruction: "Ship it" } });
    await runs.setStatus(scope, run.id, "planning");
    const step = await runs.beginStep(scope, run.id, { kind: "plan", title: "Plan" });
    await runs.finishStep(scope, step.id, { status: "succeeded", output: { steps: 3 } });
    const steps = await runs.steps(scope, run.id);
    expect(steps).toHaveLength(1);
    expect(steps[0]!.status).toBe("succeeded");
    expect(steps[0]!.durationMs).toBeGreaterThanOrEqual(0);

    const signals: string[] = [];
    const approvals = new ApprovalService(db, { notify: async (wf, id) => void signals.push(`${wf}:${id}`) });
    const approval = await approvals.request(scope, { action: "email.send", reason: "Outreach", payload: { to: "x@example.com" }, risk: "HIGH", dimension: "email_send", affectedSystem: "resend", alternatives: [], expiresInSeconds: 60, runId: run.id, workflowId: "wf-1" });
    expect(approval.status).toBe("pending");
    expect(await approvals.pendingCount(scope)).toBe(1);
    // System actors cannot approve.
    await expect(approvals.resolve({ ...scope, actor: { type: "system", component: "t" } }, approval.id, { status: "approved" })).rejects.toThrow();
    const resolved = await approvals.resolve(scope, approval.id, { status: "approved", note: "ok" });
    expect(resolved?.status).toBe("approved");
    expect(resolved?.signalDelivered).toBe(true);
    expect(signals).toEqual([`wf-1:${approval.id}`]);
    // Double-resolve is a no-op.
    expect(await approvals.resolve(scope, approval.id, { status: "denied" })).toBeNull();

    // A decision is durable before it is delivered: an unreachable workflow must not turn a recorded
    // decision into a thrown error, because the row has already changed and a retry would be refused.
    const unreachable = new ApprovalService(db, { notify: async () => { throw new Error("temporal unavailable"); } });
    const stranded = await unreachable.request(scope, { action: "email.send", reason: "Outreach", payload: { to: "y@example.com" }, risk: "HIGH", dimension: "email_send", affectedSystem: "resend", alternatives: [], expiresInSeconds: 60, runId: run.id, workflowId: "wf-2" });
    const undelivered = await unreachable.resolve(scope, stranded.id, { status: "approved" });
    expect(undelivered?.status).toBe("approved");
    expect(undelivered?.signalDelivered).toBe(false);
    const failedEvent = (await events.since(scope, before)).find((e) => e.type === "approval.signal_failed");
    expect(failedEvent?.payload).toMatchObject({ approvalId: stranded.id, workflowId: "wf-2", error: "workflow signal unavailable; the recorded decision can be recovered by the worker" });
    // A request with no workflow is recorded, and says so rather than claiming the run was resumed.
    const detached = await approvals.request(scope, { action: "email.send", reason: "Outreach", payload: { to: "z@example.com" }, risk: "HIGH", dimension: "email_send", affectedSystem: "resend", alternatives: [], expiresInSeconds: 60 });
    expect((await approvals.resolve(scope, detached.id, { status: "denied" }))?.signalDelivered).toBeNull();
    // A workflow is attached but this deployment has no client to reach it: a promise of resumption here
    // would be a lie, so it is reported as undelivered like any other failed hand-off.
    const clientless = new ApprovalService(db);
    const attached = await clientless.request(scope, { action: "email.send", reason: "Outreach", payload: { to: "w@example.com" }, risk: "HIGH", dimension: "email_send", affectedSystem: "resend", alternatives: [], expiresInSeconds: 60, workflowId: "wf-3" });
    const notDelivered = await clientless.resolve(scope, attached.id, { status: "approved" });
    expect(notDelivered?.signalDelivered).toBe(false);
    const clientlessEvent = (await events.since(scope, before)).filter((e) => e.type === "approval.signal_failed");
    expect(clientlessEvent.map((e) => (e.payload as { error?: string }).error)).toContain("no workflow client is configured in this deployment");

    await runs.setStatus(scope, run.id, "succeeded", { result: { summary: "done" } });
    await tasks.update(scope, task.id, { status: "done" });

    const evs = await events.since(scope, before);
    const types = evs.map((e) => e.type);
    for (const t of ["task.created", "run.created", "run.status", "run.step", "approval.requested", "approval.resolved", "run.completed", "task.completed"]) expect(types).toContain(t);
    const runEvents = evs.filter((e) => (e.correlation as { runId?: string }).runId === run.id);
    expect(runEvents.length).toBeGreaterThanOrEqual(5);
    // Events are ordered and strictly increasing.
    expect(evs.every((e, i) => i === 0 || e.seq > evs[i - 1]!.seq)).toBe(true);
  });

  d("budgets: charge, threshold events and hard stop", async () => {
    const auth = new AuthService(db);
    const reg = await auth.register({ email: `b-${uniq()}@example.com`, password: "correct horse battery", name: "Owner" });
    const orgScope: TenantScope = { organizationId: reg.organization.id, userId: reg.user.id, role: "owner", actor: { type: "user", userId: reg.user.id } };
    const company = await new CompanyService(db).create(orgScope, { name: "Gamma" });
    const scope: TenantScope = { ...orgScope, companyId: company.id };
    const budgets = new BudgetService(db);
    await budgets.set(scope, { category: "ai", limitUsd: 10, softThresholdPct: 50 });
    const events = new EventService(db);
    const before = await events.latestSeq();
    await budgets.charge(scope, "ai", 6, { refType: "test" });
    const st = (await budgets.list(scope)).find((b) => b.category === "ai")!;
    expect(st.spentUsd).toBeCloseTo(6);
    expect(st.overSoftThreshold).toBe(true);
    expect(st.exhausted).toBe(false);
    const evs = await events.since(scope, before);
    expect(evs.map((e) => e.type)).toContain("budget.threshold");
    await expect(budgets.assertAvailable(scope, "ai", 5)).rejects.toThrow(BudgetExhaustedError);
    await budgets.assertAvailable(scope, "ai", 3);
    await budgets.charge(scope, "ai", 5);
    expect((await budgets.list(scope)).find((b) => b.category === "ai")!.exhausted).toBe(true);
    const evs2 = await events.since(scope, before);
    expect(evs2.map((e) => e.type)).toContain("budget.exhausted");
  });

  d("integrations are company-scoped, inherited read-only and redact inherited webhook URLs", async () => {
    const auth = new AuthService(db);
    const suffix = uniq();
    const reg = await auth.register({ email: `i-${suffix}@example.com`, password: "correct horse battery", name: "Owner" });
    const orgScope: TenantScope = { organizationId: reg.organization.id, userId: reg.user.id, role: "owner", actor: { type: "user", userId: reg.user.id } };
    const companies = new CompanyService(db);
    const companyA = await companies.create(orgScope, { name: `Integration A ${suffix}` });
    const companyB = await companies.create(orgScope, { name: `Integration B ${suffix}` });
    const scopeA: TenantScope = { ...orgScope, companyId: companyA.id };
    const scopeB: TenantScope = { ...orgScope, companyId: companyB.id };
    const viewerScopeA: TenantScope = { ...scopeA, role: "viewer" };
    const integrations = new IntegrationService(db, crypto, { apiUrl: "http://localhost:4000" });
    const orgIntegration = await integrations.connectWithFields(orgScope, { type: "stripe", fields: { secret_key: `sk_test_org_${suffix}` }, label: `Org Stripe ${suffix}` });
    const integrationA = await integrations.connectWithFields(scopeA, { type: "stripe", fields: { secret_key: `sk_test_a_${suffix}` }, label: `Company A Stripe ${suffix}` });
    const integrationB = await integrations.connectWithFields(scopeB, { type: "stripe", fields: { secret_key: `sk_test_b_${suffix}` }, label: `Company B Stripe ${suffix}` });

    const companyIntegrations = await integrations.list(scopeA);
    expect(companyIntegrations.map((integration) => integration.id)).toContain(orgIntegration.id);
    expect(companyIntegrations.map((integration) => integration.id)).toContain(integrationA.id);
    expect(companyIntegrations.map((integration) => integration.id)).not.toContain(integrationB.id);
    expect(companyIntegrations.find((integration) => integration.id === orgIntegration.id)?.webhookUrl).toBeNull();
    expect((await integrations.get(scopeA, orgIntegration.id))?.webhookUrl).toBeNull();
    const viewerIntegrations = await integrations.list(viewerScopeA);
    expect(viewerIntegrations.find((integration) => integration.id === integrationA.id)?.webhookUrl).toBeNull();
    expect(viewerIntegrations.find((integration) => integration.id === orgIntegration.id)?.webhookUrl).toBeNull();
    expect(await integrations.disconnect(scopeA, orgIntegration.id)).toBe(false);
    expect(await integrations.disconnect(scopeA, integrationB.id)).toBe(false);
    expect(await integrations.disconnect(scopeA, integrationA.id)).toBe(true);

    const orgIntegrations = await integrations.list(orgScope);
    expect(orgIntegrations.map((integration) => integration.id)).toContain(orgIntegration.id);
    expect((await integrations.get(orgScope, orgIntegration.id))?.webhookUrl).not.toBeNull();
    expect(await integrations.disconnect(orgScope, orgIntegration.id)).toBe(true);
    expect(await integrations.disconnect(scopeB, integrationB.id)).toBe(true);
  });

  d("provider credentials are encrypted at rest and never returned in plaintext", async () => {
    const auth = new AuthService(db);
    const reg = await auth.register({ email: `p-${uniq()}@example.com`, password: "correct horse battery", name: "Owner" });
    const orgScope: TenantScope = { organizationId: reg.organization.id, userId: reg.user.id, role: "owner", actor: { type: "user", userId: reg.user.id } };
    const svc = new ProviderCredentialService(db, crypto);
    const apiKey = `sk-test-${uniq()}ABCD`;
    const created = await svc.create(orgScope, { providerType: "openai", secret: apiKey });
    expect(created.secretLast4).toBe("ABCD");
    expect(JSON.stringify(created)).not.toContain(apiKey);
    const listed = await svc.list(orgScope);
    expect(JSON.stringify(listed)).not.toContain(apiKey);
    const raw = await pool.query("select secret::text as s from provider_credentials where id=$1", [created.id]);
    expect(raw.rows[0].s).not.toContain(apiKey);
    const resolved = await svc.resolveForGateway(orgScope);
    expect(resolved[0]?.credential.apiKey).toBe(apiKey);
    await expect(svc.create(orgScope, { providerType: "nope", secret: "x" })).rejects.toThrow();
    await expect(svc.create(orgScope, { providerType: "anthropic" })).rejects.toThrow(/credential is required/);
    // Local providers need no secret.
    const ollama = await svc.create(orgScope, { providerType: "ollama" });
    expect(ollama.local).toBe(true);
    // Other org cannot see it.
    const other = await auth.register({ email: `q-${uniq()}@example.com`, password: "correct horse battery", name: "O" });
    expect(await svc.list({ organizationId: other.organization.id, actor: { type: "user", userId: other.user.id } })).toEqual([]);
    expect(await svc.delete({ organizationId: other.organization.id, actor: { type: "user", userId: other.user.id } }, created.id)).toBe(false);
    expect(await svc.delete(orgScope, created.id)).toBe(true);
  });

  d("NVIDIA public discovery and legacy verified rows never certify credentials", async () => {
    const auth = new AuthService(db);
    const reg = await auth.register({ email: `nim-${uniq()}@example.com`, password: "correct horse battery", name: "Owner" });
    const scope: TenantScope = { organizationId: reg.organization.id, actor: { type: "user", userId: reg.user.id } };
    const svc = new ProviderCredentialService(db, crypto);
    const saved = await svc.create(scope, { providerType: "nvidia", secret: "invalid-nim-fixture" });
    await pool.query("update provider_credentials set status='verified', last_verified_at=now() where id=$1", [saved.id]);
    expect((await svc.list(scope))[0]).toMatchObject({ status: "catalog_only", lastVerifiedAt: null });
    const f = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: "deepseek-ai/deepseek-v4.1-flash" }] })));
    vi.stubGlobal("fetch", f);
    try {
      expect(await svc.test({ organizationId: "other-org", actor: scope.actor }, saved.id)).toBeNull();
      expect(f).not.toHaveBeenCalled();
      expect(await svc.test(scope, saved.id)).toEqual({ ok: true, models: 1, verification: "catalog_only" });
      const row = (await pool.query("select status, last_verified_at from provider_credentials where id=$1", [saved.id])).rows[0];
      expect(row).toEqual({ status: "catalog_only", last_verified_at: null });
      expect(JSON.stringify(await svc.list(scope))).not.toContain("invalid-nim-fixture");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
