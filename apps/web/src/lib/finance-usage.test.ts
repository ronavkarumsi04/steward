import { describe, expect, it } from "vitest";
import type { UsageRow } from "@/lib/types";
import { splitUsage } from "./finance-usage";

const row = (model: string, o: Partial<UsageRow>): UsageRow =>
  ({ provider: "nvidia", model, calls: 1, errors: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, ...o }) as UsageRow;

describe("splitUsage", () => {
  it("puts the model that cost the most first, then the one with more calls when costs tie", () => {
    const { usage } = splitUsage([
      row("cheap-busy", { calls: 40, inputTokens: 10, costUsd: 0.01 }),
      row("pricey", { calls: 2, inputTokens: 10, costUsd: 1.5 }),
      row("free-busy", { calls: 28, inputTokens: 10, costUsd: 0 }),
      row("free-quiet", { calls: 1, inputTokens: 10, costUsd: 0 }),
    ]);
    expect(usage.map((r) => r.model)).toEqual(["pricey", "cheap-busy", "free-busy", "free-quiet"]);
  });

  it("folds rows that only errored and never produced a token", () => {
    const { usage, neverAnswered } = splitUsage([
      row("worked-with-errors", { calls: 28, errors: 9, inputTokens: 139526, outputTokens: 4911 }),
      row("listing-only", { calls: 1, errors: 1 }),
      row("dead", { calls: 3, errors: 3 }),
    ]);
    expect(usage.map((r) => r.model)).toEqual(["worked-with-errors"]);
    expect(neverAnswered.map((r) => r.model)).toEqual(["dead", "listing-only"]);
  });

  it("keeps a row that errored but still produced output in the main list", () => {
    const { usage, neverAnswered } = splitUsage([row("partial", { calls: 2, errors: 2, outputTokens: 5 })]);
    expect(usage).toHaveLength(1);
    expect(neverAnswered).toHaveLength(0);
  });

  it("returns two empty lists for no usage", () => {
    expect(splitUsage([])).toEqual({ usage: [], neverAnswered: [] });
  });
});
