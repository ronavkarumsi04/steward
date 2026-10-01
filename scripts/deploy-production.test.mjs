/**
 * Every way the deploy path can end, driven without a token and without Vercel: one stub fetch answers the
 * two requests (`POST /v13/deployments`, then the deployment read back), and the assertions are on what the
 * run said and what exit code it returned.
 *
 * This exists because the deploy path's failure mode is silence — production quietly staying on an older
 * commit — and because the token it needs does not exist yet, so there is nothing to point it at. The one
 * branch these tests cannot stand in for is Vercel's own answer; that is what a real push reports.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { classify, deploymentRequest, isSha, resolveSha, run, stateOf } from "./deploy-production.mjs";

const COMMIT = "9b41f8e6b5e0d1c2a3948576675849a0b1c2d3e4";
const TOKEN = "secret-token-abc";

/** A fetch that answers in order and remembers every request it was given. */
function fetchStub(answers) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? "GET", headers: init.headers ?? {}, body: init.body ? JSON.parse(init.body) : null });
    const answer = answers.shift();
    if (!answer) throw new Error(`unexpected request: ${init.method ?? "GET"} ${url}`);
    return new Response(JSON.stringify(answer.body ?? {}), { status: answer.status ?? 200, headers: { "content-type": "application/json" } });
  };
  return { fetchImpl, calls };
}

/** A run with a stub in place of everything outside it, and its output kept for the assertions. */
async function attempt({ env = {}, answers = [], fetchImpl } = {}) {
  const stub = fetchImpl ? { fetchImpl, calls: [] } : fetchStub(answers);
  const lines = [];
  const code = await run({
    env: { SHA: COMMIT, VERCEL_TOKEN: TOKEN, ...env },
    fetchImpl: stub.fetchImpl,
    log: (line) => lines.push(line),
    sleepImpl: async () => {},
    pollMs: 0,
  });
  return { code, lines, said: lines.join("\n"), calls: stub.calls };
}

const created = (extra = {}) => [
  { status: 200, body: { id: "dpl_new" } },
  { status: 200, body: { id: "dpl_new", readyState: "READY", ...extra } },
];

test("the request names the project, the target and the exact commit", () => {
  assert.deepEqual(deploymentRequest({ org: "ronavkarumsi04", repo: "steward", ref: "main", sha: COMMIT }), {
    name: "steward",
    project: "steward",
    target: "production",
    gitSource: { type: "github", org: "ronavkarumsi04", repo: "steward", ref: "main", sha: COMMIT },
  });
});

test("a commit is a commit, and a branch name is not one", () => {
  assert.equal(isSha(COMMIT), true);
  assert.equal(isSha("9b41f8e"), true);
  assert.equal(isSha(COMMIT.toUpperCase()), true);
  assert.equal(isSha("main"), false);
  assert.equal(isSha("9b41f8"), false);
  assert.equal(isSha("zzzzzzz"), false);
  assert.equal(isSha(""), false);
  assert.equal(isSha(null), false);
});

test("which commit to deploy: the one given, then the event's, then this checkout's", () => {
  assert.equal(resolveSha({ SHA: COMMIT }), COMMIT);
  assert.equal(resolveSha({ SHA: COMMIT.toUpperCase(), GITHUB_SHA: "0".repeat(40) }), COMMIT);
  assert.equal(resolveSha({ GITHUB_SHA: "A".repeat(40) }), "a".repeat(40));
  assert.equal(resolveSha({}, () => `${COMMIT}\n`), COMMIT);
  assert.equal(
    resolveSha({}, () => {
      throw new Error("not a repository");
    }),
    "",
  );
});

test("a deployment state means one of five things", () => {
  assert.equal(classify("READY"), "ready");
  assert.equal(classify("ERROR"), "failed");
  assert.equal(classify("CANCELED", "https://vercel.com/docs/errors/ignored-build-step"), "ignored");
  assert.equal(classify("CANCELED", undefined, "IGNORED_BUILD_STEP"), "ignored");
  assert.equal(classify("CANCELED", "https://vercel.com/docs/errors/deployment-canceled"), "canceled");
  assert.equal(classify("BUILDING"), "pending");
  assert.equal(classify("QUEUED"), "pending");
  assert.equal(classify(undefined), "pending");
  assert.equal(stateOf({ readyState: "READY" }), "READY");
  assert.equal(stateOf({ status: "ERROR" }), "ERROR");
  assert.equal(stateOf({}), "unknown");
});

test("a READY deployment is reported with what it built and what serves it", async () => {
  const { code, lines, said, calls } = await attempt({ answers: created({ alias: ["steward-eosin.vercel.app"] }) });

  assert.equal(code, 0);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].url, "https://api.vercel.com/v13/deployments?teamId=team_qWsE4XZplKvuICX6yuYLx4mX");
  assert.deepEqual(calls[0].body, {
    name: "steward",
    project: "steward",
    target: "production",
    gitSource: { type: "github", org: "ronavkarumsi04", repo: "steward", ref: "main", sha: COMMIT },
  });
  assert.equal(calls[1].url, "https://api.vercel.com/v13/deployments/dpl_new?teamId=team_qWsE4XZplKvuICX6yuYLx4mX");
  assert.match(said, /READY: production builds from 9b41f8e/);
  assert.match(said, /served by steward-eosin\.vercel\.app/);
  assert.ok(!lines.some((line) => line.includes(TOKEN)), "the token is never printed");
  assert.ok(!calls.some((call) => call.url.includes(TOKEN) || JSON.stringify(call.body ?? {}).includes(TOKEN)), "the token is never put in a request");
});

