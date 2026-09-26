import { describe, expect, it } from "vitest";
import { inspectRun, modelAttempts, offsetLabel, readVerification } from "./run-inspection";
import type { AICall, Approval, Artifact, Run, RunDetail, RunStep, ToolCall } from "./types";

/**
 * The run inspector is the place a founder goes to find out what actually happened, so these tests pin the
 * rules that keep it honest: every entry maps to a stored row, a failure the run moved past is not reported
 * as the ending, and a run is only ever called a verified success when the stored verification says so.
 */
const START = Date.parse("2026-09-26T12:00:00.000Z");
const NOW = START + 10 * 60_000;
const at = (secondsAfterStart: number) => new Date(START + secondsAfterStart * 1000).toISOString();

function run(over: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    agentId: "agent-1",
    taskId: null,
    projectId: null,
    conversationId: null,
    trigger: { kind: "task" },
    status: "executing",
    intent: "Publish the launch post",
    plan: null,
    result: null,
    error: null,
    workflowId: "wf-1",
    costUsd: "0",
    inputTokens: 0,
    outputTokens: 0,
    iterations: 0,
    startedAt: at(0),
    finishedAt: null,
    createdAt: at(0),
    ...over,
  };
}

function step(over: Partial<RunStep> & { id: string; stepIndex: number }): RunStep {
  return {
    kind: "model_call",
    title: `step ${over.stepIndex}`,
    status: "succeeded",
    input: null,
    output: null,
    error: null,
    startedAt: at(over.stepIndex * 10),
    finishedAt: at(over.stepIndex * 10 + 5),
    durationMs: 5000,
    ...over,
  };
}

function call(over: Partial<AICall> & { id: string }): AICall {
  return {
    runId: "run-1",
    stepId: null,
    provider: "openai",
    model: "gpt-5",
    purpose: "chat",
    inputTokens: 100,
    outputTokens: 50,
    cachedTokens: 0,
    reasoningTokens: 0,
    latencyMs: 1200,
    costUsd: "0.0100",
    costEstimated: false,
    status: "ok",
    errorCode: null,
    retries: 0,
    routingReason: "cheapest capable model",
    createdAt: at(1),
    ...over,
  };
}

function tool(over: Partial<ToolCall> & { id: string }): ToolCall {
  return {
    stepId: null,
    toolName: "content.publish",
    input: { body: "hello" },
    output: null,
    status: "succeeded",
    risk: "MEDIUM",
    policyDecision: { decision: "require_approval", reason: "external side effect" },
    approvalId: null,
    durationMs: 300,
    createdAt: at(20),
    ...over,
  };
}

function approval(over: Partial<Approval> & { id: string }): Approval {
  return {
    runId: "run-1",
    taskId: null,
    agentId: "agent-1",
    action: "content.publish",
    reason: "Publishing is externally visible",
    payload: {},
    risk: "MEDIUM",
    dimension: "content",
    estimatedCostUsd: null,
    affectedSystem: "cms",
    alternatives: ["Publish to staging"],
    status: "pending",
    resolvedBy: null,
    resolution: null,
    resolvedAt: null,
    expiresAt: at(3 * 86_400),
    createdAt: at(20),
    ...over,
  };
}

function artifact(over: Partial<Artifact> & { id: string }): Artifact {
  return {
    runId: "run-1",
    taskId: null,
    projectId: null,
    kind: "document",
    title: "Launch post draft",
    url: null,
    content: null,
    mimeType: null,
    metadata: {},
    createdAt: at(30),
    ...over,
  };
}

function detail(over: Partial<RunDetail> = {}): RunDetail {
  return { run: run(), steps: [], aiCalls: [], toolCalls: [], artifacts: [], approvals: [], workflow: null, ...over };
}

const ids = (d: RunDetail) => inspectRun(d, { now: NOW, companyId: "co-1" }).timeline.map((e) => e.id);

/** Indexed access is checked in this repo, so tests that need the first match say so explicitly. */
function first<T>(items: T[]): T {
  const [head] = items;
  if (head === undefined) throw new Error("expected at least one entry");
  return head;
}

