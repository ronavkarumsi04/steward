import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";

const exec = promisify(execFile);

const cwd = mkdtempSync(join(tmpdir(), "steward-hosted-check-"));
after(() => rmSync(cwd, { recursive: true, force: true }));
const git = (args, input) => execFileSync("git", args, { cwd, input, encoding: "utf8" }).trim();
git(["init", "--quiet"]);
git(["fast-import", "--quiet"], [
  ["api", null, "M 100644 inline apps/api/src/app.ts\ndata 3\napi"],
  ["web", "api", "M 100644 inline apps/web/src/app/page.tsx\ndata 3\nweb"],
  ["docs", "web", "M 100644 inline docs/DEPLOY.md\ndata 4\ndocs"],
  ["backend", "web", "M 100644 inline packages/core/src/main.ts\ndata 4\ncore"],
  ["config", "web", "M 100644 inline pnpm-lock.yaml\ndata 4\nlock"],
  ["move", "web", "R apps/api/src/app.ts apps/web/src/app/moved.ts"],
].map(([name, parent, command]) => `commit refs/heads/${name}\ncommitter Steward Test <test@example.com> 1 +0000\ndata 0\n${parent ? `from refs/heads/${parent}\n` : ""}${command}\n\n`).join(""));
const sha = (ref) => git(["rev-parse", `refs/heads/${ref}`]);
const SHORT_API = sha("api").slice(0, 7);
const WEB = sha("web");
const READY = { ok: true, db: "ok", temporal: "connected", executions: "ready", commit: SHORT_API };

async function check({
  readiness = READY, requireExecutions = true, expected = WEB, web = { commit: WEB },
  api = { ok: true, db: "ok", commit: SHORT_API }, expectedApi = "",
} = {}) {
  const server = createServer((req, res) => {
    if (req.url === "/ready" && readiness === null) { req.socket.destroy(); return; }
    const body = req.url === "/web-version" ? web
      : req.url === "/" ? "<title>Steward</title>"
      : req.url === "/legal/terms" ? "Terms"
      : req.url === "/api/v1/legal/documents" ? { documents: [{ slug: "terms", version: "1" }], requiredAgreements: [{ document: "terms", version: "1" }] }
      : req.url === "/api/v1/auth/login" ? { error: { code: "invalid_credentials" } }
      : req.url === "/ready" ? readiness
      : api;
    res.statusCode = req.url === "/api/v1/auth/login" ? 401
      : req.url === "/web-version" && !web ? 404
      : req.url === "/ready" && !readiness?.ok ? 503 : 200;
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const env = { ...process.env, BASE: `http://127.0.0.1:${server.address().port}`, EXPECT: expected, EXPECT_API: expectedApi, REQUIRE_EXECUTIONS: requireExecutions ? "1" : "0" };
    try { return { code: 0, ...(await exec(process.execPath, [fileURLToPath(new URL("./hosted-check.mjs", import.meta.url))], { cwd, env, timeout: 5_000 })) }; }
    catch (error) { return { code: error.code, stdout: error.stdout }; }
  } finally { await new Promise((resolve) => server.close(resolve)); }
}

test("execution checks require a live namespace and both worker queues", async () => {
  const result = await check();
  assert.equal(result.code, 0);
  assert.match(result.stdout, /web build .* is current/);
  assert.match(result.stdout, /API commit .* compatible/);
  assert.match(result.stdout, /workflow and activity workers recently polling/);
});

test("disabled, idle, inconsistent and unreachable verifiers cannot pass", async () => {
  for (const readiness of [
    { ok: false, db: "ok", temporal: "disabled", executions: "unavailable" },
    { ok: false, db: "ok", temporal: "connected", executions: "unavailable" },
    { ok: true, db: "down", temporal: "connected", executions: "ready" },
    { ...READY, commit: WEB.slice(0, 7) },
    null,
  ]) {
    const result = await check({ readiness });
    assert.equal(result.code, 1);
    assert.match(result.stdout, /agent execution is UNVERIFIED/);
  }
});

test("the UI smoke contract makes no claim about executions", async () => {
  const result = await check({ readiness: null, requireExecutions: false });
  assert.equal(result.code, 0);
  assert.doesNotMatch(result.stdout, /agent execution readiness/);
});

test("an old, ahead, missing or unknown web build cannot be vouched for by the API", async () => {
  for (const web of [{ commit: sha("api") }, { commit: sha("docs") }, { commit: "unknown" }, null]) {
    const result = await check({ web });
    assert.equal(result.code, 1, result.stdout);
    assert.match(result.stdout, /FAIL.*web build/);
  }
});

test("an older web build is current if only non-build files differ", async () => {
  const result = await check({ expected: sha("docs") });
  assert.equal(result.code, 0, result.stdout);
  assert.match(result.stdout, /web build .* is current/);
});

test("a shared package change, root build input or backend file moved into web needs a newer API", async () => {
  for (const ref of ["backend", "config", "move"]) {
    const expected = sha(ref);
    const result = await check({ expected, web: { commit: expected } });
    assert.equal(result.code, 1, result.stdout);
    assert.match(result.stdout, /FAIL.*API commit .* differs/);
  }
});

test("a split release cannot hide unknown, unavailable or unapproved API identity", async () => {
  for (const api of [
    { ok: true, db: "ok", commit: "unknown" },
    { ok: true, db: "ok", commit: "deadbee" },
    { ok: false, db: "down", commit: SHORT_API },
  ]) {
    const result = await check({ api });
    assert.equal(result.code, 1, result.stdout);
    assert.match(result.stdout, /FAIL.*API (commit|health)/);
  }
  const pinned = await check({ expectedApi: sha("api") });
  assert.equal(pinned.code, 0, pinned.stdout);
  const unapproved = await check({ expectedApi: WEB });
  assert.equal(unapproved.code, 1, unapproved.stdout);
  assert.match(unapproved.stdout, /FAIL.*approved API commit/);
});
