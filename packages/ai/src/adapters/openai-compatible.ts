import type { ModelInfo, ProviderTypeInfo } from "@steward/schema";
import { providerTypeMap, seedModelsFor } from "../catalog.js";
import { doFetch, fetchJson, genId, safeJsonParse, sseLines } from "../http.js";
import {
  ProviderError,
  type ChatEvent,
  type ChatMessage,
  type ChatRequest,
  type ChatResponse,
  type EmbedRequest,
  type EmbedResponse,
  type ProviderAdapter,
  type ProviderCredential,
  type ToolCall,
  type Usage,
} from "../types.js";

type OAIMessage = Record<string, unknown>;

export function toOpenAIMessages(messages: ChatMessage[]): OAIMessage[] {
  const out: OAIMessage[] = [];
  for (const m of messages) {
    if (typeof m.content === "string") {
      out.push({ role: m.role, content: m.content, ...(m.name ? { name: m.name } : {}) });
      continue;
    }
    if (m.role === "assistant") {
      const text = m.content.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("");
      const toolCalls = m.content
        .filter((p) => p.type === "tool_call")
        .map((p) => {
          const c = p as Extract<typeof p, { type: "tool_call" }>;
          return { id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.arguments) } };
        });
      out.push({ role: "assistant", content: text || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) });
      continue;
    }
    if (m.role === "tool") {
      for (const p of m.content) {
        if (p.type === "tool_result") out.push({ role: "tool", tool_call_id: p.toolCallId, content: p.content });
      }
      continue;
    }
    const parts = m.content.map((p) => {
      if (p.type === "text") return { type: "text", text: p.text };
      if (p.type === "image") return { type: "image_url", image_url: { url: `data:${p.mimeType};base64,${p.data}`, detail: p.detail ?? "auto" } };
      return { type: "text", text: "" };
    });
    out.push({ role: m.role, content: parts });
  }
  return out;
}

export function fromOpenAIUsage(u: Record<string, unknown> | undefined): Usage {
  const details = (u?.prompt_tokens_details ?? {}) as Record<string, number>;
  const cdetails = (u?.completion_tokens_details ?? {}) as Record<string, number>;
  return {
    inputTokens: Number(u?.prompt_tokens ?? 0),
    outputTokens: Number(u?.completion_tokens ?? 0),
    cachedTokens: details.cached_tokens ?? undefined,
    reasoningTokens: cdetails.reasoning_tokens ?? undefined,
  };
}

export class OpenAICompatibleAdapter implements ProviderAdapter {
  readonly info: ProviderTypeInfo;
  readonly type: string;
  protected readonly baseUrl: string;
  protected readonly headers: Record<string, string>;

  constructor(protected readonly cred: ProviderCredential, providerType: string) {
    const info = providerTypeMap.get(providerType);
    if (!info) throw new ProviderError("invalid_request", `Unknown provider type ${providerType}`, providerType, false);
    this.info = info;
    this.type = providerType;
    let base = cred.baseUrl ?? info.defaultBaseUrl;
    if (providerType === "azure_openai") {
      const cfg = cred.config ?? {};
      const resource = String(cfg.resource ?? "");
      const deployment = String(cfg.deployment ?? "");
      base = cred.baseUrl ?? `https://${resource}.openai.azure.com/openai/deployments/${deployment}`;
    }
    if (providerType === "cloudflare" && !cred.baseUrl) {
      base = `https://api.cloudflare.com/client/v4/accounts/${String(cred.config?.accountId ?? "")}/ai/v1`;
    }
    if (!base) throw new ProviderError("invalid_request", `Base URL required for ${providerType}`, providerType, false);
    this.baseUrl = base.replace(/\/$/, "");
    this.headers = { "content-type": "application/json", ...(cred.headers ?? {}) };
    if (cred.apiKey) {
      if (providerType === "azure_openai") this.headers["api-key"] = cred.apiKey;
      else this.headers.authorization = `Bearer ${cred.apiKey}`;
    }
    if (providerType === "openrouter") {
      this.headers["HTTP-Referer"] = "https://github.com/steward-os/steward";
      this.headers["X-Title"] = "Steward";
    }
    if (providerType === "openai" && cred.config?.organization) this.headers["OpenAI-Organization"] = String(cred.config.organization);
  }

  protected url(path: string): string {
    if (this.type === "azure_openai") {
      const v = String(this.cred.config?.apiVersion ?? "2024-10-21");
      return `${this.baseUrl}${path}?api-version=${encodeURIComponent(v)}`;
    }
    return `${this.baseUrl}${path}`;
  }

