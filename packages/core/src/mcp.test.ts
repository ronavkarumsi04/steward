/**
 * MCP marketplace tests.
 *
 * The pure half — what an install may be, and what a grant does to an allowlist — runs anywhere. The rest runs
 * against a real PostgreSQL *and* against a real MCP server: `packages/tools/fixtures/mcp-server.mjs` is spawned
 * over stdio the way a company's install would be, because the questions that matter here are properties of rows
 * and of a conversation: does an inspection record what the server actually offers, does a second inspection of a
 * changed server report the change instead of quietly overwriting it, does a server that cannot be started leave
 * a sentence on the row rather than a broken page, and does an agent's allowlist — and only that — decide what a
 * run may call.
 */
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { createDb, mcpTools, type Db } from "@steward/db";
import type { TenantScope } from "@steward/schema";
import { AuthService } from "./auth.js";
import { CompanyService } from "./companies.js";
import { McpError, McpService, applyGrant, describeInstall, grantedBy, privateTargetProblem, validateMcpInstall, type McpInstallContext, type McpInstallInput } from "./mcp.js";

const url = process.env.DATABASE_URL ?? "postgres://steward:steward@localhost:5432/steward";
const FIXTURE = fileURLToPath(new URL("../../tools/fixtures/mcp-server.mjs", import.meta.url));
let available = false;
let db: Db;
let pool: pg.Pool;
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

const d = (name: string, fn: () => Promise<void>, timeout = 30_000) =>
  it(
    name,
    async () => {
      if (!available) return;
      await fn();
    },
    timeout,
  );

// ---------- the vocabulary, as a request ----------

const ctx = (over: Partial<McpInstallContext> = {}): McpInstallContext => ({ takenSlugs: [], existing: 0, stdio: true, privateTargets: false, ...over });

const installInput = (over: Partial<McpInstallInput> = {}): McpInstallInput => ({
  name: "Fixture ledger",
  slug: "ledger",
  purpose: "Invoices and customers, read-only where it can be.",
  transport: "stdio",
  command: process.execPath,
  args: [FIXTURE],
  ...over,
});

const codes = (input: McpInstallInput, context: McpInstallContext = ctx()) => validateMcpInstall(input, context).map((problem) => problem.code);

