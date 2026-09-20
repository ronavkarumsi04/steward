import type { ModelInfo, ProviderTypeInfo } from "@steward/schema";
import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand,
  InvokeModelCommand,
  type ContentBlock,
  type Message,
  type SystemContentBlock,
  type Tool,
} from "@aws-sdk/client-bedrock-runtime";
import type { DocumentType } from "@smithy/types";
import { providerTypeMap, seedModelsFor } from "../catalog.js";
import { genId } from "../http.js";
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

function toBedrock(messages: ChatMessage[]): { system: SystemContentBlock[]; messages: Message[] } {
  const system: SystemContentBlock[] = [];
  const out: Message[] = [];
  for (const m of messages) {
    if (m.role === "system") {
      system.push({ text: typeof m.content === "string" ? m.content : m.content.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("\n") });
      continue;
    }
    const role = m.role === "assistant" ? "assistant" : "user";
    const blocks: ContentBlock[] = [];
    if (typeof m.content === "string") blocks.push({ text: m.content });
    else
      for (const p of m.content) {
        if (p.type === "text") blocks.push({ text: p.text });
        else if (p.type === "image") blocks.push({ image: { format: (p.mimeType.split("/")[1] ?? "png") as "png", source: { bytes: Buffer.from(p.data, "base64") } } });
        else if (p.type === "tool_call") blocks.push({ toolUse: { toolUseId: p.id, name: p.name, input: p.arguments as DocumentType } });
        else if (p.type === "tool_result") blocks.push({ toolResult: { toolUseId: p.toolCallId, content: [{ text: p.content }], status: p.isError ? "error" : "success" } });
      }
    const last = out[out.length - 1];
    if (last && last.role === role) last.content!.push(...blocks);
    else out.push({ role, content: blocks });
  }
  return { system, messages: out };
}

function mapError(e: unknown): ProviderError {
  const err = e as { name?: string; message?: string; $metadata?: { httpStatusCode?: number } };
  const status = err.$metadata?.httpStatusCode;
  const name = err.name ?? "";
  if (name === "ThrottlingException") return new ProviderError("rate_limit", err.message ?? name, "bedrock", true, status);
  if (name === "AccessDeniedException" || name === "UnrecognizedClientException" || name === "InvalidSignatureException") return new ProviderError("auth", err.message ?? name, "bedrock", false, status);
  if (name === "ValidationException") return new ProviderError(/too long|token/i.test(err.message ?? "") ? "context_length" : "invalid_request", err.message ?? name, "bedrock", false, status);
  if (name === "ResourceNotFoundException") return new ProviderError("not_found", err.message ?? name, "bedrock", false, status);
  if (name === "ModelTimeoutException") return new ProviderError("timeout", err.message ?? name, "bedrock", true, status);
  if (name === "ServiceUnavailableException" || name === "InternalServerException" || name === "ModelNotReadyException") return new ProviderError("server", err.message ?? name, "bedrock", true, status);
  return new ProviderError("unknown", err.message ?? String(e), "bedrock", false, status);
}

export class BedrockAdapter implements ProviderAdapter {
  readonly type = "bedrock";
  readonly info: ProviderTypeInfo = providerTypeMap.get("bedrock")!;
  private readonly client: BedrockRuntimeClient;
  private readonly region: string;

