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

function toCohere(messages: ChatMessage[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const m of messages) {
    if (typeof m.content === "string") {
      out.push({ role: m.role, content: m.content });
      continue;
    }
    if (m.role === "assistant") {
      const text = m.content.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("");
      const calls = m.content.filter((p) => p.type === "tool_call").map((p) => {
        const c = p as Extract<typeof p, { type: "tool_call" }>;
        return { id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.arguments) } };
      });
      out.push({ role: "assistant", ...(text ? { content: text } : {}), ...(calls.length ? { tool_calls: calls, tool_plan: text || "Calling tools." } : {}) });
    } else if (m.role === "tool") {
      for (const p of m.content) if (p.type === "tool_result") out.push({ role: "tool", tool_call_id: p.toolCallId, content: [{ type: "document", document: { data: { result: p.content } } }] });
    } else {
      out.push({ role: m.role, content: m.content.filter((p) => p.type === "text").map((p) => ({ type: "text", text: (p as { text: string }).text })) });
    }
  }
  return out;
}

function usageFrom(u: Record<string, unknown> | undefined): Usage {
  const b = (u?.billed_units ?? u?.tokens ?? {}) as Record<string, number>;
  return { inputTokens: Number(b.input_tokens ?? 0), outputTokens: Number(b.output_tokens ?? 0) };
}

export class CohereAdapter implements ProviderAdapter {
  readonly type = "cohere";
  readonly info: ProviderTypeInfo = providerTypeMap.get("cohere")!;
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;

  constructor(cred: ProviderCredential) {
    if (!cred.apiKey) throw new ProviderError("auth", "Cohere API key required", this.type, false);
    this.baseUrl = (cred.baseUrl ?? this.info.defaultBaseUrl!).replace(/\/$/, "");
    this.headers = { "content-type": "application/json", authorization: `Bearer ${cred.apiKey}`, ...(cred.headers ?? {}) };
  }

  async listModels(): Promise<ModelInfo[]> {
    const seeds = seedModelsFor(this.type);
    const j = await fetchJson<{ models?: Array<Record<string, unknown>> }>(this.type, `${this.baseUrl}/v1/models?page_size=100`, { headers: this.headers, timeoutMs: 20_000 });
    const live = (j.models ?? []).map((m) => {
      const id = String(m.name);
      const seed = seeds.find((s) => s.id === id);
      if (seed) return seed;
      const endpoints = (m.endpoints as string[]) ?? [];
      const isEmbed = endpoints.includes("embed");
      return {
        id,
        provider: this.type,
        displayName: id,
        tier: "standard",
        deprecated: false,
        local: false,
        capabilities: { contextWindow: Number(m.context_length ?? 128_000), inputModalities: ["text"], outputModalities: isEmbed ? ["embedding"] : ["text"], tools: endpoints.includes("chat"), structuredOutput: endpoints.includes("chat"), reasoning: false, streaming: endpoints.includes("chat"), vision: false, embeddingDimensions: isEmbed ? 1024 : undefined },
      } satisfies ModelInfo;
    });
    const ids = new Set(live.map((m) => m.id));
    return [...live, ...seeds.filter((s) => !ids.has(s.id))];
  }

