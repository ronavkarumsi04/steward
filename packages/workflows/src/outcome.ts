/**
 * What a finished iteration means, in one place.
 *
 * This lives outside the workflow on purpose. The Temporal workflow is not the only thing that drives a run:
 * the eval harness and any in-process driver follow the same sequence, and if they disagreed with the
 * workflow about what a verdict means, the disagreement would be about whether work was actually reviewed —
 * the one thing this product must never get wrong. `endingFor` is that agreement.
 */
import { verificationVerdict } from "@steward/schema";
import type { IterationOutcome, Verification } from "./types.js";

export type RunFinalStatus = "succeeded" | "needs_review" | "failed" | "cancelled";

export type RunEnding =
  | { action: "finish"; status: RunFinalStatus; finalText?: string; error?: string; verification?: Verification | null }
  /** Worth trying again: a provider outage, a rate limit. The workflow retries; a driver retries it too. */
  | { action: "retry"; error: string }
  /** The run is not finished — it paused for an approval, or it has more work to do. */
  | { action: "continue" };

/**
 * Only an explicit pass by the reviewer may be called a success. A reviewer who said no and a reviewer that
 * never ran both mean the work has not been cleared, so both route to a human.
 */
export function statusForVerification(verification: Verification | null | undefined): "succeeded" | "needs_review" {
  return verificationVerdict(verification) === "passed" ? "succeeded" : "needs_review";
}

/** How many times a retryable provider failure may be retried before the run is reported as failed. */
export const MAX_PROVIDER_RETRIES = 4;

/**
 * Maps an iteration outcome — together with the review, when the iteration was the last one — to what the run
 * should do next. `needs_approval` is reported as `continue` because pausing is handled by the caller, which
 * owns the waiting and the resumption.
 */
export function endingFor(outcome: IterationOutcome, verification?: Verification | null): RunEnding {
  switch (outcome.kind) {
    case "done":
      return { action: "finish", status: statusForVerification(verification), finalText: outcome.finalText, verification };
    case "budget_exhausted":
      return { action: "finish", status: "needs_review", finalText: `Stopped: ${outcome.detail}`, error: outcome.detail };
    case "failed":
      return outcome.retryable ? { action: "retry", error: outcome.error } : { action: "finish", status: "failed", error: outcome.error };
    case "needs_approval":
    case "continue":
      return { action: "continue" };
  }
}
