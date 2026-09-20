import type { ModelInfo, ProviderTypeInfo } from "@steward/schema";
import { providerTypeMap, seedModelsFor } from "../catalog.js";
import { doFetch, fetchJson, genId, safeJsonParse, sseLines } from "../http.js";
import {
  ProviderError,
  type ChatEvent,
  type ChatMessage,
  type ChatRequest,
  type ChatResponse,
  type ProviderAdapter,
  type ProviderCredential,
  type ToolCall,
  type Usage,
} from "../types.js";

const VERSION = "2023-06-01";

export function toAnthropicMessages(messages: ChatMessage[]): { system: string; messages: Array<Record<string, unknown>> } {
  const systemParts: string[] = [];
  const out: Array<Record<string, unknown>> = [];
  for (const m of messages) {
    if (m.role === "system") {
      systemParts.push(typeof m.content === "string" ? m.content : m.content.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("\n"));
      continue;
    }
    if (typeof m.content === "string") {
      out.push({ role: m.role === "tool" ? "user" : m.role, content: m.content });
      continue;
    }
    const blocks: Array<Record<string, unknown>> = [];
    for (const p of m.content) {
      if (p.type === "text") blocks.push({ type: "text", text: p.text });
      else if (p.type === "image") blocks.push({ type: "image", source: { type: "base64", media_type: p.mimeType, data: p.data } });
      else if (p.type === "tool_call") blocks.push({ type: "tool_use", id: p.id, name: p.name, input: p.arguments });
      else if (p.type === "tool_result") blocks.push({ type: "tool_result", tool_use_id: p.toolCallId, content: p.content, is_error: p.isError ?? false });
    }
    out.push({ role: m.role === "tool" ? "user" : m.role, content: blocks });
  }
  // Anthropic requires alternating roles; merge consecutive same-role messages.
  const merged: Array<Record<string, unknown>> = [];
  for (const m of out) {
    const last = merged[merged.length - 1];
    if (last && last.role === m.role) {
      const a = Array.isArray(last.content) ? last.content : [{ type: "text", text: last.content }];
      const b = Array.isArray(m.content) ? m.content : [{ type: "text", text: m.content }];
      last.content = [...a, ...b];
    } else merged.push({ ...m });
  }
  return { system: systemParts.join("\n\n"), messages: merged };
}

function usageFrom(u: Record<string, unknown> | undefined): Usage {
  return {
    inputTokens: Number(u?.input_tokens ?? 0) + Number(u?.cache_read_input_tokens ?? 0) + Number(u?.cache_creation_input_tokens ?? 0),
    outputTokens: Number(u?.output_tokens ?? 0),
    cachedTokens: u?.cache_read_input_tokens !== undefined ? Number(u.cache_read_input_tokens) : undefined,
  };
}

export class AnthropicAdapter implements ProviderAdapter {
  readonly type = "anthropic";
  readonly info: ProviderTypeInfo = providerTypeMap.get("anthropic")!;
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;

  constructor(cred: ProviderCredential) {
    if (!cred.apiKey) throw new ProviderError("auth", "Anthropic API key required", this.type, false);
    this.baseUrl = (cred.baseUrl ?? this.info.defaultBaseUrl!).replace(/\/$/, "");
    this.headers = { "content-type": "application/json", "x-api-key": cred.apiKey, "anthropic-version": VERSION, ...(cred.headers ?? {}) };
  }

  async listModels(): Promise<ModelInfo[]> {
    const seeds = seedModelsFor(this.type);
    const j = await fetchJson<{ data?: Array<{ id: string; display_name?: string }> }>(this.type, `${this.baseUrl}/v1/models?limit=100`, { headers: this.headers, timeoutMs: 20_000 });
    const live = (j.data ?? []).map((m) => seeds.find((s) => s.id === m.id) ?? ({
      id: m.id,
      provider: this.type,
      displayName: m.display_name ?? m.id,
      tier: /opus/i.test(m.id) ? "frontier" : /haiku/i.test(m.id) ? "economy" : "premium",
      deprecated: false,
      local: false,
      capabilities: { contextWindow: 200_000, maxOutputTokens: 8_192, inputModalities: ["text", "image"], outputModalities: ["text"], tools: true, structuredOutput: true, reasoning: /-4|3-7/.test(m.id), streaming: true, vision: true },
    } satisfies ModelInfo));
    const ids = new Set(live.map((m) => m.id));
    return [...live, ...seeds.filter((s) => !ids.has(s.id))];
  }