describe("installing, as a request", () => {
  it("asks for the things an install cannot exist without", () => {
    expect(codes(installInput({ name: "  " }))).toContain("name_required");
    expect(codes(installInput({ slug: "" }))).toContain("slug_required");
    expect(codes(installInput({ command: "" }))).toContain("command_required");
    expect(codes(installInput({ transport: "http", url: "" }))).toContain("url_required");
    expect(validateMcpInstall(installInput(), ctx())).toEqual([]);
  });

  it("holds a slug to what a tool name can carry, and refuses one another server has", () => {
    expect(codes(installInput({ slug: "Ledger API!" }))).toContain("slug_invalid");
    expect(codes(installInput({ slug: "x" }))).toContain("slug_invalid");
    expect(codes(installInput({ slug: "ledger" }), ctx({ takenSlugs: ["ledger"] }))).toContain("slug_taken");
    // The message has to say why a slug matters at all, because it is the one field that is not just a label.
    const taken = validateMcpInstall(installInput(), ctx({ takenSlugs: ["ledger"] })).find((problem) => problem.code === "slug_taken")!;
    expect(taken.message).toContain("Tool names would collide");
  });

  it("refuses a transport this build does not have rather than guessing at the rest", () => {
    expect(codes(installInput({ transport: "carrier-pigeon" as never }))).toEqual(["transport_unknown"]);
  });

  it("says so when this deployment will not run programs, instead of failing at the first call", () => {
    const problems = validateMcpInstall(installInput(), ctx({ stdio: false }));
    expect(problems.map((problem) => problem.code)).toEqual(["stdio_disabled"]);
    expect(problems[0]!.message).toContain("does not run programs");
    // An http install is still perfectly installable on that deployment.
    expect(codes(installInput({ transport: "http", url: "https://mcp.example.com/mcp", command: null, args: [] }), ctx({ stdio: false }))).toEqual([]);
  });

  it("bounds every field a founder can fill in, because a row nobody can read is not an install", () => {
    expect(codes(installInput({ name: "x".repeat(81) }))).toContain("name_too_long");
    expect(codes(installInput({ purpose: "x".repeat(301) }))).toContain("purpose_too_long");
    expect(codes(installInput({ args: Array.from({ length: 17 }, () => "a") }))).toContain("args_too_many");
    expect(codes(installInput({ args: ["x".repeat(301)] }))).toContain("arg_too_long");
    expect(codes(installInput({ env: Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`K${i}`, "v"])) }))).toContain("env_too_many");
    expect(codes(installInput({ env: { "not a name": "v" } }))).toContain("env_key_invalid");
    expect(codes(installInput({ env: { TOKEN: "x".repeat(501) } }))).toContain("env_value_too_long");
    expect(codes(installInput({ cwd: "x".repeat(301) }))).toContain("cwd_too_long");
    expect(codes(installInput({ transport: "sse", url: `https://example.com/${"x".repeat(500)}`, command: null, args: [] }))).toContain("url_too_long");
    expect(codes(installInput({ transport: "http", url: "https://example.com/mcp", headers: Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`X-${i}`, "v"])) }))).toContain("headers_too_many");
    expect(codes(installInput({ transport: "http", url: "https://example.com/mcp", headers: { Authorization: "x".repeat(501) } }))).toContain("header_value_too_long");
  });

  it("refuses an address it would have to be talked into, in the words of the person who typed it", () => {
    expect(codes(installInput({ transport: "http", url: "file:///etc/passwd", command: null, args: [] }))).toContain("url_invalid");
    expect(codes(installInput({ transport: "http", url: "not a url", command: null, args: [] }))).toContain("url_invalid");
    // Credentials in an address get written down in a dozen places; the headers are where they belong.
    expect(codes(installInput({ transport: "http", url: "https://user:pass@example.com/mcp", command: null, args: [] }))).toContain("url_invalid");
    // The deployment's own network, which is the shape of request that must not be pointed at metadata.
    for (const address of ["http://127.0.0.1:3000/mcp", "http://localhost/mcp", "http://10.1.2.3/mcp", "http://169.254.169.254/latest", "http://mcp.internal/mcp", "http://[::1]/mcp"]) {
      const problems = validateMcpInstall(installInput({ transport: "http", url: address, command: null, args: [] }), ctx());
      expect(problems.map((problem) => problem.code), address).toContain("url_private");
    }
    // Unless the deployment has said, explicitly, that its own network is in play.
    expect(codes(installInput({ transport: "http", url: "http://127.0.0.1:3000/mcp", command: null, args: [] }), ctx({ privateTargets: true }))).toEqual([]);
    // A public name is never mistaken for a private one, and a name that merely starts with the letters of a
    // private range is not a private address either.
    expect(privateTargetProblem("https://mcp.example.com/mcp")).toBeNull();
    expect(privateTargetProblem("https://fd-corp.example.com/mcp")).toBeNull();
  });

  it("refuses the eleventh server rather than the first one that does not work", () => {
    expect(codes(installInput(), ctx({ existing: 10 }))).toContain("too_many_servers");
  });

  it("describes an install the way a founder would say it out loud", () => {
    expect(describeInstall({ name: "Fixture ledger", transport: "stdio", command: process.execPath, args: ["server.mjs"], url: null })).toContain("runs");
    expect(describeInstall({ name: "Ledger", transport: "http", command: null, args: [], url: "https://mcp.example.com/mcp" })).toContain("HTTP server at https://mcp.example.com/mcp");
  });
});

// ---------- grants, as an allowlist ----------