describe("run timeline", () => {
  it("puts every durable row on one line, in the order it happened", () => {
    const inspection = inspectRun(
      detail({
        steps: [step({ id: "s1", stepIndex: 0, kind: "context", title: "Build context" }), step({ id: "s2", stepIndex: 1, kind: "verification", title: "Verify", startedAt: at(120) })],
        aiCalls: [call({ id: "c1", stepId: "s1", createdAt: at(2) })],
        toolCalls: [tool({ id: "t1", createdAt: at(60) })],
        artifacts: [artifact({ id: "a1", createdAt: at(130) })],
        approvals: [approval({ id: "ap1", createdAt: at(61), status: "approved", resolvedAt: at(90) })],
      }),
      { now: NOW },
    );
    expect(inspection.timeline.map((e) => e.kind)).toEqual(["step", "model", "tool", "approval", "step", "artifact"]);
    expect(inspection.timeline.map((e) => e.offsetMs)).toEqual([0, 2000, 60_000, 61_000, 120_000, 130_000]);
    expect(ids(detail({ steps: [step({ id: "s1", stepIndex: 0 })] }))).toEqual(["step:s1"]);
  });

  it("orders rows that share a timestamp deterministically, steps before the rows inside them", () => {
    const build = () =>
      detail({
        steps: [step({ id: "s1", stepIndex: 0, startedAt: at(10) })],
        aiCalls: [call({ id: "c1", stepId: "s1", createdAt: at(10) })],
        toolCalls: [tool({ id: "t1", stepId: null, createdAt: at(10) })],
      });
    expect(ids(build())).toEqual(ids(build()));
    expect(ids(build())).toEqual(["step:s1", "call:c1", "tool:t1"]);
  });

  it("folds a tool step and its tool call into one entry without dropping either row", () => {
    const inspection = inspectRun(
      detail({
        steps: [step({ id: "s1", stepIndex: 1, kind: "tool_call", title: "Publish the post" })],
        toolCalls: [tool({ id: "t1", stepId: "s1", risk: "HIGH" })],
      }),
      { now: NOW },
    );
    expect(inspection.timeline).toHaveLength(1);
    const entry = first(inspection.timeline);
    expect(entry.kind).toBe("tool");
    expect(entry.title).toBe("Publish the post");
    expect(entry.risk).toBe("HIGH");
    expect(entry.mergedIds).toEqual(["step:s1", "tool:t1"]);
  });

  it("keeps a failing pair visible even when the step row reported success", () => {
    const inspection = inspectRun(
      detail({
        steps: [step({ id: "s1", stepIndex: 1, kind: "tool_call", status: "succeeded" })],
        toolCalls: [tool({ id: "t1", stepId: "s1", status: "denied" })],
      }),
      { now: NOW },
    );
    expect(inspection.timeline[0]).toMatchObject({ status: "denied", secondaryStatus: "succeeded", failed: true });
  });

  it("keeps a step that never got a tool call row as its own entry", () => {
    const inspection = inspectRun(
      detail({ steps: [step({ id: "s1", stepIndex: 2, kind: "tool_call", title: "email.send (unavailable)", status: "failed", error: "Tool email.send is not available to this agent." })] }),
      { now: NOW },
    );
    expect(inspection.timeline.map((e) => e.kind)).toEqual(["step"]);
    expect(first(inspection.timeline).error).toContain("not available");
  });

  it("nests model calls under the step they were made for, and lifts them when the step is folded away", () => {
    const inspection = inspectRun(
      detail({
        steps: [step({ id: "s1", stepIndex: 1, kind: "model_call" }), step({ id: "s2", stepIndex: 2, kind: "tool_call", title: "Send email" })],
        aiCalls: [call({ id: "c1", stepId: "s1" }), call({ id: "c2", stepId: "s2" }), call({ id: "c3", stepId: null })],
        toolCalls: [tool({ id: "t1", stepId: "s2" })],
      }),
      { now: NOW },
    );
    const byId = new Map(inspection.timeline.map((e) => [e.id, e]));
    expect(byId.get("call:c1")?.stepId).toBe("s1");
    expect(byId.get("call:c2")?.stepId).toBeNull();
    expect(byId.get("call:c3")?.stepId).toBeNull();
    expect(byId.get("step:s2")).toBeUndefined();
  });

  it("counts model attempts inside their step, so a retry reads as attempt 2 of 2", () => {
    const calls = [
      call({ id: "c1", stepId: "s1", createdAt: at(1) }),
      call({ id: "c2", stepId: "s1", createdAt: at(2), status: "error", errorCode: "invalid_json", retries: 1 }),
      call({ id: "c3", stepId: "s2", createdAt: at(3) }),
    ];
    const attempts = modelAttempts(calls);
    expect(attempts.get("c1")).toEqual({ attempt: 1, of: 2 });
    expect(attempts.get("c2")).toEqual({ attempt: 2, of: 2 });
    expect(attempts.get("c3")).toEqual({ attempt: 1, of: 1 });
    const entries = inspectRun(detail({ aiCalls: calls }), { now: NOW }).timeline;
    expect(entries.map((e) => `${e.attempt}/${e.attempts}`)).toEqual(["1/2", "2/2", "1/1"]);
  });
});