  private body(req: ChatRequest, stream: boolean): Record<string, unknown> {
    const { system, messages } = toAnthropicMessages(req.messages);
    const body: Record<string, unknown> = { model: req.model, messages, max_tokens: req.maxTokens ?? 8_192, stream };
    if (system) body.system = system;
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.stop?.length) body.stop_sequences = req.stop;
    const tools = (req.tools ?? []).map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
    if (req.responseFormat?.type === "json_schema") {
      tools.push({ name: "__structured_output", description: `Return the final answer as JSON matching the ${req.responseFormat.name} schema.`, input_schema: req.responseFormat.schema });
      body.tool_choice = { type: "tool", name: "__structured_output" };
    } else if (req.toolChoice) {
      body.tool_choice = req.toolChoice === "auto" ? { type: "auto" } : req.toolChoice === "required" ? { type: "any" } : req.toolChoice === "none" ? { type: "none" } : { type: "tool", name: req.toolChoice.name };
    }
    if (tools.length) body.tools = tools;
    if (req.reasoning) {
      const budget = { low: 2_000, medium: 8_000, high: 24_000 }[req.reasoning.effort];
      body.thinking = { type: "enabled", budget_tokens: budget };
      body.max_tokens = Math.max(Number(body.max_tokens), budget + 4_000);
      delete body.temperature;
    }
    return body;
  }

  private toResponse(j: Record<string, unknown>, req: ChatRequest): ChatResponse {
    const content = (j.content as Array<Record<string, unknown>> | undefined) ?? [];
    let text = "";
    const toolCalls: ToolCall[] = [];
    for (const b of content) {
      if (b.type === "text") text += String(b.text ?? "");
      else if (b.type === "tool_use") {
        if (b.name === "__structured_output") text = JSON.stringify(b.input ?? {});
        else toolCalls.push({ id: String(b.id), name: String(b.name), arguments: (b.input as Record<string, unknown>) ?? {} });
      }
    }
    const stop = String(j.stop_reason ?? "end_turn");
    return {
      id: String(j.id ?? genId("msg")),
      model: String(j.model ?? req.model),
      provider: this.type,
      text,
      toolCalls,
      finishReason: toolCalls.length ? "tool_calls" : stop === "max_tokens" ? "length" : "stop",
      usage: usageFrom(j.usage as Record<string, unknown> | undefined),
      raw: j,
    };
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const j = await fetchJson<Record<string, unknown>>(this.type, `${this.baseUrl}/v1/messages`, { method: "POST", headers: this.headers, body: JSON.stringify(this.body(req, false)), signal: req.signal });
    return this.toResponse(j, req);
  }

  async *stream(req: ChatRequest): AsyncIterable<ChatEvent> {
    const res = await doFetch(this.type, `${this.baseUrl}/v1/messages`, { method: "POST", headers: { ...this.headers, accept: "text/event-stream" }, body: JSON.stringify(this.body(req, true)), signal: req.signal });
    let text = "";
    let usage: Usage = { inputTokens: 0, outputTokens: 0 };
    let id = genId("msg");
    let model = req.model;
    let stop = "end_turn";
    const blocks = new Map<number, { type: string; id: string; name: string; json: string }>();
    const toolCalls: ToolCall[] = [];
    let structured = "";
    for await (const { data } of sseLines(res)) {
      let j: Record<string, unknown>;
      try {
        j = JSON.parse(data);
      } catch {
        continue;
      }
      const t = j.type as string;
      if (t === "message_start") {
        const msg = j.message as Record<string, unknown>;
        id = String(msg.id ?? id);
        model = String(msg.model ?? model);
        usage = usageFrom(msg.usage as Record<string, unknown>);
      } else if (t === "content_block_start") {
        const cb = j.content_block as Record<string, unknown>;
        const idx = Number(j.index);
        if (cb.type === "tool_use") {
          const entry = { type: "tool_use", id: String(cb.id), name: String(cb.name), json: "" };
          blocks.set(idx, entry);
          if (entry.name !== "__structured_output") yield { type: "tool_call_start", id: entry.id, name: entry.name };
        } else blocks.set(idx, { type: String(cb.type), id: "", name: "", json: "" });
      } else if (t === "content_block_delta") {
        const d = j.delta as Record<string, unknown>;
        const entry = blocks.get(Number(j.index));
        if (d.type === "text_delta") {
          text += String(d.text);
          yield { type: "text_delta", delta: String(d.text) };
        } else if (d.type === "thinking_delta") yield { type: "reasoning_delta", delta: String(d.thinking) };
        else if (d.type === "input_json_delta" && entry) {
          entry.json += String(d.partial_json);
          if (entry.name === "__structured_output") structured = entry.json;
          else yield { type: "tool_call_delta", id: entry.id, argumentsDelta: String(d.partial_json) };
        }
      } else if (t === "content_block_stop") {
        const entry = blocks.get(Number(j.index));
        if (entry?.type === "tool_use" && entry.name !== "__structured_output") {
          const args = safeJsonParse(entry.json);
          toolCalls.push({ id: entry.id, name: entry.name, arguments: args });
          yield { type: "tool_call_end", id: entry.id, name: entry.name, arguments: args };
        }
      } else if (t === "message_delta") {
        const d = j.delta as Record<string, unknown>;
        if (d.stop_reason) stop = String(d.stop_reason);
        const u = j.usage as Record<string, unknown> | undefined;
        if (u) {
          usage = { ...usage, outputTokens: Number(u.output_tokens ?? usage.outputTokens) };
          yield { type: "usage", usage };
        }
      } else if (t === "error") {
        const err = j.error as Record<string, unknown>;
        yield { type: "error", error: new ProviderError("server", String(err?.message ?? "stream error"), this.type, true) };
        return;
      }
    }
    if (structured) text = structured;
    yield { type: "done", response: { id, model, provider: this.type, text, toolCalls, finishReason: toolCalls.length ? "tool_calls" : stop === "max_tokens" ? "length" : "stop", usage } };
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