  async listModels(): Promise<ModelInfo[]> {
    const seeds = seedModelsFor(this.type);
    if (this.type === "azure_openai") {
      const deployment = String(this.cred.config?.deployment ?? "");
      return [{ id: deployment, provider: this.type, displayName: `Azure deployment ${deployment}`, tier: "premium", deprecated: false, local: false, capabilities: { contextWindow: 128_000, inputModalities: ["text"], outputModalities: ["text"], tools: true, structuredOutput: true, reasoning: false, streaming: true, vision: false } }];
    }
    if (this.type === "perplexity") return seeds;
    try {
      const j = await fetchJson<{ data?: Array<Record<string, unknown>> }>(this.type, this.url("/models"), { headers: this.headers, timeoutMs: 20_000 });
      const live = (j.data ?? []).map((m) => this.modelFromList(m, seeds));
      const liveIds = new Set(live.map((m) => m.id));
      return [...live, ...seeds.filter((s) => !liveIds.has(s.id))];
    } catch (e) {
      if (e instanceof ProviderError && (e.code === "auth" || e.code === "network" || e.code === "timeout")) throw e;
      return seeds;
    }
  }

  protected modelFromList(m: Record<string, unknown>, seeds: ModelInfo[]): ModelInfo {
    const idRaw = String(m.id ?? m.name ?? "");
    const id = idRaw;
    const seed = seeds.find((s) => s.id === id);
    if (seed) return seed;
    // OpenRouter-style rich metadata
    const ctx = Number(m.context_length ?? (m.top_provider as Record<string, unknown> | undefined)?.context_length ?? 0);
    const pricing = m.pricing as Record<string, string> | undefined;
    const arch = m.architecture as Record<string, unknown> | undefined;
    const inputMods = (arch?.input_modalities as string[] | undefined) ?? ["text"];
    const supported = (m.supported_parameters as string[] | undefined) ?? [];
    return {
      id,
      provider: this.type,
      displayName: String(m.name ?? id),
      tier: "standard",
      deprecated: false,
      local: this.info.local,
      capabilities: {
        contextWindow: ctx > 0 ? ctx : 32_768,
        maxOutputTokens: Number((m.top_provider as Record<string, unknown> | undefined)?.max_completion_tokens ?? 0) || undefined,
        inputModalities: inputMods.includes("image") ? ["text", "image"] : ["text"],
        outputModalities: ["text"],
        tools: supported.length ? supported.includes("tools") : !/embed|whisper|tts|dall-e|moderation/i.test(id),
        structuredOutput: supported.length ? supported.includes("response_format") : true,
        reasoning: supported.includes("reasoning") || /o[1-4]|reason|thinking|r1/i.test(id),
        streaming: true,
        vision: inputMods.includes("image"),
      },
      pricing: pricing?.prompt
        ? { inputPerMTok: Number(pricing.prompt) * 1_000_000, outputPerMTok: Number(pricing.completion ?? 0) * 1_000_000, currency: "USD", estimated: false }
        : undefined,
    };
  }

