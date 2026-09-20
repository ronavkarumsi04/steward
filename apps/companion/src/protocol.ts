/** Wire types shared with the Steward API companion routes. Kept dependency-free so the CLI installs standalone. */

export const COMMANDS = ["ping", "codex.status", "codex.exec"] as const;
export type Command = (typeof COMMANDS)[number];

export interface PendingCommand {
  id: string;
  command: Command;
  payload: Record<string, unknown>;
  streaming: boolean;
}

export type ResultMessage =
  | { id: string; type: "result"; result: Record<string, unknown> }
  | { id: string; type: "event"; event: Record<string, unknown> }
  | { id: string; type: "error"; error: string };

export interface ExecMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

export interface ExecTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export type ExecResponseFormat = { type: "json_schema"; name: string; schema: Record<string, unknown> } | { type: "json" } | { type: "text" };

/** Payload of `codex.exec` as produced by the control plane's CodexCompanionAdapter. */
export interface ExecPayload {
  model?: string;
  messages: ExecMessage[];
  tools?: ExecTool[];
  responseFormat?: ExecResponseFormat;
  maxTokens?: number;
  metadata?: Record<string, string>;
}

export interface ExecResult {
  text: string;
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  usage?: { inputTokens: number; outputTokens: number; cachedTokens?: number; reasoningTokens?: number };
  model?: string;
  threadId?: string;
  error?: string;
}

export interface StatusResult {
  loggedIn: boolean;
  version?: string;
  models: string[];
  detail?: string;
}
