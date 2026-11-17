#!/usr/bin/env node
/**
 * Read-only checks for the public site and proxied API. /health identifies the API build, not Vercel's web build.
 *
 *   pnpm hosted:check                       # BASE=… EXPECT=auto|any|<sha>
 *   EXPECT_WEB=auto pnpm hosted:check       # also check Vercel's production alias (requires VERCEL_TOKEN)
 *
 * `EXPECT=auto` (default) compares the API build inputs against HEAD. `EXPECT=any` skips API revision
 * comparison, not health. `EXPECT_WEB=auto|<sha>` verifies the web revision independently.
 *
 * Node rather than bash+python: this has to run on the machines the repository is worked on, and
 * `python3` on Windows is a Windows Store stub that exits non-zero rather than parsing the JSON, which
 * turns every field into "?" and every check into a lie. Node 24 is a prerequisite of the repo.
 */
import { execFileSync } from "node:child_process";
import { DEFAULT_VERCEL_TEAM } from "./deploy-production.mjs";

const BASE = (process.env.BASE ?? "https://steward-eosin.vercel.app").replace(/\/$/, "");
const EXPECT = process.env.EXPECT ?? "auto";
const EXPECT_WEB = process.env.EXPECT_WEB;
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
async function request(url, init) {
  try {
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(30_000), ...init });
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

const get = (path) => request(`${BASE}${path}`);
const revision = (value) => typeof value === "string" && /^[0-9a-f]{7,40}$/i.test(value) ? value.toLowerCase() : null;
const short = (sha) => sha.slice(0, 7);

function expectedRevision(expect) {
  if (expect !== "auto") return revision(expect);
  try {
    return revision(execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim());
  } catch {
    return null;
  }
}

function affectsBuild(component, file) {
  if (/^(docs|\.github|scripts)\//.test(file) || /\.md$/.test(file)) return false;
  if (file.startsWith("apps/")) {
    // The web build can embed the API; the standalone backend never reads web sources.
    return file.startsWith("apps/api/") ||
      file.startsWith(component === "API" ? "apps/worker/" : "apps/web/");
  }
  if (file.startsWith("infra/")) {
    return component === "API" && file !== "infra/docker/web.Dockerfile";
  }
  return true;
}

function checkRevision(component, reported, expect) {
  const deployed = revision(reported);
  if (expect === "any" && component === "API") {
    ok(`API revision not compared${deployed ? ` (running ${short(deployed)})` : ""}`);
    return;
  }
  const expected = expectedRevision(expect);
  if (!expected || !deployed) {
    bad(`${component} revision cannot be checked: ${!expected ? "expected revision does not name a valid commit" : "deployment did not report a valid commit"}`);
    return;
  }
  if (deployed.startsWith(expected) || expected.startsWith(deployed)) {
    ok(`${component} is running ${short(deployed)}`);
    return;
  }
  try {
    const files = execFileSync("git", ["diff", "--no-renames", "--name-only", "-z", deployed, expected, "--"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
      .split("\0").filter((file) => file && affectsBuild(component, file));
    const comparison = `${component} is running ${short(deployed)}; expected ${short(expected)}`;
    if (files.length === 0) ok(`${comparison}; both have the same build inputs`);
    else bad(`${comparison}, but build inputs differ`, files.slice(0, 3).join(", "));
  } catch {
    bad(`${component} revision is unverified: git could not compare ${short(deployed)} with ${short(expected)}`);
  }
}

async function checkWebRevision() {
  const token = process.env.VERCEL_TOKEN?.trim();
  if (!token) {
    bad("web revision is unverified: EXPECT_WEB requires VERCEL_TOKEN");
    return;
  }
  const hostname = new URL(BASE).hostname;
  const api = (process.env.VERCEL_API ?? "https://api.vercel.com").replace(/\/$/, "");
  const team = process.env.VERCEL_TEAM ?? DEFAULT_VERCEL_TEAM;
  const query = team ? `?teamId=${encodeURIComponent(team)}` : "";
  const deployment = await request(`${api}/v13/deployments/${encodeURIComponent(hostname)}${query}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (deployment.status !== 200 || deployment.json?.readyState !== "READY" || deployment.json?.target !== "production") {
    bad(`web revision is unverified: Vercel has no confirmed READY production deployment for ${hostname} (HTTP ${deployment.status})`);
    return;
  }
  checkRevision("web", deployment.json.gitSource?.sha ?? deployment.json.meta?.githubCommitSha, EXPECT_WEB);
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

step("the API this same deployment serves");

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

const auth = await get("/api/v1/auth/config");
if (auth.status === 200 && typeof auth.json?.signupOpen === "boolean" && typeof auth.json?.inviteOnly === "boolean") {
  ok("GET /api/v1/auth/config -> 200, signup policy available");
} else {
  bad(`GET /api/v1/auth/config -> HTTP ${auth.status}, expected signup policy`, auth.body);
}

const health = await get("/health");
if (health.status === 200 && health.json?.ok === true && health.json?.db === "ok") {
  ok("GET /health -> ok, db ok");
  checkRevision("API", health.json.commit, EXPECT);
} else {
  bad(`GET /health -> HTTP ${health.status} (ok: ${health.json?.ok}, db: ${health.json?.db})`, health.body);
}

if (EXPECT_WEB) {
  step("the web revision serving the production alias");
  await checkWebRevision();
}

if (REQUIRE_EXECUTIONS) {
  step("agent execution readiness");
  const ready = await get("/ready");
  if (ready.status === 200 && ready.json?.ok === true && ready.json?.db === "ok" && ready.json?.temporal === "connected" && ready.json?.executions === "ready") {
    ok("GET /ready -> namespace connected, workflow and activity workers recently polling");
  } else {
    bad(`GET /ready -> HTTP ${ready.status}; agent execution is UNVERIFIED (temporal: ${ready.json?.temporal}, executions: ${ready.json?.executions})`);
  }
}

console.log("");
if (fail > 0) {
  console.log(`\x1b[31m${fail} of ${pass + fail} checks failed\x1b[0m`);
  process.exit(1);
}
console.log(`\x1b[32mall ${pass} checks passed\x1b[0m`);