describe("run verdict", () => {
  it("calls a run a success only when the stored verification passed", () => {
    const inspection = inspectRun(
      detail({ run: run({ status: "succeeded", finishedAt: at(300), result: { summary: "Post is live", verification: { passed: true, verdict: "passed", score: 90, summary: "The post is published and reachable." } } }) }),
      { now: NOW },
    );
    expect(inspection.verdict.outcome).toBe("succeeded");
    expect(inspection.verdict.disagreement).toBeNull();
    expect(inspection.verdict.explanation).toContain("published and reachable");
  });

  it("refuses to call a run a success when nothing verified it", () => {
    const inspection = inspectRun(detail({ run: run({ status: "succeeded", finishedAt: at(300), result: { summary: "Post is live" } }) }), { now: NOW });
    expect(inspection.verdict.outcome).toBe("unverified");
    expect(inspection.verdict.headline).toMatch(/nothing verified it/i);
    expect(inspection.verdict.disagreement).toContain("succeeded");
    expect(inspection.verdict.disagreement).toContain("unverified");
  });

  it("reports a status that claims success above a failed verdict as needing review", () => {
    const inspection = inspectRun(
      detail({ run: run({ status: "succeeded", result: { verification: { passed: false, verdict: "failed", unmet: ["The post is not reachable"] } } }) }),
      { now: NOW },
    );
    expect(inspection.verdict.outcome).toBe("needs_review");
    expect(inspection.verdict.explanation).toContain("The post is not reachable");
  });

  it("reports where a failed run ended, using the last failure and not an earlier recovered one", () => {
    const inspection = inspectRun(
      detail({
        run: run({ status: "failed", error: "gateway: model did not return valid JSON", finishedAt: at(120) }),
        steps: [
          step({ id: "s1", stepIndex: 1, kind: "tool_call", title: "Fetch the site", status: "failed", error: "404", startedAt: at(10) }),
          step({ id: "s2", stepIndex: 2, kind: "model_call", title: "Try another route", startedAt: at(30) }),
          step({ id: "s3", stepIndex: 3, kind: "model_call", title: "Think (iteration 2)", status: "failed", error: "model did not return valid JSON", startedAt: at(60) }),
        ],
        toolCalls: [tool({ id: "t1", stepId: "s1", status: "failed" })],
      }),
      { now: NOW },
    );
    expect(inspection.verdict.outcome).toBe("failed");
    expect(inspection.verdict.blame?.title).toBe("Think (iteration 2)");
    const recovered = inspection.timeline.filter((e) => e.recovered);
    expect(recovered).toHaveLength(1);
    expect(first(recovered).title).toBe("Fetch the site");
    expect(inspection.totals.recovered).toBe(1);
  });

  it("does not blame a run that is still working, but does report its last failure", () => {
    const inspection = inspectRun(
      detail({
        steps: [step({ id: "s1", stepIndex: 1, kind: "tool_call", title: "Send the digest", status: "failed", error: "smtp timeout", startedAt: at(10), finishedAt: null, durationMs: null })],
        toolCalls: [tool({ id: "t1", stepId: "s1", status: "failed", createdAt: at(10) })],
      }),
      { now: NOW },
    );
    expect(inspection.verdict.outcome).toBe("running");
    expect(inspection.verdict.blame).toBeNull();
    expect(inspection.verdict.lastFailure?.error).toBe("smtp timeout");
    expect(inspection.verdict.explanation).toContain("last failure: Send the digest");
    expect(first(inspection.timeline).open).toBe(true);
  });

  it("does not read a successful model call inside a failed step as recovery", () => {
    // The real shape: the gateway recorded `ok` for a planning call while the step consuming it failed to
    // parse the output. The run did not carry on, so nothing here may be reported as recovered.
    const inspection = inspectRun(
      detail({
        run: run({ status: "failed", error: "gateway: Model did not return valid JSON", finishedAt: at(0.5) }),
        steps: [
          step({ id: "s0", stepIndex: 0, kind: "context", title: "Build context", startedAt: at(0), finishedAt: at(0.1) }),
          step({ id: "s1", stepIndex: 1, kind: "plan", title: "Plan the work", status: "failed", error: "Model did not return valid JSON", startedAt: at(0.2), finishedAt: at(0.3) }),
          step({ id: "s2", stepIndex: 2, kind: "error", title: "Run failed", status: "failed", error: "gateway: Model did not return valid JSON", startedAt: at(0.4), finishedAt: at(0.4) }),
        ],
        aiCalls: [call({ id: "c1", stepId: null, purpose: "planning", status: "ok", createdAt: at(0.25) })],
      }),
      { now: NOW },
    );
    expect(inspection.totals.failures).toBe(2);
    expect(inspection.totals.recovered).toBe(0);
    expect(inspection.verdict.blame?.title).toBe("Run failed");
  });

  it("names the pending approval and how long it has been waiting", () => {
    const inspection = inspectRun(
      detail({ run: run({ status: "waiting_approval" }), approvals: [approval({ id: "ap1", createdAt: at(-600), status: "pending" })] }),
      { now: NOW, companyId: "co-1" },
    );
    expect(inspection.verdict.outcome).toBe("waiting_approval");
    expect(inspection.verdict.blocker?.kind).toBe("approval");
    expect(inspection.verdict.blocker?.waitingMs).toBe(NOW - (START - 600_000));
    expect(inspection.verdict.blocker?.href).toBe("/app/c/co-1/approvals");
    expect(first(inspection.timeline).open).toBe(true);
  });

  it("says the approval queue is missing the row instead of implying the run is progressing", () => {
    const inspection = inspectRun(detail({ run: run({ status: "waiting_approval" }) }), { now: NOW });
    expect(inspection.verdict.blocker).toBeNull();
    expect(inspection.verdict.headline).toMatch(/not in the queue/i);
    expect(inspection.verdict.explanation).toContain("no pending approval row");
  });

  it("reports a budget stop from the reason that was recorded", () => {
    const inspection = inspectRun(detail({ run: run({ status: "waiting_budget", error: "AI budget exhausted for the month" }) }), { now: NOW, companyId: "co-1" });
    expect(inspection.verdict.outcome).toBe("waiting_budget");
    expect(inspection.verdict.explanation).toContain("AI budget exhausted");
    expect(inspection.verdict.blocker?.href).toBe("/app/c/co-1/finance");
  });

  it("summarises a review stop with the criteria the reviewer could not confirm", () => {
    const inspection = inspectRun(
      detail({ run: run({ status: "needs_review", finishedAt: at(500), result: { verification: { verdict: "unverified", summary: "Verification could not be completed (provider unreachable).", unmet: ["Reachability was never checked"] } } }) }),
      { now: NOW },
    );
    expect(inspection.verdict.outcome).toBe("needs_review");
    expect(inspection.verdict.blocker?.kind).toBe("review");
    expect(inspection.verdict.explanation).toBe("The reviewer left 1 unmet criterion: Reachability was never checked");
    expect(inspection.verdict.blocker?.waitingMs).toBe(NOW - (START + 500_000));
  });

  it("says a queued run was recorded and never started when no rows exist", () => {
    const inspection = inspectRun(detail({ run: run({ status: "queued", startedAt: null }) }), { now: NOW });
    expect(inspection.verdict.outcome).toBe("queued");
    expect(inspection.verdict.headline).toBe("Recorded, never started");
    expect(inspection.verdict.explanation).toContain("no steps, model calls or tool calls");
    expect(inspection.timeline).toEqual([]);
  });

  it("keeps a failure without any rows from inventing a cause", () => {
    const inspection = inspectRun(detail({ run: run({ status: "failed", finishedAt: at(30) }) }), { now: NOW });
    expect(inspection.verdict.blame).toBeNull();
    expect(inspection.verdict.explanation).toContain("no row carries the reason");
  });

  it("carries the cancellation reason a cancelled run recorded", () => {
    const inspection = inspectRun(detail({ run: run({ status: "cancelled", error: "Cancelled from dashboard", finishedAt: at(40) }) }), { now: NOW });
    expect(inspection.verdict.outcome).toBe("cancelled");
    expect(inspection.verdict.explanation).toBe("Cancelled from dashboard");
  });
});

