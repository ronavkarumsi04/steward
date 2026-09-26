import { describe, expect, it } from "vitest";
import { endingFor, statusForVerification } from "./outcome.js";
import type { IterationOutcome } from "./types.js";

/**
 * The rules that decide what a finished run is called. These are pure, and they are shared with every
 * in-process driver, so a change here is a change to what the product is allowed to claim — which is why they
 * are pinned one case at a time rather than covered incidentally by a workflow that needs a Temporal server.
 */
describe("what a verdict means", () => {
  it("succeeds only on an explicit pass", () => {
    expect(statusForVerification({ passed: true, verdict: "passed", score: 92, summary: "ok", unmet: [], followUps: [] })).toBe("succeeded");
  });

  it("sends a refusal to a human", () => {
    expect(statusForVerification({ passed: false, verdict: "failed", score: 10, summary: "not done", unmet: ["criteria"], followUps: [] })).toBe("needs_review");
  });

  it("sends a review that never ran to a human", () => {
    expect(statusForVerification({ passed: false, verdict: "unverified", score: 0, summary: "verification could not be completed", unmet: [], followUps: [] })).toBe("needs_review");
  });

  it("grants nothing to a missing verdict", () => {
    expect(statusForVerification(null)).toBe("needs_review");
    expect(statusForVerification(undefined)).toBe("needs_review");
  });
});

describe("what an iteration outcome means", () => {
  const done: IterationOutcome = { kind: "done", finalText: "finished" };

  it("finishes a completed iteration with the review's verdict", () => {
    const ending = endingFor(done, { passed: true, verdict: "passed", score: 90, summary: "ok", unmet: [], followUps: [] });
    expect(ending).toMatchObject({ action: "finish", status: "succeeded", finalText: "finished" });
  });

  it("stops an exhausted budget for a human, saying what stopped it", () => {
    const ending = endingFor({ kind: "budget_exhausted", detail: "Run budget of $0.00 reached" });
    expect(ending).toMatchObject({ action: "finish", status: "needs_review", error: "Run budget of $0.00 reached", finalText: "Stopped: Run budget of $0.00 reached" });
  });

  it("retries a failure that is worth retrying and reports one that is not", () => {
    expect(endingFor({ kind: "failed", error: "transient upstream failure", retryable: true })).toEqual({ action: "retry", error: "transient upstream failure" });
    expect(endingFor({ kind: "failed", error: "invalid API key", retryable: false })).toMatchObject({ action: "finish", status: "failed", error: "invalid API key" });
  });

  it("treats a pause and a continuing run as unfinished", () => {
    expect(endingFor({ kind: "continue" })).toEqual({ action: "continue" });
    expect(endingFor({ kind: "needs_approval", approvalId: "a1", toolCallId: "c1", toolName: "email.send" })).toEqual({ action: "continue" });
  });
});
