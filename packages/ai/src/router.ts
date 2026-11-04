import { TIER_ORDER, type ModelInfo, type RoutingPolicy, type RoutingRequirements } from "@steward/schema";

export interface Candidate {
  credentialId: string;
  provider: string;
  model: ModelInfo;
  priority: number; // lower = preferred (credential priority)
  healthy: boolean;
}

export interface RouteChoice {
  credentialId: string;
  provider: string;
  model: string;
  reason: string;
}

const LATENCY_RANK: Record<string, number> = {
  groq: 0,
  cerebras: 0,
  sambanova: 1,
  fireworks: 1,
  together: 2,
  openai: 2,
  gemini: 2,
  xai: 2,
  anthropic: 3,
  bedrock: 3,
  vertex: 3,
  deepseek: 4,
  openrouter: 3,
  codex_companion: 5,
};

export function meetsRequirements(model: ModelInfo, req: RoutingRequirements): string | null {
  const c = model.capabilities;
  if (c.outputModalities.includes("embedding")) return "embedding model";
  if (req.tools && !c.tools) return "no tool support";
  if (req.structuredOutput && !c.structuredOutput) return "no structured output";
  if (req.vision && !c.vision) return "no vision";
  if (req.reasoning && !c.reasoning) return "no reasoning";
  if (req.minContextTokens && c.contextWindow < req.minContextTokens) return `context ${c.contextWindow} < ${req.minContextTokens}`;
  if (req.minTier && TIER_ORDER[model.tier] < TIER_ORDER[req.minTier]) return `tier ${model.tier} below ${req.minTier}`;
  if (req.localOnly && !model.local) return "not local";
  if (model.deprecated) return "deprecated";
  return null;
}

function estimatedCostPerMTok(m: ModelInfo): number {
  if (!m.pricing) return m.local ? 0 : 5;
  return m.pricing.inputPerMTok * 0.75 + m.pricing.outputPerMTok * 0.25;
}

/**
 * Produces an ordered list of routes: explicit selection first, then fallback chain, then requirement-driven ranking.
 * Unhealthy candidates are demoted, never removed (they can recover).
 */
export function planRoutes(policy: RoutingPolicy, candidates: Candidate[]): RouteChoice[] {
  const req = policy.requirements;
  const out: RouteChoice[] = [];
  const seen = new Set<string>();
  const push = (c: Candidate, reason: string) => {
    const key = `${c.credentialId}:${c.model.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ credentialId: c.credentialId, provider: c.provider, model: c.model.id, reason });
  };
  const find = (provider: string, model: string) => candidates.filter((c) => c.provider === provider && c.model.id === model).sort((a, b) => Number(b.healthy) - Number(a.healthy) || a.priority - b.priority);

  if (policy.explicit) for (const c of find(policy.explicit.provider, policy.explicit.model)) push(c, "explicit selection");
  for (const f of policy.fallbackChain) for (const c of find(f.provider, f.model)) push(c, "fallback chain");

  const eligible = candidates
    .map((c) => ({ c, why: meetsRequirements(c.model, req) }))
    .filter((x) => x.why === null)
    .map((x) => x.c);

  const score = (c: Candidate): number => {
    const tier = TIER_ORDER[c.model.tier];
    const cost = estimatedCostPerMTok(c.model);
    const latency = LATENCY_RANK[c.provider] ?? 3;
    let s: number;
    switch (req.preference) {
      case "quality":
        s = -tier * 100 + cost;
        break;
      case "cost":
        s = cost * 10 - tier;
        break;
      case "latency":
        s = latency * 100 + cost - tier;
        break;
      default:
        s = -tier * 20 + cost * 2 + latency * 5;
    }
    // Models we only know from a provider's live listing have guessed capabilities and no pricing, so
    // they all tie; without this they would be tried in listing (alphabetical) order ahead of the
    // models Steward has actually qualified. Still above unhealthy routes: unknown beats known-broken.
    if (!c.model.curated) s += 1_000;
    if (!c.healthy) s += 10_000;
    return s + c.priority / 1000;
  };
  eligible.sort((a, b) => score(a) - score(b));
  for (const c of eligible) push(c, `${req.preference} routing${req.localOnly ? " (local-only)" : ""}${c.healthy ? "" : " (degraded)"}`);
  return out;
}

export function explainRejections(policy: RoutingPolicy, candidates: Candidate[]): Array<{ provider: string; model: string; reason: string }> {
  return candidates
    .map((c) => ({ provider: c.provider, model: c.model.id, reason: meetsRequirements(c.model, policy.requirements) }))
    .filter((x): x is { provider: string; model: string; reason: string } => x.reason !== null);
}
