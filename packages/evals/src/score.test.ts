import { describe, expect, it } from "vitest";
import { everyExecutedCallCarriesItsPolicyDecision, toolDenied, unmetCriteriaRecorded, verificationSummaryMentions, verifiedSuccessOnly } from "./checks.js";
import { expectedRunStatus, scoreByAgent, scoreCase, scoreSuite } from "./score.js";
import { isGreen, renderScorecard } from "./report.js";
import type { EvalCase, RunEvidence } from "./types.js";

function evidence(over: Partial<RunEvidence> = {}): RunEvidence {
  return {
    run: {
      id: "run-1",
      status: "succeeded",
      intent: "Write the positioning document",
      agentKind: "marketing",
      agentName: "Growth Marketer",
      costUsd: "0.0042",
      iterations: 3,
      error: null,
      plannedSteps: ["Write positioning doc"],
      successCriteria: ["Positioning document exists"],
      result: { verification: { passed: true, verdict: "passed", summary: "Document written." } },
      taskId: "task-1",
      workflowId: "run-run-1",
      startedAt: "2026-09-26T12:00:00.000Z",
      finishedAt: "2026-09-26T12:01:00.000Z",
      ...(over.run ?? {}),
    },
    steps: [{ kind: "verification", title: "Verify against success criteria", status: "succeeded", error: null }],
    toolCalls: [{ toolName: "document.write", status: "succeeded", risk: "LOW", policyDecision: { decision: "allow", reason: "internal action without external side effects" }, approvalId: null, output: "Written." }],
    aiCalls: [{ purpose: "chat", provider: "stub", model: "stub-1", costUsd: "0.0042", inputTokens: 120, outputTokens: 40, status: "ok", retries: 0 }],
    approvals: [],
    artifacts: [{ kind: "document", title: "Positioning" }],
    decisions: [{ title: "Target customer", rationale: "They handle messy exports daily." }],
    events: [],
    task: { id: "task-1", title: "Write copy", status: "review", assigneeAgentId: "agent-1" },
    followUpTasks: [],
    memory: [{ kind: "episodic", title: "Growth Marketer: write", createdByRunId: "run-1" }],
    provider: "scripted-document",
    ...over,
  };
}

const oneCheck = (assess: () => { ok: boolean | null; detail: string }): EvalCase => ({
  id: "case-1",
  title: "Case one",
  proves: "something",
  setup: { backend: "scripted-document", autonomyLevel: 2, agentKind: "marketing", instruction: "do it" },
  expect: [{ name: "the check", assess }],
});

describe("scoring a case", () => {
  it("passes only when every check can answer yes", () => {
    const result = scoreCase(oneCheck(() => ({ ok: true, detail: "found it" })), evidence());
    expect(result.status).toBe("pass");
    expect(result.checks).toEqual([{ name: "the check", status: "pass", detail: "found it" }]);
    expect(result.runId).toBe("run-1");
  });

  it("can never pass on an unverifiable check, however green the rest is", () => {
    const twoChecks: EvalCase = {
      ...oneCheck(() => ({ ok: true, detail: "found it" })),
      expect: [
        { name: "known good", assess: () => ({ ok: true, detail: "yes" }) },
        { name: "cannot tell", assess: () => ({ ok: null, detail: "the record does not contain a verification record" }) },
      ],
    };
    const result = scoreCase(twoChecks, evidence());
    expect(result.status).toBe("unverified");
    expect(result.checks.map((c) => c.status)).toEqual(["pass", "unverified"]);
  });

  it("lets a failure outrank an unverifiable check", () => {
    const mixed: EvalCase = {
      ...oneCheck(() => ({ ok: true, detail: "yes" })),
      expect: [
        { name: "broken", assess: () => ({ ok: false, detail: "the run claims success unreviewed" }) },
        { name: "cannot tell", assess: () => ({ ok: null, detail: "missing" }) },
      ],
    };
    expect(scoreCase(mixed, evidence()).status).toBe("fail");
  });

  it("reports a case with no evidence as unverified rather than inventing an outcome", () => {
    const result = scoreCase(oneCheck(() => ({ ok: true, detail: "yes" })), null, "the harness could not start the run");
    expect(result.status).toBe("unverified");
    expect(result.note).toBe("the harness could not start the run");
    expect(result.checks[0]!.detail).toContain("could not start the run");
    expect(result.provider).toBe("unknown");
  });

  it("treats a case with no checks as unverified, not as vacuously true", () => {
    expect(scoreCase({ ...oneCheck(() => ({ ok: true, detail: "" })), expect: [] }, evidence()).status).toBe("unverified");
  });
});

