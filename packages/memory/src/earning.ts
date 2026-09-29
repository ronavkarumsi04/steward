import { importanceBand, verificationVerdict, type Actor, type ImportanceBand, type MemorySource } from "@steward/schema";

/**
 * What makes a memory worth keeping, as a decision with no database in it (ADR-0022).
 *
 * `importance` and `confidence` are different questions and this file keeps them apart: importance is the
 * *consequence* of the fact being true (1–10, shown as a band), confidence is *how sure the writer is* (0–1).
 * Retrieval multiplies the two, so a confident, consequential fact outranks a shaky one with the same words.
 *
 * Nothing here reads a row. The rule table, the weights and the seeding are pure so they can be argued about and
 * tested on their own — a memory policy buried in a query is a policy nobody can hold to.
 */

export const MAX_IMPORTANCE = 10;
export const MIN_IMPORTANCE = 1;

/** How much a band moves a result, relative to 1. A doubt and a certainty are not the same claim. */
const BAND_WEIGHT: Record<ImportanceBand, number> = {
  trivial: 0.9,
  minor: 0.96,
  notable: 1.02,
  important: 1.1,
  critical: 1.2,
};

/** The consequence of a memory, as a multiplier a ranking can use. */
export function importanceWeight(importance: number): number {
  return BAND_WEIGHT[importanceBand(importance)];
}

/** Certainty is a multiplier too, but a floor of 0.6: an unsure memory is down-weighted, never erased. */
export function confidenceWeight(confidence: number): number {
  const c = Math.min(1, Math.max(0, confidence));
  return 0.6 + 0.4 * c;
}

export const CONFIDENCE_BANDS = ["uncertain", "probable", "confident"] as const;
export type ConfidenceBand = (typeof CONFIDENCE_BANDS)[number];

/** How sure the writer is, in a word a surface can print. Thresholds are inclusive at the top of each band. */
export function confidenceBand(confidence: number): ConfidenceBand {
  const c = Math.min(1, Math.max(0, confidence));
  if (c >= 0.85) return "confident";
  if (c >= 0.55) return "probable";
  return "uncertain";
}

/**
 * Where a memory's confidence starts, from who wrote it.
 *
 * A person typing a fact is stating it; an agent through the tool is asserting it; a run is being inferred from.
 * Those are three different amounts of evidence and the number follows the source rather than a default nobody
 * chose.
 */
export function seedConfidence(source: MemorySource): number {
  return source === "user" ? 0.9 : source === "agent" ? 0.7 : 0.5;
}

/** What a source says, in one sentence a founder can read. */
export function describeSource(source: MemorySource): string {
  return source === "user" ? "Written by the founder" : source === "agent" ? "Learned by an agent" : "Recorded automatically from a run";
}

/** How long an automatic memory lives before a person has to confirm it. */
export const AUTO_TTL_DAYS = 21;

/** The expiry a write should carry, or `null` for a deliberate write that never lapses (ADR-0022 §2). */
export function expiryFor(source: MemorySource, now = new Date()): Date | null {
  if (source !== "auto") return null;
  return new Date(now.getTime() + AUTO_TTL_DAYS * 86_400_000);
}

/** The slice of a run's outcome the earning rule reads. Kept structural so the runtime and tests share one shape. */
export interface RunOutcome {
  status: "succeeded" | "failed" | "needs_review" | "cancelled";
  verification?: { passed?: boolean | null; verdict?: "passed" | "failed" | "unverified" | null; followUps?: unknown[] } | null;
}

export type EarningDecision =
  | { remember: false; reason: string }
  | { remember: true; kind: "episodic"; confidence: number; importance: number; ttlDays: number; reason: string };

/**
 * Whether a run's outcome earns a place in memory (ADR-0022 §1).
 *
 * The load-bearing answer is the "no" on the happy path: a run that went as planned and produced nothing anyone
 * can point at is already recorded as a run, and copying its summary into memory only competes with the facts a
 * person wrote. What is worth keeping is a *surprise* — a failure, a review, a follow-up — which is exactly the
 * thing nobody writes down by hand.
 */
export function earningRule(outcome: RunOutcome): EarningDecision {
  if (outcome.status === "cancelled") return { remember: false, reason: "A cancelled run is not an outcome worth remembering." };
  const verdict = verificationVerdict(outcome.verification);
  const followUps = outcome.verification?.followUps?.length ?? 0;

  if (outcome.status === "succeeded" && verdict === "passed") {
    if (followUps > 0) return { remember: true, kind: "episodic", confidence: 0.6, importance: 4, ttlDays: AUTO_TTL_DAYS, reason: "It passed and produced follow-up work, so what it found will be needed again." };
    return { remember: false, reason: "It passed verification and changed nothing anyone can point at; the run is its own record." };
  }
  if (outcome.status === "failed") return { remember: true, kind: "episodic", confidence: 0.5, importance: 3, ttlDays: AUTO_TTL_DAYS, reason: "It failed, and a failure is the expensive lesson nobody writes down by hand." };
  // needs_review, or a success whose verification did not pass or did not happen.
  return { remember: true, kind: "episodic", confidence: 0.5, importance: 3, ttlDays: AUTO_TTL_DAYS, reason: "It ended without a clean verification, which is worth carrying forward until it is confirmed or expires." };
}

/** The combination that gives reciprocal-rank fusion a memory-aware score (ADR-0022 §3). */
export interface ScoreInput {
  rrf: number;
  importance: number;
  confidence: number;
  createdAt: Date;
  now: number;
}

export function scoreMemory(input: ScoreInput): number {
  const ageDays = (input.now - input.createdAt.getTime()) / 86_400_000;
  const recency = 1 + Math.max(0, 0.1 - ageDays / 3650);
  return input.rrf * importanceWeight(input.importance) * confidenceWeight(input.confidence) * recency;
}

/** Which source a scope's actor writes as, when the caller does not say. */
export function sourceForActor(actor: Actor): MemorySource {
  if (actor.type === "user") return "user";
  if (actor.type === "agent") return "agent";
  return "auto";
}
