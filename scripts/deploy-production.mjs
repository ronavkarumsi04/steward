#!/usr/bin/env node
/**
 * Put a commit into production without opening the Vercel dashboard.
 *
 *   node scripts/deploy-production.mjs                     # SHA=… REF=main VERCEL_TOKEN=… (see below)
 *
 * Project `steward` has no git connection, so a push to `main` does not rebuild production: the only thing
 * that moves the site is a deployment created for the exact commit. `.github/workflows/deploy-production.yml`
 * runs this on every push to `main`, and the same file run by hand has the same effect.
 *
 * What this does NOT do is decide whether a commit deserves a build. The project already answers that for
 * itself: `ignoreCommand` in `apps/web/vercel.json` is `npx turbo-ignore`, and Vercel cancels a deployment
 * whose commit changes nothing the web app or its dependencies consume. Answering it a second time here
 * would be a second opinion that can disagree with the first, so this creates the deployment and reports
 * what Vercel decided — including "cancelled because no build reads this commit", which is a success and
 * says so rather than looking like a deployment that never happened.
 *
 * One repository secret is all it needs: VERCEL_TOKEN (Vercel → Account Settings → Tokens, scoped to the team
 * that owns the project). Without it the script names the command that sets it and how to deploy right now,
 * and the workflow treats that as a warning on a push rather than a failure: a merge would otherwise turn
 * `main` red for a capability nobody has switched on yet, and `pnpm hosted:check` is already the thing that
 * reports production drifting from the repository.
 *
 * It writes nothing anywhere but the deployment itself, and no token is ever printed, returned or put in a
 * URL.
 */
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const API = (process.env.VERCEL_API ?? "https://api.vercel.com").replace(/\/$/, "");
const PROJECT = process.env.VERCEL_PROJECT ?? "steward";
const TARGET = process.env.VERCEL_TARGET ?? "production";
const REF = process.env.REF ?? "main";
// The team that owns the project. Vercel's documented form is a team parameter on every call, but the one
// deployment this repository created by hand had to omit it, so the request is tried with it and then
// without rather than being assumed either way (see createDeployment).
const TEAM = process.env.VERCEL_TEAM ?? "team_qWsE4XZplKvuICX6yuYLx4mX";
const POLL_MS = 10_000;
const TIMEOUT_MS = 15 * 60_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const SHA = /^[0-9a-f]{7,40}$/;

/** A commit, not a branch name and not a guess: what is sent to Vercel has to name one revision. */
export function isSha(value) {
  return SHA.test(String(value ?? "").trim().toLowerCase());
}

/** The commit to deploy, most explicit wins: SHA=…, then the SHA the workflow event carries, then this
 *  checkout. Empty when none of them can name one, which the caller reports instead of deploying something
 *  plausible. */
export function resolveSha(env = process.env, gitHead = () => execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" })) {
  const given = String(env.SHA ?? env.GITHUB_SHA ?? "").trim();
  if (given) return given.toLowerCase();
  try {
    return String(gitHead()).trim().toLowerCase();
  } catch {
    return "";
  }
}

/** The deployment request, in the shape the project's own manual deployment used: the commit is named in
 *  `gitSource`, so the build Vercel makes is the build of that commit and `/health` can report it. */
export function deploymentRequest({ project = PROJECT, target = TARGET, org, repo, ref = REF, sha } = {}) {
  return {
    name: project,
    project,
    target,
    gitSource: { type: "github", org, repo, ref, sha },
  };
}

/**
 * What a deployment state means for this run.
 *
 * `ignored` is the project's own answer that a commit does not need a build (turbo-ignore, via
 * `ignoreCommand`), and is a success: production is current by definition. A cancellation for any other
 * reason is not: nothing built, and nothing said why, so this run cannot claim production moved.
 */
export function classify(state, errorLink, errorCode) {
  const s = String(state ?? "").toUpperCase();
  if (s === "READY") return "ready";
  if (s === "ERROR") return "failed";
  if (s === "CANCELED" || s === "CANCELLED") {
    return /ignored[-_]build/i.test(`${errorLink ?? ""} ${errorCode ?? ""}`) ? "ignored" : "canceled";
  }
  return "pending";
}

