import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExecPayload, ExecResult, ExecTool, StatusResult } from "./protocol.js";

export interface CodexOptions {
  bin: string;
  sandbox: "read-only" | "workspace-write";
  timeoutMs?: number;
  signal?: AbortSignal;
  onEvent?: (ev: { type: "text_delta" | "reasoning_delta"; delta: string }) => void;
}

interface RunOutput {
  code: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Windows cannot exec extensionless scripts or .cmd shims directly via spawn (and Node blocks
 * .cmd/.bat without a shell). Route everything except native executables through the shell there,
 * quoting args ourselves since Node joins them verbatim when shell is enabled.
 */
function spawnCommand(bin: string, args: string[]): { file: string; args: string[]; shell: boolean } {
  if (process.platform !== "win32" || /\.(exe|com)$/i.test(bin)) return { file: bin, args, shell: false };
  return { file: bin, args: args.map((a) => (/\s|"/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)), shell: true };
}

function run(bin: string, args: string[], opts: { stdin?: string; timeoutMs?: number; signal?: AbortSignal; cwd?: string; onLine?: (line: string) => void }): Promise<RunOutput> {
  return new Promise((resolve, reject) => {
    const cmd = spawnCommand(bin, args);
    const child = spawn(cmd.file, cmd.args, { cwd: opts.cwd, stdio: ["pipe", "pipe", "pipe"], env: process.env, shell: cmd.shell });
    let stdout = "";
    let stderr = "";
    let partial = "";
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      fn();
    };
    const kill = (why: string) => finish(() => {
      child.kill("SIGKILL");
      reject(new Error(why));
    });
    const onAbort = () => kill("aborted");
    const timer = setTimeout(() => kill(`codex timed out after ${opts.timeoutMs}ms`), opts.timeoutMs ?? 15 * 60_000);
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    child.on("error", (e) => finish(() => reject(e)));
    child.stdout.on("data", (d: Buffer) => {
      const s = d.toString();
      stdout += s;
      if (!opts.onLine) return;
      partial += s;
      const lines = partial.split("\n");
      partial = lines.pop() ?? "";
      for (const l of lines) if (l.trim()) opts.onLine(l);
    });
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("close", (code) => finish(() => {
      // With shell:true a missing executable exits non-zero with a cmd message instead of ENOENT.
      if (cmd.shell && code !== 0 && /cannot find the path|is not recognized/i.test(stderr)) {
        reject(Object.assign(new Error(`spawn ${bin} ENOENT`), { code: "ENOENT" }));
        return;
      }
      if (partial.trim() && opts.onLine) opts.onLine(partial);
      resolve({ code, stdout, stderr });
    }));
    if (opts.stdin !== undefined) child.stdin.end(opts.stdin);
    else child.stdin.end();
  });
}

/** `codex login status` exits 0 when a login is cached; we never read the token file ourselves. */
export async function codexStatus(bin: string): Promise<StatusResult> {
  let version: string | undefined;
  try {
    const v = await run(bin, ["--version"], { timeoutMs: 15_000 });
    version = v.stdout.trim() || undefined;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { loggedIn: false, models: [], detail: `codex CLI not found (${msg}). Install: npm i -g @openai/codex` };
  }
  try {
    const st = await run(bin, ["login", "status"], { timeoutMs: 20_000 });
    const detail = (st.stdout + st.stderr).trim();
    return { loggedIn: st.code === 0, version, models: [], detail: detail || undefined };
  } catch (e) {
    return { loggedIn: false, version, models: [], detail: e instanceof Error ? e.message : String(e) };
  }
}

const TOOL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["text", "tool_calls"],
  properties: {
    text: { type: "string", description: "Your reply to the user. Empty string when you are only calling tools." },
    tool_calls: {
      type: "array",
      description: "Tools to invoke now. Leave empty when the task is complete.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "arguments_json"],
        properties: { name: { type: "string" }, arguments_json: { type: "string", description: "JSON-encoded object of arguments matching the tool's schema" } },
      },
    },
  },
} as const;

/** Renders the normalized chat transcript into a single Codex prompt. Codex has no multi-turn API in exec mode. */
export function buildPrompt(payload: ExecPayload): string {
  const parts: string[] = [];
  const system = payload.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  if (system) parts.push(`# Instructions\n\n${system}`);
  parts.push("# Operating rules\n\nYou are running non-interactively inside Steward. Do not ask clarifying questions; make the best decision from the transcript. Do not modify files outside the working directory. Reply only with your final answer.");
  if (payload.tools?.length) {
    parts.push(`# Available tools\n\nYou may request tool invocations. Tools are executed by Steward, not by you; you will see their results in a later turn. Respond with the required JSON shape: put your reply in \`text\` and any tool requests in \`tool_calls\`.\n\n${payload.tools.map(renderTool).join("\n\n")}`);
  }
  if (payload.responseFormat?.type === "json_schema" && payload.tools?.length) {
    parts.push(`# Final answer format\n\nWhen the task is complete and no tools are needed, \`text\` MUST be a JSON document matching this schema:\n\n\`\`\`json\n${JSON.stringify(payload.responseFormat.schema)}\n\`\`\``);
  } else if (payload.responseFormat?.type === "json") {
    parts.push("# Final answer format\n\nReply with a single JSON document and nothing else.");
  }
  const transcript = payload.messages
    .filter((m) => m.role !== "system")
    .map((m) => `### ${m.role === "tool" ? "tool result" : m.role}\n\n${m.content}`)
    .join("\n\n");
  parts.push(`# Conversation\n\n${transcript || "(empty)"}`);
  parts.push("### assistant\n\n");
  return parts.join("\n\n");
}

function renderTool(t: ExecTool): string {
  return `## ${t.name}\n${t.description}\nArguments JSON Schema: ${JSON.stringify(t.parameters)}`;
}

interface JsonlEvent {
  type?: string;
  thread_id?: string;
  item?: { type?: string; text?: string; id?: string };
  usage?: { input_tokens?: number; cached_input_tokens?: number; output_tokens?: number; reasoning_output_tokens?: number };
  message?: string;
  error?: { message?: string } | string;
}

export interface ParsedEvents {
  agentMessages: string[];
  usage?: ExecResult["usage"];
  threadId?: string;
  errors: string[];
}

/** Parses `codex exec --json` JSONL output. Unknown event shapes are ignored so CLI upgrades degrade gracefully. */
export function parseJsonl(lines: string[]): ParsedEvents {
  const out: ParsedEvents = { agentMessages: [], errors: [] };
  for (const line of lines) {
    let ev: JsonlEvent;
    try {
      ev = JSON.parse(line) as JsonlEvent;
    } catch {
      continue;
    }
    if (ev.thread_id && ev.type === "thread.started") out.threadId = ev.thread_id;
    if (ev.type === "item.completed" && ev.item?.type === "agent_message" && typeof ev.item.text === "string") out.agentMessages.push(ev.item.text);
    if (ev.type === "turn.completed" && ev.usage) {
      out.usage = { inputTokens: ev.usage.input_tokens ?? 0, outputTokens: ev.usage.output_tokens ?? 0, cachedTokens: ev.usage.cached_input_tokens, reasoningTokens: ev.usage.reasoning_output_tokens };
    }
    if (ev.type === "error" || ev.type === "turn.failed") {
      const msg = typeof ev.error === "string" ? ev.error : ev.error?.message ?? ev.message;
      if (msg) out.errors.push(msg);
    }
  }
  return out;
}

/** Turns the model's final text into an ExecResult, decoding the tool-call envelope when tools were offered. */
export function interpretFinal(text: string, hadTools: boolean): Pick<ExecResult, "text" | "toolCalls"> {
  if (!hadTools) return { text };
  try {
    const parsed = JSON.parse(text) as { text?: unknown; tool_calls?: Array<{ name?: unknown; arguments_json?: unknown }> };
    const toolCalls = (parsed.tool_calls ?? [])
      .filter((c) => typeof c.name === "string")
      .map((c) => {
        let args: Record<string, unknown> = {};
        if (typeof c.arguments_json === "string") {
          try {
            const a = JSON.parse(c.arguments_json) as unknown;
            if (a && typeof a === "object" && !Array.isArray(a)) args = a as Record<string, unknown>;
          } catch {
            args = { _raw: c.arguments_json };
          }
        }
        return { id: `call_${randomUUID().slice(0, 12)}`, name: String(c.name), arguments: args };
      });
    return { text: typeof parsed.text === "string" ? parsed.text : "", toolCalls };
  } catch {
    return { text, toolCalls: [] };
  }
}

export async function codexExec(payload: ExecPayload, opts: CodexOptions): Promise<ExecResult> {
  const work = await mkdtemp(join(tmpdir(), "steward-codex-"));
  try {
    const lastFile = join(work, ".steward-last-message.txt");
    const args = ["exec", "--json", "--ephemeral", "--skip-git-repo-check", "--color", "never", "-s", opts.sandbox, "-C", work, "-o", lastFile];
    const hadTools = !!payload.tools?.length;
    const schema = hadTools ? TOOL_SCHEMA : payload.responseFormat?.type === "json_schema" ? payload.responseFormat.schema : undefined;
    if (schema) {
      const schemaFile = join(work, ".steward-output-schema.json");
      await writeFile(schemaFile, JSON.stringify(schema));
      args.push("--output-schema", schemaFile);
    }
    if (payload.model) args.push("-m", payload.model);
    args.push("-");

    const lines: string[] = [];
    const res = await run(opts.bin, args, {
      stdin: buildPrompt(payload),
      cwd: work,
      timeoutMs: opts.timeoutMs,
      signal: opts.signal,
      onLine: (l) => {
        lines.push(l);
        const p = parseJsonl([l]);
        for (const m of p.agentMessages) opts.onEvent?.({ type: "text_delta", delta: m });
      },
    });
    const parsed = parseJsonl(lines);
    let finalText = "";
    try {
      finalText = await readFile(lastFile, "utf8");
    } catch {
      finalText = parsed.agentMessages.at(-1) ?? "";
    }
    if (res.code !== 0 && !finalText.trim()) {
      const err = parsed.errors.at(-1) ?? res.stderr.trim().split("\n").slice(-5).join("\n") ?? `codex exited with ${res.code}`;
      return { text: "", error: /login|logged in|auth|unauthorized|401/i.test(err) ? `Codex CLI login required: ${err}` : err, usage: parsed.usage, threadId: parsed.threadId };
    }
    return { ...interpretFinal(finalText.trim(), hadTools), usage: parsed.usage, threadId: parsed.threadId, model: payload.model };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
