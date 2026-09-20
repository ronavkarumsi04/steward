import type { ModelInfo, ProviderTypeInfo } from "@steward/schema";
import { GoogleAuth } from "google-auth-library";
import { providerTypeMap, seedModelsFor } from "../catalog.js";
import { doFetch, fetchJson, genId, sseLines } from "../http.js";
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

type Part = Record<string, unknown>;

export function toGeminiContents(messages: ChatMessage[]): { systemInstruction?: { parts: Part[] }; contents: Array<{ role: string; parts: Part[] }> } {
  const sys: string[] = [];
  const contents: Array<{ role: string; parts: Part[] }> = [];
  for (const m of messages) {
    if (m.role === "system") {
      sys.push(typeof m.content === "string" ? m.content : m.content.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("\n"));
      continue;
    }
    const role = m.role === "assistant" ? "model" : "user";
    const parts: Part[] = [];
    if (typeof m.content === "string") parts.push({ text: m.content });
    else
      for (const p of m.content) {
        if (p.type === "text") parts.push({ text: p.text });
        else if (p.type === "image") parts.push({ inlineData: { mimeType: p.mimeType, data: p.data } });
        else if (p.type === "tool_call") parts.push({ functionCall: { name: p.name, args: p.arguments } });
        else if (p.type === "tool_result") {
          let response: unknown;
          try {
            response = JSON.parse(p.content);
          } catch {
            response = { result: p.content };
          }
          parts.push({ functionResponse: { name: p.toolCallId.split("::")[0] ?? "tool", response: typeof response === "object" && response !== null ? response : { result: response } } });
        }
      }
    if (!parts.length) continue;
    const last = contents[contents.length - 1];
    if (last && last.role === role) last.parts.push(...parts);
    else contents.push({ role, parts });
  }
  return { systemInstruction: sys.length ? { parts: [{ text: sys.join("\n\n") }] } : undefined, contents };
}

function usageFrom(u: Record<string, unknown> | undefined): Usage {
  return {
    inputTokens: Number(u?.promptTokenCount ?? 0),
    outputTokens: Number(u?.candidatesTokenCount ?? 0) + Number(u?.thoughtsTokenCount ?? 0),
    cachedTokens: u?.cachedContentTokenCount !== undefined ? Number(u.cachedContentTokenCount) : undefined,
    reasoningTokens: u?.thoughtsTokenCount !== undefined ? Number(u.thoughtsTokenCount) : undefined,
  };
}

/** Strips JSON Schema keywords Gemini rejects. */
export function sanitizeSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const drop = new Set(["$schema", "additionalProperties", "$id", "$ref", "definitions", "$defs", "default", "examples", "title", "const"]);
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (drop.has(k)) continue;
        out[k] = walk(val);
      }
      return out;
    }
    return v;
  };
  return walk(schema) as Record<string, unknown>;
}

export class GeminiAdapter implements ProviderAdapter {
  readonly type: string;
  readonly info: ProviderTypeInfo;
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly auth?: GoogleAuth;
  private readonly project?: string;
  private readonly location: string;

  constructor(cred: ProviderCredential, providerType: "gemini" | "vertex" = "gemini") {
    this.type = providerType;
    this.info = providerTypeMap.get(providerType)!;
    this.location = String(cred.config?.location ?? "us-central1");
    if (providerType === "vertex") {
      this.project = String(cred.config?.project ?? "");
      if (!this.project) throw new ProviderError("invalid_request", "Vertex AI requires a GCP project id", this.type, false);
      const sa = cred.apiKey ?? (cred.config?.serviceAccountJson as string | undefined);
      this.auth = new GoogleAuth({
        scopes: ["https://www.googleapis.com/auth/cloud-platform"],
        ...(sa ? { credentials: JSON.parse(sa) } : {}),
      });
      const host = this.location === "global" ? "aiplatform.googleapis.com" : `${this.location}-aiplatform.googleapis.com`;
      this.baseUrl = cred.baseUrl ?? `https://${host}/v1/projects/${this.project}/locations/${this.location}/publishers/google`;
    } else {
      if (!cred.apiKey) throw new ProviderError("auth", "Gemini API key required", this.type, false);
      this.apiKey = cred.apiKey;
      this.baseUrl = `${(cred.baseUrl ?? this.info.defaultBaseUrl!).replace(/\/$/, "")}/v1beta`;
    }
  }