describe("run measurements", () => {
  it("measures a live run against now and a finished run against its own finish", () => {
    expect(inspectRun(detail(), { now: NOW }).elapsedMs).toBe(600_000);
    expect(inspectRun(detail({ run: run({ status: "succeeded", finishedAt: at(90) }) }), { now: NOW }).elapsedMs).toBe(90_000);
    expect(inspectRun(detail(), { now: NOW }).running).toBe(true);
  });

  it("sums model cost and keeps the estimated part separate", () => {
    const inspection = inspectRun(
      detail({ aiCalls: [call({ id: "c1", costUsd: "0.02" }), call({ id: "c2", costUsd: "0.03", costEstimated: true })] }),
      { now: NOW },
    );
    expect(inspection.totals.modelUsd).toBeCloseTo(0.05, 6);
    expect(inspection.totals.estimatedUsd).toBeCloseTo(0.03, 6);
    expect(inspection.totals.inputTokens).toBe(200);
    expect(inspection.totals.outputTokens).toBe(100);
  });

  it("points at the slowest row and the most expensive model call", () => {
    const inspection = inspectRun(
      detail({
        steps: [step({ id: "s1", stepIndex: 1, title: "Write the post", durationMs: 21_000, startedAt: at(1) })],
        aiCalls: [call({ id: "c1", stepId: "s1", costUsd: "0.04" }), call({ id: "c2", stepId: "s1", costUsd: "0.11", createdAt: at(2) })],
      }),
      { now: NOW },
    );
    expect(inspection.slowest?.title).toBe("Write the post");
    expect(inspection.slowest?.durationMs).toBe(21_000);
    expect(inspection.dearest?.entryId).toBe("call:c2");
    expect(inspection.dearest?.costUsd).toBeCloseTo(0.11, 6);
  });

  it("counts only real rows as failures", () => {
    const inspection = inspectRun(
      detail({
        toolCalls: [tool({ id: "t1", status: "timed_out" }), tool({ id: "t2", status: "succeeded", createdAt: at(40) })],
        aiCalls: [call({ id: "c1", status: "error", errorCode: "rate_limit", createdAt: at(50) })],
      }),
      { now: NOW },
    );
    expect(inspection.totals.failures).toBe(2);
    expect(inspection.timeline.filter((e) => e.failed).map((e) => e.id)).toEqual(["tool:t1", "call:c1"]);
    // The timed-out tool is not the ending: a tool succeeded after it, so it reads as recovered.
    expect(inspection.totals.recovered).toBe(1);
    expect(inspection.timeline.find((e) => e.id === "tool:t1")?.recovered).toBe(true);
  });
});

