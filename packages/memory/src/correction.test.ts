/**
 * The correction vocabulary, tested on its own (ADR-0022 §4).
 *
 * A correction an agent may not make, and a correction this product cannot hold, are both refusals that a surface
 * has to render — so the rules are pure and asserted here rather than inferred from a route's status code.
 */
import { describe, expect, it } from "vitest";
import { MEMORY_LIMITS, mayCorrect, revisionFor, validateMemoryPatch } from "./correction.js";

const KINDS = ["knowledge", "decision", "episodic", "performance", "working", "conversation"];

describe("a correction this product can hold", () => {
  it("accepts a well-formed patch", () => {
    expect(validateMemoryPatch({ title: "Pricing", content: "We charge $49.", importance: 8, tags: ["pricing"], kind: "decision" }, { kinds: KINDS })).toEqual([]);
  });

  it("refuses an empty memory and a kind this build does not keep", () => {
    const problems = validateMemoryPatch({ content: "   ", kind: "entity" }, { kinds: KINDS });
    expect(problems.map((p) => p.code)).toEqual(["content_empty", "kind_unknown"]);
    // Each problem names the field the surface has to mark up.
    expect(problems.every((p) => typeof p.field === "string")).toBe(true);
  });

  it("holds importance to the column's own scale — whole numbers 1 to 10", () => {
    expect(validateMemoryPatch({ importance: 5 }, { kinds: KINDS })).toEqual([]);
    expect(validateMemoryPatch({ importance: 0.8 }, { kinds: KINDS }).map((p) => p.code)).toEqual(["importance_range"]);
    expect(validateMemoryPatch({ importance: 11 }, { kinds: KINDS }).map((p) => p.code)).toEqual(["importance_range"]);
  });

  it("bounds the title, the content and the tags", () => {
    const problems = validateMemoryPatch({ title: "x".repeat(MEMORY_LIMITS.titleChars + 1), content: "y".repeat(MEMORY_LIMITS.contentChars + 1), tags: Array.from({ length: MEMORY_LIMITS.tags + 1 }, () => "t") }, { kinds: KINDS });
    expect(problems.map((p) => p.code).sort()).toEqual(["content_too_long", "title_too_long", "too_many_tags"]);
  });
});

describe("who may correct a memory", () => {
  it("lets a person correct anything the company holds", () => {
    expect(mayCorrect({ type: "user", userId: "u1" }, { createdByRunId: "run-from-someone-else" })).toBe(true);
  });

  it("lets an agent correct only what its own run wrote", () => {
    const actor = { type: "agent" as const, agentId: "a1", runId: "run1" };
    expect(mayCorrect(actor, { createdByRunId: "run1" })).toBe(true);
    expect(mayCorrect(actor, { createdByRunId: "run2" })).toBe(false);
    expect(mayCorrect(actor, { createdByRunId: null })).toBe(false);
  });

  it("keeps the words a correction replaced, with the reason", () => {
    expect(revisionFor({ title: "Old", content: "before" }, "corrected")).toEqual({ title: "Old", content: "before", reason: "corrected" });
  });
});
