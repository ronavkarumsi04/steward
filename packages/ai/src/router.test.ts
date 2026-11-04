import { describe, expect, it } from "vitest";
import { SEED_MODELS } from "./catalog.js";
import { estimateCost } from "./gateway.js";
import type { ModelInfo } from "@steward/schema";
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

describe("planRoutes with live-listed models", () => {
  const listed = (id: string): ModelInfo => ({
    id,
    provider: "nvidia",
    displayName: id,
    tier: "standard",
    deprecated: false,
    local: false,
    capabilities: { contextWindow: 32_768, inputModalities: ["text"], outputModalities: ["text"], tools: true, structuredOutput: true, reasoning: false, streaming: true, vision: false },
  });
  const nim: Candidate[] = [
    { credentialId: "n1", provider: "nvidia", model: listed("01-ai/yi-large"), priority: 100, healthy: true },
    { credentialId: "n1", provider: "nvidia", model: listed("adept/fuyu-8b"), priority: 100, healthy: true },
    { credentialId: "n1", provider: "nvidia", model: model("nvidia", "z-ai/glm-5.3-flash"), priority: 100, healthy: true },
    { credentialId: "n1", provider: "nvidia", model: model("nvidia", "deepseek-ai/deepseek-v4.1-flash"), priority: 100, healthy: true },
  ];
  it("ranks curated seed models ahead of models only known from the live listing", () => {
    for (const preference of ["balanced", "cost", "quality", "latency"] as const) {
      const routes = planRoutes({ fallbackChain: [], requirements: { preference } }, nim).map((r) => r.model);
      expect(routes.slice(0, 2).sort()).toEqual(["deepseek-ai/deepseek-v4.1-flash", "z-ai/glm-5.3-flash"]);
      expect(routes).toHaveLength(4);
    }
  });
  it("keeps the qualified default first for balanced routing", () => {
    expect(planRoutes({ fallbackChain: [], requirements: { preference: "balanced" } }, nim)[0]!.model).toBe("z-ai/glm-5.3-flash");
  });
  it("leaves listing-only models out once three qualified routes are healthy", () => {
    const enough: Candidate[] = [
      ...nim,
      { credentialId: "n1", provider: "nvidia", model: model("nvidia", "nvidia/nemotron-3-ultra-550b-a55b"), priority: 100, healthy: true },
    ];
    const routes = planRoutes({ fallbackChain: [], requirements: { preference: "balanced" } }, enough).map((r) => r.model);
    expect(routes).toHaveLength(3);
    expect(routes.every((m) => !m.startsWith("01-ai/") && !m.startsWith("adept/"))).toBe(true);
    // One qualified route degraded: the listing is a last resort again, after the healthy qualified ones.
    const oneDown = enough.map((c) => (c.model.id === "z-ai/glm-5.3-flash" ? { ...c, healthy: false } : c));
    const again = planRoutes({ fallbackChain: [], requirements: { preference: "balanced" } }, oneDown).map((r) => r.model);
    expect(again).toHaveLength(5);
    expect(again.slice(0, 2).sort()).toEqual(["deepseek-ai/deepseek-v4.1-flash", "nvidia/nemotron-3-ultra-550b-a55b"]);
    expect(again[4]).toBe("z-ai/glm-5.3-flash");
  });
  it("still prefers an unknown healthy model over a curated unhealthy one", () => {
    const degraded = nim.map((c) => (c.model.curated ? { ...c, healthy: false } : c));
    expect(planRoutes({ fallbackChain: [], requirements: { preference: "balanced" } }, degraded)[0]!.model).toBe("01-ai/yi-large");
  });
});

describe("estimateCost", () => {
  it("accounts for cached tokens", () => {
    const m = model("openai", "gpt-5");
    const { costUsd } = estimateCost(m, { inputTokens: 1_000_000, outputTokens: 0, cachedTokens: 500_000 });
    expect(costUsd).toBeCloseTo(0.5 * 1.25 + 0.5 * 0.125, 6);
  });
});
