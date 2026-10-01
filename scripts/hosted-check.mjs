#!/usr/bin/env node
/**
 * The hosted deployment, checked from the outside: the product, the API served by the same deployment, and
 * which commit that deployment is running.
 *
 *   pnpm hosted:check                       # BASE=… EXPECT=auto|any|<sha> to point it elsewhere
 *
 * `EXPECT=auto` (the default) compares the commit the deployment reports against this checkout's HEAD,
 * because that is the fact nothing outside could see: every check was green while the hosted instance
 * served a five-day-old build, and the difference only showed up by hand. `EXPECT=any` checks that it is up
 * without claiming to know which commit should be there — for a deliberately older deployment, or a
 * checkout without git. Read-only: no account, no token, no state written anywhere.
 *
 * Node rather than bash+python: this has to run on the machines the repository is worked on, and
 * `python3` on Windows is a Windows Store stub that exits non-zero rather than parsing the JSON, which
 * turns every field into "?" and every check into a lie. Node 24 is a prerequisite of the repo.
 */
import { execFileSync } from "node:child_process";

const BASE = (process.env.BASE ?? "https://steward-eosin.vercel.app").replace(/\/$/, "");
const EXPECT = process.env.EXPECT ?? "auto";

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

// A wrong password has to be refused as a wrong password. That is what proves the API reached its database
// rather than answering from a fixture, and it needs no account: the address is random and does not exist.
const login = await post("/api/v1/auth/login", JSON.stringify({ email: `hosted-check-${Date.now()}@example.com`, password: "not-the-password-000000" }));
const loginCode = login.json?.error?.code;
if (login.status === 401 && loginCode === "invalid_credentials") {
  ok("POST /api/v1/auth/login -> 401 invalid_credentials");
} else {
  bad(`POST /api/v1/auth/login -> HTTP ${login.status} (${loginCode ?? "no error code"})`, login.body);
}

step("which commit is running");

const health = await get("/health");
if (health.status === 200 && health.json?.ok === true && health.json?.db === "ok") {
  ok("GET /health -> ok, db ok");
} else {
  bad(`GET /health -> HTTP ${health.status} (ok: ${health.json?.ok}, db: ${health.json?.db})`, health.body);
}

const reported = typeof health.json?.commit === "string" ? health.json.commit : null;
const expected =
  EXPECT === "auto"
    ? (() => {
        try {
          return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
        } catch {
          return null;
        }
      })()
    : EXPECT;
const short = (sha) => String(sha ?? "").trim().slice(0, 7).toLowerCase();

if (reported === null) {
  bad("the deployment reports no commit: it was built before /health carried one, so which commit is being served cannot be checked");
} else if (EXPECT === "any") {
  ok(`the deployment is running ${reported === "unknown" ? "an unnamed commit (built without VERCEL_GIT_COMMIT_SHA or GIT_COMMIT_SHA)" : reported} (not compared)`);
} else if (short(expected) === "") {
  bad(`EXPECT=${EXPECT} but there is no commit to compare against; use EXPECT=any if that is intended`);
} else if (reported !== "unknown" && reported === short(expected)) {
  ok(`the deployment is running ${reported}`);
} else {
  bad(`the deployment reports ${reported}, this checkout is at ${short(expected)} — the hosted instance lags the repository`);
}

console.log("");
if (fail > 0) {
  console.log(`\x1b[31m${fail} of ${pass + fail} checks failed\x1b[0m`);
  process.exit(1);
}
console.log(`\x1b[32mall ${pass} checks passed\x1b[0m`);
