/**
 * What the Memory tab decides on its own (ADR-0022).
 *
 * The page renders decisions rather than making them, so the sentences, the bands and the lifecycle read here are
 * asserted without a browser. In particular, `entity` must not be offered as a kind: identity belongs to the
 * knowledge graph, and offering a second home for it is the duplication this feature removes.
 */
import { describe, expect, it } from "vitest";
import { IMPORTANCE_OPTIONS, MEMORY_KIND_CHOICES, confidenceLabel, describeProvenance, expirySentence, importanceLabel, memoryState, memoryVerbs } from "./memory";
import type { Memory } from "./types";

const memory = (over: Partial<Memory>): Pick<Memory, "sourceType" | "confirmations" | "correctedAt" | "supersededBy" | "expiresAt"> => ({
  sourceType: "auto",
  confirmations: 0,
  correctedAt: null,
  supersededBy: null,
  expiresAt: null,
  ...over,
});

describe("importance is a band a founder can calibrate", () => {
  it("names the band a number falls in", () => {
    expect(importanceLabel(2)).toBe("Trivial");
    expect(importanceLabel(6)).toBe("Notable");
    expect(importanceLabel(10)).toBe("Critical");
  });

  it("offers one choice per band, on the column's own 1–10 scale", () => {
    expect(IMPORTANCE_OPTIONS).toHaveLength(5);
    for (const option of IMPORTANCE_OPTIONS) {
      expect(Number.isInteger(option.value)).toBe(true);
      expect(option.value).toBeGreaterThanOrEqual(1);
      expect(option.value).toBeLessThanOrEqual(10);
    }
  });
});

describe("certainty reads as a word, not a bare decimal", () => {
  it("bands confidence", () => {
    expect(confidenceLabel(0.9)).toBe("Confident");
    expect(confidenceLabel(0.7)).toBe("Probable");
    expect(confidenceLabel(0.2)).toBe("Uncertain");
  });
});

describe("provenance is a sentence, not a badge", () => {
  it("says who is saying so", () => {
    expect(describeProvenance(memory({ sourceType: "user" }))).toContain("founder");
    expect(describeProvenance(memory({ sourceType: "agent" }))).toContain("agent");
    expect(describeProvenance(memory({ sourceType: "auto" }))).toContain("run");
  });

  it("says a person confirmed or corrected it when they did", () => {
    expect(describeProvenance(memory({ sourceType: "auto", confirmations: 1 }))).toContain("Confirmed");
    expect(describeProvenance(memory({ sourceType: "auto", correctedAt: "2026-01-01T00:00:00Z" }))).toContain("Corrected");
  });
});

describe("a memory's life", () => {
  it("is live, replaced, or lapsed — and a replacement wins over a lapse", () => {
    const now = Date.parse("2026-09-28T00:00:00Z");
    expect(memoryState(memory({}), now)).toBe("live");
    expect(memoryState(memory({ expiresAt: "2026-09-01T00:00:00Z" }), now)).toBe("expired");
    expect(memoryState(memory({ supersededBy: "m2", expiresAt: "2026-09-01T00:00:00Z" }), now)).toBe("superseded");
  });

  it("says how long an automatic memory has, and nothing when it does not expire", () => {
    const now = Date.parse("2026-09-28T00:00:00Z");
    expect(expirySentence(memory({}), now)).toBeNull();
    expect(expirySentence(memory({ expiresAt: new Date(now + 3 * 86_400_000).toISOString() }), now)).toContain("3 days");
  });
});

describe("the kind catalog", () => {
  it("does not offer entity — identity belongs to the graph", () => {
    expect(MEMORY_KIND_CHOICES.map((k) => k.value)).not.toContain("entity");
  });

  it("lets a member confirm and correct, and only an administrator forget", () => {
    expect(memoryVerbs(false)).toMatchObject({ canConfirm: true, canCorrect: true, canForget: false });
    expect(memoryVerbs(true).canForget).toBe(true);
  });
});
