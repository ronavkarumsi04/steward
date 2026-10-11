import type { ModelInfo, RoutingPolicy } from "@steward/schema";
import { AnthropicAdapter } from "./adapters/anthropic.js";
import { BedrockAdapter } from "./adapters/bedrock.js";
import { CodexCompanionAdapter, type CompanionBridge } from "./adapters/codex-companion.js";
import { CohereAdapter } from "./adapters/cohere.js";
import { GeminiAdapter } from "./adapters/gemini.js";
import { OllamaAdapter } from "./adapters/ollama.js";
import { OpenAICompatibleAdapter } from "./adapters/openai-compatible.js";
import { providerTypeMap, seedModelsFor } from "./catalog.js";
import { ToolNameCodec } from "./toolnames.js";
import { planRoutes, type Candidate, type RouteChoice } from "./router.js";
import { ProviderError, type ChatEvent, type ChatRequest, type ChatResponse, type EmbedRequest, type EmbedResponse, type ProviderAdapter, type ProviderCredential, type Usage } from "./types.js";

export interface ResolvedCredential {
  id: string;
  providerType: string;
  credential: ProviderCredential;
  priority: number;
  enabled: boolean;
}

export interface UsageRecord {
  credentialId: string;
  provider: string;
  model: string;
  purpose: string;
  usage: Usage;
  latencyMs: number;
  costUsd: number;
  costEstimated: boolean;
  status: "ok" | "error";
  errorCode?: string;
  retries: number;
  routingReason: string;
  context?: Record<string, string | undefined>;
}

interface UsageAttempt {
  usage: Usage;
  latencyMs: number;
}

interface ExecutionResult<T> {
  result: T;
  usage: Usage;
  previousAttempts?: UsageAttempt[];
  latencyMs?: number;
}

type GatewayExecutionError = ProviderError & {
  usageAttempts?: UsageAttempt[];
  usageAttemptsComplete?: boolean;
};

export interface GatewayOptions {
  /** Loads enabled credentials for the calling tenant. */
  loadCredentials: () => Promise<ResolvedCredential[]>;
  /** Persist usage rows (ai_calls). Failures here are telemetry failures, never provider failures. */
  recordUsage: (rec: UsageRecord) => Promise<void>;
  /**
   * Called when telemetry (usage recording) fails. A model that answered successfully must not be reported as
   * a failed AI call because the ledger write failed — but a lost row also means unrecorded spend, so it is
   * surfaced to the caller (logged, counted) rather than swallowed.
   */
  onTelemetryError?: (input: { stage: string; error: unknown; record?: UsageRecord }) => void;
  companionBridge?: CompanionBridge;
  /** Optional model-catalog cache keyed by credential id. */
  modelCache?: Map<string, { at: number; models: ModelInfo[] }>;
  modelCacheTtlMs?: number;
  maxAttemptsPerRoute?: number;
  now?: () => number;
}

export interface GatewayCallOptions {
  policy: RoutingPolicy;
  purpose?: string;
  context?: Record<string, string | undefined>;
}

/**
 * Records usage without letting a bookkeeping failure change the outcome of the provider call. The distinction
 * matters: "the model failed" and "we failed to write down what the model cost" need different responses, and
 * only the first should trigger a retry or fail a run.
 */
async function recordUsageSafely(opts: GatewayOptions, rec: UsageRecord): Promise<void> {
  try {
    await opts.recordUsage(rec);
  } catch (error) {
    opts.onTelemetryError?.({ stage: "record_usage", error, record: rec });
  }
}

