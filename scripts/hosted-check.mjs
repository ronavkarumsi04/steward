#!/usr/bin/env node
/**
 * Checks the hosted product, web build, same-origin API and (when required) execution readiness.
 *
 * EXPECT=auto compares both components with this checkout's HEAD. EXPECT_API=<sha> additionally
 * pins the API to an approved commit. EXPECT=any skips comparison with the release, but still
 * requires identifiable releases and checks an API pin if provided. No account or token required.
 */
import { execFileSync } from "node:child_process";

const BASE = (process.env.BASE ?? "https://steward-eosin.vercel.app").replace(/\/$/, "");
const EXPECT = process.env.EXPECT ?? "auto";
const EXPECT_API = process.env.EXPECT_API?.trim() || null;
const REQUIRE_EXECUTIONS = process.env.REQUIRE_EXECUTIONS === "1";

let pass = 0;
let fail = 0;
const step = (title) => console.log(`\n\x1b[1;34m== ${title}\x1b[0m`);
const ok = (title) => {
  pass += 1;
  console.log(`  \x1b[32mok\x1b[0m   ${title}`);
};
const bad = (title, detail) => {
  fail += 1;
  console.log(`  \x1b[31mFAIL\x1b[0m ${title}`);
  // What the server actually said, cut short: "HTTP 500" on its own hides the one sentence that explains it.
  if (detail) console.log(`       ${String(detail).slice(0, 400).replace(/\s+/g, " ")}`);
};

/** One request, one status, one body. A connection that never answered is reported with the reason instead
 *  of as an empty body on a status that was never received. Redirects are not followed: a 302 into a login
 *  page is the deployment saying "not here", not a 200. */
async function request(path, init) {
  try {
    const res = await fetch(`${BASE}${path}`, { redirect: "manual", signal: AbortSignal.timeout(30_000), ...init });
    const body = await res.text();
    let json;
    try {
      json = JSON.parse(body);
    } catch {
      json = null;
    }
    return { status: res.status, body, json };
  } catch (e) {
    return { status: "unreachable", body: e instanceof Error ? e.message : String(e), json: null };
  }
}

const get = (path) => request(path);
const post = (path, body) => request(path, { method: "POST", headers: { "content-type": "application/json" }, body });