describe("the rule that success needs a reviewer", () => {
  it("refuses a succeeded run whose stored verification does not pass", () => {
    const bad = evidence({ run: { ...evidence().run, result: { verification: { passed: false, verdict: "failed" } } } });
    expect(verifiedSuccessOnly.assess(bad)).toMatchObject({ ok: false });
  });

  it("refuses a succeeded run with no verification at all", () => {
    const bad = evidence({ run: { ...evidence().run, result: {} } });
    expect(verifiedSuccessOnly.assess(bad).ok).toBeNull();
  });

  it("refuses a passed review that the run did not act on", () => {
    const bad = evidence({ run: { ...evidence().run, status: "needs_review" } });
    expect(verifiedSuccessOnly.assess(bad)).toMatchObject({ ok: false });
  });

  it("accepts the two honest combinations, checked and not-successful", () => {
    expect(verifiedSuccessOnly.assess(evidence()).ok).toBe(true);
    const stopped = evidence({ run: { ...evidence().run, status: "needs_review", result: { verification: { passed: false, verdict: "unverified" } } } });
    expect(verifiedSuccessOnly.assess(stopped).ok).toBe(true);
  });

  it("maps verdicts to the statuses a finished run may report", () => {
    expect(expectedRunStatus({ status: "succeeded", result: { verification: { passed: true, verdict: "passed" } } })).toBe("pass");
    expect(expectedRunStatus({ status: "succeeded", result: { verification: { passed: false, verdict: "unverified" } } })).toBe("fail");
    expect(expectedRunStatus({ status: "needs_review", result: { verification: { passed: true, verdict: "passed" } } })).toBe("fail");
  });
});

describe("checks that read the record rather than the run", () => {
  it("requires the denial to carry a reason", () => {
    const bare = evidence({ toolCalls: [{ toolName: "email.send", status: "denied", risk: "HIGH", policyDecision: null, approvalId: null, output: "" }] });
    expect(toolDenied("email.send").assess(bare)).toMatchObject({ ok: false });
    const explained = evidence({ toolCalls: [{ toolName: "email.send", status: "denied", risk: "HIGH", policyDecision: { decision: "deny", reason: "Company is in read-only mode (autonomy level 0)" }, approvalId: null, output: "" }] });
    expect(toolDenied("email.send").assess(explained)).toMatchObject({ ok: true });
  });

  it("fails the audit trail when an executed call has no policy decision", () => {
    const half = evidence({
      toolCalls: [
        { toolName: "document.write", status: "succeeded", risk: "LOW", policyDecision: { decision: "allow", reason: "internal" }, approvalId: null, output: "" },
        { toolName: "email.send", status: "succeeded", risk: "HIGH", policyDecision: null, approvalId: null, output: "" },
      ],
    });
    const verdict = everyExecutedCallCarriesItsPolicyDecision.assess(half);
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toContain("email.send");
  });

  it("says what is missing instead of guessing", () => {
    expect(unmetCriteriaRecorded.assess(evidence({ run: { ...evidence().run, result: {} } })).ok).toBeNull();
    expect(verificationSummaryMentions(/could not be completed/i).assess(evidence({ run: { ...evidence().run, result: {} } })).ok).toBeNull();
  });
});

describe("the scorecard", () => {
  const cases: EvalCase[] = [
    { ...oneCheck(() => ({ ok: true, detail: "yes" })), id: "a" },
    { ...oneCheck(() => ({ ok: false, detail: "no" })), id: "b" },
  ];

  it("counts cases, rolls them up per agent and keeps the money honest", () => {
    const map = new Map<string, RunEvidence>([
      ["a", evidence({ run: { ...evidence().run, id: "run-a", costUsd: "0.0100", status: "succeeded" } })],
      ["b", evidence({ run: { ...evidence().run, id: "run-b", costUsd: "0.0300", status: "needs_review" } })],
    ]);
    const card = scoreSuite(cases, map, { startedAt: "t0", finishedAt: "t1" });
    expect(card.summary).toEqual({ total: 2, pass: 1, fail: 1, unverified: 0 });
    expect(card.provider).toBe("scripted-document");
    const agent = card.byAgent[0]!;
    expect(agent).toMatchObject({ agentKind: "marketing", cases: 2, pass: 1, fail: 1, verifiedSuccesses: 1, stoppedForAHuman: 1, meanCostUsd: 0.02 });
  });

  it("is never green while anything is unverified", () => {
    const map = new Map<string, RunEvidence>([["a", evidence()], ["b", evidence()]]);
    const partial = scoreSuite([cases[0]!, { ...cases[1]!, expect: [{ name: "unknown", assess: () => ({ ok: null, detail: "cannot tell" }) }] }], map, { startedAt: "t0", finishedAt: "t1" });
    expect(partial.summary.unverified).toBe(1);
    expect(isGreen(partial)).toBe(false);
  });

  it("names the backend and says what a scripted run cannot prove", () => {
    const map = new Map<string, RunEvidence>([["a", evidence()], ["b", evidence()]]);
    const card = scoreSuite(cases, map, { startedAt: "t0", finishedAt: "t1" });
    const text = renderScorecard(card);
    expect(text).toContain("scripted provider");
    expect(text).toContain("say nothing about model quality");
    expect(text).toContain("✗ b — Case one");

    const live = renderScorecard({ ...card, provider: "openai/gpt-5" });
    expect(live).toContain("a live provider");
    expect(live).not.toContain("scripted provider");
  });

  it("renders markdown that can be pasted into a report", () => {
    const map = new Map<string, RunEvidence>([["a", evidence()], ["b", evidence()]]);
    const md = renderScorecard(scoreSuite(cases, map, { startedAt: "t0", finishedAt: "t1" }), { format: "markdown" });
    expect(md).toContain("| agent | cases | pass |");
    expect(md).toContain("<details><summary>");
  });

  it("rolls an agent with no evidence into an explicit unknown rather than dropping it", () => {
    const results = scoreByAgent(cases, [scoreCase(cases[0]!, null), scoreCase(cases[1]!, null)], new Map());
    expect(results).toEqual([expect.objectContaining({ agentKind: "unknown", cases: 2, unverified: 2 })]);
  });
});
