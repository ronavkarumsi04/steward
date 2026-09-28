import type { Hono } from "hono";
import { z } from "zod";
import { DEFAULT_TOOL_ALLOWLIST } from "@steward/agents";
import { MCP_LIMITS, MCP_TRANSPORTS, applyGrant, describeInstall, grantedBy, installOf, mcpTarget, type McpServerRow, type McpToolRow } from "@steward/core";
import { companyScope, param, type AppEnv } from "../context.js";
import { defineRoute, type RouteRegistry } from "../route.js";

/**
 * The MCP marketplace surface.
 *
 * The important thing this file does *not* have is a second permission store. A grant is a write to the agent's
 * own `toolAllowlist` — the field the runtime already reads — composed here by `applyGrant`, which is pure and
 * uses the same matcher the runtime uses. So there is no way for "the marketplace says this agent may call it" and
 * "the run could call it" to disagree, and revoking is the same act as granting.
 *
 * The second thing it does not have is an inspection that fails the request. Reaching a server is somebody else's
 * process on somebody else's host; when it is down, that is recorded on the install and returned with the read, so
 * the surface can say what happened instead of showing an error page for a third party being unavailable.
 */

const ServerBody = z.object({
  name: z.string().min(1).max(MCP_LIMITS.nameChars),
  slug: z.string().min(1).max(MCP_LIMITS.slugChars),
  purpose: z.string().max(MCP_LIMITS.purposeChars).optional(),
  transport: z.enum(MCP_TRANSPORTS),
  command: z.string().max(MCP_LIMITS.commandChars).nullable().optional(),
  args: z.array(z.string().max(MCP_LIMITS.argChars)).max(MCP_LIMITS.args).optional(),
  env: z.record(z.string().max(MCP_LIMITS.envKeyChars), z.string().max(MCP_LIMITS.envValueChars)).optional(),
  cwd: z.string().max(MCP_LIMITS.commandChars).nullable().optional(),
  url: z.string().max(MCP_LIMITS.urlChars).nullable().optional(),
  headers: z.record(z.string().max(200), z.string().max(MCP_LIMITS.headerValueChars)).optional(),
  enabled: z.boolean().optional(),
});
/** Every field optional except that a slug may not be changed by an edit — core refuses that, and says why. */
const PatchBody = ServerBody.partial();

