/**
 * Turning observations into a score.
 *
 * Three states, and the ordering between them is the whole design:
 *
 *   - `fail` outranks everything. A check that found the record contradicting the rule is a failure even if
 *     another check could not be answered.
 *   - `unverified` outranks `pass`. If any check cannot be answered from the rows, the case did not pass — it
 *     was not fully checked. This is the rule that keeps the suite from reading as green in a deployment where
 *     half the evidence is missing.
 *   - `pass` requires every check to answer yes.
 *
 * A case with no evidence at all is `unverified`, not `pass` and not `fail`: nothing was observed, so nothing
 * is claimed.
 */
import { verificationVerdict } from "@steward/schema";
import type { AgentScore, CaseResult, CheckResult, CheckStatus, EvalCase, RunEvidence, Scorecard } from "./types.js";

/** The worst status wins: fail beats unverified beats pass. */
const SEVERITY: Record<CheckStatus, number> = { pass: 0, unverified: 1, fail: 2 };

function worst(statuses: CheckStatus[]): CheckStatus {
  return statuses.reduce<CheckStatus>((acc, s) => (SEVERITY[s] > SEVERITY[acc] ? s : acc), "pass");
}

export function scoreCase(evalCase: EvalCase, evidence: RunEvidence | null | undefined, note?: string): CaseResult {
  const base = {
    id: evalCase.id,
    title: evalCase.title,
    proves: evalCase.proves,
    runId: evidence?.run.id ?? "",
    provider: evidence?.provider ?? "unknown",
  };
  if (!evidence) {
    const checks: CheckResult[] = [
      {
        name: "the run left a record",
        status: "unverified",
        detail: note ?? "No run evidence was collected, so none of this case's checks could be answered.",
      },
    ];
    return { ...base, status: "unverified", checks, ...(note ? { note } : {}) };
  }
  const checks: CheckResult[] = evalCase.expect.map((expectation) => {
    const verdict = expectation.assess(evidence);
    return {
      name: expectation.name,
      status: verdict.ok === null ? "unverified" : verdict.ok ? "pass" : "fail",
      detail: verdict.detail,
    };
  });
  return { ...base, status: checks.length ? worst(checks.map((c) => c.status)) : "unverified", checks, ...(note ? { note } : {}) };
}

/** Per-agent rollup. Every number is a count of cases, and the money is the mean over the cases that ran. */
export function scoreByAgent(cases: EvalCase[], results: CaseResult[], evidence: Map<string, RunEvidence>): AgentScore[] {
  const byKind = new Map<string, AgentScore & { costTotal: number }>();
  for (const [i, evalCase] of cases.entries()) {
    const result = results[i];
    if (!result) continue;
    const kind = evidence.get(evalCase.id)?.run.agentKind ?? "unknown";
    const entry = byKind.get(kind) ?? { agentKind: kind, cases: 0, pass: 0, fail: 0, unverified: 0, verifiedSuccesses: 0, stoppedForAHuman: 0, meanCostUsd: 0, costTotal: 0 };
    entry.cases += 1;
    if (result.status === "pass") entry.pass += 1;
    else if (result.status === "fail") entry.fail += 1;
    else entry.unverified += 1;
    const run = evidence.get(evalCase.id)?.run;
    if (run) {
      if (run.status === "succeeded") entry.verifiedSuccesses += 1;
      if (["needs_review", "failed", "cancelled"].includes(run.status)) entry.stoppedForAHuman += 1;
      entry.costTotal += Number(run.costUsd) || 0;
    }
    byKind.set(kind, entry);
  }
  return [...byKind.values()]
    .map((entry) => ({
      agentKind: entry.agentKind,
      cases: entry.cases,
      pass: entry.pass,
      fail: entry.fail,
      unverified: entry.unverified,
      verifiedSuccesses: entry.verifiedSuccesses,
      stoppedForAHuman: entry.stoppedForAHuman,
      meanCostUsd: entry.cases ? entry.costTotal / entry.cases : 0,
    }))
    .sort((a, b) => a.agentKind.localeCompare(b.agentKind));
}

export function scoreSuite(
  cases: EvalCase[],
  evidence: Map<string, RunEvidence>,
  meta: { startedAt: string; finishedAt: string; notes?: Map<string, string> },
): Scorecard {
  const results = cases.map((c) => scoreCase(c, evidence.get(c.id) ?? null, meta.notes?.get(c.id)));
  const provider = [...evidence.values()][0]?.provider ?? "unknown";
  return {
    provider,
    startedAt: meta.startedAt,
    finishedAt: meta.finishedAt,
    cases: results,
    summary: {
      total: results.length,
      pass: results.filter((r) => r.status === "pass").length,
      fail: results.filter((r) => r.status === "fail").length,
      unverified: results.filter((r) => r.status === "unverified").length,
    },
    byAgent: scoreByAgent(cases, results, evidence),
  };
}

/**
 * The verdict a finished run is allowed to report. The one rule that matters most is in `verificationVerdict`:
 * only an explicit pass succeeds. A reviewer who said no and a reviewer that never ran both land on
 * `needs_review`, because work nobody reviewed must never be reported as finished.
 */
export function expectedRunStatus(evidenceRun: Pick<RunEvidence["run"], "status" | "result">): CheckStatus {
  const verification = (evidenceRun.result?.verification ?? null) as { passed?: boolean | null; verdict?: "passed" | "failed" | "unverified" | null } | null;
  const verdict = verificationVerdict(verification);
  const claimsSuccess = evidenceRun.status === "succeeded";
  if (claimsSuccess && verdict !== "passed") return "fail";
  if (!claimsSuccess && verdict === "passed") return "fail";
  return "pass";
}
