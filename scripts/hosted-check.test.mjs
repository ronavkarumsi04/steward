import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";

const exec = promisify(execFile);

async function check(readiness, requireExecutions = true) {
  const server = createServer((req, res) => {
    if (req.url === "/ready" && readiness === null) { req.socket.destroy(); return; }
    const body = req.url === "/" ? "<title>Steward</title>"
      : req.url === "/legal/terms" ? "Terms"
      : req.url === "/api/v1/legal/documents" ? { documents: [{ slug: "terms", version: "1" }], requiredAgreements: [{ document: "terms", version: "1" }] }
      : req.url === "/api/v1/auth/login" ? { error: { code: "invalid_credentials" } }
      : req.url === "/ready" ? readiness
      : { ok: true, db: "ok", commit: "abcdef1", temporal: "disabled" };
    res.statusCode = req.url === "/api/v1/auth/login" ? 401 : req.url === "/ready" && !readiness?.ok ? 503 : 200;
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const env = { ...process.env, BASE: `http://127.0.0.1:${server.address().port}`, EXPECT: "any", REQUIRE_EXECUTIONS: requireExecutions ? "1" : "0" };
    try { return { code: 0, ...(await exec(process.execPath, [fileURLToPath(new URL("./hosted-check.mjs", import.meta.url))], { env, timeout: 5_000 })) }; }
    catch (error) { return { code: error.code, stdout: error.stdout }; }
  } finally { await new Promise((resolve) => server.close(resolve)); }
}

test("execution checks require a live namespace and both worker queues", async () => {
  const result = await check({ ok: true, db: "ok", temporal: "connected", executions: "ready" });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /workflow and activity workers recently polling/);
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