export function registerMcpRoutes(app: Hono<AppEnv>, reg: RouteRegistry) {
  /**
   * The whole surface in one read: the installs, what each one may do, and which agents already hold what.
   *
   * `grantedTo` is computed from the agent's *effective* allowlist — the one it explicitly has, or its role's
   * defaults when it has none — because that is what the runtime will actually use.
   */
  defineRoute(app, reg, { method: "get", path: "/companies/:companyId/mcp", tag: "mcp", summary: "The MCP servers this company installed, what each may do, and who may call what" }, async (c) => {
    const scope = await companyScope(c, param(c, "companyId"));
    const deps = c.get("deps");
    const [state, roster] = await Promise.all([deps.services.mcp.state(scope), deps.services.mcp.agents(scope)]);
    const agents = roster.map((agent) => ({ ...agent, effective: agent.toolAllowlist.length ? agent.toolAllowlist : (DEFAULT_TOOL_ALLOWLIST[agent.kind] ?? DEFAULT_TOOL_ALLOWLIST.custom!) }));

    return c.json({
      servers: state.map(({ server, tools: rows }) =>
        serialize(
          server,
          rows.map((tool) =>
            toolView(
              tool,
              agents.map((agent) => ({ agentId: agent.id, agentName: agent.name, pattern: grantedBy(agent.effective, tool.toolName) })).filter((row): row is { agentId: string; agentName: string; pattern: string } => row.pattern !== null),
            ),
          ),
        ),
      ),
      agents: agents.map((agent) => ({ id: agent.id, name: agent.name, kind: agent.kind, enabled: agent.enabled })),
      catalog: {
        transports: MCP_TRANSPORTS,
        limits: MCP_LIMITS,
        /** Whether this deployment runs programs for stdio installs, and whether it dials its own network. */
        stdio: deps.services.mcp.policy.stdio,
        privateTargets: deps.services.mcp.policy.allowPrivate,
      },
      canManage: scope.role === "owner" || scope.role === "admin",
    });
  });

  /** Installing stores what a founder asked for. It does not connect: reaching out is inspecting, and is its own act. */
  defineRoute(app, reg, { method: "post", path: "/companies/:companyId/mcp", tag: "mcp", summary: "Install an MCP server. Nothing is connected or offered until it is inspected", body: ServerBody }, async (c, { body: input }) => {
    const scope = await companyScope(c, param(c, "companyId"), "admin");
    const deps = c.get("deps");
    const server = await deps.services.mcp.install(scope, input);
    return c.json({ server: serialize(server, []), notices: [`“${server.name}” is installed and has not been inspected, so it offers nothing yet.`] }, 201);
  });

  defineRoute(app, reg, { method: "patch", path: "/companies/:companyId/mcp/:id", tag: "mcp", summary: "Edit an install. Changing where it points discards its tool list until it is inspected again", body: PatchBody }, async (c, { body: input }) => {
    const scope = await companyScope(c, param(c, "companyId"), "admin");
    const deps = c.get("deps");
    const { server, uninspected } = await deps.services.mcp.update(scope, param(c, "id"), input);
    const toolRows = await deps.services.mcp.toolsOf(scope, server.id);
    return c.json({
      server: serialize(server, toolRows.map((tool) => toolView(tool))),
      uninspected,
      notices: uninspected ? [`Where “${server.name}” points was changed, so its tool list was discarded. Inspect it again to see what it offers now.`] : [],
    });
  });

  /** Pausing an install takes its tools away from every agent at once — the point of installing one thing. */
  defineRoute(app, reg, { method: "post", path: "/companies/:companyId/mcp/:id/enabled", tag: "mcp", summary: "Pause or resume an installed server and every tool it contributes", body: z.object({ enabled: z.boolean() }) }, async (c, { body: input }) => {
    const scope = await companyScope(c, param(c, "companyId"), "admin");
    const deps = c.get("deps");
    const server = await deps.services.mcp.setEnabled(scope, param(c, "id"), input.enabled);
    return c.json({ server: serialize(server, []) });
  });

  /**
   * Inspecting: the one act that connects. It answers 200 whether or not the server was reachable, because the
   * outcome is a fact about the install — recorded on its row — and not a failure of this request.
   */
  defineRoute(app, reg, { method: "post", path: "/companies/:companyId/mcp/:id/inspect", tag: "mcp", summary: "Connect once, record what the server offers, and report what changed since last time" }, async (c) => {
    const scope = await companyScope(c, param(c, "companyId"), "admin");
    const deps = c.get("deps");
    const inspection = await deps.services.mcp.inspect(scope, param(c, "id"));
    const toolRows = await deps.services.mcp.toolsOf(scope, inspection.server.id);
    const notices: string[] = [];
    if (inspection.ok && inspection.added.length) notices.push(`${inspection.added.length} tool(s) this server offers were recorded for the first time.`);
    if (!inspection.ok && inspection.error) notices.push(inspection.error);
    if (inspection.omitted) notices.push(`${inspection.omitted} tool(s) this server offers are not recorded, because of this deployment's per-server limits.`);
    if (inspection.removed.length) notices.push(`${inspection.removed.length} tool(s) the server no longer offers were dropped, so a grant on them now matches nothing.`);
    return c.json({
      ok: inspection.ok,
      error: inspection.error,
      added: inspection.added,
      removed: inspection.removed,
      changed: inspection.changed,
      omitted: inspection.omitted,
      total: inspection.total,
      server: serialize(inspection.server, toolRows.map((tool) => toolView(tool))),
      notices,
    });
  });

  /** Refusing one tool without removing the server: a company may want two of a server's six tools and no more. */
  defineRoute(app, reg, { method: "patch", path: "/companies/:companyId/mcp/:id/tools/:toolId", tag: "mcp", summary: "Block or unblock one tool of an installed server", body: z.object({ enabled: z.boolean() }) }, async (c, { body: input }) => {
    const scope = await companyScope(c, param(c, "companyId"), "admin");
    const deps = c.get("deps");
    const tool = await deps.services.mcp.setToolEnabled(scope, param(c, "id"), param(c, "toolId"), input.enabled);
    return c.json({ tool: { id: tool.id, name: tool.name, toolName: tool.toolName, enabled: tool.enabled } });
  });

  /**
   * Granting is the agent's own allowlist, and nothing else.
   *
   * An agent with no allowlist of its own is running on the defaults for its kind, so a grant writes those
   * defaults out explicitly alongside the grant — otherwise the first grant would quietly *remove* every tool the
   * agent had been using. The response says so rather than leaving a founder to discover it.
   */
  defineRoute(app, reg, { method: "post", path: "/companies/:companyId/mcp/:id/grant", tag: "mcp", summary: "Give an agent this server's tools, or one of them, or take them back", body: z.object({ agentId: z.string().min(1).max(60), toolNames: z.array(z.string().min(1).max(MCP_LIMITS.toolNameChars)).nullable().optional(), granted: z.boolean() }) }, async (c, { body: input }) => {
    const scope = await companyScope(c, param(c, "companyId"), "admin");
    const deps = c.get("deps");
    const server = await deps.services.mcp.required(scope, param(c, "id"));
    const agent = await deps.services.agents.get(scope, input.agentId);
    if (!agent) return c.json({ error: { code: "not_found", message: "Agent not found" } }, 404);

    const usedDefaults = agent.toolAllowlist.length === 0;
    const base = usedDefaults ? (DEFAULT_TOOL_ALLOWLIST[agent.kind] ?? DEFAULT_TOOL_ALLOWLIST.custom!) : agent.toolAllowlist;
    const recorded = await deps.services.mcp.toolsOf(scope, server.id);
    const next = applyGrant({ allowlist: base, slug: server.slug, toolNames: input.toolNames ?? null, serverTools: recorded.map((tool) => tool.toolName), granted: input.granted });
    await deps.services.agents.update(scope, agent.id, { toolAllowlist: next });

    const notices: string[] = [];
    if (usedDefaults && input.granted) notices.push(`“${agent.name}” had no tools of its own and was using the defaults for a ${agent.kind} agent, so those defaults are now written out beside the grant.`);
    if (!recorded.length) notices.push(`“${server.name}” has not been inspected, so it has nothing to grant yet. Inspect it first.`);
    return c.json({ agent: { id: agent.id, name: agent.name, toolAllowlist: next }, granted: input.granted, toolNames: input.toolNames ?? null, notices });
  });

  defineRoute(app, reg, { method: "delete", path: "/companies/:companyId/mcp/:id", tag: "mcp", summary: "Remove an installed server and every tool it contributed" }, async (c) => {
    const scope = await companyScope(c, param(c, "companyId"), "admin");
    const deps = c.get("deps");
    const removed = await deps.services.mcp.remove(scope, param(c, "id"));
    return c.json({ ok: true, removed: { slug: removed.slug, tools: removed.tools } });
  });
}