  private async headers(): Promise<Record<string, string>> {
    const h: Record<string, string> = { "content-type": "application/json" };
    if (this.apiKey) h["x-goog-api-key"] = this.apiKey;
    if (this.auth) {
      const client = await this.auth.getClient();
      const token = await client.getAccessToken();
      if (!token.token) throw new ProviderError("auth", "Could not obtain Google access token", this.type, false);
      h.authorization = `Bearer ${token.token}`;
    }
    return h;
  }

  async listModels(): Promise<ModelInfo[]> {
    const seeds = seedModelsFor(this.type);
    if (this.type === "vertex") {
      // Vertex publisher model listing requires elevated IAM; verify token instead.
      await this.headers();
      return seeds;
    }
    const j = await fetchJson<{ models?: Array<Record<string, unknown>> }>(this.type, `${this.baseUrl}/models?pageSize=200`, { headers: await this.headers(), timeoutMs: 20_000 });
    const live = (j.models ?? [])
      .filter((m) => ((m.supportedGenerationMethods as string[]) ?? []).some((x) => x === "generateContent" || x === "embedContent"))
      .map((m) => {
        const id = String(m.name).replace(/^models\//, "");
        const seed = seeds.find((s) => s.id === id);
        if (seed) return seed;
        const isEmbed = ((m.supportedGenerationMethods as string[]) ?? []).includes("embedContent");
        return {
          id,
          provider: this.type,
          displayName: String(m.displayName ?? id),
          tier: /pro/i.test(id) ? "premium" : /lite|nano/i.test(id) ? "economy" : "standard",
          deprecated: false,
          local: false,
          capabilities: {
            contextWindow: Number(m.inputTokenLimit ?? 32_768),
            maxOutputTokens: Number(m.outputTokenLimit ?? 8_192),
            inputModalities: isEmbed ? ["text"] : ["text", "image"],
            outputModalities: isEmbed ? ["embedding"] : ["text"],
            tools: !isEmbed,
            structuredOutput: !isEmbed,
            reasoning: /2\.5|thinking/.test(id),
            streaming: !isEmbed,
            vision: !isEmbed,
            embeddingDimensions: isEmbed ? 3072 : undefined,
          },
        } satisfies ModelInfo;
      });
    const ids = new Set(live.map((m) => m.id));
    return [...live, ...seeds.filter((s) => !ids.has(s.id))];
  }

  private body(req: ChatRequest): Record<string, unknown> {
    const { systemInstruction, contents } = toGeminiContents(req.messages);
    const generationConfig: Record<string, unknown> = {};
    if (req.temperature !== undefined) generationConfig.temperature = req.temperature;
    if (req.maxTokens) generationConfig.maxOutputTokens = req.maxTokens;
    if (req.stop?.length) generationConfig.stopSequences = req.stop;
    if (req.responseFormat?.type === "json_schema") {
      generationConfig.responseMimeType = "application/json";
      generationConfig.responseSchema = sanitizeSchema(req.responseFormat.schema);
    } else if (req.responseFormat?.type === "json") generationConfig.responseMimeType = "application/json";
    if (req.reasoning) generationConfig.thinkingConfig = { thinkingBudget: { low: 1024, medium: 8192, high: 24576 }[req.reasoning.effort] };
    const body: Record<string, unknown> = { contents, generationConfig };
    if (systemInstruction) body.systemInstruction = systemInstruction;
    if (req.tools?.length) {
      body.tools = [{ functionDeclarations: req.tools.map((t) => ({ name: t.name, description: t.description, parameters: sanitizeSchema(t.parameters) })) }];
      if (req.toolChoice) {
        const mode = req.toolChoice === "none" ? "NONE" : req.toolChoice === "required" ? "ANY" : typeof req.toolChoice === "object" ? "ANY" : "AUTO";
        body.toolConfig = { functionCallingConfig: { mode, ...(typeof req.toolChoice === "object" ? { allowedFunctionNames: [req.toolChoice.name] } : {}) } };
      }
    }
    return body;
  }

  private parseCandidate(j: Record<string, unknown>, req: ChatRequest): ChatResponse {
    const cand = ((j.candidates as Array<Record<string, unknown>> | undefined) ?? [])[0];
    const parts = ((cand?.content as Record<string, unknown> | undefined)?.parts as Part[] | undefined) ?? [];
    let text = "";
    const toolCalls: ToolCall[] = [];
    for (const p of parts) {
      if (typeof p.text === "string" && !p.thought) text += p.text;
      if (p.functionCall) {
        const fc = p.functionCall as Record<string, unknown>;
        toolCalls.push({ id: `${String(fc.name)}::${genId()}`, name: String(fc.name), arguments: (fc.args as Record<string, unknown>) ?? {} });
      }
    }
    const finish = String(cand?.finishReason ?? "STOP");
    return {
      id: String(j.responseId ?? genId("gem")),
      model: String(j.modelVersion ?? req.model),
      provider: this.type,
      text,
      toolCalls,
      finishReason: toolCalls.length ? "tool_calls" : finish === "MAX_TOKENS" ? "length" : finish === "SAFETY" ? "content_filter" : "stop",
      usage: usageFrom(j.usageMetadata as Record<string, unknown> | undefined),
      raw: j,
    };
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const j = await fetchJson<Record<string, unknown>>(this.type, `${this.baseUrl}/models/${req.model}:generateContent`, { method: "POST", headers: await this.headers(), body: JSON.stringify(this.body(req)), signal: req.signal });
    return this.parseCandidate(j, req);
  }

  async *stream(req: ChatRequest): AsyncIterable<ChatEvent> {
    const res = await doFetch(this.type, `${this.baseUrl}/models/${req.model}:streamGenerateContent?alt=sse`, { method: "POST", headers: await this.headers(), body: JSON.stringify(this.body(req)), signal: req.signal });
    let text = "";
    let usage: Usage = { inputTokens: 0, outputTokens: 0 };
    const toolCalls: ToolCall[] = [];
    let finish = "STOP";
    let model = req.model;
    for await (const { data } of sseLines(res)) {
      let j: Record<string, unknown>;
      try {
        j = JSON.parse(data);
      } catch {
        continue;
      }
      if (j.modelVersion) model = String(j.modelVersion);
      if (j.usageMetadata) {
        usage = usageFrom(j.usageMetadata as Record<string, unknown>);
        yield { type: "usage", usage };
      }
      const cand = ((j.candidates as Array<Record<string, unknown>> | undefined) ?? [])[0];
      if (!cand) continue;
      if (cand.finishReason) finish = String(cand.finishReason);
      const parts = ((cand.content as Record<string, unknown> | undefined)?.parts as Part[] | undefined) ?? [];
      for (const p of parts) {
        if (typeof p.text === "string") {
          if (p.thought) yield { type: "reasoning_delta", delta: p.text };
          else {
            text += p.text;
            yield { type: "text_delta", delta: p.text };
          }
        }
        if (p.functionCall) {
          const fc = p.functionCall as Record<string, unknown>;
          const call: ToolCall = { id: `${String(fc.name)}::${genId()}`, name: String(fc.name), arguments: (fc.args as Record<string, unknown>) ?? {} };
          toolCalls.push(call);
          yield { type: "tool_call_start", id: call.id, name: call.name };
          yield { type: "tool_call_end", id: call.id, name: call.name, arguments: call.arguments };
        }
      }
    }
    yield { type: "done", response: { id: genId("gem"), model, provider: this.type, text, toolCalls, finishReason: toolCalls.length ? "tool_calls" : finish === "MAX_TOKENS" ? "length" : "stop", usage } };
  }

  async embed(req: EmbedRequest): Promise<EmbedResponse> {
    const body = { requests: req.input.map((t) => ({ model: `models/${req.model}`, content: { parts: [{ text: t }] }, ...(req.dimensions ? { outputDimensionality: req.dimensions } : {}) })) };
    const j = await fetchJson<{ embeddings?: Array<{ values: number[] }> }>(this.type, `${this.baseUrl}/models/${req.model}:batchEmbedContents`, { method: "POST", headers: await this.headers(), body: JSON.stringify(body) });
    return { embeddings: (j.embeddings ?? []).map((e) => e.values), usage: { inputTokens: 0, outputTokens: 0 }, model: req.model, provider: this.type };
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
