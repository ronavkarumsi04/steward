/**
 * The code IDE's engine.
 *
 * The pure half — paths, what counts as text, the branch a session proposes, the digest, and the instruction an
 * agent reads — runs anywhere. The rest runs against a real PostgreSQL and a *local server that answers like
 * GitHub*, because the property worth testing is that this product reads a real repository correctly: the tests
 * drive the real `GitHubClient`, over HTTP, through the integration's own `baseUrl` seam, and then assert on the
 * requests the server actually received.
 *
 * What is deliberately absent is a test that a session was committed. Committing is not something this service
 * does: an applied session is a run, and the run's outcome is what changes its state.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { EnvMasterKeyProvider, EnvelopeCrypto } from "@steward/crypto";
import { createDb, type Db } from "@steward/db";
import type { TenantScope } from "@steward/schema";
import { AuthService } from "./auth.js";
import { CompanyService } from "./companies.js";
import { applyInstruction, branchFor, changeKind, changesDigest, checkChange, checkRepoPath, CodeService, CODE_MAX_CHANGE_BYTES, looksLikeText } from "./code.js";
import { applyDiff, unifiedDiff } from "./diff.js";
import { IntegrationService } from "./integrations.js";
import { AgentService, RunService } from "./work.js";
import { startFakeGitHub } from "./test/fake-github.js";

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

const README = "# Northwind\n\nWeekly revenue reports.\n";
const APP = "export const revenue = (cents: number) => cents / 100;\n";

/** A founder, a company, and a GitHub integration pointed at a local server that answers like GitHub. */
async function setup(files: Record<string, string> = { "README.md": README, "src/app.ts": APP }) {
  const github = await startFakeGitHub({ files, binary: "logo.png" });
  const auth = new AuthService(db);
  const reg = await auth.register({ email: `code-${uniq()}@example.com`, password: "correct horse battery", name: "Owner" });
  const orgScope: TenantScope = { organizationId: reg.organization.id, userId: reg.user.id, role: "owner", actor: { type: "user", userId: reg.user.id } };
  const company = await new CompanyService(db).create(orgScope, { name: `Code ${uniq()}`, autonomyLevel: 2 });
  const scope: TenantScope = { ...orgScope, companyId: company.id };
  const integrations = new IntegrationService(db, crypto, { apiUrl: "http://localhost:4000" });
  const integration = await integrations.connectWithFields(scope, { type: "github", fields: { token: `ghp_${uniq()}`, baseUrl: github.url } });
  const agents = await new AgentService(db).list(scope);
  const code = new CodeService(db, integrations);
  return { scope, otherScope: orgScope, company, code, integrations, integration, agents, github, agentId: agents.find((agent) => agent.kind === "engineering")!.id };
}

describe("what a path may be", () => {
  it("refuses anything a filesystem would refuse, and nothing else", () => {
    expect(checkRepoPath("src/app/page.tsx")).toBeNull();
    expect(checkRepoPath("a file with spaces.txt")).toBeNull();
    expect(checkRepoPath(".github/workflows/ci.yml")).toBeNull();
    expect(checkRepoPath("")).toMatch(/cannot be empty/);
    expect(checkRepoPath("/etc/passwd")).toMatch(/absolute/);
    expect(checkRepoPath("../../secrets")).toMatch(/cannot contain empty/);
    expect(checkRepoPath("src//app.ts")).toMatch(/empty/);
    expect(checkRepoPath("src/./app.ts")).toMatch(/cannot contain empty/);
    expect(checkRepoPath("src\\app.ts")).toMatch(/forward slashes/);
    expect(checkRepoPath(".git/config")).toMatch(/`.git`/);
    expect(checkRepoPath(`nul${String.fromCharCode(0)}byte`)).toMatch(/control characters/);
    expect(checkRepoPath(`${"a".repeat(401)}.ts`)).toMatch(/400 characters/);
  });

  it("only refuses binary-looking content, and never a size a person could not have chosen", () => {
    expect(looksLikeText("hello\n")).toBe(true);
    expect(looksLikeText("")).toBe(true);
    expect(looksLikeText("PNG\u0000binary")).toBe(false);
    // A NUL deep in a file this size is still a binary file, but we only look at the head — the same heuristic
    // git uses, and a founder can always ask an agent about the file instead.
    expect(looksLikeText("a".repeat(9000) + "\u0000")).toBe(true);
  });

  it("refuses a change it would have to lie about, and allows deleting", () => {
    expect(checkChange("src/app.ts", "const x = 1;\n")).toBeNull();
    expect(checkChange("src/app.ts", null)).toBeNull();
    expect(checkChange("logo.png", "PNG\u0000\u0001")).toMatch(/not text/);
    expect(checkChange("big.ts", "x".repeat(CODE_MAX_CHANGE_BYTES + 1))).toMatch(/bigger than/);
    expect(checkChange("../escape.ts", "x")).toMatch(/cannot contain empty/);
  });
});