type SerializedTool = {
  id: string;
  name: string;
  toolName: string;
  description: string;
  risk: string;
  riskSource: string;
  riskReason: string;
  sideEffects: string;
  idempotent: boolean;
  dimension: string | null;
  enabled: boolean;
  grantedTo: Array<{ agentId: string; agentName: string; pattern: string }>;
};

/**
 * One stored tool as the surface reads it.
 *
 * `name` is what the server answers to and `toolName` is what a grant is written in terms of; both are sent,
 * because a founder reading a tool list and a founder writing an allowlist should be looking at the same two
 * things the runtime is.
 */
function toolView(tool: McpToolRow, grantedTo: SerializedTool["grantedTo"] = []): SerializedTool {
  return {
    id: tool.id,
    name: tool.name,
    toolName: tool.toolName,
    description: tool.description,
    risk: tool.risk,
    riskSource: tool.riskSource,
    riskReason: tool.riskReason,
    sideEffects: tool.sideEffects,
    idempotent: tool.idempotent,
    dimension: tool.dimension,
    enabled: tool.enabled,
    grantedTo,
  };
}

function serialize(server: McpServerRow, tools: SerializedTool[]) {
  return {
    id: server.id,
    name: server.name,
    slug: server.slug,
    purpose: server.purpose,
    transport: server.transport,
    /** Where it points, in a founder's words — the command line, or the address. */
    target: mcpTarget(installOf(server)),
    description: describeInstall(server),
    enabled: server.enabled,
    inspectedAt: server.lastInspectedAt,
    error: server.lastError,
    // What the edit form starts from. The destination is not secret, so it is sent as it is.
    command: server.command,
    args: server.args,
    url: server.url,
    /**
     * The variables and headers this install carries, by name only.
     *
     * A credential typed into this form is often the only copy of it, and this read is available to viewers as
     * well as admins, so what came from the company is that these variables exist — never their values. An edit
     * that leaves the text empty keeps what is stored, which is said out loud under the field.
     */
    envKeys: Object.keys(server.env),
    headerKeys: Object.keys(server.headers),
    tools,
  };
}