  protected buildBody(req: ChatRequest, stream: boolean): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: req.model,
      messages: toOpenAIMessages(req.messages),
      stream,
    };
    if (stream) body.stream_options = { include_usage: true };
    if (req.topP !== undefined) {
      if (/^(?:o[1-4](?:-|$)|gpt-5)/.test(req.model) && ["openai", "azure_openai"].includes(this.type)) throw new ProviderError("unsupported", "This reasoning model does not support custom top-p; use provider-default sampling", this.type, false);
      body.top_p = req.topP;
    }
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.maxTokens) body.max_completion_tokens = req.maxTokens;
    if (req.stop?.length) body.stop = req.stop;
    if (req.tools?.length) {
      body.tools = req.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
      if (req.toolChoice) body.tool_choice = typeof req.toolChoice === "string" ? req.toolChoice : { type: "function", function: { name: req.toolChoice.name } };
    }
    if (req.responseFormat?.type === "json_schema") body.response_format = { type: "json_schema", json_schema: { name: req.responseFormat.name, schema: req.responseFormat.schema, strict: false } };
    else if (req.responseFormat?.type === "json") body.response_format = { type: "json_object" };
    if (req.reasoning) body.reasoning_effort = req.reasoning.effort;
    // Providers that reject max_completion_tokens
    if (["groq", "together", "fireworks", "cerebras", "deepseek", "mistral", "perplexity", "lmstudio", "vllm", "llamacpp", "ollama", "nvidia", "sambanova", "huggingface", "cloudflare", "xai"].includes(this.type) && req.maxTokens) {
      delete body.max_completion_tokens;
      body.max_tokens = req.maxTokens;
      delete body.reasoning_effort;
    }
    return body;
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const j = await fetchJson<Record<string, unknown>>(this.type, this.url("/chat/completions"), {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(this.buildBody(req, false)),
      signal: req.signal,
    });
    const choice = ((j.choices as Array<Record<string, unknown>> | undefined) ?? [])[0];
    const message = (choice?.message ?? {}) as Record<string, unknown>;
    const toolCalls: ToolCall[] = ((message.tool_calls as Array<Record<string, unknown>> | undefined) ?? []).map((tc) => {
      const fn = tc.function as Record<string, string>;
      return { id: String(tc.id ?? genId()), name: fn.name ?? "", arguments: safeJsonParse(fn.arguments ?? "{}") };
    });
    const finish = String(choice?.finish_reason ?? "stop");
    return {
      id: String(j.id ?? genId("chatcmpl")),
      model: String(j.model ?? req.model),
      provider: this.type,
      text: typeof message.content === "string" ? message.content : "",
      toolCalls,
      finishReason: toolCalls.length ? "tool_calls" : finish === "length" ? "length" : finish === "content_filter" ? "content_filter" : "stop",
      usage: fromOpenAIUsage(j.usage as Record<string, unknown> | undefined),
      raw: j,
    };
  }

  async *stream(req: ChatRequest): AsyncIterable<ChatEvent> {
    const res = await doFetch(this.type, this.url("/chat/completions"), {
      method: "POST",
      headers: { ...this.headers, accept: "text/event-stream" },
      body: JSON.stringify(this.buildBody(req, true)),
      signal: req.signal,
    });
    let text = "";
    let usage: Usage = { inputTokens: 0, outputTokens: 0 };
    let id = genId("chatcmpl");
    let model = req.model;
    let finish = "stop";
    const calls = new Map<number, { id: string; name: string; args: string }>();
    for await (const { data } of sseLines(res)) {
      if (data === "[DONE]") break;
      let j: Record<string, unknown>;
      try {
        j = JSON.parse(data);
      } catch {
        continue;
      }
      if (j.id) id = String(j.id);
      if (j.model) model = String(j.model);
      if (j.usage) {
        usage = fromOpenAIUsage(j.usage as Record<string, unknown>);
        yield { type: "usage", usage };
      }
      const choice = ((j.choices as Array<Record<string, unknown>> | undefined) ?? [])[0];
      if (!choice) continue;
      if (choice.finish_reason) finish = String(choice.finish_reason);
      const delta = (choice.delta ?? {}) as Record<string, unknown>;
      if (typeof delta.content === "string" && delta.content) {
        text += delta.content;
        yield { type: "text_delta", delta: delta.content };
      }
      const rc = (delta.reasoning_content ?? delta.reasoning) as string | undefined;
      if (typeof rc === "string" && rc) yield { type: "reasoning_delta", delta: rc };
      for (const tc of (delta.tool_calls as Array<Record<string, unknown>> | undefined) ?? []) {
        const idx = Number(tc.index ?? 0);
        const fn = (tc.function ?? {}) as Record<string, string>;
        let entry = calls.get(idx);
        if (!entry) {
          entry = { id: String(tc.id ?? genId()), name: fn.name ?? "", args: "" };
          calls.set(idx, entry);
          yield { type: "tool_call_start", id: entry.id, name: entry.name };
        } else if (fn.name && !entry.name) entry.name = fn.name;
        if (fn.arguments) {
          entry.args += fn.arguments;
          yield { type: "tool_call_delta", id: entry.id, argumentsDelta: fn.arguments };
        }
      }
    }
    const toolCalls: ToolCall[] = [];
    for (const c of calls.values()) {
      const args = safeJsonParse(c.args);
      toolCalls.push({ id: c.id, name: c.name, arguments: args });
      yield { type: "tool_call_end", id: c.id, name: c.name, arguments: args };
    }
    yield {
      type: "done",
      response: {
        id,
        model,
        provider: this.type,
        text,
        toolCalls,
        finishReason: toolCalls.length ? "tool_calls" : finish === "length" ? "length" : "stop",
        usage,
      },
    };
  }

  async embed(req: EmbedRequest): Promise<EmbedResponse> {
    const body: Record<string, unknown> = { model: req.model, input: req.input };
    if (req.dimensions && this.type === "openai") body.dimensions = req.dimensions;
    const j = await fetchJson<Record<string, unknown>>(this.type, this.url("/embeddings"), { method: "POST", headers: this.headers, body: JSON.stringify(body) });
    const data = (j.data as Array<{ embedding: number[] }> | undefined) ?? [];
    return { embeddings: data.map((d) => d.embedding), usage: fromOpenAIUsage(j.usage as Record<string, unknown> | undefined), model: String(j.model ?? req.model), provider: this.type };
  }

  async testConnection() {
    try {
      const models = await this.listModels();
      return { ok: true as const, models: models.length };
    } catch (e) {
      return { ok: false as const, error: e instanceof ProviderError ? e : new ProviderError("unknown", String(e), this.type, false) };
    }
  }
}
