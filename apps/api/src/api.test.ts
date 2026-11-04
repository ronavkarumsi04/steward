/**
 * API integration tests against real Postgres (docker-compose defaults) and a real-HTTP
 * OpenAI-compatible stub provider. Temporal is not required: the durable run pipeline is driven
 * in-process through the same AgentRuntime the worker uses. Skipped when Postgres is unreachable.
 */
import { createHmac } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import pg from "pg";
import { AgentRuntime, AgentServiceFactory, buildToolRegistry, registryWithMcpTools } from "@steward/agents";
import { BrowserAction } from "@steward/browser";
import { AuthService, OrganizationService, createCoreContext, internalServiceToken, loadConfig, type CoreContext, type MailMessage, type Mailer } from "@steward/core";
import { runMigrations } from "@steward/db";
import { SUITE } from "@steward/evals";
import { REQUIRED_AGREEMENTS, REQUIRED_VERSIONS } from "@steward/legal";
import type { TenantScope } from "@steward/schema";
import type { WorkflowClient } from "@steward/workflows";
import { createApp } from "./app.js";
import { CompanionHub } from "./companion-hub.js";
import { runEvalSuite, SCRIPT_FOR_BACKEND } from "./test/eval-harness.js";
import { startSmtpSink, type SmtpSink } from "./test/smtp-sink.js";
import { startStubProvider, type StubProvider } from "./test/stub-provider.js";
import { startFakeGitHub } from "@steward/core/test/fake-github";
import { FakeBrowserProvider } from "@steward/core/test/fake-browser";

const DB_URL = process.env.DATABASE_URL ?? "postgres://steward:steward@localhost:5432/steward";
const ENV: NodeJS.ProcessEnv = {
  DATABASE_URL: DB_URL,
  STEWARD_MASTER_KEY: "a".repeat(64),
  SESSION_SECRET: "b".repeat(64),
  APP_URL: "http://app.test",
  API_URL: "http://api.test",
  WEBHOOK_GITHUB_SECRET: "gh-webhook-secret",
  LOG_LEVEL: "silent",
  RATE_LIMIT_DISABLED: "true",
};

let available = false;
let core: CoreContext;
let closedCore: CoreContext;
let services: AgentServiceFactory;
let app: ReturnType<typeof createApp>["app"];
/** Same database, but ALLOW_SIGNUP=false. */
let closedApp: ReturnType<typeof createApp>["app"];
let stub: StubProvider;
const uniq = () => Math.random().toString(36).slice(2, 10);

const outbox: MailMessage[] = [];
const mailer: Mailer = { provider: "console", send: async (m) => void outbox.push(m) };
const lastMailTo = (email: string) => [...outbox].reverse().find((m) => m.to === email);
/** Extracts the last path segment of the first URL in an email body (the one-time token). */
const tokenFromMail = (m: MailMessage) => /https?:\/\/\S+\/([A-Za-z0-9_-]+)/.exec(m.text)?.[1];

beforeAll(async () => {
  try {
    const probe = new pg.Pool({ connectionString: DB_URL, connectionTimeoutMillis: 1500 });
    await probe.query("select 1");
    await probe.end();
    available = true;
  } catch {
    return;
  }
  process.env.DATABASE_URL = DB_URL;
  await runMigrations();
  core = createCoreContext(loadConfig(ENV), "api-test");
  const companionHub = new CompanionHub();
  services = new AgentServiceFactory({ core, env: ENV, companionBridge: companionHub });
  app = createApp({ core, auth: new AuthService(core.db), mailer, services, workflows: fakeTemporal(), companionHub, env: ENV }, null).app;
  const closedEnv = { ...ENV, ALLOW_SIGNUP: "false" };
  closedCore = createCoreContext(loadConfig(closedEnv), "api-test-closed");
  closedApp = createApp({ core: closedCore, auth: new AuthService(closedCore.db), mailer, services, workflows: fakeTemporal(), companionHub, env: closedEnv }, null).app;
  stub = await startStubProvider();
});
afterAll(async () => {
  await stub?.close();
  await core?.pool.end();
  await closedCore?.pool.end();
});

/**
 * The budget for a test in this file, and why it is not the 5 s default.
 *
 * Every test here is an integration test: it boots the app against a real Postgres, and most of them drive
 * HTTP, webhooks, an in-process agent runtime or a stub provider. At the default 5 s the suite stopped
 * measuring the product and started measuring the runner — a case that takes four seconds on a laptop crossed
 * five on a loaded CI box and turned a working suite red. The budget is a hang guard, so it is generous on
 * purpose, and the one test that genuinely costs seconds states its own.
 */
const TEST_BUDGET_MS = 30_000;
/** Seven scripted backends, driven end to end through the runtime the worker uses, judged on recorded rows. */
const EVAL_SUITE_BUDGET_MS = 120_000;

const d = (name: string, fn: () => Promise<void>, timeoutMs = TEST_BUDGET_MS) =>
  it(
    name,
    async () => {
      if (!available) return;
      await fn();
    },
    timeoutMs,
  );