export const stateOf = (deployment) => String(deployment?.readyState ?? deployment?.status ?? deployment?.state ?? "unknown");

/** One request to Vercel, with the failure reported rather than thrown: a connection that never answered is
 *  a reason, not an empty body on a status that was never received. */
async function call(fetchImpl, token, method, path, body) {
  try {
    const res = await fetchImpl(`${API}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      // An error answer is not always JSON; the detail below carries the body either way.
    }
    return {
      ok: res.ok,
      status: res.status,
      json,
      detail: String(json?.error?.message ?? json?.message ?? text).slice(0, 300).replace(/\s+/g, " "),
    };
  } catch (e) {
    return { ok: false, status: "unreachable", json: null, detail: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Create the deployment, with the team parameter first and without it second. Whether a token is scoped to
 * the team that way is not knowable from here — the connector's own project reads of this project were
 * refused for exactly this — and a run that fails on that difference would report a broken token rather
 * than the thing it is. A refusal for any other reason is reported as it came.
 */
async function createDeployment({ fetchImpl, token, team, body, log }) {
  const forms = team ? [`?teamId=${encodeURIComponent(team)}`, ""] : [""];
  let refusal = null;
  for (const [index, query] of forms.entries()) {
    const res = await call(fetchImpl, token, "POST", `/v13/deployments${query}`, body);
    if (res.ok) {
      if (index > 0) {
        log(`  ..   ${team} does not answer to a team parameter with this token; the same request without it was accepted`);
      }
      return { res, query };
    }
    if (res.status === 403 || res.status === 404) {
      refusal ??= res;
      continue;
    }
    if (res.status === "unreachable") throw new Error(`asking Vercel for the deployment failed: ${res.detail}`);
    throw new Error(`Vercel answered HTTP ${res.status} to the deployment request: ${res.detail}`);
  }
  const tried = forms.length > 1 ? " (tried with and without the team parameter)" : "";
  throw new Error(`Vercel refused the deployment: HTTP ${refusal.status} ${refusal.detail}${tried}`);
}

/** Read the deployment until it reaches a state that means something, reporting each new state once. */
async function waitForDeployment({ fetchImpl, token, id, query, log, sleepImpl, pollMs, timeoutMs }) {
  const started = Date.now();
  let last = null;
  for (;;) {
    const res = await call(fetchImpl, token, "GET", `/v13/deployments/${encodeURIComponent(id)}${query}`);
    if (!res.ok) throw new Error(`Vercel answered HTTP ${res.status} when asked about ${id}: ${res.detail}`);
    const deployment = res.json ?? {};
    const state = stateOf(deployment);
    const outcome = classify(state, deployment.errorLink, deployment.errorCode);
    if (outcome !== "pending") return { outcome, state, deployment };
    if (state !== last) {
      log(`  ..   ${state} (${Math.round((Date.now() - started) / 1000)}s)`);
      last = state;
    }
    if (Date.now() - started >= timeoutMs) return { outcome: "timeout", state, deployment };
    await sleepImpl(pollMs);
  }
}

/** Create the deployment for `sha` and wait for it. Returns the outcome, the state and the last deployment
 *  body; the caller decides what an outcome means to a human and to an exit code. */
export async function deployCommit({
  token,
  team = TEAM,
  project,
  target,
  org,
  repo,
  ref,
  sha,
  fetchImpl = fetch,
  log = console.log,
  sleepImpl = sleep,
  pollMs = POLL_MS,
  timeoutMs = TIMEOUT_MS,
}) {
  const body = deploymentRequest({ project, target, org, repo, ref, sha });
  log(`  ..   POST ${API}/v13/deployments for gitSource github ${org}/${repo}@${ref} ${sha}`);
  const { res, query } = await createDeployment({ fetchImpl, token, team, body, log });
  const created = res.json ?? {};
  const id = created.id ?? created.uid;
  if (!id) throw new Error(`Vercel accepted the request but returned no deployment id: ${res.detail}`);

  log(`  ok   created ${id}`);
  const waited = await waitForDeployment({ fetchImpl, token, id, query, log, sleepImpl, pollMs, timeoutMs });
  return { ...waited, id, created };
}

const positive = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

/**
 * The whole run, from environment to exit code. Every answer it can give is one of: deployed, not built
 * because nothing a build reads changed, failed, cancelled for an unexplained reason, still running when
 * this gave up — and nothing to deploy with, which is a failure only when the caller asked for a deployment
 * rather than merely pushing a commit.
 */
export async function run({ env = process.env, fetchImpl = fetch, log = console.log, sleepImpl = sleep, pollMs, timeoutMs } = {}) {
  const project = env.VERCEL_PROJECT ?? PROJECT;
  const requireToken = env.REQUIRE_TOKEN !== "0";
  const sha = resolveSha(env);
  const token = String(env.VERCEL_TOKEN ?? "").trim();
  const [org, repo] = String(env.GITHUB_REPOSITORY ?? "ronavkarumsi04/steward").split("/");

  log(`== deploying ${sha ? sha.slice(0, 7) : "(no commit)"} to ${env.VERCEL_TARGET ?? TARGET} of ${project}`);

  if (!isSha(sha)) {
    log(`  FAIL there is nothing to deploy: ${sha ? `"${sha}" does not name a commit` : "no commit was given and git could not name one"}`);
    return 1;
  }

  if (!token) {
    const lines = [
      `nothing can be deployed: VERCEL_TOKEN is not set. Create a token in Vercel (Account Settings → Tokens, scoped to the team that owns ${project}) and add it here with \`gh secret set VERCEL_TOKEN\``,
      `to deploy this commit now instead: VERCEL_TOKEN=… node scripts/deploy-production.mjs`,
    ];
    if (requireToken) {
      for (const line of lines) log(`  FAIL ${line}`);
      return 1;
    }
    // `::warning::` when a runner reads the output, so the run page says what is missing; plain otherwise.
    if (env.GITHUB_ACTIONS === "true") for (const line of lines) log(`::warning::${line}`);
    else for (const line of lines) log(`  warn ${line}`);
    return 0;
  }

  const limit = timeoutMs ?? positive(env.TIMEOUT_MS, TIMEOUT_MS);

  let result;
  try {
    result = await deployCommit({
      token,
      team: env.VERCEL_TEAM ?? TEAM,
      project,
      target: env.VERCEL_TARGET ?? TARGET,
      org,
      repo,
      ref: env.REF ?? REF,
      sha,
      fetchImpl,
      log,
      sleepImpl,
      pollMs: pollMs ?? positive(env.POLL_MS, POLL_MS),
      timeoutMs: limit,
    });
  } catch (e) {
    log(`  FAIL ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }

  const { outcome, state, deployment: d, id } = result;
  const inspector = d?.inspectorUrl ? `\n       ${d.inspectorUrl}` : "";

  if (outcome === "ready") {
    const aliases = [].concat(d.alias ?? d.aliases ?? []).filter(Boolean);
    log(`  ok   ${id} is READY: production builds from ${sha.slice(0, 7)}`);
    if (aliases.length) log(`       served by ${aliases.join(", ")}`);
    else log(`       per-deployment URLs are behind Vercel Authentication; the public door is the project's assigned domain`);
    log(`       check it from outside: pnpm hosted:check`);
    return 0;
  }

  if (outcome === "ignored") {
    log(`  ok   Vercel did not build ${sha.slice(0, 7)}, because nothing the web app or its dependencies consume changed (turbo-ignore): production correctly keeps serving what it serves`);
    return 0;
  }

  if (outcome === "failed") {
    log(`  FAIL ${id} finished as ERROR${d.errorCode ? ` (${d.errorCode})` : ""}: ${d.errorMessage ?? "no message"}${inspector}`);
    return 1;
  }

  if (outcome === "canceled") {
    log(`  FAIL ${id} was cancelled before it built, and not because no build reads this commit (${d.errorLink ?? d.errorCode ?? "no reason given"}), so this run cannot say that production moved${inspector}`);
    return 1;
  }

  log(`  FAIL ${id} was still ${state} after ${Math.round(limit / 60_000)} minutes: this run cannot say whether production moved${inspector}`);
  return 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exit(await run());
}
