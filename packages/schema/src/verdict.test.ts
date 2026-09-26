import { describe, expect, it } from "vitest";
import { canTransitionRun, isTerminalRunStatus, verificationVerdict } from "./index.js";

/**
 * Verification semantics. `passed: false` and "we could not review this at all" are different facts, and only
 * one of them means the work was checked. These tests exist because the old fallback reported `passed: true`
 * after a verification crash — a run nobody reviewed could be reported as finished.
 */
describe("verification verdicts", () => {
  it("derives the verdict from `passed` for records written before the field existed", () => {
    expect(verificationVerdict({ passed: true })).toBe("passed");
    expect(verificationVerdict({ passed: false })).toBe("failed");
  });

  it("treats a crashed verification as unverified, never as passed", () => {
    expect(verificationVerdict({ passed: false, verdict: "unverified" })).toBe("unverified");
  });

  it("never grants a pass without evidence", () => {
    expect(verificationVerdict({ verdict: "passed" })).toBe("unverified");
    expect(verificationVerdict({ verdict: "passed", passed: false })).toBe("failed");
    expect(verificationVerdict({ verdict: "failed", passed: true })).toBe("failed");
    expect(verificationVerdict(null)).toBe("unverified");
    expect(verificationVerdict(undefined)).toBe("unverified");
  });

  it("keeps an explicit unverified verdict even if a score was recorded", () => {
    expect(verificationVerdict({ passed: true, verdict: "unverified" })).toBe("unverified");
  });
});

/**
 * The run state machine. It is deliberately narrow: it forbids the transitions that are always wrong, while
 * leaving the execution phases free to interleave.
 */
describe("run state machine", () => {
  it("lets a finished run stay finished", () => {
    for (const from of ["succeeded", "failed", "cancelled"] as const) {
      expect(isTerminalRunStatus(from)).toBe(true);
      expect(canTransitionRun(from, from)).toBe(true); // idempotent re-write: activity retries are normal
      expect(canTransitionRun(from, "executing")).toBe(false);
    }
    // A run that failed cannot be rewritten as a success, and vice versa.
    expect(canTransitionRun("failed", "succeeded")).toBe(false);
    expect(canTransitionRun("cancelled", "succeeded")).toBe(false);
  });

  it("allows the phases a real run moves through", () => {
    expect(canTransitionRun("queued", "building_context")).toBe(true);
    expect(canTransitionRun("executing", "waiting_approval")).toBe(true);
    expect(canTransitionRun("waiting_approval", "executing")).toBe(true);
    expect(canTransitionRun("verifying", "needs_review")).toBe(true);
    expect(canTransitionRun("needs_review", "executing")).toBe(true);
    expect(canTransitionRun("verifying", "succeeded")).toBe(true);
  });

  it("does not let a run be pushed back to the queue once it has started working", () => {
    expect(canTransitionRun("needs_review", "queued")).toBe(false);
  });
});