  private body(req: ChatRequest, stream: boolean): Record<string, unknown> {
    const body: Record<string, unknown> = { model: req.model, messages: toCohere(req.messages), stream };
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.maxTokens) body.max_tokens = req.maxTokens;
    if (req.stop?.length) body.stop_sequences = req.stop;
    if (req.tools?.length) body.tools = req.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
    if (req.responseFormat?.type === "json_schema") body.response_format = { type: "json_object", json_schema: req.responseFormat.schema };
    else if (req.responseFormat?.type === "json") body.response_format = { type: "json_object" };
    return body;
  }

  private parse(j: Record<string, unknown>, req: ChatRequest): ChatResponse {
    const msg = (j.message ?? {}) as Record<string, unknown>;
    const content = (msg.content as Array<Record<string, string>> | undefined) ?? [];
    const text = content.filter((c) => c.type === "text").map((c) => c.text).join("");
    const toolCalls: ToolCall[] = ((msg.tool_calls as Array<Record<string, unknown>> | undefined) ?? []).map((tc) => {
      const fn = tc.function as Record<string, string>;
      return { id: String(tc.id ?? genId()), name: fn.name ?? "", arguments: safeJsonParse(fn.arguments ?? "{}") };
    });
    const finish = String(j.finish_reason ?? "COMPLETE");
    return { id: String(j.id ?? genId("coh")), model: req.model, provider: this.type, text, toolCalls, finishReason: toolCalls.length ? "tool_calls" : finish === "MAX_TOKENS" ? "length" : "stop", usage: usageFrom(j.usage as Record<string, unknown>), raw: j };
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const j = await fetchJson<Record<string, unknown>>(this.type, `${this.baseUrl}/v2/chat`, { method: "POST", headers: this.headers, body: JSON.stringify(this.body(req, false)), signal: req.signal });
    return this.parse(j, req);
  }

  async *stream(req: ChatRequest): AsyncIterable<ChatEvent> {
    const res = await doFetch(this.type, `${this.baseUrl}/v2/chat`, { method: "POST", headers: { ...this.headers, accept: "text/event-stream" }, body: JSON.stringify(this.body(req, true)), signal: req.signal });
    let text = "";
    let usage: Usage = { inputTokens: 0, outputTokens: 0 };
    const calls = new Map<number, { id: string; name: string; args: string }>();
    const toolCalls: ToolCall[] = [];
    let finish = "COMPLETE";
    let id = genId("coh");
    for await (const { data } of sseLines(res)) {
      let j: Record<string, unknown>;
      try {
        j = JSON.parse(data);
      } catch {
        continue;
      }
      const t = j.type as string;
      const delta = (j.delta ?? {}) as Record<string, unknown>;
      const dmsg = (delta.message ?? {}) as Record<string, unknown>;
      if (t === "message-start") id = String(j.id ?? id);
      else if (t === "content-delta") {
        const c = (dmsg.content as Record<string, string> | undefined)?.text ?? "";
        if (c) {
          text += c;
          yield { type: "text_delta", delta: c };
        }
      } else if (t === "tool-call-start") {
        const tc = dmsg.tool_calls as Record<string, unknown>;
        const fn = (tc?.function ?? {}) as Record<string, string>;
        const entry = { id: String(tc?.id ?? genId()), name: fn.name ?? "", args: fn.arguments ?? "" };
        calls.set(Number(j.index ?? 0), entry);
        yield { type: "tool_call_start", id: entry.id, name: entry.name };
      } else if (t === "tool-call-delta") {
        const entry = calls.get(Number(j.index ?? 0));
        const fn = ((dmsg.tool_calls as Record<string, unknown>)?.function ?? {}) as Record<string, string>;
        if (entry && fn.arguments) {
          entry.args += fn.arguments;
          yield { type: "tool_call_delta", id: entry.id, argumentsDelta: fn.arguments };
        }
      } else if (t === "tool-call-end") {
        const entry = calls.get(Number(j.index ?? 0));
        if (entry) {
          const args = safeJsonParse(entry.args);
          toolCalls.push({ id: entry.id, name: entry.name, arguments: args });
          yield { type: "tool_call_end", id: entry.id, name: entry.name, arguments: args };
        }
      } else if (t === "message-end") {
        finish = String(delta.finish_reason ?? finish);
        usage = usageFrom(delta.usage as Record<string, unknown>);
        yield { type: "usage", usage };
      }
    }
    yield { type: "done", response: { id, model: req.model, provider: this.type, text, toolCalls, finishReason: toolCalls.length ? "tool_calls" : finish === "MAX_TOKENS" ? "length" : "stop", usage } };
  }

  async embed(req: EmbedRequest): Promise<EmbedResponse> {
    const j = await fetchJson<Record<string, unknown>>(this.type, `${this.baseUrl}/v2/embed`, { method: "POST", headers: this.headers, body: JSON.stringify({ model: req.model, texts: req.input, input_type: "search_document", embedding_types: ["float"], ...(req.dimensions ? { output_dimension: req.dimensions } : {}) }) });
    const emb = ((j.embeddings as Record<string, number[][]>)?.float ?? []) as number[][];
    return { embeddings: emb, usage: usageFrom((j.meta as Record<string, unknown>)?.billed_units ? { billed_units: (j.meta as Record<string, unknown>).billed_units } : undefined), model: req.model, provider: this.type };
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