interface Client {
  token: string;
  cookie: string;
  call(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<Response>;
  json<T = Record<string, unknown>>(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<{ status: number; body: T }>;
}

function client(token = "", cookie = "", target: () => typeof app = () => app): Client {
  const c: Client = {
    token,
    cookie,
    call: async (method, path, body, headers = {}) =>
      target().request(`http://api.test/v1${path}`, {
        method,
        headers: {
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
          ...(c.token ? { authorization: `Bearer ${c.token}` } : {}),
          ...(c.cookie ? { cookie: c.cookie } : {}),
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      }),
    json: async (method, path, body, headers) => {
      const res = await c.call(method, path, body, headers);
      const text = await res.text();
      return { status: res.status, body: (text ? JSON.parse(text) : {}) as never };
    },
  };
  return c;
}

/**
 * The clickwrap versions a client must send, taken from the same registry the API enforces. Every
 * registration in this suite goes through here, which is also what keeps the requirement honest: if
 * acceptance became optional, these registrations would still pass but the explicit test below would fail.
 */
const CLICKWRAP = REQUIRED_AGREEMENTS.map((document) => ({ document, version: REQUIRED_VERSIONS[document] }));

/** The two texts the code IDE's cases read from the local GitHub server. */
const README_TEXT = "# Northwind\n\nWeekly revenue reports.\n";
const APP_TEXT = "export const revenue = (cents: number) => cents / 100;\n";

async function register(name = "Founder") {
  const email = `${name.toLowerCase()}-${uniq()}@example.com`;
  const anon = client();
  const res = await anon.call("POST", "/auth/register", { email, password: "correct-horse-battery", name, accepted: CLICKWRAP });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { token: string; user: { id: string }; organization: { id: string } };
  const setCookie = res.headers.get("set-cookie") ?? "";
  const cookie = setCookie.split(";")[0] ?? "";
  return { email, orgId: body.organization.id, userId: body.user.id, token: body.token, api: client(body.token), cookieApi: client("", cookie), cookie };
}

/**
 * Records workflow starts/signals without a Temporal server. Runs are still persisted durably by the
 * API; the runtime itself is driven in-process below, exactly as the worker activities do.
 */
const temporalCalls: Array<{ op: string; args: unknown[] }> = [];
function fakeTemporal(): WorkflowClient {
  const double: Pick<WorkflowClient, "readiness" | "startRun" | "signalApproval" | "cancelRun" | "runStatus" | "upsertSchedule" | "deleteSchedule" | "triggerSchedule"> = {
    async readiness() { return { connected: true, workers: true }; },
    async startRun(input) {
      temporalCalls.push({ op: "startRun", args: [input] });
      return { workflowId: `agent-run-${input.runId}`, workflowRunId: "fake-run" };
    },
    async signalApproval(workflowId, decision) {
      temporalCalls.push({ op: "signalApproval", args: [workflowId, decision] });
      return true;
    },
    async cancelRun(runId, reason) {
      temporalCalls.push({ op: "cancelRun", args: [runId, reason] });
      return true;
    },
    async runStatus() {
      return null;
    },
    // A schedule is the one thing a workflow drawing registers with the engine, so the double answers for it
    // too: without these a published schedule would be a row nothing ticks, and the test could not tell.
    async upsertSchedule(input) {
      temporalCalls.push({ op: "upsertSchedule", args: [input] });
      return `schedule-${input.scheduleId}`;
    },
    async deleteSchedule(scheduleId) {
      temporalCalls.push({ op: "deleteSchedule", args: [scheduleId] });
    },
    async triggerSchedule(scheduleId) {
      temporalCalls.push({ op: "triggerSchedule", args: [scheduleId] });
    },
  };
  return double as WorkflowClient;
}

describe("auth + sessions", () => {
  d("registration requires accepting the current legal documents, and records what was accepted", async () => {
    const anon = client();
    const email = `clickwrap-${uniq()}@example.com`;

    // No acceptance at all: rejected before an account exists.
    expect((await anon.json("POST", "/auth/register", { email, password: "correct-horse-battery", name: "No Accept" })).status).toBe(422);

    // A stale version is refused with an explicit code rather than silently recorded.
    const stale = await anon.json<{ error: { code: string } }>("POST", "/auth/register", {
      email,
      password: "correct-horse-battery",
      name: "Stale Accept",
      accepted: [{ document: "terms", version: "0.0.1" }, { document: "privacy", version: REQUIRED_VERSIONS.privacy }, { document: "acceptable-use", version: REQUIRED_VERSIONS["acceptable-use"] }],
    });
    expect(stale.status).toBe(403);
    expect(stale.body.error.code).toBe("forbidden");

    // Accepting the current versions creates the account and stores one record per document.
    const ok = await anon.json<{ token: string }>("POST", "/auth/register", { email, password: "correct-horse-battery", name: "Accepts", accepted: CLICKWRAP });
    expect(ok.status).toBe(201);
    const api = client(ok.body.token);
    const agreements = await api.json<{ accepted: Array<{ document: string; version: string }>; pending: unknown[]; history: Array<{ statement: string; source: string; ip: string | null; userAgent: string | null }> }>("GET", "/auth/agreements");
    expect(agreements.body.accepted.map((a) => a.document).sort()).toEqual([...REQUIRED_AGREEMENTS].sort());
    expect(agreements.body.pending).toHaveLength(0);
    // Evidence: the statement shown, the source, and where it came from.
    expect(agreements.body.history[0]?.statement).toContain("I accept the");
    expect(agreements.body.history[0]?.source).toBe("web");
    // At least one provenance field must be captured (the in-process test client sends no user agent).
    expect(agreements.body.history[0]?.ip ?? agreements.body.history[0]?.userAgent).toBeTruthy();

    // /auth/me drives the in-app gate and must report nothing outstanding.
    expect((await api.json<{ pendingAgreements: unknown[] }>("GET", "/auth/me")).body.pendingAgreements).toEqual([]);
  });

  d("register → me → logout invalidates bearer + cookie", async () => {
    const { api, cookieApi, email, orgId } = await register();
    expect((await api.json("GET", "/auth/me")).body).toMatchObject({ user: { email } });
    expect((await cookieApi.json("GET", "/auth/me")).body).toMatchObject({ user: { email } });
    expect((await api.json("POST", "/auth/logout")).status).toBe(200);
    expect((await api.json<{ user: unknown }>("GET", "/auth/me")).body.user).toBeNull();
    expect((await cookieApi.json<{ user: unknown }>("GET", "/auth/me")).body.user).toBeNull();
    expect((await api.json("GET", `/orgs/${orgId}`)).status).toBe(401);
  });

  d("cookie-authenticated mutations need Origin or the CSRF header; bearer does not", async () => {
    const { cookieApi, api, orgId } = await register();
    const blocked = await cookieApi.json("POST", `/orgs/${orgId}/companies`, { name: "X" });
    expect(blocked.status).toBe(403);
    const okOrigin = await cookieApi.json("POST", `/orgs/${orgId}/companies`, { name: "X" }, { origin: "http://app.test" });
    expect(okOrigin.status).toBe(201);
    const okHeader = await cookieApi.json("POST", `/orgs/${orgId}/companies`, { name: "Y" }, { "x-steward-csrf": "1" });
    expect(okHeader.status).toBe(201);
    const evilOrigin = await cookieApi.json("POST", `/orgs/${orgId}/companies`, { name: "Z" }, { origin: "http://evil.test" });
    expect(evilOrigin.status).toBe(403);
    expect((await api.json("POST", `/orgs/${orgId}/companies`, { name: "W" })).status).toBe(201);
  });

  d("rejects weak passwords and bad credentials", async () => {
    const anon = client();
    expect((await anon.json("POST", "/auth/register", { email: `w-${uniq()}@example.com`, password: "short", name: "W" })).status).toBe(422);
    expect((await anon.json("POST", "/auth/login", { email: "nobody@example.com", password: "wrong-password-xx" })).status).toBe(401);
  });

  d("forgot/reset password: 202 for unknown emails, one-time token, old sessions revoked", async () => {
    const { api, email } = await register("Reset");
    const anon = client();
    const before = outbox.length;
    expect((await anon.json("POST", "/auth/password/forgot", { email: `ghost-${uniq()}@example.com` })).status).toBe(202);
    expect(outbox.length).toBe(before);
    expect((await anon.json("POST", "/auth/password/forgot", { email })).status).toBe(202);
    const mail = lastMailTo(email)!;
    expect(mail.subject).toMatch(/reset/i);
    const token = tokenFromMail(mail)!;
    expect(token.startsWith("reset_")).toBe(true);
    expect((await anon.json("POST", "/auth/password/reset", { token: "reset_bogus_token_value", password: "another-long-password" })).status).toBe(400);
    const reset = await anon.json<{ token: string }>("POST", "/auth/password/reset", { token, password: "brand-new-passphrase" });
    expect(reset.status).toBe(200);
    expect((await anon.json("POST", "/auth/password/reset", { token, password: "replay-attempt-pass" })).status).toBe(400);
    expect((await api.json<{ user: unknown }>("GET", "/auth/me")).body.user).toBeNull();
    expect((await anon.json("POST", "/auth/login", { email, password: "correct-horse-battery" })).status).toBe(401);
    expect((await anon.json("POST", "/auth/login", { email, password: "brand-new-passphrase" })).status).toBe(200);
    expect((await client(reset.body.token).json("GET", "/auth/me")).body).toMatchObject({ user: { email } });
  });
});

describe("sign-up policy (ALLOW_SIGNUP=false)", () => {
  const closed = () => client("", "", () => closedApp);

  d("advertises closed sign-up and rejects public registration once a user exists", async () => {
    await register(); // guarantees bootstrap is over
    expect((await closed().json("GET", "/auth/config")).body).toEqual({ signupOpen: false, inviteOnly: true });
    expect((await client().json("GET", "/auth/config")).body).toEqual({ signupOpen: true, inviteOnly: false });
    const res = await closed().json<{ error: { code: string } }>("POST", "/auth/register", { email: `late-${uniq()}@example.com`, password: "correct-horse-battery", name: "Late", accepted: CLICKWRAP });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("signup_closed");
  });

  d("invited emails can still register; the invite is accepted atomically and emailed", async () => {
    const owner = await register("Owner");
    const email = `invitee-${uniq()}@example.com`;
    const inv = await owner.api.json<{ acceptUrl: string; emailed: boolean }>("POST", `/orgs/${owner.orgId}/invitations`, { email, role: "member" });
    expect(inv.status).toBe(201);
    expect(inv.body.emailed).toBe(true);
    const token = inv.body.acceptUrl.split("/").pop()!;
    expect(tokenFromMail(lastMailTo(email)!)).toBe(token);
    expect((await client().json<{ invitation: { email: string } }>("GET", `/invitations/${token}`)).body.invitation).toMatchObject({ email, role: "member" });
    expect((await client().json("GET", `/invitations/not-a-real-token`)).status).toBe(404);

    const wrongEmail = await closed().json<{ error: { code: string } }>("POST", "/auth/register", { email: `other-${uniq()}@example.com`, password: "correct-horse-battery", name: "Other", inviteToken: token, accepted: CLICKWRAP });
    expect(wrongEmail.status).toBe(400);
    expect(wrongEmail.body.error.code).toBe("invitation_email_mismatch");
    const joined = await closed().json<{ token: string; joined: { organizationId: string; role: string } }>("POST", "/auth/register", { email, password: "correct-horse-battery", name: "Invitee", inviteToken: token, accepted: CLICKWRAP });
    expect(joined.status).toBe(201);
    expect(joined.body.joined).toEqual({ organizationId: owner.orgId, role: "member" });
    expect((await client(joined.body.token).json("GET", `/orgs/${owner.orgId}`)).status).toBe(200);
    const orgs = await client(joined.body.token).json<{ organizations: { organizationId: string }[] }>("GET", "/orgs");
    expect(orgs.body.organizations.map((o) => o.organizationId)).toEqual([owner.orgId]);
    const replay = await closed().json<{ error: { code: string } }>("POST", "/auth/register", { email: `again-${uniq()}@example.com`, password: "correct-horse-battery", name: "Again", inviteToken: token, accepted: CLICKWRAP });
    expect(replay.status).toBe(400);
    expect(replay.body.error.code).toBe("invalid_invitation");
  });
});

describe("tenancy + RBAC", () => {
  d("users cannot read or mutate another organization's company", async () => {
    const a = await register("Alice");
    const b = await register("Bob");
    const co = await a.api.json<{ company: { id: string } }>("POST", `/orgs/${a.orgId}/companies`, { name: "Alice Co" });
    expect(co.status).toBe(201);
    expect((await b.api.json("GET", `/companies/${co.body.company.id}`)).status).toBe(404);
    expect((await b.api.json("PATCH", `/companies/${co.body.company.id}`, { name: "pwned" })).status).toBe(404);
    expect((await b.api.json("GET", `/orgs/${a.orgId}/companies`)).status).toBe(404);
    expect((await b.api.json("GET", `/orgs/${a.orgId}/providers`)).status).toBe(404);
  });

  d("revoking an invitation after preview rolls back the invited account and acceptance", async () => {
    const owner = await register();
    const email = `revoked-${uniq()}@example.com`;
    const inv = await owner.api.json<{ invitation: { id: string }; acceptUrl: string }>("POST", `/orgs/${owner.orgId}/invitations`, { email, role: "member" });
    const original = AuthService.prototype.hashPassword;
    const revoke = vi.spyOn(AuthService.prototype, "hashPassword").mockImplementationOnce(async function (this: AuthService, password) {
      const hash = await original.call(this, password);
      await new OrganizationService(core.db).revokeInvitation(owner.orgId, inv.body.invitation.id);
      return hash;
    });
    try {
      const result = await client().json<{ error: { code: string } }>("POST", "/auth/register", {
        email, password: "long-enough-password", name: "Invited founder", inviteToken: inv.body.acceptUrl.split("/").at(-1), accepted: CLICKWRAP,
      });
      expect(result.status).toBe(400);
      expect(result.body.error.code).toBe("invalid_invitation");
      expect(await new AuthService(core.db).findUserByEmail(email)).toBeNull();
    } finally { revoke.mockRestore(); }
  });

  d("invited viewer can read but not mutate; role change unlocks it", async () => {
    const owner = await register("Owner");
    const viewer = await register("Viewer");
    const co = await owner.api.json<{ company: { id: string } }>("POST", `/orgs/${owner.orgId}/companies`, { name: "Team Co" });
    const inv = await owner.api.json<{ invitation: { id: string }; acceptUrl: string }>("POST", `/orgs/${owner.orgId}/invitations`, { email: viewer.email, role: "viewer" });
    expect(inv.status).toBe(201);
    expect((await viewer.api.json("POST", "/invitations/accept", { token: inv.body.acceptUrl.split("/").pop() })).status).toBe(200);
    expect((await viewer.api.json("GET", `/companies/${co.body.company.id}`)).status).toBe(200);
    expect((await viewer.api.json("POST", `/companies/${co.body.company.id}/goals`, { title: "Nope" })).status).toBe(403);
    const members = await owner.api.json<{ members: Array<{ userId: string }> }>("GET", `/orgs/${owner.orgId}/members`);
    expect(members.body.members.some((x) => x.userId === viewer.userId)).toBe(true);
    expect((await owner.api.json("PATCH", `/orgs/${owner.orgId}/members/${viewer.userId}`, { role: "member" })).status).toBe(200);
    expect((await viewer.api.json("POST", `/companies/${co.body.company.id}/goals`, { title: "Ship v1" })).status).toBe(201);
    expect((await viewer.api.json("PATCH", `/orgs/${owner.orgId}/members/${owner.userId}`, { role: "viewer" })).status).toBe(403);
  });
});

describe("providers", () => {
  d("stores secrets encrypted, never returns them, and tests live against the provider", async () => {
    const { api, orgId } = await register();
    const created = await api.json<{ provider: Record<string, unknown> }>("POST", `/orgs/${orgId}/providers`, { providerType: "openai_compatible", secret: stub.apiKey, baseUrl: stub.baseUrl, label: "stub" });
    expect(created.status).toBe(201);
    expect(JSON.stringify(created.body)).not.toContain(stub.apiKey);
    expect(created.body.provider.secretLast4).toBe(stub.apiKey.slice(-4));
    const id = created.body.provider.id as string;
    const test = await api.json<{ ok: boolean }>("POST", `/orgs/${orgId}/providers/${id}/test`);
    expect(test.body.ok).toBe(true);
    const models = await api.json<{ models: Array<{ model: { id: string } }> }>("GET", `/orgs/${orgId}/providers/models`);
    expect(models.body.models.map((m) => m.model.id)).toContain("stub-1");
    const { rows } = await core.pool.query("select secret::text as c from provider_credentials where id = $1", [id]);
    expect(rows[0].c).not.toContain(stub.apiKey);

    const bad = await api.json<{ provider: { id: string } }>("POST", `/orgs/${orgId}/providers`, { providerType: "openai_compatible", secret: "wrong-key", baseUrl: stub.baseUrl });
    const badTest = await api.json<{ ok: boolean; error: { code: string } }>("POST", `/orgs/${orgId}/providers/${bad.body.provider.id}/test`);
    expect(badTest.body.ok).toBe(false);
    expect(badTest.body.error.code).toBe("auth");
    expect((await api.json("GET", `/providers/types`)).status).toBe(200);
  });

  d("business pulse is safe before payment integrations are connected", async () => {
    const { api, orgId } = await register();
    const co = await api.json<{ company: { id: string } }>("POST", `/orgs/${orgId}/companies`, { name: "Pulse Labs", autonomyLevel: 1, profile: { description: "x", stage: "idea" } });
    const pulse = await api.json<{ payments: { connected: boolean; available: boolean; provider: string | null }; revenue: unknown }>("GET", `/companies/${co.body.company.id}/business/pulse?days=30`);
    expect(pulse.status).toBe(200);
    expect(pulse.body.payments).toEqual({ connected: false, available: false, provider: null });
    expect(pulse.body.revenue).toBeNull();
    expect(JSON.stringify(pulse.body)).not.toMatch(/secret|token|credential/i);
  });

  d("routing policies are per company and round-trip", async () => {
    const { api, orgId } = await register();
    const co = await api.json<{ company: { id: string } }>("POST", `/orgs/${orgId}/companies`, { name: "Routed", autonomyLevel: 1, profile: { description: "x", stage: "idea" } });
    const companyId = co.body.company.id;
    expect((await api.json("GET", `/orgs/${orgId}/routing/coding`)).status).toBe(422);
    const policy = { fallbackChain: [], requirements: { preference: "quality", localOnly: false } };
    expect((await api.json("PUT", `/orgs/${orgId}/routing/coding?companyId=${companyId}`, policy)).status).toBe(200);
    const got = await api.json<{ policy: { requirements: { preference: string } } }>("GET", `/orgs/${orgId}/routing/coding?companyId=${companyId}`);
    expect(got.body.policy.requirements.preference).toBe("quality");
  });
});

describe("project workspace", () => {
  d("keeps multi-thread work together and rejects cross-company project links", async () => {
    const a = await register("ProjectA");
    const first = await a.api.json<{ company: { id: string } }>("POST", `/orgs/${a.orgId}/companies`, { name: "Project Co", autonomyLevel: 2, profile: { description: "x", stage: "idea" } });
    const companyId = first.body.company.id;
    const created = await a.api.json<{ project: { id: string; status: string; objective: string } }>("POST", `/companies/${companyId}/projects`, { name: "Launch pilot", objective: "Put a verified pilot in front of real design partners", successSignal: "Three partners complete onboarding", nextStep: "Prepare the first pilot build" });
    expect(created.status).toBe(201);
    expect(created.body.project).toMatchObject({ status: "active", objective: "Put a verified pilot in front of real design partners" });
    const projectId = created.body.project.id;

    const task = await a.api.json<{ task: { id: string; projectId: string | null } }>("POST", `/companies/${companyId}/tasks`, { title: "Build onboarding pilot", description: "Smallest verified pilot", projectId, start: false });
    expect(task.status).toBe(201);
    expect(task.body.task.projectId).toBe(projectId);
    const conversation = await a.api.json<{ conversation: { id: string; projectId: string | null } }>("POST", `/companies/${companyId}/conversations`, { title: "Pilot thread", projectId });
    expect(conversation.body.conversation.projectId).toBe(projectId);
    const campaign = await a.api.json<{ campaign: { id: string; projectId: string | null } }>("POST", `/companies/${companyId}/campaigns`, { name: "Pilot outreach", channel: "email", objective: "Reach qualified design partners", projectId });
    expect(campaign.body.campaign.projectId).toBe(projectId);

    const snapshot = await a.api.json<{ project: { id: string; nextStep: string }; tasks: Array<{ id: string }>; conversations: Array<{ id: string }>; campaigns: Array<{ id: string }> }>("GET", `/companies/${companyId}/projects/${projectId}`);
    expect(snapshot.body.project.id).toBe(projectId);
    expect(snapshot.body.tasks.map((x) => x.id)).toContain(task.body.task.id);
    expect(snapshot.body.conversations.map((x) => x.id)).toContain(conversation.body.conversation.id);
    expect(snapshot.body.campaigns.map((x) => x.id)).toContain(campaign.body.campaign.id);

    const updated = await a.api.json<{ project: { status: string; nextStep: string } }>("PATCH", `/companies/${companyId}/projects/${projectId}`, { status: "blocked", nextStep: "Get founder approval for pilot scope" });
    expect(updated.body.project).toMatchObject({ status: "blocked", nextStep: "Get founder approval for pilot scope" });

    const second = await a.api.json<{ company: { id: string } }>("POST", `/orgs/${a.orgId}/companies`, { name: "Other Co", autonomyLevel: 1, profile: { description: "y", stage: "idea" } });
    const otherCompanyId = second.body.company.id;
    expect((await a.api.json("POST", `/companies/${otherCompanyId}/tasks`, { title: "Illegal cross-link", projectId, start: false })).status).toBe(404);
    expect((await a.api.json("POST", `/companies/${otherCompanyId}/conversations`, { title: "Illegal thread", projectId })).status).toBe(404);
    expect((await a.api.json("POST", `/companies/${otherCompanyId}/campaigns`, { name: "Illegal campaign", channel: "email", projectId })).status).toBe(404);
    expect((await a.api.json("GET", `/companies/${otherCompanyId}/projects/${projectId}`)).status).toBe(404);
  });
});

describe("brand kit", () => {
  d("defaults on profiles saved before it existed and round-trips once decided", async () => {
    const a = await register("BrandA");
    const co = await a.api.json<{ company: { id: string } }>("POST", `/orgs/${a.orgId}/companies`, { name: "Northwind Analytics", autonomyLevel: 2, profile: { description: "Weekly numbers", stage: "idea" } });
    const companyId = co.body.company.id;
    const before = await a.api.json<{ profile: { profile: { brand: { accent: string; voice: { tone: string[] } } } } | null }>("GET", `/companies/${companyId}`);
    expect(before.body.profile?.profile.brand).toMatchObject({ accent: "indigo", voice: { tone: [] } });

    const put = await a.api.json<{ profile: { profile: { name: string } } }>("PUT", `/companies/${companyId}/profile`, {
      name: "Northwind Analytics",
      tagline: "Numbers, weekly.",
      brand: { tagline: "Numbers, weekly.", accent: "emerald", font: "serif", radius: "sharp", dark: true, mark: "monogram", voice: { tone: ["plain", "exact"], do: ["name the number"], dont: ["say leverage"] } },
    });
    expect(put.status).toBe(200);
    const after = await a.api.json<{ profile: { profile: { brand: Record<string, unknown> } } }>("GET", `/companies/${companyId}`);
    expect(after.body.profile.profile.brand).toMatchObject({ accent: "emerald", font: "serif", radius: "sharp", dark: true, mark: "monogram", voice: { tone: ["plain", "exact"] } });

    const studio = await a.api.json<{ starter: { theme: Record<string, unknown>; pages: Array<{ blocks: Array<{ kind: string; heading?: string }> }> } | null }>("GET", `/companies/${companyId}/site`);
    expect(studio.body.starter?.theme).toEqual({ accent: "emerald", font: "serif", radius: "sharp", dark: true, mark: "monogram" });

    const bad = await a.api.call("PUT", `/companies/${companyId}/profile`, { name: "Northwind Analytics", brand: { accent: "neon" } });
    expect(bad.status).toBe(422);
  });
});

describe("growth pipeline", () => {
  d("persists real leads, updates stages, and preserves tenant isolation", async () => {
    const a = await register("GrowthA");
    const co = await a.api.json<{ company: { id: string } }>("POST", `/orgs/${a.orgId}/companies`, { name: "Growth Co", autonomyLevel: 2, profile: { description: "x", stage: "idea" } });
    const companyId = co.body.company.id;
    const created = await a.api.json<{ lead: { id: string; stage: string } }>("POST", `/companies/${companyId}/leads`, { title: "Pilot customer", name: "Ada", email: `ada-${uniq()}@example.com`, company: "Analytical Engines", source: "research", valueUsd: 1200 });
    expect(created.status).toBe(201);
    expect(created.body.lead.stage).toBe("new");
    const updated = await a.api.json<{ lead: { stage: string; valueUsd: string } }>("PATCH", `/companies/${companyId}/leads/${created.body.lead.id}`, { stage: "interested", valueUsd: 1500 });
    expect(updated.body.lead.stage).toBe("interested");
    expect(Number(updated.body.lead.valueUsd)).toBe(1500);

    const createdCampaign = await a.api.json<{ campaign: { id: string; status: string; channel: string } }>("POST", `/companies/${companyId}/campaigns`, { name: "Design partner outreach", channel: "email", objective: "Book five discovery calls", audience: "Independent retailers", budgetUsd: 250 });
    expect(createdCampaign.status).toBe(201);
    expect(createdCampaign.body.campaign).toMatchObject({ status: "draft", channel: "email" });
    const campaignId = createdCampaign.body.campaign.id;
    const campaignUpdated = await a.api.json<{ campaign: { status: string; config: { budgetUsd: number } } }>("PATCH", `/companies/${companyId}/campaigns/${campaignId}`, { status: "active", budgetUsd: 300 });
    expect(campaignUpdated.body.campaign.status).toBe("active");
    expect(campaignUpdated.body.campaign.config.budgetUsd).toBe(300);

    const growth = await a.api.json<{ leads: Array<{ id: string; contactName: string; contactCompany: string; source: string }>; campaigns: Array<{ id: string; name: string; status: string; config: { objective: string } }> }>("GET", `/companies/${companyId}/growth`);
    expect(growth.body.leads).toEqual(expect.arrayContaining([expect.objectContaining({ id: created.body.lead.id, contactName: "Ada", contactCompany: "Analytical Engines", source: "research" })]));
    expect(growth.body.campaigns).toEqual(expect.arrayContaining([expect.objectContaining({ id: campaignId, name: "Design partner outreach", status: "active", config: expect.objectContaining({ objective: "Book five discovery calls" }) })]));

    const b = await register("GrowthB");
    expect((await b.api.json("GET", `/companies/${companyId}/growth`)).status).toBe(404);
    expect((await b.api.json("PATCH", `/companies/${companyId}/campaigns/${campaignId}`, { status: "completed" })).status).toBe(404);
  });
});

describe("durable run pipeline (stub provider, in-process runtime)", () => {
  d("chat message → run → plan → tool calls → verify → artifacts, usage, events", async () => {
    const { api, orgId } = await register();
    await api.json("POST", `/orgs/${orgId}/providers`, { providerType: "openai_compatible", secret: stub.apiKey, baseUrl: stub.baseUrl });
    const co = await api.json<{ company: { id: string } }>("POST", `/orgs/${orgId}/companies`, { name: "Smoke Labs", autonomyLevel: 2, profile: { description: "CSV tidying CLI", stage: "idea" } });
    const companyId = co.body.company.id;
    const project = await api.json<{ project: { id: string } }>("POST", `/companies/${companyId}/projects`, { name: "Runtime project", objective: "Produce a verified positioning output across durable work sessions", successSignal: "A reviewable positioning document and decision exist", nextStep: "Write the first positioning draft" });
    const projectId = project.body.project.id;
    const conv = await api.json<{ conversation: { id: string; projectId: string | null } }>("POST", `/companies/${companyId}/conversations`, { projectId });
    expect(conv.body.conversation.projectId).toBe(projectId);
    const msg = await api.json<{ run: { id: string; status: string; workflowId: string | null; projectId: string | null } }>("POST", `/companies/${companyId}/conversations/${conv.body.conversation.id}/messages`, { content: "Write positioning and record a decision." });
    expect(msg.body.run.projectId).toBe(projectId);
    expect(msg.status).toBe(201);
    expect(msg.body.run.status).toBe("queued");
    const runId = msg.body.run.id;

    // Drive the same runtime the Temporal worker uses.
    const scope: TenantScope = { organizationId: orgId, companyId, actor: { type: "system", component: "test" } };
    const rt = new AgentRuntime(services.forScope(scope), buildToolRegistry());
    await services.runs.setStatus(scope, runId, "building_context");
    const ctx = await rt.buildContext(runId);
    expect(ctx.toolNames).toContain("document.write");
    expect(ctx.systemPrompt).toContain("Active project: Runtime project");
    expect(ctx.systemPrompt).toContain("Write the first positioning draft");
    const plan = await rt.plan(runId, ctx);
    expect(plan.steps.length).toBe(2);
    let final = "";
    for (let i = 0; i < 6; i++) {
      const out = await rt.iterate(runId, ctx);
      if (out.kind === "done") {
        final = out.finalText;
        break;
      }
      expect(out.kind).toBe("continue");
    }
    expect(final).toContain("Positioning saved");
    const verification = await rt.verify(runId, ctx, final);
    expect(verification.passed).toBe(true);
    // The verdict is explicit, so "the reviewer approved" is distinguishable from "verification crashed".
    expect(verification.verdict).toBe("passed");
    expect(verification.score).toBe(92);
    await rt.finalize(runId, { status: "succeeded", finalText: final, verification });

    // Wire-level assertions on what the runtime sent.
    const toolNames = stub.requests.flatMap((r) => ((r.body.tools as Array<{ function: { name: string } }> | undefined) ?? []).map((t) => t.function.name));
    expect(toolNames.length).toBeGreaterThan(0);
    for (const n of toolNames) expect(n).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
    expect(stub.requests.every((r) => r.authorization === `Bearer ${stub.apiKey}`)).toBe(true);

    const run = await api.json<{ run: { status: string; result: Record<string, unknown> }; steps: Array<{ kind: string; status: string }>; toolCalls: Array<{ toolName: string; status: string }>; artifacts: Array<{ kind: string }> }>("GET", `/companies/${companyId}/runs/${runId}`);
    expect(run.body.run.status).toBe("succeeded");
    expect(run.body.toolCalls.map((t) => `${t.toolName}:${t.status}`)).toEqual(expect.arrayContaining(["document.write:succeeded", "decision.record:succeeded"]));
    expect(run.body.steps.map((s) => s.kind)).toEqual(expect.arrayContaining(["context", "plan", "model_call", "tool_call", "verification", "result"]));
    expect(run.body.artifacts.some((a) => a.kind === "document")).toBe(true);

    const docs = await api.json<{ documents: Array<{ title: string }> }>("GET", `/companies/${companyId}/documents`);
    expect(docs.body.documents.map((x) => x.title)).toContain("Positioning");
    const decisions = await api.json<{ decisions: Array<{ title: string }> }>("GET", `/companies/${companyId}/decisions`);
    expect(decisions.body.decisions.some((x) => x.title.startsWith("Target customer"))).toBe(true);
    const projectSnapshot = await api.json<{ runs: Array<{ id: string }>; artifacts: Array<{ kind: string }>; decisions: Array<{ title: string }> }>("GET", `/companies/${companyId}/projects/${projectId}`);
    expect(projectSnapshot.body.runs.map((x) => x.id)).toContain(runId);
    expect(projectSnapshot.body.artifacts.some((x) => x.kind === "document")).toBe(true);
    expect(projectSnapshot.body.decisions.some((x) => x.title.startsWith("Target customer"))).toBe(true);
    const usage = await api.json<{ usage: Array<{ provider: string; calls: number; inputTokens: number }> }>("GET", `/orgs/${orgId}/providers/usage?companyId=${companyId}`);
    expect(usage.body.usage.reduce((n, u) => n + u.calls, 0)).toBeGreaterThanOrEqual(5);
    expect(usage.body.usage[0]!.inputTokens).toBeGreaterThan(0);
    const events = await api.json<{ events: Array<{ type: string }> }>("GET", `/companies/${companyId}/events?limit=100`);
    const types = new Set(events.body.events.map((e) => e.type));
    for (const t of ["run.created", "run.step", "run.tool_call", "document.created", "decision.recorded", "run.completed"]) expect(types.has(t)).toBe(true);
    const messages = await api.json<{ messages: Array<{ role: string; content: string }> }>("GET", `/companies/${companyId}/conversations/${conv.body.conversation.id}`);
    expect(messages.body.messages.some((m) => m.role === "assistant" && m.content.includes("Positioning saved"))).toBe(true);
  });

  d("external side effects at autonomy 1 pause for approval and the decision is durable", async () => {
    const { api, orgId } = await register();
    await api.json("POST", `/orgs/${orgId}/providers`, { providerType: "openai_compatible", secret: stub.apiKey, baseUrl: stub.baseUrl });
    const co = await api.json<{ company: { id: string } }>("POST", `/orgs/${orgId}/companies`, { name: "Careful Co", autonomyLevel: 1 });
    const companyId = co.body.company.id;
    const agents = await api.json<{ agents: Array<{ id: string; kind: string }> }>("GET", `/companies/${companyId}/agents`);
    const marketing = agents.body.agents.find((a) => a.kind === "marketing")!;
    const run = await api.json<{ run: { id: string } }>("POST", `/companies/${companyId}/runs`, { agentId: marketing.id, instruction: "Post an update." });
    const scope: TenantScope = { organizationId: orgId, companyId, actor: { type: "system", component: "test" } };
    const svc = services.forScope(scope);
    const approval = await svc.approvals.request(scope, { runId: run.body.run.id, action: "email.send", reason: "Send launch email", payload: { to: "x@example.com" }, risk: "HIGH", dimension: "email_send", affectedSystem: "email", alternatives: [], expiresInSeconds: 60, expiresInMs: 60_000 });
    const list = await api.json<{ approvals: Array<{ id: string; status: string }> }>("GET", `/companies/${companyId}/approvals?status=pending`);
    expect(list.body.approvals.map((a) => a.id)).toContain(approval.id);
    const inbox = await api.json<{ approvals: Array<{ id: string; companyId: string }> }>("GET", `/orgs/${orgId}/approvals?status=pending`);
    expect(inbox.body.approvals.map((a) => a.id)).toContain(approval.id);
    expect(inbox.body.approvals.find((a) => a.id === approval.id)?.companyId).toBe(companyId);
    const growth = await api.json<{ outbox: Array<{ id: string; action: string }> }>("GET", `/companies/${companyId}/growth`);
    expect(growth.body.outbox.map((a) => a.id)).toContain(approval.id);
    const decided = await api.json<{ approval: { status: string } }>("POST", `/companies/${companyId}/approvals/${approval.id}/decide`, { status: "denied", note: "Not yet" });
    expect(decided.status).toBe(200);
    expect(decided.body.approval.status).toBe("denied");
    expect((await api.json("POST", `/companies/${companyId}/approvals/${approval.id}/decide`, { status: "approved" })).status).toBe(409);
  });

  d("cancelling without a workflow stops the run and says so, instead of reporting a signal", async () => {
    // A deployment with no Temporal client is the case that used to look identical to a signal: the response
    // said "requested" while the run had already been stopped here and now. The run is created through a
    // deployment that can start it (the same database), then cancelled through one that cannot signal.
    const noWorkflows = createApp({ core, auth: new AuthService(core.db), mailer, services, workflows: null, companionHub: new CompanionHub(), env: ENV }, null).app;
    const { api, orgId, cookie } = await register();
    const co = await api.json<{ company: { id: string } }>("POST", `/orgs/${orgId}/companies`, { name: `Stop Co ${uniq()}`, autonomyLevel: 2 });
    const companyId = co.body.company.id;
    const agents = await api.json<{ agents: Array<{ id: string; kind: string }> }>("GET", `/companies/${companyId}/agents`);
    const run = await api.json<{ run: { id: string } }>("POST", `/companies/${companyId}/runs`, { agentId: agents.body.agents[0]!.id, instruction: "Work that gets stopped." });
    const stopped = await client("", cookie, () => noWorkflows).json<{ ok: boolean; signalled: boolean; status: string }>(
      "POST",
      `/companies/${companyId}/runs/${run.body.run.id}/cancel`,
      { reason: "no longer wanted" },
      { "x-steward-csrf": "1" },
    );
    expect(stopped.status).toBe(200);
    expect(stopped.body).toMatchObject({ ok: true, signalled: false, status: "cancelled" });
    const detail = await api.json<{ run: { status: string; error: string } }>("GET", `/companies/${companyId}/runs/${run.body.run.id}`);
    expect(detail.body.run.status).toBe("cancelled");
    expect(detail.body.run.error).toBe("no longer wanted");
  });
});

describe("local companion", () => {
  d("pairs with a one-time code, brokers commands over long-poll, and revocation cuts the key", async () => {
    const { api, orgId } = await register();
    const started = await api.json<{ device: { id: string; status: string }; code: string }>("POST", `/orgs/${orgId}/companion/devices`, { name: "laptop" });
    expect(started.status).toBe(201);
    expect(started.body.device.status).toBe("pairing");
    expect(started.body.code).toMatch(/^\d{6}$/);

    const anon = client();
    expect((await anon.json("POST", "/companion/pair", { code: "000000" })).status).toBe(404);
    const paired = await anon.json<{ device: { id: string }; deviceKey: string }>("POST", "/companion/pair", { code: started.body.code, capabilities: ["ping", "codex.status", "codex.exec"] });
    expect(paired.status).toBe(201);
    expect(paired.body.deviceKey.startsWith("scd_")).toBe(true);
    expect((await anon.json("POST", "/companion/pair", { code: started.body.code })).status).toBe(404);
    const { rows } = await core.pool.query("select device_key_hash, pairing_code_hash from companion_devices where id = $1", [paired.body.device.id]);
    expect(rows[0].device_key_hash).not.toBe(paired.body.deviceKey);
    expect(rows[0].pairing_code_hash).toBeNull();

    const device = client(paired.body.deviceKey);
    expect((await device.json("GET", "/companion/me")).status).toBe(200);

    // Companion loop: one poll outstanding while the operator pings; it answers ping and codex.status.
    const loop = (async () => {
      for (let i = 0; i < 4; i++) {
        const { body } = await device.json<{ commands: Array<{ id: string; command: string }> }>("POST", "/companion/poll", { waitMs: 2000 });
        for (const cmd of body.commands) {
          const result = cmd.command === "ping" ? { pong: true } : cmd.command === "codex.status" ? { loggedIn: true, models: ["gpt-5-codex"] } : { text: "hello from codex" };
          await device.json("POST", "/companion/results", { id: cmd.id, type: "result", result });
        }
      }
    })();
    // The poll request authenticates and touches Postgres before it reaches the in-process hub.
    // Avoid a fixed sleep here: loaded CI runners can legitimately take >50ms to cross that boundary.
    let online = false;
    for (let attempt = 0; attempt < 40 && !online; attempt++) {
      const listed = await api.json<{ devices: Array<{ id: string; online: boolean }> }>("GET", `/orgs/${orgId}/companion/devices`);
      online = listed.body.devices.find((x) => x.id === paired.body.device.id)?.online ?? false;
      if (!online) await new Promise((r) => setTimeout(r, 50));
    }
    expect(online).toBe(true);
    const ping = await api.json<{ ok: boolean; status: { loggedIn: boolean } }>("POST", `/orgs/${orgId}/companion/devices/${paired.body.device.id}/ping`);
    expect(ping.body.ok).toBe(true);
    expect(ping.body.status.loggedIn).toBe(true);

    // Worker-side relay uses the internal token; a wrong token is rejected.
    const internal = client(internalServiceToken(core.config, ENV));
    const relayed = await internal.json<{ result: { text: string } }>("POST", `/internal/companion/${paired.body.device.id}/request`, { command: "codex.exec", payload: { messages: [] }, timeoutMs: 5000 });
    expect(relayed.status).toBe(200);
    expect(relayed.body.result.text).toBe("hello from codex");
    expect((await client("nope").json("POST", `/internal/companion/${paired.body.device.id}/request`, { command: "ping" })).status).toBe(401);

    // Codex companion provider credential routes through the paired device for model discovery.
    const prov = await api.json<{ provider: { id: string; secretLast4: string | null } }>("POST", `/orgs/${orgId}/providers`, { providerType: "codex_companion", config: { deviceId: paired.body.device.id } });
    expect(prov.status).toBe(201);
    expect(prov.body.provider.secretLast4).toBeNull();
    const test = await api.json<{ ok: boolean }>("POST", `/orgs/${orgId}/providers/${prov.body.provider.id}/test`);
    expect(test.body.ok).toBe(true);
    await loop;

    const revoked = await api.json<{ device: { status: string } }>("DELETE", `/orgs/${orgId}/companion/devices/${paired.body.device.id}`);
    expect(revoked.body.device.status).toBe("revoked");
    expect((await device.json("GET", "/companion/me")).status).toBe(401);
    const offline = await api.json<{ ok: boolean }>("POST", `/orgs/${orgId}/companion/devices/${paired.body.device.id}/ping`);
    expect(offline.status).toBe(404);
  });
});

describe("webhooks", () => {
  d("verifies GitHub HMAC signatures and de-duplicates replays", async () => {
    const payload = JSON.stringify({ action: "opened", repository: { id: 42 }, sender: { login: "octocat" }, secret_token: "should-not-persist" });
    const sig = "sha256=" + createHmac("sha256", ENV.WEBHOOK_GITHUB_SECRET!).update(payload).digest("hex");
    const deliveryId = `d-${uniq()}`;
    const send = (signature: string, id = deliveryId) =>
      app.request("http://api.test/v1/webhooks/github", { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": signature, "x-github-delivery": id, "x-github-event": "pull_request" }, body: payload });
    expect((await send("sha256=deadbeef")).status).toBe(401);
    const first = await send(sig);
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ ok: true, duplicate: false });
    const replay = await send(sig);
    expect(await replay.json()).toMatchObject({ ok: true, duplicate: true });
    const { rows } = await core.pool.query("select payload::text as p from webhook_deliveries where external_id = $1", [deliveryId]);
    expect(rows).toHaveLength(1);
    expect(rows[0].p).not.toContain("should-not-persist");
    expect((await app.request("http://api.test/v1/webhooks/unknown", { method: "POST", body: "{}" })).status).toBe(404);
  });
});

/**
 * The agent eval suite, run against the real database and a real HTTP provider.
 *
 * Each case gets its own organisation and its own scripted provider, is driven through the same runtime the
 * worker uses, and is then judged only on the rows the product wrote. "Green" here means every rule the suite
 * defends held — and nothing was left unverified, because a case that could not be checked has not passed.
 */
describe("agent evals (scripted backends, in-process runtime)", () => {
  d("holds every rule the suite defends, with nothing unverified", async () => {
    const providers: StubProvider[] = [];
    const sinks: SmtpSink[] = [];
    try {
      const { scorecard, text } = await runEvalSuite({
        services,
        createOrg: async (backend) => {
          // The backend decides what the scripted model does: what it reaches for, and what its reviewer says.
          const provider = await startStubProvider({ script: SCRIPT_FOR_BACKEND[backend], failFirstChat: backend === "provider-outage" });
          providers.push(provider);
          const { orgId, userId, api } = await register(backend);
          const installed = await api.json("POST", `/orgs/${orgId}/providers`, { providerType: "openai_compatible", secret: provider.apiKey, baseUrl: provider.baseUrl });
          expect(installed.status).toBe(201);
          // A case about an email leaving the building needs somewhere for it to go: a real SMTP endpoint, so the
          // product's own send path runs end to end and the message can be checked afterwards.
          const sink = backend === "scripted-outbound" ? await startSmtpSink() : null;
          if (sink) sinks.push(sink);
          return {
            orgId,
            userId,
            api,
            afterCompany: sink
              ? async (companyId) => {
                  const connected = await api.json("POST", `/orgs/${orgId}/integrations`, {
                    type: "smtp",
                    label: "Eval SMTP",
                    companyId,
                    fields: { host: sink.host, port: String(sink.port), secure: "false", fromAddress: "steward@eval.test" },
                  });
                  expect(connected.status).toBe(201);
                }
              : undefined,
          };
        },
      });

      // The scorecard goes into the log, so a green run still says what was proved and on which backend.
      console.log(`\n${text}\n`);
      const notPassing = scorecard.cases
        .filter((c) => c.status !== "pass")
        .map((c) => `${c.id} [${c.status}]: ${c.checks.filter((k) => k.status !== "pass").map((k) => `${k.name} — ${k.detail}`).join(" | ")}`);
      expect(notPassing).toEqual([]);
      expect(scorecard.summary).toMatchObject({ total: SUITE.length, fail: 0, unverified: 0 });
      expect(scorecard.byAgent.length).toBeGreaterThan(0);

      // The outbound cases are only evidence if mail actually arrived: check the other side of the wire.
      const received = sinks.flatMap((s) => s.messages);
      expect(received.length).toBeGreaterThan(0);
      expect(received.some((m) => m.to.includes("beta@example.com"))).toBe(true);
    } finally {
      await Promise.all(providers.map((p) => p.close()));
      await Promise.all(sinks.map((s) => s.close()));
    }
  }, EVAL_SUITE_BUDGET_MS);
});

/**
 * Event-driven reactions over HTTP: the signed webhook, the rule the founder wrote, the run that follows, the
 * ledger that refuses to repeat it, and the sweep that answers records nobody pushed.
 *
 * These cases exist because the interesting failures are at the seams — a signature that verifies but a rule
 * that never sees the signal, a redelivery that starts a second run, a person's explicit request being refused
 * by a decision that has already been superseded. The engine's own gates are covered in `@steward/core`.
 */
describe("event-driven reactions", () => {
  /** A founder, a company, and the company's Chief of Staff. */
  async function reactor(opts: { autonomyLevel?: number } = {}) {
    const founder = await register("Reactor");
    const co = await founder.api.json<{ company: { id: string } }>("POST", `/orgs/${founder.orgId}/companies`, { name: `Reactions ${uniq()}`, autonomyLevel: opts.autonomyLevel ?? 2, profile: { description: "x", stage: "idea" } });
    const companyId = co.body.company.id;
    const listed = await founder.api.json<{ agents: Array<{ id: string; kind: string; enabled: boolean }> }>("GET", `/companies/${companyId}/agents`);
    const orchestrator = listed.body.agents.find((a) => a.kind === "orchestrator");
    expect(orchestrator).toBeTruthy();
    return { ...founder, companyId, agentId: orchestrator!.id };
  }

  /** Connects Stripe with a known signing secret and returns the integration id its webhook URL points at. */
  async function connectStripe(api: ReturnType<typeof client>, orgId: string, companyId: string, secret: string) {
    const connected = await api.json<{ integration: { id: string; webhookUrl: string | null } }>("POST", `/orgs/${orgId}/integrations`, { type: "stripe", label: "Stripe (test)", companyId, fields: { secretKey: "rk_test_123", webhookSecret: secret } });
    expect(connected.status).toBe(201);
    return connected.body.integration.id;
  }

  /** A real Stripe delivery: the signature covers `${t}.${body}`, and the body is signed byte for byte. */
  const stripeDelivery = (integrationId: string, secret: string, eventId: string, type = "checkout.session.completed", object: Record<string, unknown> = {}) => {
    const body = JSON.stringify({ id: eventId, type, created: Math.floor(Date.now() / 1000), data: { object: { id: `cs_${eventId}`, amount_total: 2500, currency: "usd", payment_status: "paid", customer_details: { email: `buyer-${eventId}@example.com` }, ...object } } });
    const t = Math.floor(Date.now() / 1000);
    const signature = `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
    // Webhooks are public routes outside /v1: the provider is not a signed-in client.
    return app.request(`http://api.test/webhooks/stripe/${integrationId}`, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": signature }, body });
  };

  d("starts the agent a founder asked for, exactly once per payment", async () => {
    const { api, orgId, companyId, agentId } = await reactor();
    const secret = `whsec_${uniq()}`;
    const integrationId = await connectStripe(api, orgId, companyId, secret);
    const instruction = "Look at what sold, update the project, and propose the next step.";
    const created = await api.json<{ rule: { id: string; builtin: string | null; preview: { instruction: string } | null; matches7d: number } }>("POST", `/companies/${companyId}/reactions`, { agentId, name: "Review payments", source: "signal", matchKinds: ["payment.completed"], instruction });
    expect(created.status).toBe(201);
    const ruleId = created.body.rule.id;

    const eventId = `evt_${uniq()}`;
    const delivery = await stripeDelivery(integrationId, secret, eventId);
    expect(delivery.status).toBe(200);
    const delivered = (await delivery.json()) as { created: boolean; autoReviewRunId: string | null; reactions: Array<{ ruleId: string; status: string; runId: string | null }> };
    expect(delivered.created).toBe(true);
    expect(delivered.reactions).toEqual([expect.objectContaining({ ruleId, status: "started" })]);
    expect(delivered.autoReviewRunId).toBe(delivered.reactions[0]!.runId);

    // The run is durable and says which rule asked for it, what it was told, and which signal it came from.
    const runs = await api.json<{ runs: Array<{ id: string; intent: string; trigger: Record<string, unknown>; status: string }> }>("GET", `/companies/${companyId}/runs?limit=20`);
    expect(runs.body.runs).toHaveLength(1);
    const run = runs.body.runs[0]!;
    expect(run.trigger).toMatchObject({ kind: "event", reactionRuleId: ruleId });
    expect(run.intent).toContain(instruction);
    expect(run.intent).toContain("kind=payment.completed");
    expect(temporalCalls.some((call) => call.op === "startRun" && (call.args[0] as { runId: string }).runId === run.id)).toBe(true);

    // The ledger shows the fire, the rule counts it, and the rule can show a founder what it would send.
    const listed = await api.json<{ rules: Array<{ id: string; fireCount: number; matches7d: number; preview: { instruction: string } | null }>; fires: Array<{ status: string; ruleId: string; runId: string | null; sourceKind: string }>; catalog: { signalKinds: string[]; eventTypes: string[] }; canManage: boolean }>("GET", `/companies/${companyId}/reactions`);
    const rule = listed.body.rules.find((r) => r.id === ruleId)!;
    expect(rule.fireCount).toBe(1);
    expect(rule.matches7d).toBeGreaterThanOrEqual(1);
    expect(rule.preview!.instruction.startsWith(instruction)).toBe(true);
    expect(listed.body.fires).toEqual([expect.objectContaining({ status: "started", ruleId, runId: run.id, sourceKind: "payment.completed" })]);
    expect(listed.body.catalog.signalKinds).toContain("email.opened");
    expect(listed.body.catalog.eventTypes).toContain("integration.webhook");
    expect(listed.body.canManage).toBe(true);

    // A redelivery of the same event is the same event: the signature verifies, the signal is a duplicate, and
    // nothing runs twice.
    const replayed = await stripeDelivery(integrationId, secret, eventId);
    expect(replayed.status).toBe(200);
    const replay = (await replayed.json()) as { created: boolean; duplicate: boolean; reactions: unknown[] };
    expect(replay.created).toBe(false);
    expect(replay.duplicate).toBe(true);
    expect(replay.reactions).toEqual([]);

    // A different payment is a different record: the rule is not one-shot.
    const another = await stripeDelivery(integrationId, secret, `evt_${uniq()}`);
    expect((await another.json()) as { reactions: unknown[] }).toMatchObject({ reactions: [expect.objectContaining({ ruleId, status: "started" })] });
    const runsAfter = await api.json<{ runs: unknown[] }>("GET", `/companies/${companyId}/runs?limit=20`);
    expect(runsAfter.body.runs).toHaveLength(2);
    const ledger = await api.json<{ fires: Array<{ status: string }> }>("GET", `/companies/${companyId}/reactions`);
    expect(ledger.body.fires.map((f) => f.status)).toEqual(["started", "started"]);
  });

  d("leaves a signal nobody wrote a rule for in the inbox", async () => {
    const { api, orgId, companyId } = await reactor();
    const secret = `whsec_${uniq()}`;
    const integrationId = await connectStripe(api, orgId, companyId, secret);

    const delivery = await stripeDelivery(integrationId, secret, `evt_${uniq()}`);
    expect(delivery.status).toBe(200);
    const body = (await delivery.json()) as { created: boolean; autoReviewRunId: string | null; reactions: unknown[] };
    expect(body.created).toBe(true);
    expect(body.reactions).toEqual([]);
    expect(body.autoReviewRunId).toBeNull();
    const runs = await api.json<{ runs: unknown[] }>("GET", `/companies/${companyId}/runs?limit=20`);
    expect(runs.body.runs).toHaveLength(0);
    const signals = await api.json<{ signals: Array<{ state: string }> }>("GET", `/companies/${companyId}/signals`);
    expect(signals.body.signals[0]!.state).toBe("unread");

    // A rule with nothing to answer says exactly that instead of starting work against nothing.
    const { agents: agentList } = (await api.json<{ agents: Array<{ id: string; kind: string }> }>("GET", `/companies/${companyId}/agents`)).body;
    const empty = await api.json<{ rule: { id: string } }>("POST", `/companies/${companyId}/reactions`, { agentId: agentList.find((a) => a.kind === "orchestrator")!.id, name: "Watch cancellations", source: "signal", matchKinds: ["subscription.cancelled"], instruction: "Check what was lost." });
    const pressed = await api.json("POST", `/companies/${companyId}/reactions/${empty.body.rule.id}/run`);
    expect(pressed.status).toBe(409);
    expect(pressed.body).toMatchObject({ error: { code: "no_matching_record" } });
  });

  d("treats the Signals toggle as the builtin rule it is", async () => {
    const { api, companyId } = await reactor();
    const before = await api.json<{ settings: { autoReviewImportant: boolean }; ruleId: string | null }>("GET", `/companies/${companyId}/signals/settings`);
    expect(before.body.settings.autoReviewImportant).toBe(false);
    expect(before.body.ruleId).toBeNull();

    const on = await api.json<{ settings: { autoReviewImportant: boolean }; ruleId: string | null }>("PATCH", `/companies/${companyId}/signals/settings`, { autoReviewImportant: true });
    expect(on.body.settings.autoReviewImportant).toBe(true);
    expect(on.body.ruleId).toBeTruthy();

    // It is one editable rule, not a hidden switch: it appears in the rules list with its seven kinds.
    const listed = await api.json<{ rules: Array<{ id: string; builtin: string | null; kinds: string[]; enabled: boolean }> }>("GET", `/companies/${companyId}/reactions`);
    const builtin = listed.body.rules.find((r) => r.id === on.body.ruleId)!;
    expect(builtin.builtin).toBe("signal_review");
    expect(builtin.kinds).toContain("payment.failed");
    expect(builtin.kinds).not.toContain("email.opened");
    expect(builtin.enabled).toBe(true);

    const off = await api.json<{ settings: { autoReviewImportant: boolean } }>("PATCH", `/companies/${companyId}/signals/settings`, { autoReviewImportant: false });
    expect(off.body.settings.autoReviewImportant).toBe(false);
    const after = await api.json<{ settings: { autoReviewImportant: boolean } }>("GET", `/companies/${companyId}/signals/settings`);
    expect(after.body.settings.autoReviewImportant).toBe(false);
    expect((await api.json("GET", `/companies/${companyId}/reactions`)).body).toMatchObject({ rules: [expect.objectContaining({ id: on.body.ruleId, enabled: false })] });
  });

  d("refuses a rule pointed at records Steward never keeps, and refuses a rule with no agent behind it", async () => {
    const { api, companyId, agentId } = await reactor();
    // Creating a rule is validated against the catalog itself, so a kind that is not recorded never becomes a
    // rule in the first place.
    const unknownKind = await api.json("POST", `/companies/${companyId}/reactions`, { agentId, name: "Watch steps", source: "event", matchKinds: ["run.step"], instruction: "Look at it." });
    expect(unknownKind.status).toBe(422);
    const unknownSignal = await api.json("POST", `/companies/${companyId}/reactions`, { agentId, name: "Watch nothing", source: "signal", matchKinds: ["payment.something"], instruction: "Look at it." });
    expect(unknownSignal.status).toBe(422);
    const noKinds = await api.json("POST", `/companies/${companyId}/reactions`, { agentId, name: "Watch everything", source: "signal", matchKinds: [], instruction: "Look at it." });
    expect(noKinds.status).toBe(422);
    const badAgent = await api.json("POST", `/companies/${companyId}/reactions`, { agentId: "agent_nope", name: "Nowhere", source: "signal", matchKinds: ["payment.completed"], instruction: "Look at it." });
    expect(badAgent.status).toBe(404);

    // Editing is validated against the catalog too, and says which kinds it does not know.
    const rule = await api.json<{ rule: { id: string } }>("POST", `/companies/${companyId}/reactions`, { agentId, name: "Watch payments", source: "signal", matchKinds: ["payment.completed"], instruction: "Look at it." });
    const edited = await api.json("PATCH", `/companies/${companyId}/reactions/${rule.body.rule.id}`, { matchKinds: ["payment.completed", "payment.imaginary"] });
    expect(edited.status).toBe(422);
    expect(edited.body).toMatchObject({ error: { code: "unknown_kinds" } });
    expect((await api.json<{ rules: Array<{ kinds: string[] }> }>("GET", `/companies/${companyId}/reactions`)).body.rules[0]!.kinds).toEqual(["payment.completed"]);
  });

  d("answers a refusal when a person asks for it, and only then", async () => {
    const { api, orgId, companyId, agentId } = await reactor();
    const secret = `whsec_${uniq()}`;
    const integrationId = await connectStripe(api, orgId, companyId, secret);
    const rule = await api.json<{ rule: { id: string } }>("POST", `/companies/${companyId}/reactions`, { agentId, name: "Review payments", source: "signal", matchKinds: ["payment.completed"], instruction: "Look at what sold." });
    const ruleId = rule.body.rule.id;

    // Paused when the payment arrives: the ledger says so, and nothing ran.
    await api.json("PATCH", `/companies/${companyId}/reactions/${ruleId}`, { enabled: false });
    const delivery = await stripeDelivery(integrationId, secret, `evt_${uniq()}`);
    const body = (await delivery.json()) as { reactions: Array<{ status: string; runId: string | null }> };
    expect(body.reactions).toEqual([expect.objectContaining({ status: "skipped", runId: null })]);
    expect((await api.json<{ runs: unknown[] }>("GET", `/companies/${companyId}/runs`)).body.runs).toHaveLength(0);

    // Resumed, then run by hand against that same record: the refusal was a decision about then, not a claim.
    await api.json("PATCH", `/companies/${companyId}/reactions/${ruleId}`, { enabled: true });
    const asked = await api.json<{ decision: { status: string; runId: string | null }; run: { id: string; trigger: Record<string, unknown> } }>("POST", `/companies/${companyId}/reactions/${ruleId}/run`);
    expect(asked.status).toBe(201);
    expect(asked.body.decision.status).toBe("started");
    expect(asked.body.run.trigger).toMatchObject({ reactionRuleId: ruleId });

    // And now the record is spent: asking again cannot start a second run for it.
    const twice = await api.json<{ decision: { status: string } }>("POST", `/companies/${companyId}/reactions/${ruleId}/run`);
    expect(twice.body.decision.status).toBe("duplicate");
    expect((await api.json<{ runs: unknown[] }>("GET", `/companies/${companyId}/runs`)).body.runs).toHaveLength(1);

    // The ledger keeps both decisions, in order, so the story is readable.
    const listed = await api.json<{ fires: Array<{ status: string; reason: string | null }> }>("GET", `/companies/${companyId}/reactions`);
    expect(listed.body.fires.map((f) => f.status)).toEqual(["started", "skipped"]);
    expect(listed.body.fires[1]!.reason).toContain("paused");
  });

  d("reacts to a recorded event through the sweep, and never to a reaction's own work", async () => {
    const { api, orgId, companyId, agentId } = await reactor();
    const rule = await api.json<{ rule: { id: string } }>("POST", `/companies/${companyId}/reactions`, { agentId, name: "Follow up finished work", source: "event", matchKinds: ["task.completed"], instruction: "Check whether the outcome needs a follow-up task." });
    const taskRuleId = rule.body.rule.id;

    const task = await api.json<{ task: { id: string } }>("POST", `/companies/${companyId}/tasks`, { title: "Ship the pricing page", description: "Bounded work", start: false });
    await api.json("PATCH", `/companies/${companyId}/tasks/${task.body.task.id}`, { status: "done" });

    const launcher = { start: async (input: { runId: string; scope: { organizationId: string; companyId: string } }) => (await fakeTemporal().startRun(input)) };
    const swept = await services.reactions.sweep({ launcher });
    expect(swept.considered).toBeGreaterThanOrEqual(1);

    const runs = await api.json<{ runs: Array<{ id: string; trigger: Record<string, unknown> }> }>("GET", `/companies/${companyId}/runs?limit=20`);
    const followUp = runs.body.runs.find((r) => (r.trigger as { reactionRuleId?: string }).reactionRuleId === taskRuleId);
    expect(followUp).toBeTruthy();
    expect(followUp!.trigger).toMatchObject({ kind: "event", sourceEventId: expect.any(String) });

    // The sweep's own work is not a record to answer: a rule over finished runs does not answer the run a
    // reaction started, so no pair of rules can hand work back and forth forever.
    const watch = await api.json<{ rule: { id: string } }>("POST", `/companies/${companyId}/reactions`, { agentId, name: "Watch finished runs", source: "event", matchKinds: ["run.completed"], instruction: "Summarize the run." });
    const scope: TenantScope = { organizationId: orgId, companyId, actor: { type: "system", component: "api-test" } };
    await services.runs.setStatus(scope, followUp!.id, "succeeded");
    const second = await services.reactions.sweep({ launcher });
    expect(second.selfCaused).toBeGreaterThanOrEqual(1);
    expect(await services.reactions.listFires(scope, { ruleId: watch.body.rule.id })).toHaveLength(0);
  });
});

/**
 * The Site Studio over HTTP. The engine's own rules live in `@steward/core`; what these cases are for is the
 * seams: a read that hands the editor its own catalog, a draft that may be unfinished where a publish may not,
 * a preview that is the same bytes as the version it becomes, and a ship that is a recorded run rather than a
 * promise that something started.
 */
describe("site studio", () => {
  /** A founder, their company (with a tagline to start from) and the agents they have. */
  async function studio() {
    const founder = await register("Studio");
    const co = await founder.api.json<{ company: { id: string } }>("POST", `/orgs/${founder.orgId}/companies`, {
      name: `Studio ${uniq()}`,
      autonomyLevel: 2,
      profile: { description: "Revenue reports for small stores.", stage: "idea" },
    });
    const companyId = co.body.company.id;
    const listed = await founder.api.json<{ agents: Array<{ id: string; kind: string; enabled: boolean }> }>("GET", `/companies/${companyId}/agents`);
    const agent = listed.body.agents.find((candidate) => candidate.kind === "engineering") ?? listed.body.agents[0];
    expect(agent).toBeTruthy();
    return { ...founder, companyId, agentId: agent!.id };
  }

  /** A site with every rule satisfied, so a publish has something to succeed at. */
  const complete = (name: string) => ({
    name,
    theme: { accent: "indigo", font: "sans", radius: "soft", dark: false },
    pages: [
      {
        slug: "index",
        title: name,
        description: "Revenue reports for small stores.",
        blocks: [
          { kind: "hero", heading: "Revenue, explained weekly", subheading: "For stores selling in more than one place.", action: { label: "Talk to us", href: "/contact" } },
          { kind: "features", heading: "What you get", items: [{ title: "One number", body: "Everything in one place." }] },
        ],
      },
      {
        slug: "contact",
        title: "Contact",
        description: "",
        blocks: [{ kind: "contact", heading: "Talk to us", body: "We answer within a day.", email: "hello@example.com", phone: "", action: { label: "", href: "" } }],
      },
    ],
  });

  type StudioRead = {
    site: { id: string; name: string; revision: string } | null;
    model: { name: string; pages: Array<{ slug: string; blocks: Array<{ kind: string }> }> } | null;
    starter: unknown;
    problems: string[];
    catalog: Array<{ kind: string; label: string; fields: Array<{ path: string; required?: boolean }> }>;
    versions: Array<{ id: string; number: number; digest: string }>;
    agents: Array<{ id: string; kind: string }>;
    canEdit: boolean;
  };

  const read = (api: ReturnType<typeof client>, companyId: string) => api.json<StudioRead>("GET", `/companies/${companyId}/site`);

  d("opens on a company with no site as a starting draft, not an empty screen", async () => {
    const { api, companyId } = await studio();
    const first = await read(api, companyId);
    expect(first.status).toBe(200);
    expect(first.body.site).toBeNull();
    expect(first.body.model).toBeNull();
    expect(first.body.versions).toEqual([]);
    expect(first.body.canEdit).toBe(true);
    // The starting point is the company's own words, and it is already a valid draft.
    const starter = first.body.starter as { name: string; pages: Array<{ slug: string; blocks: Array<{ kind: string }> }> };
    expect(starter.name).toContain("Studio");
    expect(starter.pages.map((page) => page.slug)).toEqual(["index", "contact"]);
    // The editor is built from the server's catalog: kinds, and the fields of each, including the button a hero
    // block has, which is not a top-level property of the block.
    expect(first.body.catalog.map((spec) => spec.kind)).toEqual(["hero", "text", "features", "gallery", "faq", "cta", "contact"]);
    expect(first.body.catalog.find((spec) => spec.kind === "hero")?.fields.map((field) => field.path)).toContain("action.label");
    // Nothing has been written by reading — and there is nothing to publish yet, which is a 404 rather than a 500.
    expect((await read(api, companyId)).body.site).toBeNull();
    expect((await api.call("POST", `/companies/${companyId}/site/publish`)).status).toBe(404);
  });

  d("keeps one company's site out of another company's reach", async () => {
    const owner = await studio();
    const stranger = await studio();
    await owner.api.json("PUT", `/companies/${owner.companyId}/site`, { model: complete("Northwind Analytics"), expectedRevision: null });
    const published = await owner.api.json<{ version: { id: string } }>("POST", `/companies/${owner.companyId}/site/publish`);

    // A company id the caller cannot see is a 404, not a 403: the studio does not confirm that it exists.
    expect((await stranger.api.call("GET", `/companies/${owner.companyId}/site`)).status).toBe(404);
    expect((await stranger.api.call("PUT", `/companies/${owner.companyId}/site`, { model: complete("Mine now"), expectedRevision: null })).status).toBe(404);
    expect((await stranger.api.call("GET", `/companies/${owner.companyId}/site/preview?slug=index`)).status).toBe(404);
    expect((await stranger.api.call("GET", `/companies/${owner.companyId}/site/versions/${published.body.version.id}/bundle`)).status).toBe(404);
    expect((await stranger.api.call("POST", `/companies/${owner.companyId}/site/versions/${published.body.version.id}/restore`)).status).toBe(404);
    expect((await stranger.api.call("POST", `/companies/${owner.companyId}/site/publish`)).status).toBe(404);
  });

  d("saves an unfinished draft, and says what publishing would still need", async () => {
    const { api, companyId } = await studio();
    const started = await read(api, companyId);
    const saved = await api.json<{ site: { revision: string; name: string }; pages: string[]; problems: string[] }>("PUT", `/companies/${companyId}/site`, {
      model: started.body.starter,
      expectedRevision: null,
    });
    expect(saved.status).toBe(200);
    expect(saved.body.pages).toEqual(["index", "contact"]);
    // A starter is honest but unfinished: saving it works, publishing it would not.
    expect(saved.body.problems.length).toBeGreaterThan(0);
    expect(saved.body.problems.join("\n")).toContain("paragraph 1 is empty");

    const reloaded = await read(api, companyId);
    expect(reloaded.body.site?.revision).toBe(saved.body.site.revision);
    expect(reloaded.body.starter).toBeNull(); // The starting point is only offered to a company without a site.
    expect(reloaded.body.problems).toEqual(saved.body.problems);

    // A second tab that never read this revision cannot overwrite it.
    const stale = await api.json<{ error: { code: string } }>("PUT", `/companies/${companyId}/site`, { model: complete("Later"), expectedRevision: "2020-01-01T00:00:00.000Z" });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("site_stale");

    // A slug that is not an address is refused with the field that was wrong.
    const bad = await api.json<{ error: { code: string; details?: { problems?: string[] } } }>("PUT", `/companies/${companyId}/site`, {
      model: { ...complete("Later"), pages: [{ slug: "About Us", title: "About", description: "", blocks: [] }] },
      expectedRevision: reloaded.body.site!.revision,
    });
    expect(bad.status).toBe(422);
    expect(bad.body.error.details?.problems?.join(" ")).toContain("slug");
  });

  d("previews the draft with the same renderer that publishes it", async () => {
    const { api, companyId } = await studio();
    await api.json("PUT", `/companies/${companyId}/site`, { model: complete("Northwind"), expectedRevision: null });

    const preview = await api.json<{ source: string; html: string; problems: string[] }>("GET", `/companies/${companyId}/site/preview?slug=index`);
    expect(preview.status).toBe(200);
    expect(preview.body.source).toBe("draft");
    expect(preview.body.problems).toEqual([]);
    expect(preview.body.html.startsWith("<!doctype html>")).toBe(true);
    expect(preview.body.html).toContain("Revenue, explained weekly");
    expect(preview.body.html).toContain('href="/contact/"');
    // A preview is shown in an iframe a founder trusts with nothing: the bundle never carries a script or a handler.
    expect(preview.body.html).not.toMatch(/<script/i);
    expect(preview.body.html).not.toMatch(/\son[a-z]+=/i);

    expect((await api.call("GET", `/companies/${companyId}/site/preview?slug=no-such-page`)).status).toBe(404);
    expect((await api.call("GET", `/companies/${companyId}/site/preview?slug=index&versionId=missing`)).status).toBe(404);
  });

  d("refuses to publish an unfinished draft, then builds a version that is exactly what was previewed", async () => {
    const { api, companyId } = await studio();
    const started = await read(api, companyId);
    await api.json("PUT", `/companies/${companyId}/site`, { model: started.body.starter, expectedRevision: null });

    const refused = await api.json<{ error: { code: string; details?: { problems?: string[] } } }>("POST", `/companies/${companyId}/site/publish`);
    expect(refused.status).toBe(422);
    expect(refused.body.error.code).toBe("site_invalid");
    expect(refused.body.error.details?.problems?.join("\n")).toContain("paragraph 1 is empty");
    expect((await read(api, companyId)).body.versions).toEqual([]); // A refusal leaves no version behind.

    const current = (await read(api, companyId)).body.site!;
    const saved = await api.json<{ site: { revision: string } }>("PUT", `/companies/${companyId}/site`, { model: complete("Northwind Analytics"), expectedRevision: current.revision });
    expect(saved.status).toBe(200);
    const preview = await api.json<{ html: string }>("GET", `/companies/${companyId}/site/preview?slug=index`);

    const published = await api.json<{ version: { id: string; number: number; digest: string; pageCount: number; fileCount: number }; files: Array<{ path: string; bytes: number }> }>("POST", `/companies/${companyId}/site/publish`);
    expect(published.status).toBe(201);
    expect(published.body.version.number).toBe(1);
    expect(published.body.version.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(published.body.files.map((file) => file.path)).toEqual(["contact/index.html", "index.html", "site.json"]);

    // What the founder approved in the preview is what the version holds, byte for byte.
    const stored = await api.json<{ source: string; html: string; digest: string }>("GET", `/companies/${companyId}/site/preview?slug=index&versionId=${published.body.version.id}`);
    expect(stored.body.source).toBe("version");
    expect(stored.body.html).toBe(preview.body.html);
    expect(stored.body.digest).toBe(published.body.version.digest);
    expect((await read(api, companyId)).body.versions.map((row) => row.number)).toEqual([1]);

    // The files come back as a download, which is what a founder who hosts elsewhere needs.
    const bundle = await api.call("GET", `/companies/${companyId}/site/versions/${published.body.version.id}/bundle`);
    expect(bundle.status).toBe(200);
    expect(bundle.headers.get("content-disposition")).toContain("attachment");
    const boxed = (await bundle.json()) as { version: number; digest: string; files: Array<{ path: string; contents: string }> };
    expect(boxed.version).toBe(1);
    expect(boxed.digest).toBe(published.body.version.digest);
    expect(boxed.files.find((file) => file.path === "index.html")?.contents).toBe(preview.body.html);
  });

  d("restores an old version as the draft, and shipping it is a run rather than a promise", async () => {
    const { api, companyId, agentId } = await studio();
    await api.json("PUT", `/companies/${companyId}/site`, { model: complete("Northwind Analytics"), expectedRevision: null });
    const first = await api.json<{ version: { id: string; number: number; digest: string } }>("POST", `/companies/${companyId}/site/publish`);
    expect(first.status).toBe(201);
    expect(first.body.version.number).toBe(1);

    const revision = (await read(api, companyId)).body.site!.revision;
    await api.json("PUT", `/companies/${companyId}/site`, { model: { ...complete("Northwind Analytics Ltd"), theme: { accent: "rose", font: "mono", radius: "round", dark: true } }, expectedRevision: revision });
    const second = await api.json<{ version: { number: number; digest: string } }>("POST", `/companies/${companyId}/site/publish`);
    expect(second.body.version.number).toBe(2);
    expect(second.body.version.digest).not.toBe(first.body.version.digest);

    const restored = await api.json<{ site: { name: string; theme: { accent: string } }; problems: string[] }>("POST", `/companies/${companyId}/site/versions/${first.body.version.id}/restore`);
    expect(restored.status).toBe(200);
    expect(restored.body.site.name).toBe("Northwind Analytics");
    expect(restored.body.site.theme.accent).toBe("indigo");
    expect((await read(api, companyId)).body.versions.map((row) => row.number)).toEqual([2, 1]); // A restore is an edit, not a publish.

    const shipped = await api.json<{ status: string; reason: string | null; instruction: string; run: { id: string; trigger: { instruction: string } } }>("POST", `/companies/${companyId}/site/versions/${first.body.version.id}/ship`, { agentId });
    expect(shipped.status).toBe(201);
    expect(shipped.body.status).toBe("started");
    expect(shipped.body.reason).toBeNull();
    expect(shipped.body.instruction).toContain(first.body.version.digest);
    expect(shipped.body.run.trigger.instruction).toBe(shipped.body.instruction);
    // The ship is a real run, so it is visible in the company's own list of what its agents did.
    const runs = await api.json<{ runs: Array<{ id: string; intent: string }> }>("GET", `/companies/${companyId}/runs?limit=10`);
    expect(runs.body.runs.map((run) => run.id)).toContain(shipped.body.run.id);

    expect((await api.call("POST", `/companies/${companyId}/site/versions/no-such-version/ship`, { agentId })).status).toBe(404);
  });

});

/**
 * The code IDE over HTTP.
 *
 * The repository is a *local server that answers like GitHub*, and the integration is pointed at it through its
 * own `baseUrl` field — the seam GitHub Enterprise uses. So these cases exercise the real client over real HTTP:
 * the encrypted token is decrypted and sent, the tree and the file come back the way GitHub sends them, and the
 * refusals (binary, too big, no integration) are the ones a founder would actually meet.
 *
 * Committing is not tested here because this API does not commit: applying a session starts a run, and the run's
 * outcome is what the product reports as applied.
 */
describe("code ide", () => {
  async function workspace(files: Record<string, string> = { "README.md": "# Northwind\n\nWeekly revenue reports.\n", "src/app.ts": "export const revenue = (cents: number) => cents / 100;\n" }) {
    // `binary` is the server's marker for a file with a NUL byte in it, which is how the binary refusal is tested.
    const github = await startFakeGitHub({ files, binary: "logo.png" });
    const founder = await register("Coder");
    const co = await founder.api.json<{ company: { id: string } }>("POST", `/orgs/${founder.orgId}/companies`, { name: `Code ${uniq()}`, autonomyLevel: 2, profile: { description: "x", stage: "idea" } });
    const companyId = co.body.company.id;
    const connected = await founder.api.json<{ integration: { id: string } }>("POST", `/orgs/${founder.orgId}/integrations`, {
      type: "github",
      label: "GitHub (local)",
      companyId,
      fields: { token: `ghp_${uniq()}`, baseUrl: github.url },
    });
    expect(connected.status).toBe(201);
    const listed = await founder.api.json<{ agents: Array<{ id: string; kind: string }> }>("GET", `/companies/${companyId}/agents`);
    const agentId = listed.body.agents.find((agent) => agent.kind === "engineering")!.id;
    return { ...founder, companyId, agentId, github };
  }

  type Read = { connected: boolean; integration: { id: string; label: string } | null; defaultRepo: string | null; sessions: Array<{ id: string; state: string; repo: string; branch: string; changeCount: number; pullUrl: string | null }>; canEdit: boolean; sandbox: { provider: string; runsCommands: boolean } };
  const read = (api: ReturnType<typeof client>, companyId: string) => api.json<Read>("GET", `/companies/${companyId}/code`);

  d("says what to connect instead of failing when source control is not connected, and reports no sandbox honestly", async () => {
    const founder = await register("NoCode");
    const co = await founder.api.json<{ company: { id: string } }>("POST", `/orgs/${founder.orgId}/companies`, { name: `No code ${uniq()}`, autonomyLevel: 2 });
    const companyId = co.body.company.id;

    const first = await read(founder.api, companyId);
    expect(first.status).toBe(200);
    expect(first.body.connected).toBe(false);
    expect(first.body.integration).toBeNull();
    expect(first.body.sessions).toEqual([]);
    // The test stack has no sandbox provider, and the IDE says so rather than offering a button that cannot work.
    expect(first.body.sandbox.runsCommands).toBe(first.body.sandbox.provider !== "none" && first.body.sandbox.provider !== "disabled");

    const repos = await founder.api.json<{ error: { code: string; message: string } }>("GET", `/companies/${companyId}/code/repos`);
    expect(repos.status).toBe(409);
    expect(repos.body.error.code).toBe("code_no_integration");
    expect(repos.body.error.message).toMatch(/Connect GitHub/);
    expect((await founder.api.call("GET", `/companies/${companyId}/code/tree?repo=northwind/analytics&ref=main`)).status).toBe(409);
  });

  d("reads a real repository: tree, file, branches — and refuses what it cannot show", async () => {
    const { api, companyId, github } = await workspace({ "README.md": README_TEXT, "src/app.ts": APP_TEXT, "logo.png": "" });
    const code = await read(api, companyId);
    expect(code.body.connected).toBe(true);

    const repos = await api.json<{ repos: Array<{ fullName: string; defaultBranch: string }> }>("GET", `/companies/${companyId}/code/repos`);
    expect(repos.body.repos.map((repo) => repo.fullName)).toContain("northwind/analytics");

    const tree = await api.json<{ entries: Array<{ path: string; size: number | null }>; truncated: boolean; defaultBranch: string }>("GET", `/companies/${companyId}/code/tree?repo=northwind/analytics&ref=main`);
    expect(tree.body.entries.map((entry) => entry.path)).toEqual(["README.md", "logo.png", "src/app.ts"]);
    expect(tree.body.truncated).toBe(false);

    const file = await api.json<{ contents: string; bytes: number }>("GET", `/companies/${companyId}/code/file?repo=northwind/analytics&ref=main&path=src/app.ts`);
    expect(file.body.contents).toBe(APP_TEXT);

    const branches = await api.json<{ defaultBranch: string; branches: Array<{ name: string; protected: boolean }> }>("GET", `/companies/${companyId}/code/branches?repo=northwind/analytics`);
    expect(branches.body.defaultBranch).toBe("main");
    expect(branches.body.branches.map((branch) => branch.name)).toContain("feature/one");

    // A binary file is refused with a reason a founder can act on, and never sent to the editor.
    const binary = await api.json<{ error: { code: string; message: string } }>("GET", `/companies/${companyId}/code/file?repo=northwind/analytics&ref=main&path=logo.png`);
    expect(binary.status).toBe(422);
    expect(binary.body.error.code).toBe("code_refused");
    expect(binary.body.error.message).toMatch(/not text/);

    // A path that tries to leave the repository is refused before it is ever used.
    expect((await api.call("GET", `/companies/${companyId}/code/file?repo=northwind/analytics&ref=main&path=../secrets`)).status).toBe(422);
    // A ref that is not a branch name is refused rather than passed to git or to a URL.
    expect((await api.call("GET", `/companies/${companyId}/code/tree?repo=northwind/analytics&ref=main%3B%20rm%20-rf`)).status).toBe(422);
    await github.close();
  });

  d("stages a change, shows the diff it would commit, and withdraws it", async () => {
    const { api, companyId, github } = await workspace();
    const created = await api.json<{ session: { id: string; branch: string; baseRef: string; state: string } }>("POST", `/companies/${companyId}/code/sessions`, { repo: "northwind/analytics", baseRef: "main", title: "Add a net helper" });
    expect(created.status).toBe(201);
    expect(created.body.session.branch).toBe("steward/add-a-net-helper");
    const sessionId = created.body.session.id;

    const staged = await api.json<{ changes: Array<{ path: string; kind: string; summary: string; diff: { added: number } }> }>("PUT", `/companies/${companyId}/code/sessions/${sessionId}/changes`, { path: "src/app.ts", contents: `${APP_TEXT}export const net = (cents: number) => cents;\n` });
    expect(staged.status).toBe(200);
    expect(staged.body.changes).toHaveLength(1);
    expect(staged.body.changes[0]!.kind).toBe("modified");
    expect(staged.body.changes[0]!.diff.added).toBe(1);

    const detail = await api.json<{ session: { state: string; changeCount: number }; changes: unknown[]; patch: string; digest: string }>("GET", `/companies/${companyId}/code/sessions/${sessionId}`);
    expect(detail.body.session.state).toBe("draft");
    expect(detail.body.session.changeCount).toBe(1);
    expect(detail.body.patch).toContain("--- a/src/app.ts\n");
    expect(detail.body.patch).toContain("+export const net = (cents: number) => cents;\n");
    expect(detail.body.digest).toMatch(/^sha256:[0-9a-f]{64}$/);

    // A change that says exactly what is already there is not a change.
    const same = await api.json<{ changes: unknown[] }>("PUT", `/companies/${companyId}/code/sessions/${sessionId}/changes`, { path: "src/app.ts", contents: APP_TEXT });
    expect(same.body.changes).toEqual([]);

    // A binary proposal is refused: this editor does not write files it cannot show.
    const binary = await api.json<{ error: { message: string } }>("PUT", `/companies/${companyId}/code/sessions/${sessionId}/changes`, { path: "logo.png", contents: "PNG\u0000" });
    expect(binary.status).toBe(422);
    expect(binary.body.error.message).toMatch(/not text/);

    // Withdrawing leaves the session with nothing to commit.
    await api.json("PUT", `/companies/${companyId}/code/sessions/${sessionId}/changes`, { path: "README.md", contents: "# Northwind\n" });
    const withdrawn = await api.json<{ changes: unknown[] }>("DELETE", `/companies/${companyId}/code/sessions/${sessionId}/changes?path=README.md`);
    expect(withdrawn.body.changes).toEqual([]);

    const discarded = await api.json<{ session: { state: string } }>("POST", `/companies/${companyId}/code/sessions/${sessionId}/discard`);
    expect(discarded.body.session.state).toBe("discarded");
    expect((await api.call("PUT", `/companies/${companyId}/code/sessions/${sessionId}/changes`, { path: "README.md", contents: "x" })).status).toBe(422);
    expect((await read(api, companyId)).body.sessions[0]!.state).toBe("discarded");
    await github.close();
  });

  d("applies a session as a run, and reports applied only when the run says so", async () => {
    const { api, companyId, agentId, orgId, userId, github } = await workspace();
    const created = await api.json<{ session: { id: string; branch: string; title: string } }>("POST", `/companies/${companyId}/code/sessions`, { repo: "northwind/analytics", baseRef: "main", title: "Add a net helper" });
    const sessionId = created.body.session.id;
    await api.json("PUT", `/companies/${companyId}/code/sessions/${sessionId}/changes`, { path: "src/net.ts", contents: "export const net = (cents: number) => cents;\n" });

    const applied = await api.json<{ status: string; reason: string | null; instruction: string; digest: string; run: { id: string; trigger: { instruction: string } } }>("POST", `/companies/${companyId}/code/sessions/${sessionId}/apply`, { agentId });
    expect(applied.status).toBe(201);
    expect(applied.body.status).toBe("started");
    expect(applied.body.reason).toBeNull();
    expect(applied.body.instruction).toContain("Branch: steward/add-a-net-helper");
    expect(applied.body.instruction).toContain("Never commit to main directly");
    // The instruction the founder was shown is the instruction the run holds, byte for byte.
    expect(applied.body.run.trigger.instruction).toBe(applied.body.instruction);
    expect(temporalCalls.some((call) => call.op === "startRun" && (call.args[0] as { runId: string }).runId === applied.body.run.id)).toBe(true);
    // The proposed files are an artifact of the run, so what was approved can be read back later.
    const bundle = await core.pool.query<{ content: string; metadata: Record<string, unknown> }>("select content, metadata from artifacts where run_id = $1 and kind = 'code_change'", [applied.body.run.id]);
    expect((JSON.parse(bundle.rows[0]!.content) as { files: unknown[] }).files).toEqual([{ path: "src/net.ts", contents: "export const net = (cents: number) => cents;\n" }]);
    expect(bundle.rows[0]?.metadata.branch).toBe("steward/add-a-net-helper");

    // A session that is already being applied is frozen rather than applied twice.
    const conflict = await api.json<{ error: { code: string; message: string } }>("POST", `/companies/${companyId}/code/sessions/${sessionId}/apply`, { agentId });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe("code_conflict");
    expect((await read(api, companyId)).body.sessions[0]!.state).toBe("running");

    // The state is the run's: a succeeded run is an applied session, and its pull request is linked.
    const scope: TenantScope = { organizationId: orgId, companyId, userId, role: "owner", actor: { type: "user", userId } };
    await services.runs.setStatus(scope, applied.body.run.id, "succeeded");
    await services.runs.addArtifact(scope, { runId: applied.body.run.id, kind: "pull_request", title: "Add a net helper", url: "https://github.com/northwind/analytics/pull/1", metadata: { number: 1 } });
    const after = await read(api, companyId);
    expect(after.body.sessions[0]!.state).toBe("applied");
    expect(after.body.sessions[0]!.pullUrl).toBe("https://github.com/northwind/analytics/pull/1");

    const detail = await api.json<{ pullRequests: Array<{ url: string; number: number }> }>("GET", `/companies/${companyId}/code/sessions/${sessionId}`);
    expect(detail.body.pullRequests).toEqual([{ title: "Add a net helper", url: "https://github.com/northwind/analytics/pull/1", number: 1 }]);
    await github.close();
  });

  d("keeps a company's code workspace out of another company's reach", async () => {
    const owner = await workspace();
    const stranger = await register("Stranger");
    const strangerCo = await stranger.api.json<{ company: { id: string } }>("POST", `/orgs/${stranger.orgId}/companies`, { name: `Other ${uniq()}`, autonomyLevel: 2 });
    const strangerCompanyId = strangerCo.body.company.id;
    const created = await owner.api.json<{ session: { id: string } }>("POST", `/companies/${owner.companyId}/code/sessions`, { repo: "northwind/analytics", baseRef: "main", title: "Mine" });
    const sessionId = created.body.session.id;

    // A company id the caller cannot see is a 404, and a session of another company is never readable.
    expect((await stranger.api.call("GET", `/companies/${owner.companyId}/code`)).status).toBe(404);
    expect((await stranger.api.call("GET", `/companies/${owner.companyId}/code/tree?repo=northwind/analytics&ref=main`)).status).toBe(404);
    expect((await stranger.api.call("GET", `/companies/${strangerCompanyId}/code/sessions/${sessionId}`)).status).toBe(404);
    expect((await stranger.api.call("PUT", `/companies/${strangerCompanyId}/code/sessions/${sessionId}/changes`, { path: "README.md", contents: "x" })).status).toBe(404);
    await owner.github.close();
  });
});

describe("browser sessions", () => {
  /**
   * The browser lives in the worker, so this suite plays two parts: the API a founder talks to, and the worker that
   * actually owns a page. The provider is the core fake — the same contract with no Chromium — which is what lets
   * a session, its steps, its frames and a stop be checked without launching a browser in the test runner.
   */
  const fake = new FakeBrowserProvider();
  let browserApp: ReturnType<typeof createApp>["app"];
  beforeAll(() => {
    if (!available) return;
    const browserServices = new AgentServiceFactory({ core, env: ENV, companionBridge: new CompanionHub(), browser: fake });
    browserApp = createApp({ core, auth: new AuthService(core.db), mailer, services: browserServices, workflows: fakeTemporal(), companionHub: new CompanionHub(), env: ENV }, null).app;
  });

  /** A founder, a company, the agents that can browse, and a client for the app that has a browser. */
  async function browsable() {
    const founder = await register("Watcher");
    const co = await founder.api.json<{ company: { id: string } }>("POST", `/orgs/${founder.orgId}/companies`, { name: `Browse ${uniq()}`, autonomyLevel: 2, profile: { description: "x", stage: "idea" } });
    const companyId = co.body.company.id;
    const listed = await founder.api.json<{ agents: Array<{ id: string; kind: string }> }>("GET", `/companies/${companyId}/agents`);
    const agentId = listed.body.agents.find((agent) => agent.kind === "research")!.id;
    return { ...founder, companyId, agentId, api: client(founder.token, "", () => browserApp) };
  }

  type Workspace = { provider: string; available: boolean; reason: string | null; sessions: Array<{ id: string; status: string; url: string; stepCount: number; frameCount: number; lastAction: string | null; stopReason: string | null }>; agents: Array<{ id: string; kind: string }>; canControl: boolean; frameWindowDays: number };
  const workspace = (api: ReturnType<typeof client>, companyId: string) => api.json<Workspace>("GET", `/companies/${companyId}/browser`);

  d("says there is no browser here, in the same words a browsing run would be refused with", async () => {
    const founder = await register("NoBrowser");
    const co = await founder.api.json<{ company: { id: string } }>("POST", `/orgs/${founder.orgId}/companies`, { name: `No browser ${uniq()}`, autonomyLevel: 2 });
    const companyId = co.body.company.id;

    // This client talks to the app built without a provider: the honest state of a stack that installed no Chromium.
    const first = await workspace(founder.api, companyId);
    expect(first.status).toBe(200);
    expect(first.body.provider).toBe("none");
    expect(first.body.available).toBe(false);
    expect(first.body.reason).toMatch(/no browser provider configured/i);
    expect(first.body.sessions).toEqual([]);
    // A browser is not a way to drive the company, so a viewer reads the page and the buttons are not offered.
    expect(first.body.canControl).toBe(true);

    const agents = await founder.api.json<{ agents: Array<{ id: string; kind: string }> }>("GET", `/companies/${companyId}/agents`);
    const agentId = agents.body.agents.find((agent) => agent.kind === "research")!.id;
    const started = await founder.api.json<{ error: { code: string; message: string } }>("POST", `/companies/${companyId}/browser/runs`, { url: "https://example.com", objective: "read it", agentId });
    expect(started.body.error.code).toBe("browser_unavailable");
    expect(started.status).toBe(409);
    expect(started.body.error.message).toMatch(/no browser provider configured/i);
    // No run was created for a browser that cannot exist.
    const runs = await founder.api.json<{ runs: unknown[] }>("GET", `/companies/${companyId}/runs`);
    expect(runs.body.runs).toEqual([]);
  });

  d("starts a run from a page and a purpose, and hands it the instruction the founder read", async () => {
    const { api, companyId, agentId } = await browsable();
    const started = await api.json<{ status: string; reason: string | null; instruction: string; run: { id: string; trigger: { instruction: string }; agentId: string } }>("POST", `/companies/${companyId}/browser/runs`, {
      url: "https://example.com/pricing",
      objective: "check the annual price and the free-trial length",
      agentId,
    });
    expect(started.status).toBe(201);
    expect(started.body.status).toBe("started");
    expect(started.body.run.agentId).toBe(agentId);
    expect(started.body.instruction).toContain("https://example.com/pricing");
    expect(started.body.instruction).toContain("check the annual price and the free-trial length");
    expect(started.body.instruction).toMatch(/Watcher asked for this and is watching the session/);
    // The instruction the founder was shown is the instruction the run holds, byte for byte.
    expect(started.body.run.trigger.instruction).toBe(started.body.instruction);
    expect(temporalCalls.some((call) => call.op === "startRun" && (call.args[0] as { runId: string }).runId === started.body.run.id)).toBe(true);
    // And nothing has opened yet: the run opening the page is the point, so no session appears on its own.
    expect((await workspace(api, companyId)).body.sessions).toEqual([]);
  });

  d("refuses an address this deployment will not open, and refuses a run no agent can take", async () => {
    const { api, companyId, agentId } = await browsable();
    fake.refuseTarget = "169.254.169.254";
    const refused = await api.json<{ error: { code: string; message: string } }>("POST", `/companies/${companyId}/browser/runs`, { url: "http://169.254.169.254/latest/meta-data/", objective: "read it", agentId });
    fake.refuseTarget = null;
    expect(refused.status).toBe(422);
    expect(refused.body.error.code).toBe("browser_refused");
    expect(refused.body.error.message).toMatch(/private address/);

    const missing = await api.json<{ error: { code: string } }>("POST", `/companies/${companyId}/browser/runs`, { url: "https://example.com", objective: "read it", agentId: "00000000-0000-4000-8000-000000000000" });
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("not_found");
  });

  d("shows the page the agent is on, what it did, and the frame it saw — then stops it for good", async () => {
    const { api, companyId, agentId, orgId, userId } = await browsable();
    const started = await api.json<{ run: { id: string } }>("POST", `/companies/${companyId}/browser/runs`, { url: "https://example.com", objective: "read it", agentId });
    const scope: TenantScope = { organizationId: orgId, companyId, userId, role: "owner", actor: { type: "user", userId } };

    // The worker half: the provider this app was built with opens the page the run was asked to look at.
    const browser = new AgentServiceFactory({ core, env: ENV, companionBridge: new CompanionHub(), browser: fake }).browser;
    const opened = await browser.open(scope, { url: "https://example.com", runId: started.body.run.id, agentId, purpose: "check the pricing page" });
    expect(opened.session.provider).toBe("fake");
    fake.handle(opened.session.id)!.body = "the price went up";
    await browser.act(scope, opened.session.id, BrowserAction.parse({ kind: "click", selector: "#pricing-link" }));

    const live = await workspace(api, companyId);
    expect(live.body.provider).toBe("fake");
    expect(live.body.available).toBe(true);
    expect(live.body.sessions[0]).toMatchObject({ id: opened.session.id, status: "live", stepCount: 2, frameCount: 2 });

    const detail = await api.json<{ session: { status: string; url: string; title: string; lastAction: string }; frames: Array<{ id: string; seq: number; action: string; bytes: number }> }>("GET", `/companies/${companyId}/browser/sessions/${opened.session.id}`);
    expect(detail.body.session.lastAction).toBe("Click #pricing-link");
    expect(detail.body.frames.map((frame) => frame.seq)).toEqual([1, 2]);
    expect(detail.body.frames[1]!.action).toBe("Click #pricing-link");

    // The frames are images served from the rows, so "I watched it" means the founder saw it.
    const frame = await api.call("GET", `/companies/${companyId}/browser/sessions/${opened.session.id}/frame`);
    expect(frame.status).toBe(200);
    expect(frame.headers.get("content-type")).toBe("image/jpeg");
    expect(frame.headers.get("x-content-type-options")).toBe("nosniff");
    const bytes = Buffer.from(await frame.arrayBuffer());
    expect(bytes.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    expect(bytes.byteLength).toBe(detail.body.frames[1]!.bytes);
    const one = await api.call("GET", `/companies/${companyId}/browser/sessions/${opened.session.id}/frames/${detail.body.frames[0]!.id}`);
    expect(one.status).toBe(200);
    expect(Buffer.from(await one.arrayBuffer()).byteLength).toBe(detail.body.frames[0]!.bytes);

    // The founder stops it. From here the worker's own guard refuses: no further action is possible.
    const stopped = await api.json<{ session: { status: string; stopReason: string } }>("POST", `/companies/${companyId}/browser/sessions/${opened.session.id}/stop`, { reason: "Seen enough." });
    expect(stopped.body.session).toMatchObject({ status: "stopped", stopReason: "Seen enough." });
    expect(fake.closedIds).toContain(opened.session.id);
    await expect(browser.act(scope, opened.session.id, BrowserAction.parse({ kind: "scroll", to: "down" }))).rejects.toMatchObject({ code: "stopped" });

    // A stopped session is still readable — the record of what it did is the point of stopping it.
    const afterwards = await api.json<{ session: { status: string }; frames: unknown[] }>("GET", `/companies/${companyId}/browser/sessions/${opened.session.id}`);
    expect(afterwards.body.session.status).toBe("stopped");
    expect(afterwards.body.frames).toHaveLength(2);
    expect((await api.call("GET", `/companies/${companyId}/browser/sessions/${opened.session.id}/frame`)).status).toBe(200);
  });

  d("delivers the live view's own event list: five types at once is a filter, not a broken query", async () => {
    const { companyId, agentId, orgId, userId, token } = await browsable();
    const types = "browser.opened,browser.step,browser.stopped,browser.closed,browser.failed";
    const response = await browserApp.request(`http://api.test/v1/companies/${companyId}/events/stream?types=${encodeURIComponent(types)}`, { headers: { authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    // A stream has to forbid transformation. Every browser offers `Accept-Encoding`, the web app proxies this route,
    // and Next's production server gzips what it can — and gzip buffers, so the browser would get a 200, an open
    // connection, and no events at all. `no-transform` is what the compression middleware reads to stand down; the
    // browser suite proves the proxy honours it end to end.
    expect(response.headers.get("cache-control")).toContain("no-transform");

    // Read the stream while a session is opened in another "process", which is what the page does.
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    const reading = (async () => {
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline && !text.includes("browser.opened")) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value);
      }
      await reader.cancel().catch(() => undefined);
      return text;
    })();

    await new Promise((resolve) => setTimeout(resolve, 300));
    const scope: TenantScope = { organizationId: orgId, companyId, userId, role: "owner", actor: { type: "user", userId } };
    const browser = new AgentServiceFactory({ core, env: ENV, companionBridge: new CompanionHub(), browser: fake }).browser;
    const opened = await browser.open(scope, { url: "https://example.com", agentId, purpose: "live view" });
    const delivered = await reading;

    expect(delivered.startsWith(": connected\n\n")).toBe(true);
    expect(delivered).toContain("event: ready");
    expect(delivered).toContain("browser.opened");
    expect(delivered).toContain(opened.session.id);
  });

  d("lets a viewer watch and not stop, and keeps one company's sessions out of another's", async () => {
    const owner = await browsable();
    const stranger = await register("Peeker");
    const strangerCo = await stranger.api.json<{ company: { id: string } }>("POST", `/orgs/${stranger.orgId}/companies`, { name: `Peek ${uniq()}`, autonomyLevel: 2 });
    const strangerCompanyId = strangerCo.body.company.id;

    const scope: TenantScope = { organizationId: owner.orgId, companyId: owner.companyId, userId: owner.userId, role: "owner", actor: { type: "user", userId: owner.userId } };
    const browser = new AgentServiceFactory({ core, env: ENV, companionBridge: new CompanionHub(), browser: fake }).browser;
    const opened = await browser.open(scope, { url: "https://example.com", purpose: "look" });

    // An invited viewer reads the workspace and the frames, and cannot stop the session.
    const viewer = await register("Guest");
    const inv = await owner.api.json<{ acceptUrl: string }>("POST", `/orgs/${owner.orgId}/invitations`, { email: viewer.email, role: "viewer" });
    await viewer.api.json("POST", "/invitations/accept", { token: inv.body.acceptUrl.split("/").pop() });
    const asViewer = await workspace(viewer.api, owner.companyId);
    expect(asViewer.body.canControl).toBe(false);
    expect(asViewer.body.sessions[0]!.id).toBe(opened.session.id);
    expect((await viewer.api.call("GET", `/companies/${owner.companyId}/browser/sessions/${opened.session.id}/frame`)).status).toBe(200);
    expect((await viewer.api.call("POST", `/companies/${owner.companyId}/browser/sessions/${opened.session.id}/stop`, {})).status).toBe(403);
    expect((await viewer.api.call("POST", `/companies/${owner.companyId}/browser/runs`, { url: "https://example.com", objective: "x", agentId: owner.agentId })).status).toBe(403);

    // Another company cannot see the session, its frames or its bytes, however it asks.
    expect((await stranger.api.call("GET", `/companies/${owner.companyId}/browser`)).status).toBe(404);
    expect((await stranger.api.call("GET", `/companies/${strangerCompanyId}/browser/sessions/${opened.session.id}`)).status).toBe(404);
    expect((await stranger.api.call("GET", `/companies/${strangerCompanyId}/browser/sessions/${opened.session.id}/frame`)).status).toBe(404);
    expect((await stranger.api.call("POST", `/companies/${strangerCompanyId}/browser/sessions/${opened.session.id}/stop`, {})).status).toBe(404);
  });
});

describe("workflows", () => {
  /**
   * A drawing is only real if it lands on the rows the rest of the product already reads. These tests go through
   * HTTP — one founder, one company, the real app — and then check the reaction surface for the row a drawing
   * published, because "the workflow page says it is live" would be worth nothing on its own.
   */
  type Drawn = { id: string; name: string; enabled: boolean; draftIsLive: boolean; liveCount: number; revision: number; problems: Array<{ code: string; where: string; message: string }>; broken: Array<{ code: string }>; sentences: string[]; readings: Array<{ triggerId: string; kind: string; targetId: string | null; missing: boolean; drift: string[]; live: { id: string; instruction: string; cron?: string; timezone?: string; enabled: boolean } | null }> };
  type ListBody = { workflows: Drawn[]; agents: Array<{ id: string; name: string; enabled: boolean }>; projects: Array<{ id: string }>; catalog: { nodeKinds: string[]; triggerSources: string[]; signalKinds: string[]; eventTypes: string[] }; engine: boolean; canManage: boolean };

  async function drawable() {
    const founder = await register("Drawer");
    const co = await founder.api.json<{ company: { id: string } }>("POST", `/orgs/${founder.orgId}/companies`, { name: `Draw ${uniq()}`, autonomyLevel: 2 });
    const companyId = co.body.company.id;
    const listed = await founder.api.json<{ agents: Array<{ id: string; kind: string; enabled: boolean }> }>("GET", `/companies/${companyId}/agents`);
    const agentId = listed.body.agents.find((agent) => agent.enabled)!;
    const api = client(founder.token, "", () => app);
    const list = () => api.json<ListBody>("GET", `/companies/${companyId}/workflows`);
    return { ...founder, companyId, agentId: agentId.id, agentName: agentId.kind, api, list };
  }

  const triggerNode = (over: Record<string, unknown> = {}) => ({ id: "t1", kind: "trigger", source: "signal", kinds: ["payment.completed"], cron: null, timezone: null, ...over });
  const agentNode = (agentId: string, instruction = "Look at what sold and record the next step.") => ({ id: "a1", kind: "agent", agentId, instruction });
  const limitNode = (over: Record<string, unknown> = {}) => ({ id: "l1", kind: "limit", maxRunsPerHour: 4, cooldownMinutes: 15, ...over });

  d("offers the vocabulary it can actually carry out, and refuses a drawing it cannot", async () => {
    const me = await drawable();
    const workspace = await me.list();
    expect(workspace.status).toBe(200);
    expect(workspace.body.catalog.nodeKinds).toEqual(["trigger", "filter", "agent", "limit"]);
    expect(workspace.body.catalog.triggerSources).toEqual(["signal", "event", "schedule"]);
    expect(workspace.body.catalog.signalKinds).toContain("payment.completed");
    expect(workspace.body.canManage).toBe(true);
    expect(workspace.body.engine).toBe(true);

    // An unfinished drawing is storable — a new workflow starts on a shape, not on a finished one — and is not
    // publishable. The two gates are deliberately different, and the response says which problems are which.
    const half = await me.api.json<{ workflow: Drawn }>("POST", `/companies/${me.companyId}/workflows`, { name: "Incomplete", nodes: [triggerNode()] });
    expect(half.status).toBe(201);
    expect(half.body.workflow.problems.map((problem) => problem.code)).toContain("no_agent");
    expect(half.body.workflow.broken).toEqual([]);
    const notYet = await me.api.json<{ error: { code: string; details: { problems: Array<{ code: string }> } } }>("POST", `/companies/${me.companyId}/workflows/${half.body.workflow.id}/publish`, {});
    expect(notYet.status).toBe(422);
    expect(notYet.body.error.code).toBe("workflow_invalid");
    expect(notYet.body.error.details.problems.map((problem) => problem.code)).toContain("no_agent");
    // The preview tells the same story without storing anything, which is what the builder calls as it is drawn.
    const previewProblems = await me.api.json<{ problems: Array<{ code: string }>; targets: unknown[] }>("POST", `/companies/${me.companyId}/workflows/preview`, { name: "Incomplete", nodes: [triggerNode()] });
    expect(previewProblems.body.problems.map((problem) => problem.code)).toContain("no_agent");
    expect(previewProblems.body.targets).toEqual([]);

    // A node kind this build does not have is refused rather than dropped.
    expect((await me.api.call("POST", `/companies/${me.companyId}/workflows`, { name: "Forked", nodes: [triggerNode(), agentNode(me.agentId), { id: "b1", kind: "branch" }] })).status).toBe(422);
    // And a cron the engine would reject never becomes a row.
    const badCron = await me.api.json<{ error: { details: { problems: Array<{ code: string; message: string }> } } }>("POST", `/companies/${me.companyId}/workflows`, { name: "Never", nodes: [triggerNode({ source: "schedule", kinds: [], cron: "0 9 * *" }), agentNode(me.agentId)] });
    expect(badCron.status).toBe(422);
    expect(badCron.body.error.details.problems.some((problem) => problem.code === "cron_invalid")).toBe(true);
  });

  d("previews a drawing without saving anything, then publishes it into a rule the reaction surface shows", async () => {
    const me = await drawable();
    const nodes = [triggerNode({ kinds: ["payment.completed", "payment.failed"] }), { id: "f1", kind: "filter", severities: ["critical"], projectId: null }, agentNode(me.agentId, "Escalate to the founder."), limitNode()];

    // The preview is the same function as the publish gate: it compiles, and it writes nothing.
    const preview = await me.api.json<{ problems: unknown[]; sentences: string[]; targets: Array<{ kind: string; matchSeverities: string[]; maxRunsPerHour: number }> }>("POST", `/companies/${me.companyId}/workflows/preview`, { name: "Payments", nodes });
    expect(preview.status).toBe(200);
    expect(preview.body.problems).toEqual([]);
    expect(preview.body.targets[0]).toMatchObject({ kind: "rule", matchSeverities: ["critical"], maxRunsPerHour: 4 });
    expect(preview.body.sentences[0]).toContain("Escalate to the founder.");
    expect((await me.list()).body.workflows).toEqual([]);

    const created = await me.api.json<{ workflow: Drawn }>("POST", `/companies/${me.companyId}/workflows`, { name: "Payments", nodes });
    expect(created.status).toBe(201);
    expect(created.body.workflow.draftIsLive).toBe(false); // drawn, not running
    const published = await me.api.json<{ workflow: Drawn; targets: Array<{ targetId: string }>; notices: string[] }>("POST", `/companies/${me.companyId}/workflows/${created.body.workflow.id}/publish`, {});
    expect(published.status).toBe(200);
    expect(published.body.notices).toEqual([]);
    expect(published.body.workflow.draftIsLive).toBe(true);
    expect(published.body.workflow.liveCount).toBe(1);

    // The row the drawing published is the row the reactions surface reads — same id, same words.
    const reactions = await me.api.json<{ rules: Array<{ id: string; name: string; kinds: string[]; severities: string[]; instruction: string; maxRunsPerHour: number; cooldownMinutes: number }> }>("GET", `/companies/${me.companyId}/reactions`);
    const rule = reactions.body.rules.find((row) => row.id === published.body.targets[0]!.targetId)!;
    expect(rule).toMatchObject({ name: "Payments", kinds: ["payment.completed", "payment.failed"], severities: ["critical"], instruction: "Escalate to the founder.", maxRunsPerHour: 4, cooldownMinutes: 15 });
  });

  d("says when the row behind a node was changed somewhere else, and stops everything when paused", async () => {
    const me = await drawable();
    const created = await me.api.json<{ workflow: Drawn }>("POST", `/companies/${me.companyId}/workflows`, { name: "Payments", nodes: [triggerNode(), agentNode(me.agentId, "Watch it.")] });
    const published = await me.api.json<{ targets: Array<{ targetId: string }> }>("POST", `/companies/${me.companyId}/workflows/${created.body.workflow.id}/publish`, {});
    const ruleId = published.body.targets[0]!.targetId;
    expect((await me.list()).body.workflows[0]!.draftIsLive).toBe(true);

    // Somebody edits the same rule on the reactions page. The row is the truth, and the drawing says so.
    await me.api.json("PATCH", `/companies/${me.companyId}/reactions/${ruleId}`, { instruction: "Changed by hand." });
    const drifted = (await me.list()).body.workflows[0]!;
    expect(drifted.draftIsLive).toBe(false);
    expect(drifted.readings[0]!.drift).toContain("its instruction was changed");
    expect(drifted.readings[0]!.live!.instruction).toBe("Changed by hand.");

    // Pausing is one write that pauses every row the drawing runs.
    const paused = await me.api.json<{ workflow: Drawn }>("POST", `/companies/${me.companyId}/workflows/${created.body.workflow.id}/enabled`, { enabled: false });
    expect(paused.status).toBe(200);
    const rules = await me.api.json<{ rules: Array<{ id: string; enabled: boolean }> }>("GET", `/companies/${me.companyId}/reactions`);
    expect(rules.body.rules.find((row) => row.id === ruleId)!.enabled).toBe(false);
    expect(paused.body.workflow.enabled).toBe(false);
  });

  d("registers a drawn schedule with the engine, and takes it back when the drawing is deleted", async () => {
    const me = await drawable();
    const nodes = [triggerNode({ source: "schedule", kinds: [], cron: "0 9 * * 1-5", timezone: "Europe/London" }), agentNode(me.agentId, "Write the weekly digest.")];
    const created = await me.api.json<{ workflow: Drawn }>("POST", `/companies/${me.companyId}/workflows`, { name: "Weekly digest", nodes });
    temporalCalls.length = 0;
    const published = await me.api.json<{ workflow: Drawn; targets: Array<{ targetId: string; kind: string }> }>("POST", `/companies/${me.companyId}/workflows/${created.body.workflow.id}/publish`, {});

    // A schedule that is only a row and never registered is a schedule that looks configured and never fires.
    const registered = temporalCalls.filter((call) => call.op === "upsertSchedule");
    expect(registered).toHaveLength(1);
    expect(registered[0]!.args[0]).toMatchObject({ cron: "0 9 * * 1-5", timezone: "Europe/London", enabled: true });
    const scheduleId = published.body.targets[0]!.targetId;
    expect(published.body.workflow.readings[0]!.live).toMatchObject({ cron: "0 9 * * 1-5", timezone: "Europe/London" });
    // The row also carries the engine's own id, so a later pause updates the right schedule.
    const schedules = await me.api.json<{ schedules: Array<{ id: string; temporalScheduleId: string | null }> }>("GET", `/companies/${me.companyId}/schedules`);
    expect(schedules.body.schedules.find((row) => row.id === scheduleId)!.temporalScheduleId).toBe(`schedule-${scheduleId}`);

    const removed = await me.api.json<{ removed: { rules: number; schedules: number } }>("DELETE", `/companies/${me.companyId}/workflows/${created.body.workflow.id}`);
    expect(removed.body.removed).toEqual({ rules: 0, schedules: 1 });
    expect(temporalCalls.some((call) => call.op === "deleteSchedule" && call.args[0] === scheduleId)).toBe(true);
    expect((await me.list()).body.workflows).toEqual([]);
  });

  d("keeps one company's drawings, and the rules they publish, out of another's", async () => {
    const owner = await drawable();
    const stranger = await drawable();
    const created = await owner.api.json<{ workflow: Drawn }>("POST", `/companies/${owner.companyId}/workflows`, { name: "Private", nodes: [triggerNode(), agentNode(owner.agentId, "Watch it.")] });
    const published = await owner.api.json<{ targets: Array<{ targetId: string }> }>("POST", `/companies/${owner.companyId}/workflows/${created.body.workflow.id}/publish`, {});

    // The stranger cannot read it, cannot publish it, and cannot delete a rule it does not own.
    expect((await stranger.api.call("GET", `/companies/${owner.companyId}/workflows`)).status).toBe(404);
    expect((await stranger.api.call("POST", `/companies/${owner.companyId}/workflows/${created.body.workflow.id}/publish`, {})).status).toBe(404);
    expect((await stranger.api.call("DELETE", `/companies/${owner.companyId}/workflows/${created.body.workflow.id}`)).status).toBe(404);
    expect((await stranger.list()).body.workflows).toEqual([]);
    // And the rule really belongs to the company that drew it.
    expect((await stranger.api.call("PATCH", `/companies/${owner.companyId}/reactions/${published.body.targets[0]!.targetId}`, { enabled: false })).status).toBe(404);
  });
});

describe("mcp marketplace", () => {
  /**
   * Install a server, see what it may do, decide who may call it.
   *
   * The inspection half of these tests spawns a *real* MCP server over stdio — the fixture beside the seam that
   * speaks to it — because the claim being made is that a company can install somebody else's server and the
   * product will tell them the truth about it. A stub would only prove we agree with ourselves. The grant half
   * then goes one step further than any read: it builds the registry a run would use, in-process, from the rows
   * the API just wrote, and checks that the agent's own allowlist and nothing else decides what is in it.
   */
  const FIXTURE_SERVER = fileURLToPath(new URL("../../../packages/tools/fixtures/mcp-server.mjs", import.meta.url));

  type ToolView = { id: string; name: string; toolName: string; risk: string; riskSource: string; riskReason: string; sideEffects: string; idempotent: boolean; enabled: boolean; grantedTo: Array<{ agentId: string; agentName: string; pattern: string }> };
  type ServerView = { id: string; name: string; slug: string; purpose: string; transport: string; target: string; description: string; enabled: boolean; inspectedAt: string | null; error: string | null; tools: ToolView[] };
  type Surface = { servers: ServerView[]; agents: Array<{ id: string; name: string; kind: string }>; catalog: { transports: string[]; stdio: boolean; privateTargets: boolean }; canManage: boolean };
  type Inspected = { ok: boolean; error: string | null; added: string[]; removed: string[]; changed: Array<{ toolName: string; fields: string[] }>; omitted: number; total: number; server: ServerView; notices: string[] };

  async function marketplace() {
    const founder = await register("Marketplace");
    const co = await founder.api.json<{ company: { id: string } }>("POST", `/orgs/${founder.orgId}/companies`, { name: `Marketplace ${uniq()}`, autonomyLevel: 2 });
    const companyId = co.body.company.id;
    const api = client(founder.token, "", () => app);
    const listed = await api.json<{ agents: Array<{ id: string; kind: string; name: string; enabled: boolean }> }>("GET", `/companies/${companyId}/agents`);
    const agent = listed.body.agents.find((row) => row.enabled)!;
    return {
      ...founder,
      companyId,
      api,
      agentId: agent.id,
      agentKind: agent.kind,
      read: () => api.json<Surface>("GET", `/companies/${companyId}/mcp`),
      install: (over: Record<string, unknown> = {}) => ({ name: "Fixture ledger", slug: "ledger", purpose: "Customers and invoices.", transport: "stdio", command: process.execPath, args: [FIXTURE_SERVER], ...over }),
    };
  }

  d("installs a server, then asks it what it may do and records the answer with its reasoning", async () => {
    const me = await marketplace();
    const empty = await me.read();
    expect(empty.status).toBe(200);
    expect(empty.body.servers).toEqual([]);
    expect(empty.body.catalog.transports).toEqual(["stdio", "http", "sse"]);
    expect(empty.body.catalog.stdio).toBe(true);
    expect(empty.body.catalog.privateTargets).toBe(false);
    expect(empty.body.canManage).toBe(true);

    // Installing is not reaching out: the server exists, and it offers nothing, because nobody has asked it yet.
    const installed = await me.api.json<{ server: ServerView; notices: string[] }>("POST", `/companies/${me.companyId}/mcp`, me.install());
    expect(installed.status).toBe(201);
    expect(installed.body.server).toMatchObject({ slug: "ledger", transport: "stdio", inspectedAt: null, error: null, tools: [] });
    expect(installed.body.server.target).toContain("mcp-server.mjs");
    expect(installed.body.notices[0]).toContain("has not been inspected");

    const inspected = await me.api.json<Inspected>("POST", `/companies/${me.companyId}/mcp/${installed.body.server.id}/inspect`, {});
    expect(inspected.status).toBe(200);
    expect(inspected.body).toMatchObject({ ok: true, error: null, total: 6, omitted: 0 });
    expect(inspected.body.added).toHaveLength(6);

    const server = (await me.read()).body.servers[0]!;
    const tool = (name: string) => server.tools.find((row) => row.name === name)!;
    // Two names, because a founder reading a tool list and a founder writing an allowlist must be looking at what
    // the runtime is: the server's name and the name Steward calls it.
    expect(tool("lookup_invoice")).toMatchObject({ toolName: "mcp.ledger.lookup_invoice", risk: "LOW", riskSource: "hint", sideEffects: "none", idempotent: true, enabled: true });
    expect(tool("lookup_invoice").riskReason).toContain("only reads");
    expect(tool("delete_customer")).toMatchObject({ risk: "HIGH", riskSource: "hint", sideEffects: "external" });
    expect(tool("reschedule")).toMatchObject({ risk: "MEDIUM", riskSource: "default" });
    // The one a naive classifier gets wrong: a name that reads as a query, an annotation that says it writes.
    expect(tool("get_and_reissue")).toMatchObject({ risk: "HIGH", riskSource: "hint" });
    expect(server.inspectedAt).not.toBeNull();

    // A second inspection of an unchanged server reports no drift.
    const again = await me.api.json<Inspected>("POST", `/companies/${me.companyId}/mcp/${installed.body.server.id}/inspect`, {});
    expect(again.body).toMatchObject({ added: [], removed: [], changed: [], total: 6 });
  }, 60_000);

  d("refuses an install this deployment will not carry out, naming the field and saying why", async () => {
    const me = await marketplace();
    const refused = (body: Record<string, unknown>) => me.api.json<{ error: { code: string; details?: { problems: Array<{ code: string; where: string; message: string }> } } }>("POST", `/companies/${me.companyId}/mcp`, me.install(body));

    const badSlug = await refused({ slug: "Ledger API!" });
    expect(badSlug.status).toBe(422);
    expect(badSlug.body.error.code).toBe("mcp_invalid");
    expect(badSlug.body.error.details!.problems).toContainEqual(expect.objectContaining({ code: "slug_invalid", where: "slug" }));
    expect((await refused({ name: "  " })).body.error.details!.problems).toContainEqual(expect.objectContaining({ code: "name_required" }));
    expect((await refused({ command: "" })).body.error.details!.problems).toContainEqual(expect.objectContaining({ code: "command_required" }));

    // The deployment's own network is refused unless it has been told otherwise, and the sentence names the host.
    const privateTarget = await refused({ transport: "http", url: "http://169.254.169.254/latest/meta-data", command: null, args: [] });
    expect(privateTarget.body.error.details!.problems).toContainEqual(expect.objectContaining({ code: "url_private", where: "url" }));
    expect(privateTarget.body.error.details!.problems.find((problem) => problem.code === "url_private")!.message).toContain("169.254.169.254");
    // Credentials in an address end up written down in a dozen places.
    expect((await refused({ transport: "http", url: "https://user:pass@mcp.example.com/mcp", command: null, args: [] })).body.error.details!.problems).toContainEqual(expect.objectContaining({ code: "url_invalid" }));
    // A transport this build does not have never reaches the handler at all.
    expect((await me.api.call("POST", `/companies/${me.companyId}/mcp`, me.install({ transport: "smoke-signal" }))).status).toBe(422);

    // And two servers in one company cannot share a slug, because their tool names would collide.
    expect((await me.api.json("POST", `/companies/${me.companyId}/mcp`, me.install())).status).toBe(201);
    const clash = await refused({ name: "Other ledger" });
    expect(clash.status).toBe(422);
    expect(clash.body.error.details!.problems).toContainEqual(expect.objectContaining({ code: "slug_taken" }));
    expect(await me.api.call("DELETE", `/companies/${me.companyId}/mcp/does-not-exist`)).toHaveProperty("status", 404);
  }, 60_000);

  d("records a server it cannot reach as the server's condition, not as a failed request", async () => {
    const me = await marketplace();
    const broken = await me.api.json<{ server: ServerView }>("POST", `/companies/${me.companyId}/mcp`, me.install({ command: "steward-mcp-that-does-not-exist", args: [] }));
    const inspected = await me.api.json<Inspected>("POST", `/companies/${me.companyId}/mcp/${broken.body.server.id}/inspect`, {});

    // 200, because a third party being down is not this request failing — it is what this server is right now.
    expect(inspected.status).toBe(200);
    expect(inspected.body.ok).toBe(false);
    expect(inspected.body.error).toContain("Could not start “Fixture ledger”");
    expect(inspected.body.notices[0]).toContain("steward-mcp-that-does-not-exist");
    expect(inspected.body.total).toBe(0);

    // The row says so too, so the next reader is told without having to try again.
    const server = (await me.read()).body.servers[0]!;
    expect(server.error).toContain("Could not start");
    expect(server.inspectedAt).toBeNull();
    expect(server.tools).toEqual([]);
  }, 60_000);

  d("grants a server by writing the agent's own allowlist, and takes it back the same way", async () => {
    const me = await marketplace();
    const installed = await me.api.json<{ server: ServerView }>("POST", `/companies/${me.companyId}/mcp`, me.install());
    const serverId = installed.body.server.id;
    await me.api.json("POST", `/companies/${me.companyId}/mcp/${serverId}/inspect`, {});

    // Nothing is granted by installing: the agent that exists has no `mcp.` pattern of its own.
    const before = (await me.read()).body.servers[0]!;
    expect(before.tools.every((tool) => tool.grantedTo.length === 0)).toBe(true);

    const granted = await me.api.json<{ agent: { id: string; toolAllowlist: string[] }; notices: string[] }>("POST", `/companies/${me.companyId}/mcp/${serverId}/grant`, { agentId: me.agentId, toolNames: null, granted: true });
    expect(granted.status).toBe(200);
    expect(granted.body.agent.toolAllowlist).toContain("mcp.ledger.*");
    // This agent has a tool list of its own, so nothing had to be written out on its behalf.
    expect(granted.body.notices).toEqual([]);

    // An agent with no list of its own is running on the defaults for its kind, and the first grant must not be
    // the thing that takes those away — so they are written out explicitly, and the answer says it happened.
    const bare = await me.api.json<{ agent: { id: string; toolAllowlist: string[] } }>("POST", `/companies/${me.companyId}/agents`, { kind: "research", name: `Researcher ${uniq()}`, toolAllowlist: [] });
    expect(bare.body.agent.toolAllowlist).toEqual([]);
    const bareGrant = await me.api.json<{ agent: { toolAllowlist: string[] }; notices: string[] }>("POST", `/companies/${me.companyId}/mcp/${serverId}/grant`, { agentId: bare.body.agent.id, toolNames: null, granted: true });
    expect(bareGrant.body.notices[0]).toContain("no tools of its own");
    expect(bareGrant.body.agent.toolAllowlist).toContain("mcp.ledger.*");
    expect(bareGrant.body.agent.toolAllowlist).toContain("web.*");

    // The surface and the agent agree, because they are reading the same field.
    const after = (await me.read()).body.servers[0]!;
    expect(after.tools.every((tool) => tool.grantedTo.some((row) => row.pattern === "mcp.ledger.*"))).toBe(true);
    const agents = await me.api.json<{ agents: Array<{ id: string; toolAllowlist: string[] }> }>("GET", `/companies/${me.companyId}/agents`);
    expect(agents.body.agents.find((row) => row.id === me.agentId)!.toolAllowlist).toContain("mcp.ledger.*");

    // Taking one tool back from a wildcard has to leave the other five named explicitly, or "revoke one" would
    // either do nothing or take the whole server away.
    const one = await me.api.json<{ agent: { toolAllowlist: string[] } }>("POST", `/companies/${me.companyId}/mcp/${serverId}/grant`, { agentId: me.agentId, toolNames: ["mcp.ledger.delete_customer"], granted: false });
    expect(one.body.agent.toolAllowlist).not.toContain("mcp.ledger.*");
    expect(one.body.agent.toolAllowlist).not.toContain("mcp.ledger.delete_customer");
    expect(one.body.agent.toolAllowlist).toContain("mcp.ledger.lookup_invoice");
    const narrowed = (await me.read()).body.servers[0]!;
    // Read per agent, because another agent holding the whole server is exactly the case this is not about.
    const heldBy = (name: string) => narrowed.tools.find((tool) => tool.name === name)!.grantedTo.filter((row) => row.agentId === me.agentId);
    expect(heldBy("delete_customer")).toEqual([]);
    expect(heldBy("lookup_invoice")).toHaveLength(1);

    // And taking the server back leaves the agent with what it had before, defaults included.
    const revoked = await me.api.json<{ agent: { toolAllowlist: string[] } }>("POST", `/companies/${me.companyId}/mcp/${serverId}/grant`, { agentId: me.agentId, toolNames: null, granted: false });
    expect(revoked.body.agent.toolAllowlist.some((pattern) => pattern.startsWith("mcp."))).toBe(false);
    expect(revoked.body.agent.toolAllowlist.length).toBeGreaterThan(0);
  }, 60_000);

  d("puts the granted tools in the registry a run actually reads, and only those", async () => {
    const me = await marketplace();
    const installed = await me.api.json<{ server: ServerView }>("POST", `/companies/${me.companyId}/mcp`, me.install());
    const serverId = installed.body.server.id;
    await me.api.json("POST", `/companies/${me.companyId}/mcp/${serverId}/inspect`, {});
    await me.api.json("POST", `/companies/${me.companyId}/mcp/${serverId}/inspect`, {});

    const scope: TenantScope = { organizationId: me.orgId, companyId: me.companyId, userId: me.userId, role: "owner", actor: { type: "user", userId: me.userId } };
    const runtimeRegistry = async () => registryWithMcpTools(buildToolRegistry(), services.forScope(scope));
    const names = async (allow: string[]) => (await runtimeRegistry()).list({ allow }).map((tool) => tool.manifest.name);

    // Before any grant, the server's tools are registered but invisible to this agent — which is the whole safety
    // story of a marketplace: installing a server changes what no agent may do.
    const agent = await services.forScope(scope).agents.get(scope, me.agentId);
    const grantedNames = await names(["mcp.ledger.*"]);
    expect(grantedNames).toHaveLength(6);
    expect(await names(agent!.toolAllowlist)).not.toContain("mcp.ledger.lookup_invoice");
    expect(agent!.toolAllowlist.some((pattern) => pattern.startsWith("mcp."))).toBe(false);

    // The tool in the registry is the one the row describes, and it is the server's tool.
    const listed = (await runtimeRegistry()).get("mcp.ledger.lookup_invoice")!;
    expect(listed.manifest).toMatchObject({ source: "mcp", risk: "LOW", sideEffects: "none", idempotent: true, costCategory: "none" });
    expect(listed.manifest.description).toContain("Fixture ledger");
    expect(listed.manifest.inputSchema).toMatchObject({ type: "object" });
    const result = await listed.execute({ id: "inv_1" }, { scope, services: {}, log: () => {} });
    expect(result.ok).toBe(true);
    expect(result.content).toContain("250.00 GBP");

    // Blocking one tool takes it out of the registry without touching the rest, and pausing the server takes them
    // all away at once — which is the difference between a per-tool decision and an install.
    const surface = (await me.read()).body.servers[0]!;
    const blocked = surface.tools.find((tool) => tool.name === "delete_customer")!;
    expect((await me.api.json("PATCH", `/companies/${me.companyId}/mcp/${serverId}/tools/${blocked.id}`, { enabled: false })).status).toBe(200);
    expect(await names(["mcp.ledger.*"])).not.toContain("mcp.ledger.delete_customer");
    expect(await names(["mcp.ledger.*"])).toHaveLength(5);

    await me.api.json("POST", `/companies/${me.companyId}/mcp/${serverId}/enabled`, { enabled: false });
    expect(await names(["mcp.ledger.*"])).toEqual([]);
    await me.api.json("POST", `/companies/${me.companyId}/mcp/${serverId}/enabled`, { enabled: true });
    expect(await names(["mcp.ledger.*"])).toHaveLength(5);
  }, 60_000);

  d("discards the tool list when where a server points changes, and keeps one company's servers out of another's", async () => {
    const owner = await marketplace();
    const stranger = await marketplace();
    const installed = await owner.api.json<{ server: ServerView }>("POST", `/companies/${owner.companyId}/mcp`, owner.install());
    const serverId = installed.body.server.id;
    await owner.api.json("POST", `/companies/${owner.companyId}/mcp/${serverId}/inspect`, {});

    // Renaming is not moving. The tool list still came from this server, so it stays.
    const renamed = await owner.api.json<{ server: ServerView; uninspected: boolean; notices: string[] }>("PATCH", `/companies/${owner.companyId}/mcp/${serverId}`, { name: "Ledger API" });
    expect(renamed.body.uninspected).toBe(false);
    expect(renamed.body.notices).toEqual([]);
    expect(renamed.body.server.tools).toHaveLength(6);

    // Changing the arguments is: what was recorded is evidence about a different process.
    const moved = await owner.api.json<{ server: ServerView; uninspected: boolean; notices: string[] }>("PATCH", `/companies/${owner.companyId}/mcp/${serverId}`, { args: [FIXTURE_SERVER, "--other"] });
    expect(moved.body.uninspected).toBe(true);
    expect(moved.body.server.tools).toEqual([]);
    expect(moved.body.server.inspectedAt).toBeNull();
    expect(moved.body.notices[0]).toContain("discarded");
    // A slug is not editable, because every tool name and every grant is written in terms of it.
    expect((await owner.api.json("PATCH", `/companies/${owner.companyId}/mcp/${serverId}`, { slug: "ledger-v2" })).status).toBe(422);

    // Nothing of the owner's is reachable from the stranger, on any route, and its own surface is still empty.
    expect((await stranger.api.call("GET", `/companies/${owner.companyId}/mcp`)).status).toBe(404);
    expect((await stranger.api.call("POST", `/companies/${owner.companyId}/mcp/${serverId}/inspect`, {})).status).toBe(404);
    expect((await stranger.api.call("POST", `/companies/${owner.companyId}/mcp/${serverId}/grant`, { agentId: stranger.agentId, granted: true })).status).toBe(404);
    expect((await stranger.api.call("DELETE", `/companies/${owner.companyId}/mcp/${serverId}`)).status).toBe(404);
    expect((await stranger.read()).body.servers).toEqual([]);

    // Removing an install takes its tools with it, and says how many went.
    const removed = await owner.api.json<{ removed: { slug: string; tools: number } }>("DELETE", `/companies/${owner.companyId}/mcp/${serverId}`);
    expect(removed.body.removed).toEqual({ slug: "ledger", tools: 0 });
    expect((await owner.read()).body.servers).toEqual([]);
  }, 60_000);
});

describe("knowledge graph", () => {
  /**
   * What the company knows, as one thing.
   *
   * The two halves are asserted apart because the product keeps them apart. A *derived* edge is read from the
   * rows the company already has, so it disappears with the row it came from. A *recorded* claim is somebody's
   * sentence about a row, so it is the one that can outlive its subject — which is why the case that matters most
   * here is a claim pointing at something that has been deleted: it has to be reported, not hidden, and not
   * cascaded away from a graph into nine tables.
   */
  type Node = { kind: string; id: string; label: string; sublabel: string; at: string | null; entityType?: string };
  type Edge = { id: string; relation: string; label: string; sentence: string; origin: "derived" | "recorded"; field: string | null; by: string | null; note: string | null; from: Node; to: Node; dangling: boolean };
  type Surface = {
    overview: {
      counts: Array<{ kind: string; total: number; omitted: number }>;
      links: { total: number; dangling: number; byRelation: Array<{ relation: string; total: number }> };
      relations: Array<{ id: string; label: string; targets: string[] }>;
      nodeKinds: Array<{ kind: string; label: string }>;
      limits: { nodesPerKind: number };
    };
    nodes: Node[];
    canRecord: boolean;
    canManage: boolean;
  };
  type Neighborhood = { node: Node; derived: Edge[]; incoming: Edge[]; outgoing: Edge[]; omitted: Record<string, number>; dangling: number };
  type Entity = { id: string; type: string; name: string; normalizedName: string; aliases: string[]; attributes: Record<string, unknown>; confidence: number; source: string };
  type Refusal = { error: { code: string; message: string; details: { problems?: Array<{ code: string }>; entityId?: string } } };

  async function workspace() {
    const founder = await register("Graph");
    const co = await founder.api.json<{ company: { id: string } }>("POST", `/orgs/${founder.orgId}/companies`, { name: `Graph ${uniq()}`, autonomyLevel: 2 });
    const companyId = co.body.company.id;
    const api = client(founder.token, "", () => app);
    const project = await api.json<{ project: { id: string } }>("POST", `/companies/${companyId}/projects`, { name: "Payments", objective: "Take payments and ship the ledger to every customer." });
    const task = await api.json<{ task: { id: string } }>("POST", `/companies/${companyId}/tasks`, { title: "Ship the ledger", projectId: project.body.project.id });
    return {
      ...founder,
      companyId,
      api,
      projectId: project.body.project.id,
      taskId: task.body.task.id,
      read: () => api.json<Surface>("GET", `/companies/${companyId}/graph`),
      find: (query: string) => api.json<{ nodes: Node[]; query: string }>("GET", `/companies/${companyId}/graph/search?q=${encodeURIComponent(query)}`),
      node: (kind: string, id: string) => api.json<Neighborhood>("GET", `/companies/${companyId}/graph/nodes/${kind}/${id}`),
      // The row itself, which is what a surface opens an edit form on: a node in a list is a label, not a record.
      known: (id: string) => api.json<{ entity: Entity }>("GET", `/companies/${companyId}/graph/entities/${id}`),
      record: (body: Record<string, unknown>) => api.json<{ entity: Entity; created: boolean; aliasAdded: boolean; notices: string[] }>("POST", `/companies/${companyId}/graph/entities`, body),
      recordRaw: (body: Record<string, unknown>) => api.json<Refusal>("POST", `/companies/${companyId}/graph/entities`, body),
      link: (entityId: string, body: Record<string, unknown>) => api.json<{ link: { id: string }; alreadyThere: boolean; notices: string[] }>("POST", `/companies/${companyId}/graph/entities/${entityId}/links`, body),
      linkRaw: (entityId: string, body: Record<string, unknown>) => api.json<Refusal>("POST", `/companies/${companyId}/graph/entities/${entityId}/links`, body),
    };
  }

  d("reads what the company already has, and says which column every edge came from", async () => {
    const me = await workspace();
    const surface = await me.read();
    expect(surface.status).toBe(200);
    expect(surface.body).toMatchObject({ canRecord: true, canManage: true });

    const count = (kind: string) => surface.body.overview.counts.find((row) => row.kind === kind)!;
    expect(count("project").total).toBe(1);
    expect(count("task").total).toBe(1);
    // A company that has never recorded anything still has a kind to record into.
    expect(count("entity").total).toBe(0);
    expect(surface.body.overview.nodeKinds.map((row) => row.kind)).toContain("entity");
    expect(surface.body.overview.relations.map((row) => row.id)).toContain("works_at");

    // The page is the company's own rows, with the label a surface draws and the type a known thing carries.
    expect(surface.body.nodes.find((node) => node.kind === "task")).toMatchObject({ id: me.taskId, label: "Ship the ledger", sublabel: "todo" });
    // Nothing was left out of a company this small, and the bound is the API's own number rather than a hidden one.
    expect(count("task").omitted).toBe(0);
    expect(surface.body.overview.limits.nodesPerKind).toBeGreaterThan(0);

    // The derived half: read from a column, and the column travels with the edge.
    const hood = await me.node("project", me.projectId);
    expect(hood.status).toBe(200);
    expect(hood.body.derived.find((edge) => edge.from.id === me.taskId)).toMatchObject({ relation: "belongs_to", origin: "derived", field: "tasks.project_id" });
    expect(hood.body.incoming).toEqual([]);
  });

  d("records a thing, confirms one it already knew, and refuses a name that says nothing", async () => {
    const me = await workspace();
    const first = await me.record({ type: "company", name: "Acme, Inc.", attributes: { domain: "acme.test" }, confidence: 0.8 });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ created: true, aliasAdded: false });
    expect(first.body.entity).toMatchObject({ type: "company", normalizedName: "acme, inc", confidence: 0.8, source: "founder" });
    expect(first.body.entity.attributes).toEqual({ domain: "acme.test" });
    // And reading it back gives the surface every spelling and field to open a correction on.
    const read = await me.known(first.body.entity.id);
    expect(read.status).toBe(200);
    expect(read.body.entity).toMatchObject({ name: "Acme, Inc.", type: "company", confidence: 0.8, source: "founder" });
    expect(read.body.entity.attributes).toEqual({ domain: "acme.test" });

    // The same name written differently is the same thing: confirmed, not a second node.
    const again = await me.record({ type: "company", name: "ACME,  INC." });
    expect(again.status).toBe(200);
    expect(again.body.created).toBe(false);
    expect(again.body.entity.id).toBe(first.body.entity.id);
    expect(again.body.notices[0]).toContain("already knew");

    // A spelling the fold cannot reach is kept, because that is the one that would otherwise look like another thing.
    const named = await me.record({ type: "company", name: "Acme, Inc.", aliases: ["Acme Incorporated"] });
    expect(named.body.aliasAdded).toBe(true);
    expect(named.body.entity.aliases).toContain("Acme Incorporated");
    expect((await me.find("Acme Incorporated")).body.nodes.map((node) => node.id)).toContain(first.body.entity.id);

    // A name that says nothing is refused by the graph's own rules, in the words the surface renders against the field.
    const refused = await me.recordRaw({ type: "company", name: "x", attributes: { domain: "x".repeat(401) } });
    expect(refused.status).toBe(422);
    expect(refused.body.error.code).toBe("graph_invalid");
    expect(refused.body.error.details.problems!.map((problem) => problem.code)).toEqual(expect.arrayContaining(["name_required", "attribute_too_long"]));
    // And a kind of thing this build does not have never reaches the service at all: the transport refuses it.
    const nonsense = await me.recordRaw({ type: "wizard", name: "Merlin" });
    expect(nonsense.status).toBe(422);
    expect(nonsense.body.error.code).toBe("invalid_body");
  });

  d("connects a thing to the company's own rows, and refuses a claim its relation cannot make", async () => {
    const me = await workspace();
    const person = await me.record({ type: "person", name: "Ada Lovelace" });
    const entityId = person.body.entity.id;

    const linked = await me.link(entityId, { relation: "works_on", targetKind: "project", targetId: me.projectId, note: "owns the ledger" });
    expect(linked.status).toBe(201);
    expect(linked.body.alreadyThere).toBe(false);
    // Recording the same claim twice is idempotent rather than a doubled neighborhood.
    const twice = await me.link(entityId, { relation: "works_on", targetKind: "project", targetId: me.projectId });
    expect(twice.status).toBe(200);
    expect(twice.body.alreadyThere).toBe(true);
    expect(twice.body.notices[0]).toContain("already recorded");

    // A relation that points at a project cannot point at one by accident, and a target that is not here is not here.
    const wrongKind = await me.linkRaw(entityId, { relation: "works_at", targetKind: "project", targetId: me.projectId });
    expect(wrongKind.status).toBe(422);
    expect(wrongKind.body.error.code).toBe("graph_invalid");
    expect(wrongKind.body.error.details.problems!.map((problem) => problem.code)).toContain("target_kind_not_allowed");
    const missing = await me.linkRaw(entityId, { relation: "mentioned_in", targetKind: "document", targetId: "00000000-0000-0000-0000-000000000000" });
    expect(missing.body.error.details.problems!.map((problem) => problem.code)).toContain("target_missing");
    const itself = await me.linkRaw(entityId, { relation: "same_as", targetKind: "entity", targetId: entityId });
    expect(itself.body.error.details.problems!.map((problem) => problem.code)).toContain("self_link");

    // The claim is one edge seen from both ends, and it says who wrote it.
    const mine = await me.node("entity", entityId);
    expect(mine.body.outgoing).toHaveLength(1);
    expect(mine.body.outgoing[0]).toMatchObject({ relation: "works_on", origin: "recorded", by: "founder", dangling: false });
    const theirs = await me.node("project", me.projectId);
    expect(theirs.body.incoming).toHaveLength(1);
    expect(theirs.body.incoming[0]!.sentence).toContain("Ada Lovelace");
    expect((await me.read()).body.overview.links.byRelation.find((row) => row.relation === "works_on")!.total).toBe(1);
  });

  d("reports a claim whose row is gone, and drops it in one act", async () => {
    const me = await workspace();
    const doc = await me.api.json<{ document: { id: string } }>("PUT", `/companies/${me.companyId}/documents`, { title: "Pricing notes", content: "What we charge for." });
    const entity = await me.record({ type: "company", name: "Globex" });
    expect((await me.link(entity.body.entity.id, { relation: "mentioned_in", targetKind: "document", targetId: doc.body.document.id })).status).toBe(201);

    await me.api.json("DELETE", `/companies/${me.companyId}/documents/${doc.body.document.id}`);
    const hood = await me.node("entity", entity.body.entity.id);
    expect(hood.body.dangling).toBe(1);
    expect(hood.body.outgoing[0]).toMatchObject({ dangling: true });
    // Said out loud rather than hidden: the claim is there, and what it was about is not.
    expect(hood.body.outgoing[0]!.to.label).toContain("gone");
    expect((await me.read()).body.overview.links.dangling).toBe(1);

    const dropped = await me.api.json("DELETE", `/companies/${me.companyId}/graph/links/${hood.body.outgoing[0]!.id}`);
    expect(dropped.status).toBe(200);
    expect((await me.node("entity", entity.body.entity.id)).body.dangling).toBe(0);
    expect((await me.read()).body.overview.links.total).toBe(0);
  });

  d("merges a duplicate without losing a claim, and refuses to rename into a name it knows", async () => {
    const me = await workspace();
    const ours = await me.record({ type: "company", name: "Acme Inc" });
    const theirs = await me.record({ type: "company", name: "Acme, Inc." });
    // Two nodes, because the fold is narrow on purpose: only a person can say these are one company.
    expect(ours.body.entity.id).not.toBe(theirs.body.entity.id);

    await me.link(ours.body.entity.id, { relation: "works_on", targetKind: "project", targetId: me.projectId });
    await me.link(theirs.body.entity.id, { relation: "works_on", targetKind: "project", targetId: me.projectId });
    await me.link(theirs.body.entity.id, { relation: "mentioned_in", targetKind: "task", targetId: me.taskId });

    const merged = await me.api.json<{ entity: Entity; moved: number; dropped: number; aliases: string[]; notices: string[] }>("POST", `/companies/${me.companyId}/graph/entities/${ours.body.entity.id}/merge`, { duplicateId: theirs.body.entity.id });
    expect(merged.status).toBe(200);
    expect(merged.body).toMatchObject({ moved: 1, dropped: 1 });
    expect(merged.body.entity.aliases).toContain("Acme, Inc.");
    expect(merged.body.notices.join(" ")).toContain("moved to");
    // The duplicate is gone, and what it knew is the survivor's.
    expect((await me.node("entity", theirs.body.entity.id)).status).toBe(404);
    expect((await me.node("entity", ours.body.entity.id)).body.outgoing).toHaveLength(2);

    const other = await me.record({ type: "company", name: "Globex" });
    const clash = await me.api.json<Refusal>("PATCH", `/companies/${me.companyId}/graph/entities/${other.body.entity.id}`, { name: "Acme Inc" });
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe("graph_conflict");
    expect(clash.body.error.details.entityId).toBe(ours.body.entity.id);
    expect(clash.body.error.message).toContain("Merge them");

    // A correction keeps the spelling it had, so searching for the old name still finds the row.
    const corrected = await me.api.json<{ entity: Entity; notices: string[] }>("PATCH", `/companies/${me.companyId}/graph/entities/${ours.body.entity.id}`, { name: "Acme Incorporated" });
    expect(corrected.body.entity).toMatchObject({ name: "Acme Incorporated", normalizedName: "acme incorporated" });
    expect(corrected.body.entity.aliases).toEqual(expect.arrayContaining(["Acme, Inc.", "Acme Inc"]));
    expect((await me.known(ours.body.entity.id)).body.entity.aliases).toEqual(expect.arrayContaining(["Acme, Inc.", "Acme Inc"]));
    expect((await me.find("Acme Incorporated")).body.nodes.map((node) => node.id)).toContain(ours.body.entity.id);
  });

  d("forgets a thing and everything said about it, and takes nothing else with it", async () => {
    const me = await workspace();
    const entity = await me.record({ type: "competitor", name: "Globex" });
    await me.link(entity.body.entity.id, { relation: "works_on", targetKind: "project", targetId: me.projectId });

    const forgotten = await me.api.json<{ ok: boolean; removed: { name: string; links: number } }>("DELETE", `/companies/${me.companyId}/graph/entities/${entity.body.entity.id}`);
    expect(forgotten.status).toBe(200);
    expect(forgotten.body.removed).toEqual({ name: "Globex", links: 1 });
    expect((await me.node("entity", entity.body.entity.id)).status).toBe(404);
    // The row the claim pointed at is untouched: a claim was never a copy of it.
    const project = await me.node("project", me.projectId);
    expect(project.body.incoming).toEqual([]);
    expect(project.body.node.label).toBe("Payments");
  });

  d("keeps one company's knowledge out of another's, and refuses a claim that reaches across", async () => {
    const mine = await workspace();
    const theirs = await workspace();
    const entity = await mine.record({ type: "company", name: "Acme" });

    // Another company cannot even ask about it.
    expect((await theirs.node("entity", entity.body.entity.id)).status).toBe(404);
    // Nor point a claim at a row that belongs to somebody else: it is not there, because it is not theirs.
    const theirsEntity = await theirs.record({ type: "company", name: "Globex" });
    const cross = await theirs.linkRaw(theirsEntity.body.entity.id, { relation: "works_on", targetKind: "project", targetId: mine.projectId });
    expect(cross.status).toBe(422);
    expect(cross.body.error.details.problems!.map((problem) => problem.code)).toContain("target_missing");
    // And the graph each of them reads is their own.
    expect((await theirs.read()).body.overview.counts.find((row) => row.kind === "entity")!.total).toBe(1);
    expect((await mine.read()).body.overview.counts.find((row) => row.kind === "entity")!.total).toBe(1);
  });
});

describe("memory 2.0 (ADR-0022)", () => {
  /** A founder, a company, and the base path for its memories. */
  async function workspace() {
    const founder = await register("Rememberer");
    const co = await founder.api.json<{ company: { id: string } }>("POST", `/orgs/${founder.orgId}/companies`, { name: `Memory ${uniq()}`, autonomyLevel: 2 });
    return { ...founder, companyId: co.body.company.id, base: `/companies/${co.body.company.id}/memories` };
  }

  d("keeps a fact a person wrote, with its provenance and no expiry", async () => {
    const me = await workspace();
    const created = await me.api.json<{ memory: { id: string; sourceType: string; confidence: number; importance: number; expiresAt: string | null; confidenceBand: string } }>("POST", me.base, { kind: "decision", title: "Pricing", content: "We charge $49 a seat.", importance: 8, tags: ["pricing"] });
    expect(created.status).toBe(201);
    expect(created.body.memory.sourceType).toBe("user");
    expect(created.body.memory.confidence).toBeGreaterThan(0.8);
    expect(created.body.memory.importance).toBe(8);
    expect(created.body.memory.expiresAt).toBeNull();

    const list = await me.api.json<{ memories: Array<{ id: string }>; pending: unknown[]; canManage: boolean }>("GET", me.base);
    expect(list.body.memories.map((m) => m.id)).toContain(created.body.memory.id);
    // A deliberate write is never waiting on confirmation, and the creator is an owner.
    expect(list.body.pending).toEqual([]);
    expect(list.body.canManage).toBe(true);
  });

  d("holds importance to the column's own scale — whole numbers 1 to 10", async () => {
    const me = await workspace();
    expect((await me.api.json("POST", me.base, { kind: "knowledge", content: "A fact", importance: 0.8 })).status).toBe(422);
    expect((await me.api.json("POST", me.base, { kind: "knowledge", content: "A fact", importance: 11 })).status).toBe(422);
    expect((await me.api.json("POST", me.base, { kind: "knowledge", content: "A fact", importance: 10 })).status).toBe(201);
    // `entity` is retired: identity belongs to the graph, not to a kind of memory.
    expect((await me.api.json("POST", me.base, { kind: "entity", content: "Acme" })).status).toBe(422);
  });

  d("corrects a memory without losing the words it replaced", async () => {
    const me = await workspace();
    const created = await me.api.json<{ memory: { id: string } }>("POST", me.base, { kind: "knowledge", title: "Price", content: "We charge $39.", importance: 6 });
    const id = created.body.memory.id;
    const corrected = await me.api.json<{ memory: { content: string; confidence: number; correctedAt: string | null } }>("PATCH", `${me.base}/${id}`, { content: "We charge $49.", importance: 8 });
    expect(corrected.status).toBe(200);
    expect(corrected.body.memory.content).toBe("We charge $49.");
    expect(corrected.body.memory.confidence).toBe(1);
    expect(corrected.body.memory.correctedAt).not.toBeNull();

    const read = await me.api.json<{ memory: { content: string }; revisions: Array<{ content: string; reason: string }> }>("GET", `${me.base}/${id}`);
    expect(read.body.memory.content).toBe("We charge $49.");
    // The version before the correction is the reason there is a revision table at all.
    expect(read.body.revisions).toHaveLength(1);
    expect(read.body.revisions[0]).toMatchObject({ content: "We charge $39.", reason: "corrected" });
  });

  d("supersedes: the new statement is retrieved, the old one stays readable but out of search", async () => {
    const me = await workspace();
    const old = await me.api.json<{ memory: { id: string } }>("POST", me.base, { kind: "decision", title: "Hosting", content: "We host on the old provider.", importance: 6 });
    const oldId = old.body.memory.id;
    const next = await me.api.json<{ memory: { id: string } }>("POST", `${me.base}/${oldId}/supersede`, { kind: "decision", title: "Hosting", content: "We host on the new provider.", importance: 6 });
    expect(next.status).toBe(201);

    const list = await me.api.json<{ memories: Array<{ id: string }> }>("GET", me.base);
    expect(list.body.memories.map((m) => m.id)).not.toContain(oldId);
    expect(list.body.memories.map((m) => m.id)).toContain(next.body.memory.id);

    // The old row is still there, marked, so "what did we believe then" has an answer.
    const read = await me.api.json<{ memory: { supersededBy: string | null } }>("GET", `${me.base}/${oldId}`);
    expect(read.body.memory.supersededBy).toBe(next.body.memory.id);
    // Retrieval does not see it; the corrected statement is what a run is handed.
    const search = await me.api.json<{ memories: Array<{ id: string }> }>("GET", `${me.base}?q=old%20provider`);
    expect(search.body.memories.map((m) => m.id)).not.toContain(oldId);
  });

  d("merges two memories into one, losing neither the tags nor the record", async () => {
    const me = await workspace();
    const a = await me.api.json<{ memory: { id: string } }>("POST", me.base, { kind: "knowledge", title: "Acme", content: "Acme is on the enterprise plan.", tags: ["acme"] });
    const b = await me.api.json<{ memory: { id: string } }>("POST", me.base, { kind: "knowledge", title: "Acme (again)", content: "Acme renewed in March.", tags: ["renewal"] });
    const intoId = a.body.memory.id;
    const fromId = b.body.memory.id;
    const merged = await me.api.json<{ memory: { tags: string[] } }>("POST", `${me.base}/merge`, { intoId, fromId });
    expect(merged.status).toBe(200);
    expect(merged.body.memory.tags.sort()).toEqual(["acme", "renewal"]);

    expect((await me.api.json<{ memory: { supersededBy: string | null } }>("GET", `${me.base}/${fromId}`)).body.memory.supersededBy).toBe(intoId);
    const list = await me.api.json<{ memories: Array<{ id: string }> }>("GET", me.base);
    expect(list.body.memories.map((m) => m.id)).not.toContain(fromId);
  });

  d("confirms a memory: certainty to the top, and a vote on the record", async () => {
    const me = await workspace();
    const created = await me.api.json<{ memory: { id: string; confidence: number } }>("POST", me.base, { kind: "knowledge", content: "Net revenue retention is 112%." });
    const confirmed = await me.api.json<{ memory: { confidence: number; confirmations: number } }>("POST", `${me.base}/${created.body.memory.id}/confirm`);
    expect(confirmed.body.memory.confidence).toBe(1);
    expect(confirmed.body.memory.confirmations).toBe(1);
  });

  d("refuses to file a memory against a thing the company does not know", async () => {
    const me = await workspace();
    const res = await me.api.json<{ error: { details: { problems: Array<{ code: string }> } } }>("POST", me.base, { kind: "knowledge", content: "A fact", aboutEntityId: "not-a-real-entity" });
    expect(res.status).toBe(422);
    expect(res.body.error.details.problems.map((p) => p.code)).toContain("about_unknown");
  });

  d("keeps one company's memory out of another's, and forgets for real", async () => {
    const me = await workspace();
    const created = await me.api.json<{ memory: { id: string } }>("POST", me.base, { kind: "knowledge", content: "A private fact." });
    const stranger = await register("Stranger");
    // Another user is not a member of this company, so it is not there, because it is not theirs.
    expect((await stranger.api.json("GET", me.base)).status).toBe(404);
    expect((await stranger.api.json("DELETE", `${me.base}/${created.body.memory.id}`)).status).toBe(404);
    expect((await me.api.json<{ ok: boolean }>("DELETE", `${me.base}/${created.body.memory.id}`)).body.ok).toBe(true);
    expect((await me.api.json("GET", `${me.base}/${created.body.memory.id}`)).status).toBe(404);
  });
});

describe("openapi + health", () => {
  d("distinguishes UI health from execution readiness without leaking dependency errors", async () => {
    const checks = async (workflows: WorkflowClient | null, env: NodeJS.ProcessEnv) => {
      const instance = createApp({ core, auth: new AuthService(core.db), mailer, services, workflows, env }, null).app;
      return { health: await instance.request("http://api.test/health"), ready: await instance.request("http://api.test/ready") };
    };
    const disabled = await checks(null, { ...ENV, TEMPORAL_DISABLED: "true" });
    expect(disabled.health.status).toBe(200);
    expect(disabled.ready.status).toBe(503);
    expect(disabled.ready.headers.get("cache-control")).toBe("no-store");
    expect(await disabled.ready.json()).toMatchObject({ ok: false, temporal: "disabled", executions: "unavailable" });
    const unavailable = await checks(null, ENV);
    expect(await unavailable.health.json()).toMatchObject({ temporal: "unavailable" });
    const idle = fakeTemporal();
    idle.readiness = async () => ({ connected: true, workers: false });
    expect((await checks(idle, ENV)).ready.status).toBe(503);
    expect((await checks(fakeTemporal(), ENV)).ready.status).toBe(200);
  });
  d("serves a valid OpenAPI document covering every registered route", async () => {
    const res = await app.request("http://api.test/v1/openapi.json");
    expect(res.status).toBe(200);
    const doc = (await res.json()) as { openapi: string; paths: Record<string, Record<string, { summary: string }>>; components: { securitySchemes: Record<string, unknown> } };
    expect(doc.openapi).toMatch(/^3\.1/);
    expect(Object.keys(doc.paths).length).toBeGreaterThan(50);
    expect(doc.paths["/companies/{companyId}/runs/{id}"]?.get?.summary).toBeTruthy();
    expect(doc.components.securitySchemes).toHaveProperty("cookieAuth");
    expect(doc.components.securitySchemes).toHaveProperty("bearerAuth");
    const health = await app.request("http://api.test/health");
    // `commit` is `unknown` here because this suite's environment deliberately sets neither variable a
    // deployment fills in; what a real deployment answers is what `scripts/hosted-check.sh` compares
    // against the repository.
    expect(await health.json()).toMatchObject({ ok: true, db: "ok", commit: "unknown" });
  });
});

describe("Overclock configuration and runtime", () => {
  d("requires admin, isolates tenants, preserves unrelated settings and rejects stale revisions", async () => {
    const owner = await register("OverclockOwner");
    const outsider = await register("OverclockOther");
    const co = await owner.api.json<{ company: { id: string } }>("POST", `/orgs/${owner.orgId}/companies`, { name: "Overclock isolation" });
    const base = `/companies/${co.body.company.id}`;
    const list = await owner.api.json<{ agents: Array<{ id: string }> }>("GET", `${base}/agents`);
    const agentId = list.body.agents[0]!.id;
    const path = `${base}/agents/${agentId}/overclock`;
    expect((await owner.api.json("PUT", path, { revision: 0, config: {} })).status).toBe(409);
    expect((await outsider.api.json("PUT", `${base}/overclock`, { enabled: true })).status).toBe(404);
    await owner.api.json("PATCH", base, { settings: { preserved: "yes" } });
    const toggle = await owner.api.json<{ company: { settings: Record<string, unknown> } }>("PUT", `${base}/overclock`, { enabled: true });
    expect(toggle.body.company.settings).toEqual({ preserved: "yes", overclockEnabled: true });
    const invite = await owner.api.json<{ acceptUrl: string }>("POST", `/orgs/${owner.orgId}/invitations`, { email: outsider.email, role: "member" });
    expect(invite.status).toBe(201);
    expect((await outsider.api.json("POST", "/invitations/accept", { token: invite.body.acceptUrl.split("/").at(-1) })).status).toBe(200);
    expect((await outsider.api.json("PUT", `${base}/overclock`, { enabled: true })).status).toBe(403);
    expect((await outsider.api.json("PUT", path, { revision: 0, config: {} })).status).toBe(403);
    expect((await owner.api.json("PUT", path, { revision: 0, config: { acting: { topP: 2 } } })).status).toBe(422);
    const saved = await owner.api.json<{ agent: { config: { overclockRevision: number } } }>("PUT", path, { revision: 0, config: { skills: [{ id: "citation", name: "Citations", instructions: "Cite original evidence." }] } });
    expect(saved.status).toBe(200); expect(saved.body.agent.config.overclockRevision).toBe(1);
    const reordered = await owner.api.json<{ agents: Array<{ id: string }> }>("GET", `${base}/agents`);
    expect(reordered.body.agents.map((a) => a.id)).toEqual(list.body.agents.map((a) => a.id));
    expect((await owner.api.json("PUT", path, { revision: 0, config: {} })).status).toBe(409);
    const audit = await core.pool.query("select metadata from audit_log where target=$1 and action='agent.overclock.update'", [agentId]);
    expect(audit.rows).toHaveLength(1); expect(audit.rows[0].metadata.revision).toBe(1);
    expect((await owner.api.json("PUT", `${base}/overclock`, { enabled: false })).status).toBe(200);
    expect((await owner.api.json("PUT", path, { revision: 1, config: {} })).status).toBe(409);
  });

  d("snapshots skills and tuning in durable context, sends top-p on the wire and restores defaults for new runs", async () => {
    const owner = await register("OverclockRuntime");
    await owner.api.json("POST", `/orgs/${owner.orgId}/providers`, { providerType: "openai_compatible", secret: stub.apiKey, baseUrl: stub.baseUrl });
    const co = await owner.api.json<{ company: { id: string } }>("POST", `/orgs/${owner.orgId}/companies`, { name: "Overclock runtime" });
    const companyId = co.body.company.id; const base = `/companies/${companyId}`;
    const list = await owner.api.json<{ agents: Array<{ id: string }> }>("GET", `${base}/agents`);
    const agentId = list.body.agents[0]!.id;
    await owner.api.json("PUT", `${base}/overclock`, { enabled: true });
    const config = { planning: { sampler: "top_p", topP: 0.67, maxTokens: 512 }, acting: { sampler: "provider_default", maxTokens: 700 }, memoryLimit: 0, skills: [{ id: "sources", name: "Sources", instructions: "Record source evidence before publishing." }] };
    expect((await owner.api.json("PUT", `${base}/agents/${agentId}/overclock`, { revision: 0, config })).status).toBe(200);
    const scope: TenantScope = { organizationId: owner.orgId, companyId, actor: { type: "system", component: "overclock-test" } };
    const rt = new AgentRuntime(services.forScope(scope), buildToolRegistry());
    const run = await services.runs.create(scope, { agentId, trigger: { kind: "user", instruction: "Write positioning and record a decision." } });
    const ctx = await rt.buildContext(run.id);
    expect(ctx.systemPrompt).toContain("Record source evidence before publishing.");
    expect(ctx.overclockRevision).toBe(1);
    // Save a replacement after context creation; resuming must retain the original revision.
    await owner.api.json("PUT", `${base}/agents/${agentId}/overclock`, { revision: 1, config: {} });
    expect(await rt.buildContext(run.id)).toEqual(ctx);
    const before = stub.requests.length;
    await rt.plan(run.id, ctx);
    const requests = stub.requests.slice(before).filter((r) => r.path.includes("chat/completions"));
    expect(requests).toHaveLength(1);
    expect(requests[0]!.body.top_p).toBe(0.67);
    expect(requests[0]!.body.temperature).toBeUndefined();
    expect(requests[0]!.body.max_completion_tokens).toBe(512);
    await owner.api.json("PUT", `${base}/overclock`, { enabled: false });
    const next = await services.runs.create(scope, { agentId, trigger: { kind: "user", instruction: "Review goals." } });
    const standard = await rt.buildContext(next.id);
    expect(standard.overclockEnabled).toBe(false);
    expect(standard.overclock?.planning.temperature).toBe(0.2);
    expect(standard.systemPrompt).not.toContain("Record source evidence before publishing.");
  });

  d("production without platform email fails identically before account lookup", async () => {
    const owner = await register("EmailAvailability");
    const prod = createCoreContext(loadConfig({ ...ENV, NODE_ENV: "production" }), "auth-email-test");
    try {
      const noEmail = createApp({ core: prod, auth: new AuthService(prod.db), mailer, services, workflows: null, env: ENV }, null).app;
      const request = (email: string) => noEmail.request("http://api.test/v1/auth/password/forgot", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
      const existing = await request(owner.email); const missing = await request(`missing-${uniq()}@example.com`);
      expect(existing.status).toBe(503); expect(missing.status).toBe(503);
      const a = await existing.json() as { error: { code: string; message: string } };
      const b = await missing.json() as { error: { code: string; message: string } };
      expect({ code: a.error.code, message: a.error.message }).toEqual({ code: b.error.code, message: b.error.message });
    } finally { await prod.pool.end(); }
  });
});

describe("launch kit", () => {
  d("starts a Chief of Staff run from the company profile the moment a founder asks", async () => {
    const { api, orgId } = await register();
    await api.json("POST", `/orgs/${orgId}/providers`, { providerType: "openai_compatible", secret: stub.apiKey, baseUrl: stub.baseUrl });
    const co = await api.json<{ company: { id: string } }>("POST", `/orgs/${orgId}/companies`, {
      name: "Ledgerline",
      autonomyLevel: 2,
      profile: { name: "Ledgerline", description: "Bookkeeping that closes itself for two-person agencies", stage: "prototype", targetCustomers: ["design agencies"], constraints: ["no paid ads"] },
    });
    const companyId = co.body.company.id;
    const started = await api.json<{ run: { id: string; agentId: string; trigger: { kind: string; instruction: string } } }>("POST", `/companies/${companyId}/launch-kit`, {});
    const byTrigger = await api.json<{ runs: { id: string }[] }>("GET", `/companies/${companyId}/runs?trigger=launch&limit=1`);
    expect(byTrigger.body.runs.map((r) => r.id)).toEqual([started.body.run.id]);
    expect(started.status).toBe(201);
    expect(started.body.run.trigger.kind).toBe("launch");
    expect(started.body.run.trigger.instruction).toContain("Bookkeeping that closes itself");
    expect(started.body.run.trigger.instruction).toContain('title "Positioning"');
    const agents = await api.json<{ agents: Array<{ id: string; kind: string }> }>("GET", `/companies/${companyId}/agents`);
    expect(agents.body.agents.find((a) => a.id === started.body.run.agentId)?.kind).toBe("orchestrator");
    const listed = await api.json<{ runs: Array<{ id: string; trigger: { kind: string } }> }>("GET", `/companies/${companyId}/runs`);
    expect(listed.body.runs.find((r) => r.id === started.body.run.id)?.trigger.kind).toBe("launch");
  });
});
