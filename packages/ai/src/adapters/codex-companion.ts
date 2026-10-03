import type { ModelInfo, ProviderTypeInfo } from "@steward/schema";
import { providerTypeMap, seedModelsFor } from "../catalog.js";
import { genId } from "../http.js";
import { ProviderError, type ChatEvent, type ChatRequest, type ChatResponse, type ProviderAdapter, type ProviderCredential } from "../types.js";

/**
 * Transport to a paired Local Companion. Implemented by the API (which holds the WebSocket) and proxied by the worker.
 * The companion only accepts a restricted command set; the control plane never sees provider credentials.
 */
export interface CompanionBridge {
  request(deviceId: string, command: "codex.exec" | "codex.status" | "ping", payload: Record<string, unknown>, opts?: { timeoutMs?: number; signal?: AbortSignal }): Promise<Record<string, unknown>>;
  stream?(deviceId: string, command: "codex.exec", payload: Record<string, unknown>, opts?: { signal?: AbortSignal }): AsyncIterable<Record<string, unknown>>;
}

export interface CodexExecResult {
  text: string;
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  usage?: { inputTokens: number; outputTokens: number; cachedTokens?: number; reasoningTokens?: number };
  model?: string;
  threadId?: string;
}

export class CodexCompanionAdapter implements ProviderAdapter {
  readonly type = "codex_companion";
  readonly info: ProviderTypeInfo = providerTypeMap.get("codex_companion")!;
  private readonly deviceId: string;

  constructor(cred: ProviderCredential, private readonly bridge: CompanionBridge) {
    this.deviceId = String(cred.config?.deviceId ?? "");
    if (!this.deviceId) throw new ProviderError("invalid_request", "Companion device id is required", this.type, false);
  }

  async listModels(): Promise<ModelInfo[]> {
    const status = await this.bridge.request(this.deviceId, "codex.status", {}, { timeoutMs: 10_000 });
    if (status.loggedIn === false) throw new ProviderError("auth", "Codex CLI on the companion device is not logged in", this.type, false);
    const models = (status.models as string[] | undefined) ?? [];
    const seeds = seedModelsFor(this.type);
    return models.length ? models.map((id) => ({ ...seeds[0]!, id, displayName: `${id} (ChatGPT plan)` })) : seeds;
  }

  private payload(req: ChatRequest) {
    if (req.metadata?.steward_overclock === "required") throw new ProviderError("unsupported", "Codex Companion cannot enforce Overclock sampling or output-token limits. Route this agent to another provider or disable Overclock.", this.type, false);
    if (req.topP !== undefined) throw new ProviderError("unsupported", "Codex Companion does not support custom top-p", this.type, false);
    return {
      model: req.model === "codex" ? undefined : req.model,
      messages: req.messages.map((m) => ({ role: m.role, content: typeof m.content === "string" ? m.content : m.content.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("\n") })),
      tools: req.tools,
      responseFormat: req.responseFormat,
      maxTokens: req.maxTokens,
      metadata: req.metadata,
    };
  }

  private toResponse(r: CodexExecResult, req: ChatRequest): ChatResponse {
    return {
      id: genId("codex"),
      model: r.model ?? req.model,
      provider: this.type,
      text: r.text ?? "",
      toolCalls: r.toolCalls ?? [],
      finishReason: r.toolCalls?.length ? "tool_calls" : "stop",
      usage: r.usage ?? { inputTokens: 0, outputTokens: 0 },
      raw: r,
    };
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const res = (await this.bridge.request(this.deviceId, "codex.exec", this.payload(req), { timeoutMs: 15 * 60_000, signal: req.signal })) as unknown as CodexExecResult & { error?: string };
    if (res.error) throw new ProviderError(/login|auth/i.test(res.error) ? "auth" : "server", res.error, this.type, false);
    return this.toResponse(res, req);
  }

  async *stream(req: ChatRequest): AsyncIterable<ChatEvent> {
    if (!this.bridge.stream) {
      const r = await this.chat(req);
      if (r.text) yield { type: "text_delta", delta: r.text };
      yield { type: "done", response: r };
      return;
    }
    let text = "";
    let final: CodexExecResult | undefined;
    for await (const ev of this.bridge.stream(this.deviceId, "codex.exec", this.payload(req), { signal: req.signal })) {
      if (ev.type === "text_delta") {
        text += String(ev.delta);
        yield { type: "text_delta", delta: String(ev.delta) };
      } else if (ev.type === "reasoning_delta") yield { type: "reasoning_delta", delta: String(ev.delta) };
      else if (ev.type === "done") final = ev.result as CodexExecResult;
      else if (ev.type === "error") {
        yield { type: "error", error: new ProviderError("server", String(ev.error), this.type, false) };
        return;
      }
    }
    yield { type: "done", response: this.toResponse(final ?? { text }, req) };
  }

  async testConnection() {
    try {
      const models = await this.listModels();
      return { ok: true as const, models: models.length };
    } catch (e) {
      return { ok: false as const, error: e instanceof ProviderError ? e : new ProviderError("network", String(e), this.type, true) };
    }
  }
}