describe("what a session proposes", () => {
  it("derives a branch from its title, so a branch says what it does", () => {
    expect(branchFor("Add weekly revenue summary")).toBe("steward/add-weekly-revenue-summary");
    expect(branchFor("  Fix   the  typo!  ")).toBe("steward/fix-the-typo");
    expect(branchFor("…")).toBe("steward/change");
    expect(branchFor("x".repeat(200)).length).toBeLessThanOrEqual(56);
  });

  it("digests the proposed files the same way every time, whichever order they were staged in", () => {
    const a = { path: "src/a.ts", contents: "a\n" };
    const b = { path: "src/b.ts", contents: null };
    expect(changesDigest([a, b])).toBe(changesDigest([b, a]));
    expect(changesDigest([a, b])).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(changesDigest([a, b])).not.toBe(changesDigest([{ ...a, contents: "a\n\n" }, b]));
    // A deletion and an empty file are different proposals.
    expect(changesDigest([{ path: "x", contents: null }])).not.toBe(changesDigest([{ path: "x", contents: "" }]));
  });

  it("names the kind of change from the two texts", () => {
    expect(changeKind(null, "new\n")).toBe("added");
    expect(changeKind("old\n", null)).toBe("deleted");
    expect(changeKind("old\n", "new\n")).toBe("modified");
  });
});

describe("the instruction an agent reads", () => {
  const changes = [
    { path: "src/app.ts", original: APP, contents: `${APP}export const net = (cents: number) => cents;\n`, added: 1, removed: 0 },
    { path: "docs/old.md", original: "gone\n", contents: null, added: 0, removed: 1 },
    { path: "src/new.ts", original: null, contents: "new\n", added: 1, removed: 0 },
  ];

  it("states the repository, the refs, the digest and every file — and not one byte of the files themselves", () => {
    const instruction = applyInstruction({ repo: "northwind/analytics", baseRef: "main", branch: "steward/add-net", title: "Add a net helper", digest: changesDigest(changes), artifactId: "artifact-9", changes });
    expect(instruction).toContain("northwind/analytics");
    expect(instruction).toContain("Base: main");
    expect(instruction).toContain("Branch: steward/add-net");
    expect(instruction).toContain("artifact-9");
    expect(instruction).toContain("- M src/app.ts (1 added, 0 removed)");
    expect(instruction).toContain("- D docs/old.md (0 added, 1 removed)");
    expect(instruction).toContain("- A src/new.ts (1 added, 0 removed)");
    // The safety rules that make this an application rather than an invitation to improve the code.
    expect(instruction).toContain("Never commit to main directly");
    expect(instruction).toContain("No reformatting, no dependency updates, no unrelated edits");
    expect(instruction).toContain("Do not fall back to committing anywhere else");
    // The text of the files lives in the artifact, not in a prompt: a session can be shown to a founder without
    // pasting a repository into a model call.
    expect(instruction).not.toContain("export const net");
    expect(instruction).toBe(applyInstruction({ repo: "northwind/analytics", baseRef: "main", branch: "steward/add-net", title: "Add a net helper", digest: changesDigest(changes), artifactId: "artifact-9", changes }));
  });

  it("says who wrote the session", () => {
    const instruction = applyInstruction({ repo: "a/b", baseRef: "main", branch: "steward/x", title: "X", digest: "sha256:x", artifactId: null, changes: [], operator: "an agent" });
    expect(instruction).toContain("an agent wrote and approved in Steward");
    expect(instruction).toContain("Files: 0.");
  });
});