  constructor(cred: ProviderCredential) {
    const cfg = cred.config ?? {};
    this.region = String(cfg.region ?? "us-east-1");
    const accessKeyId = String(cfg.accessKeyId ?? "");
    const secretAccessKey = cred.apiKey ?? String(cfg.secretAccessKey ?? "");
    this.client = new BedrockRuntimeClient({
      region: this.region,
      ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey, sessionToken: cfg.sessionToken ? String(cfg.sessionToken) : undefined } } : {}),
      ...(cred.baseUrl ? { endpoint: cred.baseUrl } : {}),
    });
  }

  async listModels(): Promise<ModelInfo[]> {
    // ListFoundationModels lives in the control-plane client; keep the runtime-only dependency and use the seed list
    // plus any model ids configured by the operator.
    return seedModelsFor(this.type);
  }

  private tools(req: ChatRequest): Tool[] | undefined {
    const tools: Tool[] = (req.tools ?? []).map((t) => ({ toolSpec: { name: t.name, description: t.description, inputSchema: { json: t.parameters as DocumentType } } }));
    if (req.responseFormat?.type === "json_schema") tools.push({ toolSpec: { name: "__structured_output", description: "Return the final structured answer.", inputSchema: { json: req.responseFormat.schema as DocumentType } } });
    return tools.length ? tools : undefined;
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const { system, messages } = toBedrock(req.messages);
    const tools = this.tools(req);
    try {
      const out = await this.client.send(
        new ConverseCommand({
          modelId: req.model,
          system: system.length ? system : undefined,
          messages,
          inferenceConfig: { maxTokens: req.maxTokens ?? 4096, temperature: req.temperature, stopSequences: req.stop },
          toolConfig: tools ? { tools, ...(req.responseFormat?.type === "json_schema" ? { toolChoice: { tool: { name: "__structured_output" } } } : req.toolChoice === "required" ? { toolChoice: { any: {} } } : {}) } : undefined,
        }),
        { abortSignal: req.signal },
      );
      let text = "";
      const toolCalls: ToolCall[] = [];
      for (const b of out.output?.message?.content ?? []) {
        if (b.text) text += b.text;
        if (b.toolUse) {
          if (b.toolUse.name === "__structured_output") text = JSON.stringify(b.toolUse.input ?? {});
          else toolCalls.push({ id: b.toolUse.toolUseId ?? genId(), name: b.toolUse.name ?? "", arguments: (b.toolUse.input as Record<string, unknown>) ?? {} });
        }
      }
      const usage: Usage = { inputTokens: out.usage?.inputTokens ?? 0, outputTokens: out.usage?.outputTokens ?? 0, cachedTokens: out.usage?.cacheReadInputTokens };
      return { id: genId("bdrk"), model: req.model, provider: this.type, text, toolCalls, finishReason: toolCalls.length ? "tool_calls" : out.stopReason === "max_tokens" ? "length" : "stop", usage, raw: out };
    } catch (e) {
      throw mapError(e);
    }
  }

  async *stream(req: ChatRequest): AsyncIterable<ChatEvent> {
    const { system, messages } = toBedrock(req.messages);
    const tools = this.tools(req);
    let res;
    try {
      res = await this.client.send(
        new ConverseStreamCommand({
          modelId: req.model,
          system: system.length ? system : undefined,
          messages,
          inferenceConfig: { maxTokens: req.maxTokens ?? 4096, temperature: req.temperature, stopSequences: req.stop },
          toolConfig: tools ? { tools } : undefined,
        }),
        { abortSignal: req.signal },
      );
    } catch (e) {
      throw mapError(e);
    }
    let text = "";
    let usage: Usage = { inputTokens: 0, outputTokens: 0 };
    const calls = new Map<number, { id: string; name: string; json: string }>();
    const toolCalls: ToolCall[] = [];
    let stop = "end_turn";
    try {
      for await (const ev of res.stream ?? []) {
        if (ev.contentBlockStart?.start?.toolUse) {
          const tu = ev.contentBlockStart.start.toolUse;
          const entry = { id: tu.toolUseId ?? genId(), name: tu.name ?? "", json: "" };
          calls.set(ev.contentBlockStart.contentBlockIndex ?? 0, entry);
          yield { type: "tool_call_start", id: entry.id, name: entry.name };
        }
        if (ev.contentBlockDelta?.delta) {
          const d = ev.contentBlockDelta.delta;
          if (d.text) {
            text += d.text;
            yield { type: "text_delta", delta: d.text };
          }
          if (d.reasoningContent?.text) yield { type: "reasoning_delta", delta: d.reasoningContent.text };
          if (d.toolUse?.input) {
            const entry = calls.get(ev.contentBlockDelta.contentBlockIndex ?? 0);
            if (entry) {
              entry.json += d.toolUse.input;
              yield { type: "tool_call_delta", id: entry.id, argumentsDelta: d.toolUse.input };
            }
          }
        }
        if (ev.contentBlockStop) {
          const entry = calls.get(ev.contentBlockStop.contentBlockIndex ?? 0);
          if (entry) {
            let args: Record<string, unknown> = {};
            try {
              args = JSON.parse(entry.json || "{}");
            } catch {
              args = { _raw: entry.json };
            }
            toolCalls.push({ id: entry.id, name: entry.name, arguments: args });
            yield { type: "tool_call_end", id: entry.id, name: entry.name, arguments: args };
          }
        }
        if (ev.messageStop?.stopReason) stop = ev.messageStop.stopReason;
        if (ev.metadata?.usage) {
          usage = { inputTokens: ev.metadata.usage.inputTokens ?? 0, outputTokens: ev.metadata.usage.outputTokens ?? 0, cachedTokens: ev.metadata.usage.cacheReadInputTokens };
          yield { type: "usage", usage };
        }
      }
    } catch (e) {
      yield { type: "error", error: mapError(e) };
      return;
    }
    yield { type: "done", response: { id: genId("bdrk"), model: req.model, provider: this.type, text, toolCalls, finishReason: toolCalls.length ? "tool_calls" : stop === "max_tokens" ? "length" : "stop", usage } };
  }

  async embed(req: EmbedRequest): Promise<EmbedResponse> {
    const embeddings: number[][] = [];
    for (const input of req.input) {
      try {
        const out = await this.client.send(new InvokeModelCommand({ modelId: req.model, contentType: "application/json", accept: "application/json", body: JSON.stringify({ inputText: input, ...(req.dimensions ? { dimensions: req.dimensions } : {}) }) }));
        const j = JSON.parse(Buffer.from(out.body).toString("utf8")) as { embedding: number[] };
        embeddings.push(j.embedding);
      } catch (e) {
        throw mapError(e);
      }
    }
    return { embeddings, usage: { inputTokens: 0, outputTokens: 0 }, model: req.model, provider: this.type };
  }

  async testConnection() {
    try {
      await this.chat({ model: String(process.env.BEDROCK_TEST_MODEL ?? "amazon.nova-micro-v1:0"), messages: [{ role: "user", content: "ping" }], maxTokens: 5 });
      return { ok: true as const, models: seedModelsFor(this.type).length };
    } catch (e) {
      return { ok: false as const, error: e instanceof ProviderError ? e : mapError(e) };
    }
  }
}