describe("grants", () => {
  const tools = ["mcp.ledger.lookup_invoice", "mcp.ledger.delete_customer", "mcp.ledger.reschedule"];

  it("grants a whole server in one pattern and finds it with the runtime's own matcher", () => {
    const granted = applyGrant({ allowlist: ["web.*"], slug: "ledger", toolNames: null, serverTools: tools, granted: true });
    expect(granted).toEqual(["web.*", "mcp.ledger.*"]);
    expect(grantedBy(granted, "mcp.ledger.lookup_invoice")).toBe("mcp.ledger.*");
    expect(grantedBy(granted, "mcp.other.tool")).toBeNull();
    // Granting the whole server again is not a second pattern.
    expect(applyGrant({ allowlist: granted, slug: "ledger", toolNames: null, serverTools: tools, granted: true })).toEqual(granted);
    // Nor is it narrower patterns it already covers.
    expect(applyGrant({ allowlist: granted, slug: "ledger", toolNames: ["mcp.ledger.reschedule"], serverTools: tools, granted: true })).toEqual(granted);
  });

  it("grants one tool, and does not duplicate an exact pattern", () => {
    const one = applyGrant({ allowlist: [], slug: "ledger", toolNames: ["mcp.ledger.reschedule"], serverTools: tools, granted: true });
    expect(one).toEqual(["mcp.ledger.reschedule"]);
    expect(grantedBy(one, "mcp.ledger.reschedule")).toBe("mcp.ledger.reschedule");
    expect(grantedBy(one, "mcp.ledger.lookup_invoice")).toBeNull();
    expect(applyGrant({ allowlist: one, slug: "ledger", toolNames: ["mcp.ledger.reschedule"], serverTools: tools, granted: true })).toEqual(one);
  });

  it("takes a whole server back, including every narrower pattern inside it", () => {
    const held = ["web.*", "mcp.ledger.*", "mcp.ledger.reschedule", "mcp.crm.search"];
    expect(applyGrant({ allowlist: held, slug: "ledger", toolNames: null, serverTools: tools, granted: false })).toEqual(["web.*", "mcp.crm.search"]);
    // And takes nothing else with it: another server's tools are another server's.
    expect(applyGrant({ allowlist: held, slug: "crm", toolNames: null, serverTools: ["mcp.crm.search"], granted: false })).toEqual(["web.*", "mcp.ledger.*", "mcp.ledger.reschedule"]);
  });

  it("materialises a wildcard when one tool is taken back out of it, so the others survive", () => {
    const held = ["mcp.ledger.*"];
    const narrowed = applyGrant({ allowlist: held, slug: "ledger", toolNames: ["mcp.ledger.delete_customer"], serverTools: tools, granted: false });
    expect(narrowed).toEqual(["mcp.ledger.lookup_invoice", "mcp.ledger.reschedule"]);
    expect(grantedBy(narrowed, "mcp.ledger.delete_customer")).toBeNull();
    expect(grantedBy(narrowed, "mcp.ledger.lookup_invoice")).toBe("mcp.ledger.lookup_invoice");
    // Revoking a tool that was never granted changes nothing at all.
    expect(applyGrant({ allowlist: ["web.*"], slug: "ledger", toolNames: ["mcp.ledger.reschedule"], serverTools: tools, granted: false })).toEqual(["web.*"]);
  });
});

// ---------- against a real database and a real server ----------

async function setup(options: { stdio?: boolean; allowPrivate?: boolean } = {}) {
  const auth = new AuthService(db);
  const reg = await auth.register({ email: `mcp-${uniq()}@example.com`, password: "correct horse battery", name: "Owner" });
  const orgScope: TenantScope = { organizationId: reg.organization.id, userId: reg.user.id, role: "owner", actor: { type: "user", userId: reg.user.id } };
  const company = await new CompanyService(db).create(orgScope, { name: `Marketplace ${uniq()}`, autonomyLevel: 2 });
  const scope: TenantScope = { ...orgScope, companyId: company.id };
  const mcp = new McpService(db, undefined, { stdio: options.stdio ?? true, allowPrivate: options.allowPrivate ?? false });
  return { scope, company, mcp };
}