describe("reading a repository through a real client", () => {
  it("lists the tree at a ref, with the provider's own answer about truncation", async () => {
    if (!available) return;
    const { scope, code, github } = await setup();
    const tree = await code.tree(scope, "northwind/analytics", "main");
    expect(tree.repo).toBe("northwind/analytics");
    // A tree lists everything, including the binary file: refusing to *read* it is not the same as hiding it.
    expect(tree.entries.map((entry) => entry.path)).toEqual(["README.md", "logo.png", "src/app.ts"]);
    expect(tree.defaultBranch).toBe("main");
    expect(tree.truncated).toBe(false);
    // The token was decrypted from the integration and sent, and the read was of the ref that was asked for.
    expect(github.requests.every((request) => request.authorization?.startsWith("Bearer ghp_"))).toBe(true);
    expect(github.requests.some((request) => request.path.endsWith("/git/trees/main"))).toBe(true);
    await github.close();
  });

  it("reads a file, and refuses one that is too big or not text, with a reason", async () => {
    if (!available) return;
    const { scope, code, github } = await setup({ "README.md": README, "logo.png": "", "huge.json": "x".repeat(CODE_MAX_CHANGE_BYTES * 3) });
    const file = await code.file(scope, "northwind/analytics", "README.md", "main");
    expect(file.contents).toBe(README);
    expect(file.bytes).toBe(Buffer.byteLength(README, "utf8"));
    expect(file.sha).toBe("sha-README.md");
    await expect(code.file(scope, "northwind/analytics", "logo.png", "main")).rejects.toMatchObject({ code: "refused", message: expect.stringMatching(/not text/) });
    await expect(code.file(scope, "northwind/analytics", "huge.json", "main")).rejects.toMatchObject({ message: expect.stringMatching(/more than this editor will show/) });
    await expect(code.file(scope, "northwind/analytics", "../secrets", "main")).rejects.toMatchObject({ code: "refused" });
    await github.close();
  });

  it("says what to connect rather than failing obscurely when no source control is connected", async () => {
    if (!available) return;
    const { otherScope, code } = await setup();
    await expect(code.tree(otherScope, "northwind/analytics", "main")).rejects.toMatchObject({ code: "no_integration", message: expect.stringMatching(/Connect GitHub/) });
  });

  it("refuses a repository or branch that is not one", async () => {
    if (!available) return;
    const { scope, code, github } = await setup();
    await expect(code.tree(scope, "not a repo", "main")).rejects.toMatchObject({ code: "refused" });
    await expect(code.tree(scope, "northwind/analytics", "main; rm -rf /")).rejects.toMatchObject({ code: "refused" });
    await expect(code.tree(scope, "northwind/analytics", "..")).rejects.toMatchObject({ code: "refused" });
    await github.close();
  });
});

