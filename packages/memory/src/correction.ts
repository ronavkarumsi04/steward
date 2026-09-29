import type { Actor } from "@steward/schema";

/**
 * The five verbs that correct a memory, and the rules they share (ADR-0022 §4).
 *
 * Memory uses the knowledge graph's own vocabulary — confirm, correct, supersede, merge, forget — rather than
 * inventing a second one, so a founder learns one set of moves for both surfaces. This file holds the validation
 * those verbs need and the one authorization rule that has nothing to do with roles: an agent may only correct
 * what its own runs wrote.
 */

export const MEMORY_LIMITS = {
  titleChars: 200,
  contentChars: 20_000,
  tags: 20,
  tagChars: 50,
} as const;

export type MemoryErrorCode = "not_found" | "invalid" | "conflict" | "forbidden";

export class MemoryError extends Error {
  constructor(
    readonly code: MemoryErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "MemoryError";
  }
}

export interface MemoryProblem {
  code: string;
  field: string;
  message: string;
}

/** What a correction may change. Kind is included because a memory can be reclassified; scope is not, because
 * moving a fact between agents is a different act and belongs in its own decision rather than a text edit. */
export interface MemoryPatch {
  title?: string;
  content?: string;
  kind?: string;
  importance?: number;
  tags?: string[];
  aboutEntityId?: string | null;
}

/**
 * Reads a correction the way the service will store it, and answers with the problems a person would have to fix
 * rather than throwing on the first one. The surface renders this list against the field each problem names, and
 * the service refuses with the same list, so the two cannot drift.
 */
export function validateMemoryPatch(patch: MemoryPatch, opts: { kinds: readonly string[] } = { kinds: [] }): MemoryProblem[] {
  const problems: MemoryProblem[] = [];
  const bad = (code: string, field: string, message: string) => problems.push({ code, field, message });

  if (patch.title !== undefined) {
    if (patch.title.length > MEMORY_LIMITS.titleChars) bad("title_too_long", "title", `Keep the title to ${MEMORY_LIMITS.titleChars} characters.`);
  }
  if (patch.content !== undefined) {
    if (!patch.content.trim()) bad("content_empty", "content", "A memory has to say something.");
    else if (patch.content.length > MEMORY_LIMITS.contentChars) bad("content_too_long", "content", `Keep the memory to ${MEMORY_LIMITS.contentChars} characters.`);
  }
  if (patch.kind !== undefined) {
    if (!opts.kinds.includes(patch.kind)) bad("kind_unknown", "kind", `“${patch.kind}” is not a kind of memory this product keeps.`);
  }
  if (patch.importance !== undefined) {
    if (!Number.isInteger(patch.importance) || patch.importance < 1 || patch.importance > 10) bad("importance_range", "importance", "Importance is a whole number from 1 to 10.");
  }
  if (patch.tags !== undefined) {
    if (patch.tags.length > MEMORY_LIMITS.tags) bad("too_many_tags", "tags", `At most ${MEMORY_LIMITS.tags} tags.`);
    for (const [index, tag] of patch.tags.entries()) if (tag.length > MEMORY_LIMITS.tagChars) bad("tag_too_long", "tags", `Tag ${index + 1} is longer than ${MEMORY_LIMITS.tagChars} characters.`);
  }
  return problems;
}

/**
 * Whether this actor may correct this memory (ADR-0022 §4).
 *
 * A person may correct anything the company holds. An agent may correct only what its own run wrote — a run
 * fixing its own mistake is the point of the verb, and a run silently rewriting the founder's facts is the
 * failure this whole feature exists to prevent. Forgetting is never an agent's act and is not offered here.
 */
export function mayCorrect(actor: Actor, memory: { createdByRunId: string | null }): boolean {
  if (actor.type !== "agent") return true;
  return Boolean(memory.createdByRunId) && memory.createdByRunId === actor.runId;
}

/** The version a correction or merge writes down before it changes anything. */
export interface RevisionDraft {
  title: string;
  content: string;
  reason: "corrected" | "superseded" | "merged";
}

/** The revision that records what a row said before a correction replaced it. */
export function revisionFor(row: { title: string; content: string }, reason: RevisionDraft["reason"]): RevisionDraft {
  return { title: row.title, content: row.content, reason };
}
