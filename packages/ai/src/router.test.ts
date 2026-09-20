import { describe, expect, it } from "vitest";
import { SEED_MODELS } from "./catalog.js";
import { estimateCost } from "./gateway.js";
import { planRoutes, type Candidate } from "./router.js";

const model = (provider: string, id: string) => SEED_MODELS.find((m) => m.provider === provider && m.id === id)!;
const cands: Candidate[] = [
  { credentialId: "c1", provider: "openai", model: model("openai", "gpt-5"), priority: 100, healthy: true },
  { credentialId: "c1", provider: "openai", model: model("openai", "gpt-5-nano"), priority: 100, healthy: true },
  { credentialId: "c1", provider: "openai", model: model("openai", "text-embedding-3-small"), priority: 100, healthy: true },
  { credentialId: "c2", provider: "anthropic", model: model("anthropic", "claude-sonnet-4-5"), priority: 50, healthy: false },
  { credentialId: "c3", provider: "groq", model: model("groq", "llama-3.3-70b-versatile"), priority: 100, healthy: true },
];

describe("planRoutes", () => {
  it("puts explicit selection first and fallback chain next", () => {
    const routes = planRoutes({ explicit: { provider: "groq", model: "llama-3.3-70b-versatile" }, fallbackChain: [{ provider: "openai", model: "gpt-5-nano" }], requirements: { preference: "balanced" } }, cands);
    expect(routes[0]).toMatchObject({ provider: "groq", reason: "explicit selection" });
    expect(routes[1]).toMatchObject({ model: "gpt-5-nano", reason: "fallback chain" });
    expect(routes.some((r) => r.model === "text-embedding-3-small")).toBe(false);
  });
  it("prefers cheap models with cost preference and frontier with quality", () => {
    const cost = planRoutes({ fallbackChain: [], requirements: { preference: "cost" } }, cands);
    expect(cost[0]!.model).toBe("gpt-5-nano");
    const quality = planRoutes({ fallbackChain: [], requirements: { preference: "quality" } }, cands);
    expect(quality[0]!.model).toBe("gpt-5");
  });
  it("demotes unhealthy credentials and honors requirements", () => {
    const r = planRoutes({ fallbackChain: [], requirements: { preference: "quality", minTier: "premium" } }, cands);
    expect(r.map((x) => x.model)).toEqual(["gpt-5", "claude-sonnet-4-5"]);
    const local = planRoutes({ fallbackChain: [], requirements: { preference: "balanced", localOnly: true } }, cands);
    expect(local).toHaveLength(0);
  });
});

describe("estimateCost", () => {
  it("accounts for cached tokens", () => {
    const m = model("openai", "gpt-5");
    const { costUsd } = estimateCost(m, { inputTokens: 1_000_000, outputTokens: 0, cachedTokens: 500_000 });
    expect(costUsd).toBeCloseTo(0.5 * 1.25 + 0.5 * 0.125, 6);
  });
});
