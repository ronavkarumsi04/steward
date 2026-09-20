import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { RiskLevel, ToolManifest } from "@steward/schema";
import { z } from "zod";
import { untrusted, type ToolDefinition } from "./registry.js";

export type McpServerConfig =
  | { id: string; name: string; transport: "stdio"; command: string; args?: string[]; env?: Record<string, string>; cwd?: string }
  | { id: string; name: string; transport: "http" | "sse"; url: string; headers?: Record<string, string> };

export interface McpToolPolicy {
  /** Default risk assigned to tools from this server unless overridden. */
  defaultRisk?: RiskLevel;
  /** Per-tool overrides keyed by the raw MCP tool name. */
  overrides?: Record<string, { risk?: RiskLevel; dimension?: ToolManifest["dimension"]; sideEffects?: ToolManifest["sideEffects"]; idempotent?: boolean }>;
  /** Only expose these tools (raw names). */
  allow?: string[];
}

function safeName(server: string, tool: string): string {
  const s = `mcp.${server}.${tool}`.toLowerCase().replace(/[^a-z0-9_.]/g, "_");
  return s.replace(/^[^a-z]+/, "m");
}

/** Heuristic classification for MCP tools without explicit policy. Read-only hints → LOW; otherwise MEDIUM external. */
function classify(tool: { name: string; description?: string; annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean } }, policy: McpToolPolicy) {
  const o = policy.overrides?.[tool.name] ?? {};
  const ro = tool.annotations?.readOnlyHint === true || /^(get|list|read|search|find|fetch|describe|query)[_-]/i.test(tool.name);
  const destructive = tool.annotations?.destructiveHint === true || /(delete|remove|drop|destroy|purge)/i.test(tool.name);
  const risk: RiskLevel = o.risk ?? (ro ? "LOW" : destructive ? "HIGH" : policy.defaultRisk ?? "MEDIUM");
  return {
    risk,
    sideEffects: o.sideEffects ?? (ro ? ("none" as const) : ("external" as const)),
    idempotent: o.idempotent ?? (tool.annotations?.idempotentHint === true || ro),
    dimension: o.dimension ?? (ro ? undefined : ("external_write" as const)),
  };
}

export class McpConnection {
  private client?: Client;

  constructor(readonly config: McpServerConfig, readonly policy: McpToolPolicy = {}) {}

  async connect(): Promise<void> {
    const client = new Client({ name: "steward", version: "0.1.0" }, { capabilities: {} });
    if (this.config.transport === "stdio") {
      await client.connect(new StdioClientTransport({ command: this.config.command, args: this.config.args ?? [], env: { ...filteredEnv(), ...(this.config.env ?? {}) }, cwd: this.config.cwd, stderr: "pipe" }));
    } else if (this.config.transport === "http") {
      await client.connect(new StreamableHTTPClientTransport(new URL(this.config.url), { requestInit: { headers: this.config.headers } }));
    } else {
      await client.connect(new SSEClientTransport(new URL(this.config.url), { requestInit: { headers: this.config.headers } }));
    }
    this.client = client;
  }

  async close(): Promise<void> {
    await this.client?.close();
    this.client = undefined;
  }

  async tools(): Promise<ToolDefinition[]> {
    if (!this.client) await this.connect();
    const client = this.client!;
    const { tools } = await client.listTools();
    const serverSlug = this.config.name.toLowerCase().replace(/[^a-z0-9]+/g, "_");
    return tools
      .filter((t) => !this.policy.allow || this.policy.allow.includes(t.name))
      .map((t) => {
        const c = classify(t, this.policy);
        const name = safeName(serverSlug, t.name);
        const inputSchema = (t.inputSchema as Record<string, unknown>) ?? { type: "object", properties: {} };
        return {
          manifest: {
            name,
            description: `[MCP: ${this.config.name}] ${t.description ?? t.name}`,
            inputSchema,
            scopes: [],
            risk: c.risk,
            dimension: c.dimension,
            idempotent: c.idempotent,
            sideEffects: c.sideEffects,
            timeoutMs: 120_000,
            costCategory: "none",
            source: "mcp",
          },
          input: z.record(z.string(), z.unknown()),
          execute: async (input) => {
            const res = await client.callTool({ name: t.name, arguments: input as Record<string, unknown> });
            const content = (res.content as Array<{ type: string; text?: string; data?: string; mimeType?: string }> | undefined) ?? [];
            const text = content.map((c) => (c.type === "text" ? c.text ?? "" : c.type === "image" ? `[image ${c.mimeType}]` : `[${c.type}]`)).join("\n");
            const structured = res.structuredContent;
            return { ok: !res.isError, content: untrusted(`mcp:${this.config.name}/${t.name}`, text || JSON.stringify(structured ?? {})), data: structured ?? content, untrusted: true };
          },
        } satisfies ToolDefinition;
      });
  }
}

/** Environment passed to stdio MCP servers: PATH/HOME/locale only — never control-plane secrets. */
function filteredEnv(): Record<string, string> {
  const keep = ["PATH", "HOME", "LANG", "LC_ALL", "TMPDIR", "TEMP", "TMP", "SystemRoot", "USERPROFILE"];
  const out: Record<string, string> = {};
  for (const k of keep) if (process.env[k]) out[k] = process.env[k]!;
  return out;
}