describe("mcp marketplace (postgres)", () => {
  d("installs a server with no connection, and refuses a slug its neighbour already uses", async () => {
    const { scope, mcp } = await setup();
    const server = await mcp.install(scope, installInput());
    expect(server).toMatchObject({ slug: "ledger", transport: "stdio", enabled: true });
    // Installing on its own reaches nothing, which is why there is nothing here yet.
    expect(server.lastInspectedAt).toBeNull();
    expect(await mcp.toolsOf(scope, server.id)).toEqual([]);

    const clash = await mcp.install(scope, installInput({ name: "Other ledger" })).then(
      () => null,
      (e: unknown) => e,
    );
    expect(clash).toBeInstanceOf(McpError);
    expect((clash as McpError).details.problems).toContainEqual(expect.objectContaining({ code: "slug_taken" }));
  });

  d("reads a real server over stdio and writes down what it may do", async () => {
    const { scope, mcp } = await setup();
    const server = await mcp.install(scope, installInput());
    const inspected = await mcp.inspect(scope, server.id);

    expect(inspected.ok).toBe(true);
    expect(inspected.error).toBeNull();
    expect(inspected.total).toBe(6);
    expect(inspected.added).toHaveLength(6);
    const tools = await mcp.toolsOf(scope, server.id);
    const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));

    // The namespacing is the guard against two servers meaning the same thing.
    expect(byName.lookup_invoice!.toolName).toBe("mcp.ledger.lookup_invoice");
    // The server's own claim, and the derivation, each recorded with where it came from.
    expect(byName.lookup_invoice).toMatchObject({ risk: "LOW", riskSource: "hint", sideEffects: "none", idempotent: true });
    expect(byName.lookup_invoice!.riskReason).toContain("only reads");
    expect(byName.lookup_invoice!.annotations).toMatchObject({ readOnlyHint: true });
    expect(byName.delete_customer).toMatchObject({ risk: "HIGH", riskSource: "hint", sideEffects: "external", dimension: "external_write" });
    expect(byName.reschedule).toMatchObject({ risk: "MEDIUM", riskSource: "default" });
    expect(byName.reschedule!.riskReason).toContain("nothing about it");
    // The liar: a name that reads as a query, an annotation that says it writes, and the cautious answer.
    expect(byName.get_and_reissue).toMatchObject({ risk: "HIGH", riskSource: "hint" });
    // The schema a model provider will actually be handed.
    expect(byName.lookup_invoice!.inputSchema).toMatchObject({ type: "object" });
    expect(inspected.server.lastInspectedAt).toBeInstanceOf(Date);
    expect(inspected.server.lastError).toBeNull();
  }, 60_000);

  d("reports what a changed server now offers instead of replacing what a founder read", async () => {
    const { scope, mcp } = await setup();
    const server = await mcp.install(scope, installInput());
    const first = await mcp.inspect(scope, server.id);
    expect(first.added).toHaveLength(6);

    // A second inspection of an unchanged server is a no-op that only says when it was last seen.
    const again = await mcp.inspect(scope, server.id);
    expect(again.added).toEqual([]);
    expect(again.removed).toEqual([]);
    expect(again.changed).toEqual([]);
    expect(again.total).toBe(6);

    // A server whose tools moved is drift, and a tool nobody can call any more stops existing here — which is
    // what keeps a grant from pointing at something the server no longer answers to.
    const before = (await mcp.toolsOf(scope, server.id)).length;
    // Somebody changed the server's mind about a tool, and dropped one entirely.
    await db.update(mcpTools).set({ risk: "LOW", riskSource: "name" }).where(and(eq(mcpTools.serverId, server.id), eq(mcpTools.name, "reschedule")));
    await db.delete(mcpTools).where(and(eq(mcpTools.serverId, server.id), eq(mcpTools.name, "env_report")));
    expect(await mcp.toolsOf(scope, server.id)).toHaveLength(before - 1);

    const drifted = await mcp.inspect(scope, server.id);
    expect(drifted.changed.map((row) => row.toolName)).toContain("mcp.ledger.reschedule");
    expect(drifted.changed.find((row) => row.toolName === "mcp.ledger.reschedule")!.fields).toContain("risk");
    expect(drifted.added).toContain("mcp.ledger.env_report");
    expect(drifted.total).toBe(6);
  }, 60_000);

  d("records a server it cannot reach as the server's condition, not as a broken page", async () => {
    const { scope, mcp } = await setup();
    const server = await mcp.install(scope, installInput({ command: "steward-mcp-that-does-not-exist" }));
    const inspected = await mcp.inspect(scope, server.id);
    expect(inspected.ok).toBe(false);
    expect(inspected.error).toContain("Could not start “Fixture ledger”");
    expect(inspected.error).toContain("steward-mcp-that-does-not-exist");
    expect(inspected.server.lastError).toContain("Could not start");
    expect(inspected.server.lastInspectedAt).toBeNull();
    // Nothing is recorded as callable, so a server nobody has seen offers nothing to grant.
    expect(await mcp.toolsOf(scope, server.id)).toEqual([]);

    // Editing where it points gets it inspected, and the sentence goes away.
    const fixed = await mcp.update(scope, server.id, { command: process.execPath, args: [FIXTURE] });
    expect(fixed.uninspected).toBe(true);
    const ok = await mcp.inspect(scope, server.id);
    expect(ok.ok).toBe(true);
    expect(ok.server.lastError).toBeNull();
    expect(ok.total).toBe(6);
  }, 60_000);

  d("discards the tool list when where a server points changes, because it is evidence about somewhere else", async () => {
    const { scope, mcp } = await setup();
    const server = await mcp.install(scope, installInput());
    await mcp.inspect(scope, server.id);
    expect(await mcp.toolsOf(scope, server.id)).toHaveLength(6);

    // Renaming is not changing the destination: the tool list still came from this server.
    const renamed = await mcp.update(scope, server.id, { name: "Ledger API" });
    expect(renamed.uninspected).toBe(false);
    expect(await mcp.toolsOf(scope, server.id)).toHaveLength(6);
    expect(renamed.server.name).toBe("Ledger API");

    // Nor is an edit form that sends every destination field and changes none of them, which is what the
    // marketplace's own form does on every save — a rename must not cost a company its tool list.
    const resubmitted = await mcp.update(scope, server.id, { transport: "stdio", command: process.execPath, args: [FIXTURE], env: {}, url: null, headers: {} });
    expect(resubmitted.uninspected).toBe(false);
    expect(await mcp.toolsOf(scope, server.id)).toHaveLength(6);
    // An http install, where the headers really are part of where it points: adding one is a change, and the
    // same set built in a different order is not.
    const remote = await mcp.install(scope, installInput({ name: "Remote ledger", slug: "remote", transport: "http", url: "https://mcp.example.com/mcp", command: null, args: [] }));
    expect((await mcp.update(scope, remote.id, { headers: { Authorization: "Bearer x", "X-Tenant": "acme" } })).uninspected).toBe(true);
    expect((await mcp.update(scope, remote.id, { headers: { "X-Tenant": "acme", Authorization: "Bearer x" } })).uninspected).toBe(false);

    // Changing the arguments is: what was recorded is a claim about a different process.
    const moved = await mcp.update(scope, server.id, { args: [FIXTURE, "--different"] });
    expect(moved.uninspected).toBe(true);
    expect(await mcp.toolsOf(scope, server.id)).toEqual([]);
    expect(moved.server.lastInspectedAt).toBeNull();
    expect(moved.server.lastError).toContain("read again");
  }, 60_000);

  d("refuses to change a slug, because every grant is written in terms of it", async () => {
    const { scope, mcp } = await setup();
    const server = await mcp.install(scope, installInput());
    const error = await mcp.update(scope, server.id, { slug: "ledger-v2" }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(McpError);
    expect((error as McpError).details.problems).toContainEqual(expect.objectContaining({ code: "slug_immutable" }));
    expect((await mcp.get(scope, server.id))!.slug).toBe("ledger");
  });

  d("hands the runtime only the tools of enabled servers that a founder has not blocked", async () => {
    const { scope, mcp } = await setup();
    const server = await mcp.install(scope, installInput());
    await mcp.inspect(scope, server.id);

    const state = await mcp.forRuntime(scope);
    expect(state).toHaveLength(1);
    expect(state[0]!.install).toMatchObject({ slug: "ledger", transport: "stdio" });
    expect(state[0]!.tools.map((tool) => tool.toolName)).toContain("mcp.ledger.lookup_invoice");
    expect(state[0]!.tools.find((tool) => tool.toolName === "mcp.ledger.lookup_invoice")).toMatchObject({ risk: "LOW", name: "lookup_invoice", sideEffects: "none" });

    // Blocking one tool takes it out of what a run may be offered, without touching the others.
    const blocked = await mcp.setToolEnabled(scope, server.id, (await mcp.toolsOf(scope, server.id)).find((tool) => tool.name === "delete_customer")!.id, false);
    expect(blocked.enabled).toBe(false);
    const afterBlock = await mcp.forRuntime(scope);
    expect(afterBlock[0]!.tools.map((tool) => tool.toolName)).not.toContain("mcp.ledger.delete_customer");
    expect(afterBlock[0]!.tools).toHaveLength(5);

    // And pausing the install takes all six away at once, which is the point of installing one thing.
    await mcp.setEnabled(scope, server.id, false);
    expect(await mcp.forRuntime(scope)).toEqual([]);
    // The record survives being paused: nothing was un-inspected, only switched off.
    expect(await mcp.toolsOf(scope, server.id)).toHaveLength(6);
  }, 60_000);

  d("removes an install and everything it could have done", async () => {
    const { scope, mcp } = await setup();
    const server = await mcp.install(scope, installInput());
    await mcp.inspect(scope, server.id);
    const removed = await mcp.remove(scope, server.id);
    expect(removed).toEqual({ slug: "ledger", tools: 6 });
    expect(await mcp.get(scope, server.id)).toBeNull();
    expect(await mcp.state(scope)).toEqual([]);
    expect(await mcp.forRuntime(scope)).toEqual([]);
  }, 60_000);

  d("reads the company's agents so a grant has somewhere to land, and keeps one company's servers out of another's", async () => {
    const owner = await setup();
    const stranger = await setup();
    const server = await owner.mcp.install(owner.scope, installInput());
    await owner.mcp.inspect(owner.scope, server.id);

    const roster = await owner.mcp.agents(owner.scope);
    expect(roster.length).toBeGreaterThan(0);
    expect(roster[0]).toHaveProperty("toolAllowlist");
    // No default allowlist mentions `mcp.`, so installing a server has changed what no agent may do.
    for (const agent of roster) expect(agent.toolAllowlist.some((pattern) => pattern.startsWith("mcp."))).toBe(false);

    // A grant is the agent's own allowlist and nothing else, so the pure function is the whole of it.
    const agent = roster.find((row) => row.enabled)!;
    const next = applyGrant({ allowlist: agent.toolAllowlist, slug: server.slug, toolNames: null, serverTools: (await owner.mcp.toolsOf(owner.scope, server.id)).map((tool) => tool.toolName), granted: true });
    expect(next).toContain("mcp.ledger.*");
    expect((await owner.mcp.state(owner.scope)).map((row) => row.server.slug)).toEqual(["ledger"]);
    expect(await stranger.mcp.get(stranger.scope, server.id)).toBeNull();
    expect(await stranger.mcp.state(stranger.scope)).toEqual([]);
  }, 60_000);
});