export function createAdapter(providerType: string, credential: ProviderCredential, bridge?: CompanionBridge): ProviderAdapter {
  const info = providerTypeMap.get(providerType);
  if (!info) throw new ProviderError("invalid_request", `Unknown provider type ${providerType}`, providerType, false);
  switch (info.protocol) {
    case "anthropic":
      return new AnthropicAdapter(credential);
    case "gemini":
      return new GeminiAdapter(credential, "gemini");
    case "vertex":
      return new GeminiAdapter(credential, "vertex");
    case "bedrock":
      return new BedrockAdapter(credential);
    case "cohere":
      return new CohereAdapter(credential);
    case "ollama":
      return new OllamaAdapter(credential);
    case "companion_codex":
      if (!bridge) throw new ProviderError("unsupported", "Companion bridge not configured", providerType, false);
      return new CodexCompanionAdapter(credential, bridge);
    default:
      return new OpenAICompatibleAdapter(credential, providerType);
  }
}

export function estimateCost(model: ModelInfo | undefined, usage: Usage): { costUsd: number; estimated: boolean } {
  if (!model?.pricing) return { costUsd: 0, estimated: true };
  const p = model.pricing;
  const cached = usage.cachedTokens ?? 0;
  const uncached = Math.max(0, usage.inputTokens - cached);
  const cost = (uncached * p.inputPerMTok + cached * (p.cachedInputPerMTok ?? p.inputPerMTok) + usage.outputTokens * p.outputPerMTok) / 1_000_000;
  return { costUsd: Number(cost.toFixed(8)), estimated: p.estimated };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Provider-neutral entry point. Resolves credentials → catalog → route plan, executes with retries and fallback,
 * and records every attempt in the usage ledger.
 */
export class AIGateway {
  private readonly health = new Map<string, { failures: number; until: number }>();
  private readonly modelCache: Map<string, { at: number; models: ModelInfo[] }>;

  constructor(private readonly opts: GatewayOptions) {
    this.modelCache = opts.modelCache ?? new Map();
  }

  private now() {
    return (this.opts.now ?? Date.now)();
  }

  adapterFor(c: ResolvedCredential): ProviderAdapter {
    return createAdapter(c.providerType, c.credential, this.opts.companionBridge);
  }

  async modelsFor(c: ResolvedCredential, force = false): Promise<ModelInfo[]> {
    const ttl = this.opts.modelCacheTtlMs ?? 10 * 60_000;
    const hit = this.modelCache.get(c.id);
    if (!force && hit && this.now() - hit.at < ttl) return hit.models;
    const models = await this.adapterFor(c).listModels();
    this.modelCache.set(c.id, { at: this.now(), models });
    return models;
  }

  async candidates(): Promise<{ creds: Map<string, ResolvedCredential>; candidates: Candidate[] }> {
    const creds = (await this.opts.loadCredentials()).filter((c) => c.enabled);
    const map = new Map(creds.map((c) => [c.id, c]));
    const candidates: Candidate[] = [];
    await Promise.all(
      creds.map(async (c) => {
        let models: ModelInfo[];
        try {
          models = await this.modelsFor(c);
        } catch (e) {
          // Live discovery failed (network, bad key, provider down). Fall back to the cached or seeded
          // catalog so the real error surfaces at call time as an auth/network ProviderError instead
          // of the credential silently vanishing from routing.
          models = this.modelCache.get(c.id)?.models ?? seedModelsFor(c.providerType);
          this.lastDiscoveryError.set(c.id, e instanceof Error ? e.message : String(e));
        }
        const h = this.health.get(c.id);
        const healthy = !h || h.until < this.now();
        for (const m of models) candidates.push({ credentialId: c.id, provider: c.providerType, model: m, priority: c.priority, healthy });
      }),
    );
    return { creds: map, candidates };
  }

  async plan(policy: RoutingPolicy): Promise<{ routes: RouteChoice[]; creds: Map<string, ResolvedCredential>; candidates: Candidate[] }> {
    const { creds, candidates } = await this.candidates();
    return { routes: planRoutes(policy, candidates), creds, candidates };
  }

  private readonly lastDiscoveryError = new Map<string, string>();

  private noRouteDetail(candidates: Candidate[], creds: Map<string, ResolvedCredential>): string {
    if (candidates.length) return "No configured model satisfies the routing requirements";
    if (!creds.size) return "No AI provider credentials are configured";
    const errs = [...creds.keys()].map((id) => this.lastDiscoveryError.get(id)).filter(Boolean);
    return errs.length ? `Configured providers returned no models: ${errs.join("; ")}` : "Configured providers returned no models";
  }

  private markFailure(credentialId: string, err: ProviderError) {
    const h = this.health.get(credentialId) ?? { failures: 0, until: 0 };
    h.failures += 1;
    const base = err.code === "rate_limit" ? (err.retryAfterMs ?? 15_000) : err.code === "auth" || err.code === "quota" ? 5 * 60_000 : 30_000;
    h.until = this.now() + Math.min(base * Math.min(h.failures, 4), 10 * 60_000);
    this.health.set(credentialId, h);
  }

  private markSuccess(credentialId: string) {
    this.health.delete(credentialId);
  }

  private async execute<T>(
    req: { model?: string; signal?: AbortSignal },
    opts: GatewayCallOptions,
    fn: (adapter: ProviderAdapter, route: RouteChoice, model: ModelInfo | undefined) => Promise<ExecutionResult<T>>,
  ): Promise<T & { route: RouteChoice }> {
    const { routes, creds, candidates } = await this.plan(opts.policy);
    if (!routes.length) {
      const detail = this.noRouteDetail(candidates, creds);
      throw new ProviderError("unsupported", detail, "gateway", false);
    }
    const maxAttempts = this.opts.maxAttemptsPerRoute ?? 2;
    let lastErr: ProviderError | undefined;
    const deadCreds = new Set<string>();
    for (const route of routes) {
      const cred = creds.get(route.credentialId);
      if (!cred || deadCreds.has(cred.id)) continue;
      const model = candidates.find((c) => c.credentialId === route.credentialId && c.model.id === route.model)?.model;
      const adapter = this.adapterFor(cred);
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (req.signal?.aborted) throw new ProviderError("unknown", "aborted", route.provider, false);
        const started = this.now();
        try {
          const { result, usage, previousAttempts = [], latencyMs: resultLatencyMs } = await fn(adapter, route, model);
          for (const [index, previous] of previousAttempts.entries()) {
            const { costUsd, estimated } = estimateCost(model, previous.usage);
            await recordUsageSafely(this.opts, { credentialId: cred.id, provider: route.provider, model: route.model, purpose: opts.purpose ?? "chat", usage: previous.usage, latencyMs: previous.latencyMs, costUsd, costEstimated: estimated, status: "ok", retries: attempt + index, routingReason: route.reason, context: opts.context });
          }
          const { costUsd, estimated } = estimateCost(model, usage);
          await recordUsageSafely(this.opts, { credentialId: cred.id, provider: route.provider, model: route.model, purpose: opts.purpose ?? "chat", usage, latencyMs: resultLatencyMs ?? this.now() - started, costUsd, costEstimated: estimated, status: "ok", retries: attempt + previousAttempts.length, routingReason: route.reason, context: opts.context });
          this.markSuccess(cred.id);
          return Object.assign(result as object, { route }) as T & { route: RouteChoice };
        } catch (e) {
          const err = e instanceof ProviderError ? e : new ProviderError("unknown", e instanceof Error ? e.message : String(e), route.provider, false);
          lastErr = err;
          const executionError = err as GatewayExecutionError;
          for (const [index, previous] of (executionError.usageAttempts ?? []).entries()) {
            const { costUsd, estimated } = estimateCost(model, previous.usage);
            await recordUsageSafely(this.opts, { credentialId: cred.id, provider: route.provider, model: route.model, purpose: opts.purpose ?? "chat", usage: previous.usage, latencyMs: previous.latencyMs, costUsd, costEstimated: estimated, status: "ok", retries: attempt + index, routingReason: route.reason, context: opts.context });
          }
          if (!executionError.usageAttemptsComplete) {
            await recordUsageSafely(this.opts, { credentialId: cred.id, provider: route.provider, model: route.model, purpose: opts.purpose ?? "chat", usage: { inputTokens: 0, outputTokens: 0 }, latencyMs: this.now() - started, costUsd: 0, costEstimated: true, status: "error", errorCode: err.code, retries: attempt + (executionError.usageAttempts?.length ?? 0), routingReason: route.reason, context: opts.context });
          }
          if (err.code === "invalid_request" || err.code === "content_filter" || err.code === "context_length") {
            // Not a provider health problem; move to the next route without penalizing.
            break;
          }
          this.markFailure(cred.id, err);
          if (err.code === "auth" || err.code === "quota") deadCreds.add(cred.id);
          if (!err.retryable || attempt === maxAttempts - 1) break;
          await sleep(Math.min(err.retryAfterMs ?? 500 * 2 ** attempt, 20_000));
        }
      }
    }
    throw lastErr ?? new ProviderError("unknown", "All routes failed", "gateway", false);
  }

  async chat(req: Omit<ChatRequest, "model"> & { model?: string }, opts: GatewayCallOptions): Promise<ChatResponse & { route: RouteChoice }> {
    const codec = new ToolNameCodec(req.tools);
    const encoded = codec.encodeRequest(req);
    return this.execute(encoded, opts, async (adapter, route, model) => {
      const firstStarted = this.now();
      const first = codec.decodeResponse(await adapter.chat({ ...encoded, model: route.model }));
      const firstLatencyMs = this.now() - firstStarted;
      const requestedMaxTokens = encoded.maxTokens;
      const reasoningTokens = first.usage.reasoningTokens ?? 0;
      const shouldRetry =
        requestedMaxTokens !== undefined &&
        first.text.trim() === "" &&
        first.toolCalls.length === 0 &&
        first.finishReason === "length" &&
        first.usage.outputTokens > 0 &&
        reasoningTokens >= first.usage.outputTokens * 0.8;

      if (!shouldRetry) return { result: first, usage: first.usage, latencyMs: firstLatencyMs };

      const retryMaxTokens = Math.min(Math.max(requestedMaxTokens * 4, 4096), model?.capabilities.maxOutputTokens ?? 16384);
      const retryStarted = this.now();
      let retry: ChatResponse;
      try {
        retry = codec.decodeResponse(await adapter.chat({ ...encoded, model: route.model, maxTokens: retryMaxTokens }));
      } catch (e) {
        const error = e instanceof ProviderError ? e : new ProviderError("unknown", e instanceof Error ? e.message : String(e), route.provider, false);
        const executionError = error as GatewayExecutionError;
        executionError.usageAttempts = [{ usage: first.usage, latencyMs: firstLatencyMs }];
        throw executionError;
      }
      const retryLatencyMs = this.now() - retryStarted;

      if (retry.text.trim() === "" && retry.toolCalls.length === 0) {
        const error = new ProviderError("invalid_request", `Model used its entire ${retryMaxTokens}-token output budget on reasoning and returned no answer`, route.provider, false) as GatewayExecutionError;
        error.usageAttempts = [
          { usage: first.usage, latencyMs: firstLatencyMs },
          { usage: retry.usage, latencyMs: retryLatencyMs },
        ];
        error.usageAttemptsComplete = true;
        throw error;
      }

      return { result: retry, usage: retry.usage, previousAttempts: [{ usage: first.usage, latencyMs: firstLatencyMs }], latencyMs: retryLatencyMs };
    });
  }

  /** Streams events; the final `done` event carries the full response. Falls back to other routes only before first token. */
  async *stream(req: Omit<ChatRequest, "model"> & { model?: string }, opts: GatewayCallOptions): AsyncIterable<ChatEvent & { route?: RouteChoice }> {
    const { routes, creds, candidates } = await this.plan(opts.policy);
    if (!routes.length) throw new ProviderError("unsupported", this.noRouteDetail(candidates, creds), "gateway", false);
    const codec = new ToolNameCodec(req.tools);
    const encoded = codec.encodeRequest(req);
    let lastErr: ProviderError | undefined;
    const deadCreds = new Set<string>();
    for (const route of routes) {
      const cred = creds.get(route.credentialId);
      if (!cred || deadCreds.has(cred.id)) continue;
      const model = candidates.find((c) => c.credentialId === route.credentialId && c.model.id === route.model)?.model;
      const adapter = this.adapterFor(cred);
      const started = this.now();
      let emitted = false;
      let usage: Usage = { inputTokens: 0, outputTokens: 0 };
      try {
        for await (const raw of adapter.stream({ ...encoded, model: route.model })) {
          const ev = codec.decodeEvent(raw);
          if (ev.type === "error") throw ev.error;
          if (ev.type === "usage") usage = ev.usage;
          if (ev.type === "done") {
            usage = ev.response.usage.inputTokens || ev.response.usage.outputTokens ? ev.response.usage : usage;
            const { costUsd, estimated } = estimateCost(model, usage);
            await recordUsageSafely(this.opts, { credentialId: cred.id, provider: route.provider, model: route.model, purpose: opts.purpose ?? "chat", usage, latencyMs: this.now() - started, costUsd, costEstimated: estimated, status: "ok", retries: 0, routingReason: route.reason, context: opts.context });
            this.markSuccess(cred.id);
            yield { ...ev, response: { ...ev.response, usage }, route };
            return;
          }
          emitted = true;
          yield { ...ev, route };
        }
        return;
      } catch (e) {
        const err = e instanceof ProviderError ? e : new ProviderError("unknown", e instanceof Error ? e.message : String(e), route.provider, false);
        lastErr = err;
        await recordUsageSafely(this.opts, { credentialId: cred.id, provider: route.provider, model: route.model, purpose: opts.purpose ?? "chat", usage: { inputTokens: 0, outputTokens: 0 }, latencyMs: this.now() - started, costUsd: 0, costEstimated: true, status: "error", errorCode: err.code, retries: 0, routingReason: route.reason, context: opts.context });
        if (!["invalid_request", "content_filter", "context_length"].includes(err.code)) this.markFailure(cred.id, err);
        if (emitted) {
          yield { type: "error", error: err, route };
          return;
        }
      }
    }
    throw lastErr ?? new ProviderError("unknown", "All routes failed", "gateway", false);
  }

  async embed(req: Omit<EmbedRequest, "model"> & { model?: string }, opts: GatewayCallOptions): Promise<EmbedResponse & { route: RouteChoice }> {
    const { creds, candidates } = await this.candidates();
    const embedCandidates = candidates.filter((c) => c.model.capabilities.outputModalities.includes("embedding") && (!opts.policy.requirements.localOnly || c.model.local));
    const explicit = opts.policy.explicit;
    const ordered = explicit ? [...embedCandidates.filter((c) => c.provider === explicit.provider && c.model.id === explicit.model), ...embedCandidates] : embedCandidates;
    ordered.sort((a, b) => Number(b.healthy) - Number(a.healthy) || a.priority - b.priority);
    let lastErr: ProviderError | undefined;
    for (const c of ordered) {
      const cred = creds.get(c.credentialId)!;
      const adapter = this.adapterFor(cred);
      if (!adapter.embed) continue;
      const started = this.now();
      try {
        const res = await adapter.embed({ ...req, model: c.model.id });
        const { costUsd, estimated } = estimateCost(c.model, res.usage);
        await recordUsageSafely(this.opts, { credentialId: cred.id, provider: c.provider, model: c.model.id, purpose: opts.purpose ?? "embedding", usage: res.usage, latencyMs: this.now() - started, costUsd, costEstimated: estimated, status: "ok", retries: 0, routingReason: explicit ? "explicit selection" : "first available embedding model", context: opts.context });
        return { ...res, route: { credentialId: cred.id, provider: c.provider, model: c.model.id, reason: "embedding" } };
      } catch (e) {
        lastErr = e instanceof ProviderError ? e : new ProviderError("unknown", String(e), c.provider, false);
        this.markFailure(cred.id, lastErr);
      }
    }
    throw lastErr ?? new ProviderError("unsupported", "No embedding model available", "gateway", false);
  }
}