describe("a session's changes", () => {
  it("stages a change against the text that is really in the repository", async () => {
    if (!available) return;
    const { scope, code, github } = await setup();
    const session = await code.createSession(scope, { repo: "northwind/analytics", baseRef: "main", title: "Explain revenue" });

    const staged = await code.stage(scope, session.id, { path: "src/app.ts", contents: `${APP}export const net = (cents: number) => cents;\n` });
    expect(staged).not.toBeNull();
    expect(github.requests.some((request) => request.path.endsWith("/contents/src/app.ts") && request.search.includes("ref=main"))).toBe(true);

    const [change] = await code.changes(scope, session.id);
    expect(change!.kind).toBe("modified");
    expect(change!.original).toBe(APP);
    expect(change!.summary).toBe("1 added, 0 removed");
    // The diff is the real thing: applying it to the original text reproduces the proposal exactly.
    expect(applyDiff(change!.original!, change!.diff)).toBe(`${APP}export const net = (cents: number) => cents;\n`);

    // Staging the same text again is not a change, and the proposal is removed rather than left stale.
    expect(await code.stage(scope, session.id, { path: "src/app.ts", contents: APP })).toBeNull();
    expect(await code.changes(scope, session.id)).toEqual([]);
    await github.close();
  });

  it("treats a file the repository does not have as a new file, and keeps the proposal across edits", async () => {
    if (!available) return;
    const { scope, code, github } = await setup();
    const session = await code.createSession(scope, { repo: "northwind/analytics", baseRef: "main", title: "Add a changelog" });
    await code.stage(scope, session.id, { path: "CHANGELOG.md", contents: "## 1.0.0\n" });
    const [change] = await code.changes(scope, session.id);
    expect(change!.kind).toBe("added");
    expect(change!.original).toBeNull();
    expect(change!.summary).toBe("1 lines added");

    // Editing the proposal again does not re-read the repository: the original is the one the session was built
    // against, so a push from someone else cannot quietly rewrite the diff a founder is looking at.
    const before = github.requests.length;
    await code.stage(scope, session.id, { path: "CHANGELOG.md", contents: "## 1.0.0\n\nFirst release.\n" });
    expect(github.requests.length).toBe(before);
    const [updated] = await code.changes(scope, session.id);
    expect(updated!.original).toBeNull();
    expect(updated!.diff.added).toBe(3);
    await github.close();
  });

  it("a deletion is a change with the file's text in the diff", async () => {
    if (!available) return;
    const { scope, code, github } = await setup();
    const session = await code.createSession(scope, { repo: "northwind/analytics", baseRef: "main", title: "Drop the readme" });
    await code.stage(scope, session.id, { path: "README.md", contents: null });
    const [change] = await code.changes(scope, session.id);
    expect(change!.kind).toBe("deleted");
    expect(change!.contents).toBeNull();
    expect(change!.summary).toBe("3 lines removed");
    await github.close();
  });

  it("a session cannot propose changes to the base ref", async () => {
    if (!available) return;
    const { scope, code, github } = await setup();
    await expect(code.createSession(scope, { repo: "northwind/analytics", baseRef: "main", title: "Sneaky", branch: "main" })).rejects.toMatchObject({ code: "refused", message: expect.stringMatching(/cannot propose changes to main itself/) });
    await expect(code.createSession(scope, { repo: "northwind/analytics", baseRef: "main", title: "Bad ref", branch: "main; curl evil" })).rejects.toMatchObject({ code: "refused" });
    await github.close();
  });

  it("discarding a session stops it being edited, and leaves its proposals behind", async () => {
    if (!available) return;
    const { scope, code, github } = await setup();
    const session = await code.createSession(scope, { repo: "northwind/analytics", baseRef: "main", title: "Abandoned" });
    await code.stage(scope, session.id, { path: "README.md", contents: "# Rewritten\n" });
    await code.discard(scope, session.id);
    expect((await code.sessions(scope))[0]!.state).toBe("discarded");
    await expect(code.stage(scope, session.id, { path: "README.md", contents: "# Again\n" })).rejects.toMatchObject({ code: "refused", message: expect.stringMatching(/discarded/) });
    await expect(code.apply(scope, { sessionId: session.id, agentId: "x", launcher: null })).rejects.toMatchObject({ code: "refused" });
    await github.close();
  });

  it("hands a session to an agent as a recorded run, and says honestly when nothing can start it", async () => {
    if (!available) return;
    const { scope, code, agents, agentId, github } = await setup();
    expect(agents.some((agent) => agent.id === agentId)).toBe(true);
    const session = await code.createSession(scope, { repo: "northwind/analytics", baseRef: "main", title: "Add net" });
    await code.stage(scope, session.id, { path: "src/net.ts", contents: "export const net = (cents: number) => cents;\n" });
    await code.stage(scope, session.id, { path: "README.md", contents: "# Northwind\n\nWeekly net revenue reports.\n" });

    const queued = await code.apply(scope, { sessionId: session.id, agentId, launcher: null });
    expect(queued.status).toBe("queued");
    expect(queued.reason).toContain("No workflow engine");
    expect(queued.digest).toMatch(/^sha256:/);

    // The run holds the instruction byte for byte, and the files are in an artifact rather than in the prompt.
    const run = await pool.query<{ status: string; trigger: { instruction: string } }>("select status, trigger from agent_runs where id = $1", [queued.runId]);
    expect(run.rows[0]?.status).toBe("queued");
    expect(run.rows[0]?.trigger.instruction).toBe(queued.instruction);
    const bundle = await pool.query<{ content: string; metadata: Record<string, unknown> }>("select content, metadata from artifacts where run_id = $1 and kind = 'code_change'", [queued.runId]);
    const stored = JSON.parse(bundle.rows[0]!.content) as { files: Array<{ path: string; contents: string }> };
    expect(stored.files.map((file) => file.path)).toEqual(["README.md", "src/net.ts"]);
    expect(bundle.rows[0]?.metadata.branch).toBe("steward/add-net");

    // A session that is already being applied is frozen: a second apply would be a second commit of the same work.
    await expect(code.apply(scope, { sessionId: session.id, agentId, launcher: null })).rejects.toMatchObject({ code: "conflict" });

    // The state is the run's, not the session's own opinion.
    const runs = new RunService(db);
    expect((await code.sessions(scope))[0]!.state).toBe("running");
    await runs.setStatus(scope, queued.runId, "succeeded");
    expect((await code.sessions(scope))[0]!.state).toBe("applied");
    await runs.addArtifact(scope, { runId: queued.runId, kind: "pull_request", title: "Add net", url: "https://github.com/northwind/analytics/pull/7", metadata: { number: 7 } });
    expect((await code.sessions(scope))[0]!.pullUrl).toBe("https://github.com/northwind/analytics/pull/7");
    expect(await code.pullRequests(scope, queued.runId)).toEqual([{ title: "Add net", url: "https://github.com/northwind/analytics/pull/7", number: 7 }]);
    await github.close();
  });

  it("starts the run when an engine is reachable, and reports the files a session never had", async () => {
    if (!available) return;
    const { scope, code, agentId, github } = await setup();
    const session = await code.createSession(scope, { repo: "northwind/analytics", baseRef: "main", title: "Only one file" });
    await expect(code.apply(scope, { sessionId: session.id, agentId, launcher: null })).rejects.toMatchObject({ code: "refused", message: expect.stringMatching(/no changes yet/) });
    await code.stage(scope, session.id, { path: "README.md", contents: "# Northwind\n" });
    const started = await code.apply(scope, { sessionId: session.id, agentId, launcher: { start: async () => ({ workflowId: `wf-${uniq()}`, workflowRunId: `run-${uniq()}` }) } });
    expect(started.reason, started.reason ?? "").toBeNull();
    expect(started.status).toBe("started");
    await github.close();
  });

  it("keeps one company's sessions and repository out of another's reach", async () => {
    if (!available) return;
    const a = await setup();
    const b = await setup();
    const session = await a.code.createSession(a.scope, { repo: "northwind/analytics", baseRef: "main", title: "Mine" });
    await a.code.stage(a.scope, session.id, { path: "README.md", contents: "# Mine\n" });

    expect(await b.code.session(b.scope, session.id)).toBeNull();
    expect(await b.code.changes(b.scope, session.id)).toEqual([]);
    expect(await b.code.sessions(b.scope)).toEqual([]);
    await expect(b.code.patch(b.scope, session.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(b.code.stage(b.scope, session.id, { path: "README.md", contents: "x" })).rejects.toMatchObject({ code: "not_found" });
    await expect(b.code.discard(b.scope, session.id)).rejects.toMatchObject({ code: "not_found" });
    await a.github.close();
    await b.github.close();
  });

  it("returns a session as one patch a person could apply", async () => {
    if (!available) return;
    const { scope, code, github } = await setup();
    const session = await code.createSession(scope, { repo: "northwind/analytics", baseRef: "main", title: "Patch me" });
    await code.stage(scope, session.id, { path: "src/app.ts", contents: "export const revenue = (cents: number) => cents / 100;\nexport const net = (cents: number) => cents;\n" });
    const patch = await code.patch(scope, session.id);
    expect(patch.text).toContain("--- a/src/app.ts\n");
    expect(patch.text).toContain("+++ b/src/app.ts\n");
    expect(patch.text).toContain("@@ -1,1 +1,2 @@\n");
    expect(patch.digest).toBe(changesDigest([{ path: "src/app.ts", contents: "export const revenue = (cents: number) => cents / 100;\nexport const net = (cents: number) => cents;\n" }]));
    expect(unifiedDiff(APP, "export const revenue = (cents: number) => cents / 100;\nexport const net = (cents: number) => cents;\n", "src/app.ts").added).toBe(1);
    await github.close();
  });
});