const isSha = (sha) => typeof sha === "string" && /^[0-9a-f]{7,40}$/.test(sha);
const short = (sha) => sha.slice(0, 7);
const git = (...args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

function resolveCommit(rev) {
  try {
    const commit = git("rev-parse", "--verify", "--end-of-options", `${rev}^{commit}`).trim();
    return rev === "HEAD" || commit.startsWith(rev) ? commit : null;
  } catch {
    return null;
  }
}

const nonBuild = (file) => /^(docs|\.github|scripts)\//.test(file) || /^[^/]+\.md$/.test(file);
// The API and worker build their workspace dependency graphs, not the web app.
const nonBackend = (file) => nonBuild(file) || file.startsWith("apps/web/") || file === "infra/docker/web.Dockerfile";

function checkRelease(label, reported, expected, irrelevant, verdict, pin = null) {
  if (!isSha(reported)) {
    bad(`${label} is unknown or missing`);
    return;
  }
  const actual = EXPECT === "any" && pin === null ? null : resolveCommit(reported);
  if (pin !== null && (!actual || !isSha(pin) || resolveCommit(pin) !== actual)) {
    bad(`${label} ${short(reported)} does not match a known, approved API commit (EXPECT_API=${pin})`);
    return;
  }
  if (EXPECT === "any") {
    ok(`${label} ${short(reported)} (not compared with the release)`);
    return;
  }
  if (!actual || !expected) {
    bad(`${label} ${short(reported)} cannot be compared: release or reported commit is not in this checkout`);
    return;
  }
  try {
    if (actual !== expected) {
      git("merge-base", "--is-ancestor", actual, expected);
      // A rename out of a backend-owned path must still count as a deletion there.
      const changes = git("diff", "--no-renames", "--name-only", "-z", actual, expected, "--")
        .split("\0").filter((file) => file && !irrelevant(file));
      if (changes.length) {
        bad(`${label} ${short(actual)} differs from ${short(expected)} in build inputs`, changes.slice(0, 4).join(", "));
        return;
      }
    }
    ok(`${label} ${short(actual)} is ${verdict}${actual === expected ? "" : ` (build inputs unchanged through ${short(expected)})`}`);
  } catch {
    bad(`${label} ${short(actual)} is not a verifiable ancestor of ${short(expected)}`);
  }
}

step(`the product, on the public origin (${BASE})`);

const home = await get("/");
if (home.status === 200 && /<title>[^<]*steward/i.test(home.body)) {
  ok("GET / -> 200, the app shell");
} else {
  bad(`GET / -> HTTP ${home.status}`, home.body);
}

const terms = await get("/legal/terms");
if (terms.status === 200) {
  ok("GET /legal/terms -> 200");
} else {
  bad(`GET /legal/terms -> HTTP ${terms.status}`, terms.body);
}

step("web release identity");

const expected = EXPECT === "auto" ? resolveCommit("HEAD") : isSha(EXPECT) ? resolveCommit(EXPECT) : null;
const web = await get("/web-version");
if (web.status === 200) {
  checkRelease("web build", web.json?.commit, expected, nonBuild, "current");
} else {
  bad(`web build identity -> GET /web-version HTTP ${web.status}`);
}

step("the same-origin API");

const legal = await get("/api/v1/legal/documents");
const documents = Array.isArray(legal.json?.documents) ? legal.json.documents : [];
const required = Array.isArray(legal.json?.requiredAgreements) ? legal.json.requiredAgreements : [];
/** The sign-up form's acceptance list has to name documents this response actually serves, at the versions
 *  it serves them: a required agreement nothing matches is a clickwrap that cannot be satisfied. */
const unanswered = required.filter((r) => !documents.some((d) => d.slug === r.document && d.version === r.version));
if (legal.status === 200 && documents.length >= 1 && required.length >= 1 && unanswered.length === 0) {
  ok(`GET /api/v1/legal/documents -> 200, ${documents.length} document(s), ${required.length} required and all of them served`);
} else {
  bad(
    `GET /api/v1/legal/documents -> HTTP ${legal.status} (documents: ${documents.length}, required: ${required.length}${
      unanswered.length ? `, not served: ${unanswered.map((r) => r.document).join(", ")}` : ""
    })`,
    legal.body,
  );
}

// A wrong password has to be refused as a wrong password. That is what proves the API reached its database
// rather than answering from a fixture, and it needs no account: the address is random and does not exist.
const login = await post("/api/v1/auth/login", JSON.stringify({ email: `hosted-check-${Date.now()}@example.com`, password: "not-the-password-000000" }));
const loginCode = login.json?.error?.code;
if (login.status === 401 && loginCode === "invalid_credentials") {
  ok("POST /api/v1/auth/login -> 401 invalid_credentials");
} else {
  bad(`POST /api/v1/auth/login -> HTTP ${login.status} (${loginCode ?? "no error code"})`, login.body);
}

const health = await get("/health");
if (health.status === 200 && health.json?.ok === true && health.json?.db === "ok") {
  ok("API health -> GET /health, db ok");
  checkRelease("API commit", health.json.commit, expected, nonBackend, "compatible", EXPECT_API);
} else {
  bad(`API health -> GET /health HTTP ${health.status} (ok: ${health.json?.ok}, db: ${health.json?.db})`, health.body);
}

if (REQUIRE_EXECUTIONS) {
  step("agent execution readiness");
  const ready = await get("/ready");
  const sameApi = isSha(health.json?.commit) && ready.json?.commit === health.json.commit;
  if (ready.status === 200 && ready.json?.ok === true && ready.json?.db === "ok" && ready.json?.temporal === "connected" && ready.json?.executions === "ready" && sameApi) {
    ok("GET /ready -> namespace connected, workflow and activity workers recently polling");
  } else {
    bad(`GET /ready -> HTTP ${ready.status}; agent execution is UNVERIFIED (temporal: ${ready.json?.temporal}, executions: ${ready.json?.executions}, matches API commit: ${sameApi})`);
  }
}

console.log("");
if (fail > 0) {
  console.log(`\x1b[31m${fail} of ${pass + fail} checks failed\x1b[0m`);
  process.exit(1);
}
console.log(`\x1b[32mall ${pass} checks passed\x1b[0m`);
