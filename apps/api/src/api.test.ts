/**
 * API integration tests against real Postgres (docker-compose defaults) and a real-HTTP
 * OpenAI-compatible stub provider. Temporal is not required: the durable run pipeline is driven
 * in-process through the same AgentRuntime the worker uses. Skipped when Postgres is unreachable.
 */
import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { AgentRuntime, AgentServiceFactory, buildToolRegistry } from "@steward/agents";
import { AuthService, createCoreContext, loadConfig, type CoreContext } from "@steward/core";
import { runMigrations } from "@steward/db";
import type { TenantScope } from "@steward/schema";
import type { WorkflowClient } from "@steward/workflows";
import { createApp } from "./app.js";
import { startStubProvider, type StubProvider } from "./test/stub-provider.js";

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
let services: AgentServiceFactory;
let app: ReturnType<typeof createApp>["app"];
let stub: StubProvider;
const uniq = () => Math.random().toString(36).slice(2, 10);

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
  services = new AgentServiceFactory({ core, env: ENV });
  app = createApp({ core, auth: new AuthService(core.db), services, workflows: fakeTemporal(), env: ENV }, null).app;
  stub = await startStubProvider();
});
afterAll(async () => {
  await stub?.close();
  await core?.pool.end();
});

const d = (name: string, fn: () => Promise<void>) => it(name, async () => {
  if (!available) return;
  await fn();
});

interface Client {
  token: string;
  cookie: string;
  call(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<Response>;
  json<T = Record<string, unknown>>(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<{ status: number; body: T }>;
}

function client(token = "", cookie = ""): Client {
  const c: Client = {
    token,
    cookie,
    call: async (method, path, body, headers = {}) =>
      app.request(`http://api.test/v1${path}`, {
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

async function register(name = "Founder") {
  const email = `${name.toLowerCase()}-${uniq()}@example.com`;
  const anon = client();
  const res = await anon.call("POST", "/auth/register", { email, password: "correct-horse-battery", name });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { token: string; user: { id: string }; organization: { id: string } };
  const setCookie = res.headers.get("set-cookie") ?? "";
  const cookie = setCookie.split(";")[0] ?? "";
  return { email, orgId: body.organization.id, userId: body.user.id, api: client(body.token), cookieApi: client("", cookie) };
}

/**
 * Records workflow starts/signals without a Temporal server. Runs are still persisted durably by the
 * API; the runtime itself is driven in-process below, exactly as the worker activities do.
 */
const temporalCalls: Array<{ op: string; args: unknown[] }> = [];
function fakeTemporal(): WorkflowClient {
  const double: Pick<WorkflowClient, "startRun" | "signalApproval" | "cancelRun" | "runStatus"> = {
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
  };
  return double as WorkflowClient;
}

describe("auth + sessions", () => {
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
});

describe("durable run pipeline (stub provider, in-process runtime)", () => {
  d("chat message → run → plan → tool calls → verify → artifacts, usage, events", async () => {
    const { api, orgId } = await register();
    await api.json("POST", `/orgs/${orgId}/providers`, { providerType: "openai_compatible", secret: stub.apiKey, baseUrl: stub.baseUrl });
    const co = await api.json<{ company: { id: string } }>("POST", `/orgs/${orgId}/companies`, { name: "Smoke Labs", autonomyLevel: 2, profile: { description: "CSV tidying CLI", stage: "idea" } });
    const companyId = co.body.company.id;
    const conv = await api.json<{ conversation: { id: string } }>("POST", `/companies/${companyId}/conversations`, {});
    const msg = await api.json<{ run: { id: string; status: string; workflowId: string | null } }>("POST", `/companies/${companyId}/conversations/${conv.body.conversation.id}/messages`, { content: "Write positioning and record a decision." });
    expect(msg.status).toBe(201);
    expect(msg.body.run.status).toBe("queued");
    const runId = msg.body.run.id;

    // Drive the same runtime the Temporal worker uses.
    const scope: TenantScope = { organizationId: orgId, companyId, actor: { type: "system", component: "test" } };
    const rt = new AgentRuntime(services.forScope(scope), buildToolRegistry());
    await services.runs.setStatus(scope, runId, "building_context");
    const ctx = await rt.buildContext(runId);
    expect(ctx.toolNames).toContain("document.write");
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
    const decided = await api.json<{ approval: { status: string } }>("POST", `/companies/${companyId}/approvals/${approval.id}/decide`, { status: "denied", note: "Not yet" });
    expect(decided.status).toBe(200);
    expect(decided.body.approval.status).toBe("denied");
    expect((await api.json("POST", `/companies/${companyId}/approvals/${approval.id}/decide`, { status: "approved" })).status).toBe(409);
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

describe("openapi + health", () => {
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
    expect(await health.json()).toMatchObject({ ok: true, db: "ok" });
  });
});