test("a deployment that was not built because no build reads the commit is a success, and says why", async () => {
  const { code, said, calls } = await attempt({
    answers: [
      { status: 200, body: { id: "dpl_new" } },
      { status: 200, body: { id: "dpl_new", readyState: "CANCELED", errorLink: "https://vercel.com/docs/errors/ignored-build-step" } },
    ],
  });

  assert.equal(code, 0);
  assert.equal(calls.length, 2);
  assert.match(said, /Vercel did not build 9b41f8e, because nothing the web app or its dependencies consume changed/);
});

test("a token that is not scoped to the team is not reported as a broken token", async () => {
  const { code, said, calls } = await attempt({
    answers: [
      { status: 403, body: { error: { message: "Team team_qWsE4XZplKvuICX6yuYLx4mX does not exist or you don't have access" } } },
      ...created(),
    ],
  });

  assert.equal(code, 0);
  assert.equal(calls[0].url, "https://api.vercel.com/v13/deployments?teamId=team_qWsE4XZplKvuICX6yuYLx4mX");
  assert.equal(calls[1].url, "https://api.vercel.com/v13/deployments");
  assert.equal(calls[2].url, "https://api.vercel.com/v13/deployments/dpl_new");
  assert.match(said, /the same request without it was accepted/);
});

test("a refusal about the request itself is reported, not retried", async () => {
  const { code, said, calls } = await attempt({ answers: [{ status: 400, body: { error: { message: "Invalid gitSource" } } }] });

  assert.equal(code, 1);
  assert.equal(calls.length, 1);
  assert.match(said, /HTTP 400 to the deployment request: Invalid gitSource/);
});

test("a build that failed fails this run, with the build's own words", async () => {
  const { code, said } = await attempt({
    answers: [
      { status: 200, body: { id: "dpl_new" } },
      {
        status: 200,
        body: { id: "dpl_new", readyState: "ERROR", errorCode: "BUILD_FAILED", errorMessage: 'Command "next build" exited with 1', inspectorUrl: "https://vercel.com/novara-exosystems-projects/steward/dpl_new" },
      },
    ],
  });

  assert.equal(code, 1);
  assert.match(said, /dpl_new finished as ERROR \(BUILD_FAILED\): Command "next build" exited with 1/);
  assert.match(said, /https:\/\/vercel\.com\/novara-exosystems-projects\/steward\/dpl_new/);
});

test("a cancellation for any other reason is not a success either", async () => {
  const { code, said } = await attempt({
    answers: [
      { status: 200, body: { id: "dpl_new" } },
      { status: 200, body: { id: "dpl_new", readyState: "CANCELED", errorCode: "DEPLOYMENT_CANCELED" } },
    ],
  });

  assert.equal(code, 1);
  assert.match(said, /was cancelled before it built, and not because no build reads this commit/);
});

test("a deployment still running when the run gives up is not a success", async () => {
  const stub = fetchStub([
    { status: 200, body: { id: "dpl_new" } },
    { status: 200, body: { id: "dpl_new", readyState: "BUILDING" } },
  ]);
  const lines = [];
  const code = await run({
    env: { SHA: COMMIT, VERCEL_TOKEN: TOKEN },
    fetchImpl: stub.fetchImpl,
    log: (line) => lines.push(line),
    sleepImpl: async () => {},
    pollMs: 0,
    timeoutMs: 0,
  });

  assert.equal(code, 1);
  assert.equal(stub.calls.length, 2, "one read of the deployment is enough to know it is late");
  assert.match(lines.join("\n"), /was still BUILDING after 0 minutes: this run cannot say whether production moved/);
});

test("no token fails a deployment that was asked for, and warns on a push that did not ask", async () => {
  const push = await attempt({ env: { VERCEL_TOKEN: "", REQUIRE_TOKEN: "0", GITHUB_ACTIONS: "true" }, answers: created() });
  assert.equal(push.code, 0);
  assert.equal(push.calls.length, 0, "nothing is asked of Vercel without a token");
  assert.ok(push.lines.some((line) => line.startsWith("::warning::") && line.includes("gh secret set VERCEL_TOKEN")));
  assert.ok(push.lines.some((line) => line.includes("VERCEL_TOKEN=… node scripts/deploy-production.mjs")));

  const manual = await attempt({ env: { VERCEL_TOKEN: "" } });
  assert.equal(manual.code, 1);
  assert.equal(manual.calls.length, 0);
  assert.match(manual.said, /FAIL nothing can be deployed: VERCEL_TOKEN is not set/);
});

test("a branch name is not deployed as if it were a commit", async () => {
  const { code, said, calls } = await attempt({ env: { SHA: "main" } });

  assert.equal(code, 1);
  assert.equal(calls.length, 0);
  assert.match(said, /"main" does not name a commit/);
});

test("a Vercel that cannot be reached is reported with the reason", async () => {
  const fetchImpl = async () => {
    throw new Error("fetch failed: EAI_AGAIN");
  };
  const { code, said } = await attempt({ fetchImpl });

  assert.equal(code, 1);
  assert.match(said, /asking Vercel for the deployment failed: fetch failed: EAI_AGAIN/);
});
