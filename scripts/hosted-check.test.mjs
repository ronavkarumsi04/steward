import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";

const exec = promisify(execFile);

async function check(readiness, requireExecutions = true, {
  cwd, env: overrides, apiSha = "abcdef1", db = "ok", webDeployment, webStatus = 200,
} = {}) {
  const requests = [];
  const server = createServer((req, res) => {
    requests.push({ method: req.method, path: req.url, authorization: req.headers.authorization });
    if (req.url === "/ready" && readiness === null) { req.socket.destroy(); return; }
    const body = req.url === "/" ? "<title>Steward</title>"
      : req.url === "/legal/terms" ? "Terms"
      : req.url === "/api/v1/legal/documents" ? { documents: [{ slug: "terms", version: "1" }], requiredAgreements: [{ document: "terms", version: "1" }] }
      : req.url === "/api/v1/auth/config" ? { signupOpen: false, inviteOnly: true }
      : req.url === "/ready" ? readiness
      : req.url.startsWith("/v13/deployments/") ? webDeployment
      : { ok: db === "ok", db, commit: apiSha, temporal: "disabled" };
    res.statusCode = req.url === "/ready" && !readiness?.ok ? 503 : req.url.startsWith("/v13/deployments/") ? webStatus : 200;
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const env = { ...process.env, BASE: base, VERCEL_API: base, VERCEL_TOKEN: "test-token", VERCEL_TEAM: "test-team",
      EXPECT: "any", EXPECT_WEB: "", REQUIRE_EXECUTIONS: requireExecutions ? "1" : "0", ...overrides };
    try { return { code: 0, requests, ...(await exec(process.execPath, [fileURLToPath(new URL("./hosted-check.mjs", import.meta.url))], { cwd, env, timeout: 5_000 })) }; }
    catch (error) { return { code: error.code, stdout: error.stdout, requests }; }
  } finally { await new Promise((resolve) => server.close(resolve)); }
}

test("execution checks require a live namespace and both worker queues", async () => {
  const result = await check({ ok: true, db: "ok", temporal: "connected", executions: "ready" });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /workflow and activity workers recently polling/);
});

function revisions(t) {
  const cwd = mkdtempSync(join(tmpdir(), "hosted-check-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, {
    cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.com",
      GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.com" },
  }).trim();
  const commit = (file) => {
    mkdirSync(dirname(join(cwd, file)), { recursive: true });
    writeFileSync(join(cwd, file), file);
    git("add", file);
    git("commit", "-qm", file);
    return git("rev-parse", "HEAD");
  };
  git("init", "-q");
  return { cwd, api: commit("apps/api/source.ts"), web: commit("apps/web/source.ts"),
    ops: commit(".github/workflows/hosted.yml"), backend: commit("packages/core/source.ts") };
}

const production = (sha) => ({ target: "production", readyState: "READY", gitSource: { sha } });

test("web-only and workflow changes do not make a healthy, separately deployed API stale", async (t) => {
  const { cwd, api, web, ops } = revisions(t);
  const result = await check(null, false, {
    cwd, apiSha: api.slice(0, 7), env: { EXPECT: ops, EXPECT_WEB: ops }, webDeployment: production(web),
  });
  assert.equal(result.code, 0, result.stdout);
  assert.match(result.stdout, /API.*same build inputs/);
  assert.match(result.stdout, /web.*same build inputs/);
  assert.ok(result.requests.every(({ method }) => method === "GET"));
  const metadata = result.requests.find(({ path }) => path.startsWith("/v13/deployments/127.0.0.1?"));
  assert.equal(metadata?.authorization, "Bearer test-token");
  assert.ok(result.requests.filter((request) => request !== metadata).every(({ authorization }) => !authorization));
});

test("an up-to-date API does not hide a stale web deployment", async (t) => {
  const { cwd, api, web } = revisions(t);
  const result = await check(null, false, {
    cwd, apiSha: api.slice(0, 7), env: { EXPECT: web, EXPECT_WEB: web }, webDeployment: production(api),
  });
  assert.equal(result.code, 1, result.stdout);
  assert.match(result.stdout, /FAIL.*web.*build inputs differ/);
});

test("backend changes and unverifiable API revisions still fail", async (t) => {
  const { cwd, api, backend } = revisions(t);
  for (const [apiSha, reason] of [[api.slice(0, 7), /build inputs differ/], ["unknown", /valid commit/], ["0000000", /could not compare/]]) {
    const result = await check(null, false, { cwd, apiSha, env: { EXPECT: backend } });
    assert.equal(result.code, 1, result.stdout);
    assert.match(result.stdout, reason);
  }
});

test("a web revision check fails without ready production deployment metadata", async (t) => {
  const { cwd, web } = revisions(t);
  for (const [webStatus, webDeployment] of [
    [403, {}], [200, { ...production(web), target: "preview" }], [200, { ...production(web), readyState: "BUILDING" }],
    [200, production(undefined)],
  ]) {
    const result = await check(null, false, { cwd, webStatus, webDeployment, env: { EXPECT_WEB: web } });
    assert.equal(result.code, 1, result.stdout);
    assert.match(result.stdout, /FAIL.*web/);
  }
});

test("revision checks never turn a failed database probe into a pass", async () => {
  const result = await check(null, false, { db: "down" });
  assert.equal(result.code, 1, result.stdout);
  assert.match(result.stdout, /FAIL.*GET \/health.*db: down/);
});

test("disabled, idle, inconsistent and unreachable verifiers cannot pass", async () => {
  for (const readiness of [
    { ok: false, db: "ok", temporal: "disabled", executions: "unavailable" },
    { ok: false, db: "ok", temporal: "connected", executions: "unavailable" },
    { ok: true, db: "down", temporal: "connected", executions: "ready" },
    null,
  ]) {
    const result = await check(readiness);
    assert.equal(result.code, 1);
    assert.match(result.stdout, /agent execution is UNVERIFIED/);
  }
});

test("the UI smoke contract makes no claim about executions", async () => {
  const result = await check(null, false);
  assert.equal(result.code, 0);
  assert.doesNotMatch(result.stdout, /agent execution readiness/);
});
