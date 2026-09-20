import type { ModelInfo, ProviderTypeInfo } from "@steward/schema";

export type Role = "system" | "user" | "assistant" | "tool";

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image"; mimeType: string; data: string; detail?: "low" | "high" | "auto" }
  | { type: "tool_call"; id: string; name: string; arguments: Record<string, unknown> }
  | { type: "tool_result"; toolCallId: string; content: string; isError?: boolean };

export interface ChatMessage {
  role: Role;
  content: string | ContentPart[];
  name?: string;
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  toolChoice?: "auto" | "none" | "required" | { name: string };
  responseFormat?: { type: "json_schema"; name: string; schema: Record<string, unknown> } | { type: "json" } | { type: "text" };
  temperature?: number;
  maxTokens?: number;
  reasoning?: { effort: "low" | "medium" | "high" };
  stop?: string[];
  metadata?: Record<string, string>;
  signal?: AbortSignal;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens?: number;
  reasoningTokens?: number;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatResponse {
  id: string;
  model: string;
  provider: string;
  text: string;
  toolCalls: ToolCall[];
  finishReason: "stop" | "tool_calls" | "length" | "content_filter" | "error" | "other";
  usage: Usage;
  raw?: unknown;
}

export type ChatEvent =
  | { type: "text_delta"; delta: string }
  | { type: "reasoning_delta"; delta: string }
  | { type: "tool_call_start"; id: string; name: string }
  | { type: "tool_call_delta"; id: string; argumentsDelta: string }
  | { type: "tool_call_end"; id: string; name: string; arguments: Record<string, unknown> }
  | { type: "usage"; usage: Usage }
  | { type: "done"; response: ChatResponse }
  | { type: "error"; error: ProviderError };

export interface EmbedRequest {
  model: string;
  input: string[];
  dimensions?: number;
}

export interface EmbedResponse {
  embeddings: number[][];
  usage: Usage;
  model: string;
  provider: string;
}

export type ProviderErrorCode =
  | "auth"
  | "rate_limit"
  | "quota"
  | "invalid_request"
  | "not_found"
  | "context_length"
  | "content_filter"
  | "server"
  | "network"
  | "timeout"
  | "unsupported"
  | "unknown";

export class ProviderError extends Error {
  constructor(
    public readonly code: ProviderErrorCode,
    message: string,
    public readonly provider: string,
    public readonly retryable: boolean,
    public readonly status?: number,
    public readonly retryAfterMs?: number,
    public readonly raw?: unknown,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export interface ProviderCredential {
  apiKey?: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  /** Provider-specific structured config (region, project, deployment names, service account JSON, ...) */
  config?: Record<string, unknown>;
}

export interface ProviderAdapter {
  readonly type: string;
  readonly info: ProviderTypeInfo;
  listModels(): Promise<ModelInfo[]>;
  chat(req: ChatRequest): Promise<ChatResponse>;
  stream(req: ChatRequest): AsyncIterable<ChatEvent>;
  embed?(req: EmbedRequest): Promise<EmbedResponse>;
  testConnection(): Promise<{ ok: true; models: number } | { ok: false; error: ProviderError }>;
}

export interface AdapterFactory {
  (credential: ProviderCredential, providerType: string): ProviderAdapter;
}
