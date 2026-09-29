import { importanceBand, type MemoryKind } from "@steward/schema";
import type { Memory } from "./types";

/**
 * What the memory surface decides on its own, pure and unit-tested (ADR-0022).
 *
 * The page renders decisions; it does not make them. Which band an importance belongs to, how sure a confidence
 * is, how a memory's provenance reads in a sentence and whether a row is live, superseded or expired are all
 * computed here, so the same answer can be asserted without a browser — and the one thing the page must not do,
 * validate a correction against its own copy of the rules, never happens.
 */

/** The five bands as a form offers them: a named consequence rather than a raw number nobody can calibrate. */
export const IMPORTANCE_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 2, label: "Trivial" },
  { value: 4, label: "Minor" },
  { value: 6, label: "Notable" },
  { value: 8, label: "Important" },
  { value: 10, label: "Critical" },
];

/** The label a band prints, capitalized for a badge. */
export function importanceLabel(importance: number): string {
  const band = importanceBand(importance);
  return band.charAt(0).toUpperCase() + band.slice(1);
}

export function confidenceLabel(confidence: number): string {
  if (confidence >= 0.85) return "Confident";
  if (confidence >= 0.55) return "Probable";
  return "Uncertain";
}

/** Where a memory came from, in one sentence a founder can read. */
export function describeProvenance(memory: Pick<Memory, "sourceType" | "confirmations" | "correctedAt">): string {
  if (memory.confirmations > 0) return "Confirmed by a person";
  if (memory.correctedAt) return "Corrected by a person";
  return memory.sourceType === "user" ? "Written by the founder" : memory.sourceType === "agent" ? "Learned by an agent" : "Recorded from a run";
}

export type MemoryState = "live" | "superseded" | "expired";

/** Whether a memory is retrieved, replaced, or has quietly lapsed. Superseded wins over expired: it was replaced first. */
export function memoryState(memory: Pick<Memory, "supersededBy" | "expiresAt">, now = Date.now()): MemoryState {
  if (memory.supersededBy) return "superseded";
  if (memory.expiresAt && Date.parse(memory.expiresAt) <= now) return "expired";
  return "live";
}

/** How long an automatic memory has left, in a phrase. `null` when it does not expire. */
export function expirySentence(memory: Pick<Memory, "expiresAt">, now = Date.now()): string | null {
  if (!memory.expiresAt) return null;
  const days = Math.ceil((Date.parse(memory.expiresAt) - now) / 86_400_000);
  if (days <= 0) return "expired";
  if (days === 1) return "expires tomorrow unless confirmed";
  return `expires in ${days} days unless confirmed`;
}

/** The kinds a person may file, in the order the form offers them. `entity` is deliberately absent: who and what a
 * name refers to is the graph's job (ADR-0022 §5), not a second kind of memory. */
export const MEMORY_KIND_CHOICES: ReadonlyArray<{ value: MemoryKind; label: string }> = [
  { value: "knowledge", label: "Knowledge" },
  { value: "decision", label: "Decision" },
  { value: "episodic", label: "Episodic" },
  { value: "performance", label: "Performance" },
  { value: "working", label: "Working" },
  { value: "conversation", label: "Conversation" },
];

/** Confirm, correct, supersede and merge are members' acts; forgetting is an administrator's (ADR-0022 §4). */
export function memoryVerbs(canManage: boolean): { canConfirm: boolean; canCorrect: boolean; canForget: boolean } {
  return { canConfirm: true, canCorrect: true, canForget: canManage };
}