describe("reading the stored verification", () => {
  it("treats a missing or unreadable record as unverified", () => {
    expect(readVerification(null).verdict).toBe("unverified");
    expect(readVerification({}).verdict).toBe("unverified");
    expect(readVerification({ verification: "passed" }).verdict).toBe("unverified");
  });

  it("lets a contradictory record only ever downgrade", () => {
    expect(readVerification({ verification: { verdict: "passed", passed: false } }).verdict).toBe("failed");
    expect(readVerification({ verification: { verdict: "passed" } }).verdict).toBe("unverified");
    expect(readVerification({ verification: { passed: true, verdict: "passed" } }).verdict).toBe("passed");
  });

  it("keeps the reviewer's own words and the criteria it could not confirm", () => {
    const read = readVerification({ verification: { passed: false, verdict: "failed", summary: "Not live yet", unmet: ["Post is not reachable", 7], score: 20 } });
    expect(read).toEqual({ verdict: "failed", summary: "Not live yet", unmet: ["Post is not reachable"], score: 20 });
  });
});

describe("offset labels", () => {
  it("reads a duration without arithmetic", () => {
    expect(offsetLabel(0)).toBe("0ms");
    expect(offsetLabel(87)).toBe("87ms");
    expect(offsetLabel(1400)).toBe("1s");
    expect(offsetLabel(45_000)).toBe("45s");
    expect(offsetLabel(134_000)).toBe("2m 14s");
    expect(offsetLabel(11_220_000)).toBe("3h 07m");
    expect(offsetLabel(187_200_000)).toBe("2d 4h");
    expect(offsetLabel(null)).toBe("—");
  });
});
