/**
 * The MCP marketplace: install a server, and see what it may do.
 *
 * A company's tools are not all ours. Steward ships the ones that describe a business — mail, code, a browser, a
 * deploy — and the long tail of what a particular company actually runs lives behind somebody else's server.
 * This file is the company's half of that seam: what was installed, what it turned out to offer, and who may
 * call what. Five decisions hold it together, and every one of them is here because the alternative is a
 * marketplace that looks like a way to give an agent a new power without anybody having read it.
 *
 *   1. **Installing and inspecting are two different acts.** An install stores what a founder asked for and is
 *      validated on its own terms (`validateMcpInstall`): where it points, what it is called, that its slug is
 *      free. It does not open a connection. Inspecting is the act that connects once, asks the server what it
 *      offers, and writes the answer down. A form that both saved and reached out would make "install" a request
 *      to an arbitrary address on the internet with a side effect nobody asked for.
 *   2. **The rows are the record, not a cache.** The runtime builds an agent's tools from `mcp_tools` rather than
 *      from a live handshake, so a run never begins by waiting on somebody else's process, and the surface can
 *      always answer what a server may do without the network. A server whose tools changed is therefore
 *      *drift*, reported on the next inspection (`added`, `removed`, `changed`) instead of quietly replacing
 *      what a founder read.
 *   3. **A failed inspection is the server's condition, not the request's.** Reaching a server is somebody
 *      else's process on somebody else's host; when it is down, that is a fact about the install. It is recorded
 *      on the row (`lastError`) and returned with the read, so the surface says "it could not be reached, at
 *      this time, for this reason" rather than turning a broken server into a broken page.
 *   4. **Nothing is granted by itself.** A tool exists in the registry the moment its install is inspected and
 *      reaches an agent only through the allowlist that already exists — `mcp.<slug>.<tool>`, or the whole
 *      server as `mcp.<slug>.*`. No default allowlist mentions `mcp.`, so installing a server changes what no
 *      agent may do, and the surface's job is to make granting an informed, deliberate act.
 *   5. **Changing where a server points un-inspects it.** An edit to the command, the address, the arguments or
 *      the headers means the recorded tool list is evidence about somewhere else, so it is discarded and the
 *      install is marked as needing another inspection. Keeping it would be the marketplace's version of the
 *      thing the product refuses everywhere else: a claim that outlived its evidence.
 *
 * Grants are the agent's own allowlist and nothing else. `applyGrant` is pure and `grantedBy` is the same
 * `matchTool` the runtime uses, so what the surface says a tool is granted to and what a run may actually call
 * cannot drift apart — and there is no second permission store to keep in step.
 */

import { isIP } from "node:net";
import { eq, inArray } from "drizzle-orm";
import { agents, emitEvent, mcpServers, mcpTools, scoped, type Db, type McpToolAnnotationsShape } from "@steward/db";
import type { RiskLevel, TenantScope, ToolManifest } from "@steward/schema";
import {
  MCP_TRANSPORTS,
  isPrivateAddress,
  listMcpTools,
  matchTool,
  mcpFailureSentence,
  mcpTarget,
  mcpToolName,
  mcpToolPattern,
  riskForMcpTool,
  type McpInstall,
  type McpToolSpec,
  type McpTransport,
  type StoredMcpTool,
} from "@steward/tools";

/**
 * Re-exported so the API and the worker have one import surface for the marketplace: the vocabulary a request is
 * validated against and the sentence an install is described in both come from here, and neither has to reach past
 * this package into the seam to get them.
 */
export { MCP_TRANSPORTS, mcpTarget };
export type { McpTransport };

// ---------- the vocabulary ----------

/**
 * What one company may install, and how much of it.
 *
 * The counts are small on purpose. A marketplace is a place to bring in the two or three systems a business
 * actually runs on, not a way to fill an allowlist with tools nobody has read; and every bound here exists
 * because the alternative is a row whose size a founder cannot see.
 */
export const MCP_LIMITS = {
  serversPerCompany: 10,
  nameChars: 80,
  slugChars: 40,
  purposeChars: 300,
  commandChars: 300,
  args: 16,
  argChars: 300,
  envVars: 16,
  envKeyChars: 60,
  envValueChars: 500,
  headers: 16,
  headerValueChars: 500,
  urlChars: 500,
  toolNameChars: 120,
  descriptionChars: 1000,
  toolsPerServer: 200,
  schemaChars: 20_000,
} as const;

/** A slug is what tool names are built from, so it is held to what a tool name can hold. */
export const MCP_SLUG_RE = /^[a-z0-9][a-z0-9_-]{1,39}$/;

/**
 * A problem a founder must fix. The code is stable and the sentence is what the surface shows, exactly as the
 * workflow builder's problems are — the same function answers the form and the write, so the two cannot disagree.
 */
export interface McpProblem {
  code: string;
  /** The field the problem is about, so the form can mark it up. */
  where: string;
  message: string;
}

/** The install as a request: everything a company decides, and nothing Steward decides for it. */
export interface McpInstallInput {
  name: string;
  slug: string;
  purpose?: string;
  transport: McpTransport;
  command?: string | null;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string | null;
  url?: string | null;
  headers?: Record<string, string>;
  enabled?: boolean;
}

/** What a validation needs to know that the install does not say about itself. */
export interface McpInstallContext {
  /** Slugs already in use by this company, excluding the install being edited. */
  takenSlugs: readonly string[];
  /** How many servers the company already has, excluding the one being edited. */
  existing: number;
  /** Whether this deployment spawns programs on its own host at all. */
  stdio: boolean;
  /** Whether this deployment will connect to loopback and private addresses. */
  privateTargets: boolean;
}

/**
 * Whether this deployment will even consider an address.
 *
 * The protocol's own transport is checked again, with a DNS lookup, at the moment of connecting — a name that
 * resolves to `127.0.0.1` passes a string check. This one is here because a form should refuse what it can see
 * immediately, in words, rather than accepting an install and failing it later where nobody is looking.
 */
export function privateTargetProblem(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host === "metadata" || host === "metadata.google.internal" || host.endsWith(".internal") || host.endsWith(".local")) return host;
  if (isIP(host) !== 0 && isPrivateAddress(host)) return host;
  return null;
}

/**
 * Everything wrong with an install, in the order a founder would fix it.
 *
 * There is one stage here rather than the builder's two, because there is nothing in between: a server is either
 * something this deployment can be asked to reach or it is not. Nothing is stored that fails this.
 */
export function validateMcpInstall(input: McpInstallInput, ctx: McpInstallContext): McpProblem[] {
  const problems: McpProblem[] = [];
  const bad = (code: string, where: string, message: string) => problems.push({ code, where, message });

  const name = input.name?.trim() ?? "";
  if (!name) bad("name_required", "name", "Give this server a name — what you would call it talking to a colleague.");
  else if (name.length > MCP_LIMITS.nameChars) bad("name_too_long", "name", `Keep the name to ${MCP_LIMITS.nameChars} characters.`);

  const slug = input.slug?.trim().toLowerCase() ?? "";
  if (!slug) bad("slug_required", "slug", "A slug is needed: it is the part of every tool name this server contributes.");
  else if (!MCP_SLUG_RE.test(slug)) bad("slug_invalid", "slug", "Use lowercase letters, digits, dashes and underscores, starting with a letter or digit.");
  else if (ctx.takenSlugs.includes(slug)) bad("slug_taken", "slug", `Another server already uses the slug “${slug}”. Tool names would collide, so this one needs its own.`);

  if (ctx.existing >= MCP_LIMITS.serversPerCompany) bad("too_many_servers", "server", `This company already has ${MCP_LIMITS.serversPerCompany} servers installed, which is the limit.`);
  if ((input.purpose ?? "").length > MCP_LIMITS.purposeChars) bad("purpose_too_long", "purpose", `Keep the note to ${MCP_LIMITS.purposeChars} characters.`);
  // A transport this build does not have makes every other answer meaningless, so it is the end of the list.
  if (!MCP_TRANSPORTS.includes(input.transport)) {
    bad("transport_unknown", "transport", `“${input.transport}” is not a transport this build knows.`);
    return problems;
  }

  if (input.transport === "stdio") {
    // A command is a program this deployment will run. A stack that has decided not to spawn programs says so
    // here rather than accepting the install and failing at the first call.
    if (!ctx.stdio) bad("stdio_disabled", "transport", "This deployment does not run programs for MCP servers. Install an HTTP or SSE server instead.");
    const command = input.command?.trim() ?? "";
    if (!command) bad("command_required", "command", "Give the program to run, exactly as you would type it in a terminal.");
    else if (command.length > MCP_LIMITS.commandChars) bad("command_too_long", "command", `Keep the command to ${MCP_LIMITS.commandChars} characters.`);
    const args = input.args ?? [];
    if (args.length > MCP_LIMITS.args) bad("args_too_many", "args", `A command may carry at most ${MCP_LIMITS.args} arguments.`);
    for (const [index, arg] of args.entries()) if (arg.length > MCP_LIMITS.argChars) bad("arg_too_long", "args", `Argument ${index + 1} is longer than ${MCP_LIMITS.argChars} characters.`);
    const env = Object.entries(input.env ?? {});
    if (env.length > MCP_LIMITS.envVars) bad("env_too_many", "env", `A server may be given at most ${MCP_LIMITS.envVars} variables.`);
    for (const [key, value] of env) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || key.length > MCP_LIMITS.envKeyChars) bad("env_key_invalid", "env", `“${key}” is not a name a process can be given.`);
      if (value.length > MCP_LIMITS.envValueChars) bad("env_value_too_long", "env", `The value of ${key} is longer than ${MCP_LIMITS.envValueChars} characters.`);
    }
    if ((input.cwd ?? "").length > MCP_LIMITS.commandChars) bad("cwd_too_long", "cwd", `Keep the working directory to ${MCP_LIMITS.commandChars} characters.`);
    return problems;
  }

  const raw = input.url?.trim() ?? "";
  if (!raw) bad("url_required", "url", "Give the address the server answers on.");
  else if (raw.length > MCP_LIMITS.urlChars) bad("url_too_long", "url", `Keep the address to ${MCP_LIMITS.urlChars} characters.`);
  else {
    let parsed: URL | null = null;
    try {
      parsed = new URL(raw);
    } catch {
      bad("url_invalid", "url", `“${raw}” is not a URL.`);
    }
    if (parsed) {
      if (!["http:", "https:"].includes(parsed.protocol)) bad("url_invalid", "url", `A server address has to be http or https, not ${parsed.protocol.replace(":", "")}.`);
      if (parsed.username || parsed.password) bad("url_invalid", "url", "Credentials belong in the headers, not in the address: an address with a password in it ends up written down everywhere.");
      const privateHost = privateTargetProblem(raw);
      if (privateHost && !ctx.privateTargets) bad("url_private", "url", `This deployment will not connect to ${privateHost}: addresses on its own network are refused unless the deployment explicitly allows them.`);
    }
  }
  const headers = Object.entries(input.headers ?? {});
  if (headers.length > MCP_LIMITS.headers) bad("headers_too_many", "headers", `At most ${MCP_LIMITS.headers} headers.`);
  for (const [key, value] of headers) if (value.length > MCP_LIMITS.headerValueChars) bad("header_value_too_long", "headers", `The value of ${key} is longer than ${MCP_LIMITS.headerValueChars} characters.`);
  return problems;
}

// ---------- rows ----------

export interface McpServerRow {
  id: string;
  organizationId: string;
  companyId: string;
  name: string;
  slug: string;
  purpose: string;
  transport: McpTransport;
  command: string | null;
  args: string[];
  env: Record<string, string>;
  cwd: string | null;
  url: string | null;
  headers: Record<string, string>;
  enabled: boolean;
  lastInspectedAt: Date | null;
  lastError: string | null;
  installedBy: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface McpToolRow {
  id: string;
  organizationId: string;
  companyId: string;
  serverId: string;
  name: string;
  toolName: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: McpToolAnnotationsShape;
  risk: RiskLevel;
  sideEffects: string;
  idempotent: boolean;
  dimension: string | null;
  riskSource: string;
  riskReason: string;
  enabled: boolean;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

/** What one inspection found, including what changed since the last one. */
export interface McpInspection {
  ok: boolean;
  /** The sentence a founder reads when the server could not be reached. */
  error: string | null;
  server: McpServerRow;
  added: string[];
  removed: string[];
  changed: Array<{ toolName: string; fields: string[] }>;
  /** Tools the server offers that this deployment did not record, because of the per-server limits. */
  omitted: number;
  /** How many tools this install now records, whatever the outcome. */
  total: number;
}

export class McpError extends Error {
  constructor(readonly code: "not_found" | "invalid", message: string, readonly details: Record<string, unknown> = {}) {
    super(message);
    this.name = "McpError";
  }
}

/** The install, in the shape the seam connects with. */
export function installOf(row: McpServerRow): McpInstall {
  return { name: row.name, slug: row.slug, transport: row.transport, command: row.command, args: row.args, env: row.env, cwd: row.cwd, url: row.url, headers: row.headers };
}

/**
 * Whether an edit changes where a server points.
 *
 * Compared by *value* and not by which fields a request happened to mention, because a surface that always sends
 * every field — the marketplace's own edit form does, so that clearing an argument is possible at all — would
 * otherwise un-inspect an install on a rename. A record is compared by its keys and their values rather than by
 * its JSON, since two people building the same set of headers need not build it in the same order.
 */
function destinationDiffers(existing: McpServerRow, patch: Partial<McpInstallInput>): boolean {
  const sameRecord = (next: Record<string, string> | undefined, now: Record<string, string>) => {
    if (next === undefined) return true;
    const keys = Object.keys(next).sort();
    return JSON.stringify(keys) === JSON.stringify(Object.keys(now).sort()) && keys.every((key) => next[key] === now[key]);
  };
  return (
    (patch.transport !== undefined && patch.transport !== existing.transport) ||
    (patch.command !== undefined && (patch.command ?? "").trim() !== (existing.command ?? "")) ||
    (patch.args !== undefined && JSON.stringify(patch.args) !== JSON.stringify(existing.args)) ||
    (patch.cwd !== undefined && (patch.cwd?.trim() || null) !== existing.cwd) ||
    (patch.url !== undefined && (patch.url ?? "").trim() !== (existing.url ?? "")) ||
    !sameRecord(patch.env, existing.env) ||
    !sameRecord(patch.headers, existing.headers)
  );
}

/** Where an install points, in the words a founder would use. Pure, and shared with the surface. */
export function describeInstall(row: Pick<McpServerRow, "name" | "transport" | "command" | "args" | "url">): string {
  if (row.transport === "stdio") return `${row.name} runs \`${[row.command, ...(row.args ?? [])].join(" ")}\` on Steward's host.`;
  return `${row.name} is a ${row.transport.toUpperCase()} server at ${row.url}.`;
}

export interface McpServiceOptions {
  /** Whether this deployment runs programs for stdio installs. */
  stdio?: boolean;
  /** Whether this deployment will connect to loopback and private addresses. */
  allowPrivate?: boolean;
}

/**
 * The installs a company has, what they turned out to offer, and who may call what.
 *
 * Every method is scoped: a server id from another company reads as not found, which is the same answer a deleted
 * server gives and the same one an id that never existed gives.
 */
export class McpService {
  readonly policy: Required<McpServiceOptions>;

  constructor(private readonly db: Db, private readonly now: () => Date = () => new Date(), options: McpServiceOptions = {}) {
    this.policy = { stdio: options.stdio ?? true, allowPrivate: options.allowPrivate ?? false };
  }

  private async validate(scope: TenantScope, input: McpInstallInput, excludeId?: string): Promise<void> {
    const rows = await this.list(scope);
    const others = rows.filter((row) => row.id !== excludeId);
    const problems = validateMcpInstall(input, { takenSlugs: others.map((row) => row.slug), existing: others.length, stdio: this.policy.stdio, privateTargets: this.policy.allowPrivate });
    if (problems.length) throw new McpError("invalid", "This server cannot be installed as it stands.", { problems });
  }

  async list(scope: TenantScope): Promise<McpServerRow[]> {
    return (await this.db
      .select()
      .from(mcpServers)
      .where(scoped(scope, { organizationId: mcpServers.organizationId, companyId: mcpServers.companyId }))
      .orderBy(mcpServers.createdAt)) as unknown as McpServerRow[];
  }

  async get(scope: TenantScope, id: string): Promise<McpServerRow | null> {
    const [row] = await this.db
      .select()
      .from(mcpServers)
      .where(scoped(scope, { organizationId: mcpServers.organizationId, companyId: mcpServers.companyId }, eq(mcpServers.id, id)))
      .limit(1);
    return (row as unknown as McpServerRow) ?? null;
  }

  async required(scope: TenantScope, id: string): Promise<McpServerRow> {
    const row = await this.get(scope, id);
    if (!row) throw new McpError("not_found", "That server is not installed here.");
    return row;
  }

  /** Every recorded tool of one server, blocked ones included, so a founder can see what they turned off. */
  async toolsOf(scope: TenantScope, serverId: string): Promise<McpToolRow[]> {
    return (await this.db
      .select()
      .from(mcpTools)
      .where(scoped(scope, { organizationId: mcpTools.organizationId, companyId: mcpTools.companyId }, eq(mcpTools.serverId, serverId)))
      .orderBy(mcpTools.name)) as unknown as McpToolRow[];
  }

  /** The whole company's installs in one query each, which is what the surface reads. */
  async state(scope: TenantScope): Promise<Array<{ server: McpServerRow; tools: McpToolRow[] }>> {
    const servers = await this.list(scope);
    if (!servers.length) return [];
    const rows = (await this.db
      .select()
      .from(mcpTools)
      .where(scoped(scope, { organizationId: mcpTools.organizationId, companyId: mcpTools.companyId }))
      .orderBy(mcpTools.name)) as unknown as McpToolRow[];
    return servers.map((server) => ({ server, tools: rows.filter((tool) => tool.serverId === server.id) }));
  }

  /** The people a grant can be given to, which is every agent in the company. */
  async agents(scope: TenantScope): Promise<Array<{ id: string; name: string; kind: string; enabled: boolean; toolAllowlist: string[] }>> {
    const rows = await this.db
      .select({ id: agents.id, name: agents.name, kind: agents.kind, enabled: agents.enabled, toolAllowlist: agents.toolAllowlist })
      .from(agents)
      .where(scoped(scope, { organizationId: agents.organizationId, companyId: agents.companyId }));
    return rows.map((row) => ({ ...row, toolAllowlist: row.toolAllowlist ?? [] }));
  }

  async install(scope: TenantScope, input: McpInstallInput): Promise<McpServerRow> {
    await this.validate(scope, input);
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(mcpServers)
        .values({
          organizationId: scope.organizationId,
          companyId: scope.companyId!,
          name: input.name.trim().slice(0, MCP_LIMITS.nameChars),
          slug: input.slug.trim().toLowerCase(),
          purpose: (input.purpose ?? "").slice(0, MCP_LIMITS.purposeChars),
          transport: input.transport,
          command: input.transport === "stdio" ? (input.command ?? "").trim() : null,
          args: input.transport === "stdio" ? (input.args ?? []).map((arg) => arg.slice(0, MCP_LIMITS.argChars)) : [],
          env: input.transport === "stdio" ? (input.env ?? {}) : {},
          cwd: input.transport === "stdio" ? (input.cwd?.trim() || null) : null,
          url: input.transport === "stdio" ? null : (input.url ?? "").trim(),
          headers: input.transport === "stdio" ? {} : (input.headers ?? {}),
          enabled: input.enabled ?? true,
          installedBy: scope.actor as unknown as Record<string, unknown>,
        })
        .returning();
      const server = row as unknown as McpServerRow;
      await emitEvent(tx, {
        organizationId: scope.organizationId,
        companyId: scope.companyId,
        type: "mcp.installed",
        actor: scope.actor,
        payload: { serverId: server.id, slug: server.slug, name: server.name, transport: server.transport, target: mcpTarget(installOf(server)) },
      });
      return server;
    });
  }

  /**
   * Editing an install.
   *
   * Two kinds of edit, and they are not the same act. Renaming changes what a person reads; changing where the
   * server points changes what the recorded tool list is evidence *about*, so it is discarded along with the
   * inspection that produced it. Keeping it would leave a company with a list of tools that came from somewhere
   * else, and a grant on top of it.
   */
  async update(scope: TenantScope, id: string, patch: Partial<McpInstallInput>): Promise<{ server: McpServerRow; uninspected: boolean }> {
    const existing = await this.required(scope, id);
    // The slug is immutable, and the reason is not tidiness: tool names are `mcp.<slug>.<tool>` and every grant is
    // written in those terms, so changing it would silently un-grant every tool of this server while leaving the
    // old patterns in agents' allowlists matching nothing. Removing and reinstalling is the honest way to do it.
    if (patch.slug !== undefined && patch.slug.trim().toLowerCase() !== existing.slug) {
      throw new McpError("invalid", "A server's slug cannot be changed after it is installed.", {
        problems: [{ code: "slug_immutable", where: "slug", message: `Every tool name and every grant is written in terms of “${existing.slug}”. Remove this server and install it again to use a different one.` }],
      });
    }
    const merged: McpInstallInput = {
      name: patch.name ?? existing.name,
      slug: patch.slug ?? existing.slug,
      purpose: patch.purpose ?? existing.purpose,
      transport: patch.transport ?? existing.transport,
      command: patch.command !== undefined ? patch.command : existing.command,
      args: patch.args ?? existing.args,
      env: patch.env ?? existing.env,
      cwd: patch.cwd !== undefined ? patch.cwd : existing.cwd,
      url: patch.url !== undefined ? patch.url : existing.url,
      headers: patch.headers ?? existing.headers,
      enabled: patch.enabled ?? existing.enabled,
    };
    await this.validate(scope, merged, id);

    const destinationChanged = destinationDiffers(existing, patch);

    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(mcpServers)
        .set({
          name: merged.name.trim().slice(0, MCP_LIMITS.nameChars),
          slug: merged.slug.trim().toLowerCase(),
          purpose: (merged.purpose ?? "").slice(0, MCP_LIMITS.purposeChars),
          transport: merged.transport,
          command: merged.transport === "stdio" ? (merged.command ?? "").trim() : null,
          args: merged.transport === "stdio" ? merged.args ?? [] : [],
          env: merged.transport === "stdio" ? merged.env ?? {} : {},
          cwd: merged.transport === "stdio" ? (merged.cwd?.trim() || null) : null,
          url: merged.transport === "stdio" ? null : (merged.url ?? "").trim(),
          headers: merged.transport === "stdio" ? {} : merged.headers ?? {},
          enabled: merged.enabled ?? existing.enabled,
          ...(destinationChanged ? { lastInspectedAt: null, lastError: "Where this server points was changed, so its tool list has to be read again." } : {}),
          updatedAt: this.now(),
        })
        .where(scoped(scope, { organizationId: mcpServers.organizationId, companyId: mcpServers.companyId }, eq(mcpServers.id, id)))
        .returning();
      const server = row as unknown as McpServerRow;
      if (destinationChanged) await tx.delete(mcpTools).where(scoped(scope, { organizationId: mcpTools.organizationId, companyId: mcpTools.companyId }, eq(mcpTools.serverId, id)));
      await emitEvent(tx, {
        organizationId: scope.organizationId,
        companyId: scope.companyId,
        type: "mcp.updated",
        actor: scope.actor,
        payload: { serverId: id, slug: server.slug, enabled: server.enabled, uninspected: destinationChanged },
      });
      return { server, uninspected: destinationChanged };
    });
  }

  /** Pausing an install takes its tools away from every agent at once, which is the point of installing one thing. */
  async setEnabled(scope: TenantScope, id: string, enabled: boolean): Promise<McpServerRow> {
    const existing = await this.required(scope, id);
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(mcpServers)
        .set({ enabled, updatedAt: this.now() })
        .where(scoped(scope, { organizationId: mcpServers.organizationId, companyId: mcpServers.companyId }, eq(mcpServers.id, id)))
        .returning();
      await emitEvent(tx, {
        organizationId: scope.organizationId,
        companyId: scope.companyId,
        type: "mcp.updated",
        actor: scope.actor,
        payload: { serverId: id, slug: existing.slug, enabled },
      });
      return row as unknown as McpServerRow;
    });
  }

  /** Refusing one tool without removing the server: a company may want two of a server's six tools and no more. */
  async setToolEnabled(scope: TenantScope, serverId: string, toolId: string, enabled: boolean): Promise<McpToolRow> {
    await this.required(scope, serverId);
    const [row] = await this.db
      .update(mcpTools)
      .set({ enabled, updatedAt: this.now() })
      .where(scoped(scope, { organizationId: mcpTools.organizationId, companyId: mcpTools.companyId }, eq(mcpTools.id, toolId), eq(mcpTools.serverId, serverId)))
      .returning();
    if (!row) throw new McpError("not_found", "That tool is not recorded for this server.");
    return row as unknown as McpToolRow;
  }

  /**
   * Removing an install removes its tools with it, because a tool whose server is gone is a grant to nothing.
   * The rest of the product is deliberately untouched: an agent's allowlist still names patterns, and a pattern
   * for a server that is not installed simply matches nothing, which is a state the runtime already has to handle.
   */
  async remove(scope: TenantScope, id: string): Promise<{ slug: string; tools: number }> {
    const existing = await this.required(scope, id);
    return this.db.transaction(async (tx) => {
      const removed = await tx.delete(mcpTools).where(scoped(scope, { organizationId: mcpTools.organizationId, companyId: mcpTools.companyId }, eq(mcpTools.serverId, id))).returning({ id: mcpTools.id });
      await tx.delete(mcpServers).where(scoped(scope, { organizationId: mcpServers.organizationId, companyId: mcpServers.companyId }, eq(mcpServers.id, id)));
      await emitEvent(tx, {
        organizationId: scope.organizationId,
        companyId: scope.companyId,
        type: "mcp.removed",
        actor: scope.actor,
        payload: { serverId: id, slug: existing.slug, name: existing.name, tools: removed.length },
      });
      return { slug: existing.slug, tools: removed.length };
    });
  }

  /**
   * Inspecting: connect once, ask what the server offers, and write the answer down beside what was there.
   *
   * A server that cannot be reached is not an error here. It is the state of the install, recorded on the row and
   * returned with the read, because the alternative — a 500 for a third party being down — tells a founder
   * nothing about what to do next and hides a server that was fine a minute ago.
   */
  async inspect(scope: TenantScope, id: string): Promise<McpInspection> {
    const server = await this.required(scope, id);
    const install = installOf(server);
    let specs: McpToolSpec[];
    try {
      specs = await listMcpTools(install, { allowPrivate: this.policy.allowPrivate });
    } catch (error) {
      const sentence = mcpFailureSentence(error, install);
      const [row] = await this.db
        .update(mcpServers)
        .set({ lastError: sentence, updatedAt: this.now() })
        .where(scoped(scope, { organizationId: mcpServers.organizationId, companyId: mcpServers.companyId }, eq(mcpServers.id, id)))
        .returning();
      const existing = await this.toolsOf(scope, id);
      await emitEvent(this.db, {
        organizationId: scope.organizationId,
        companyId: scope.companyId,
        type: "mcp.inspection_failed",
        actor: scope.actor,
        payload: { serverId: id, slug: server.slug, error: sentence },
      });
      return { ok: false, error: sentence, server: (row as unknown as McpServerRow) ?? server, added: [], removed: [], changed: [], omitted: 0, total: existing.length };
    }

    const existing = await this.toolsOf(scope, id);
    const byName = new Map(existing.map((tool) => [tool.name, tool]));
    const kept: Array<{ spec: McpToolSpec; risk: ReturnType<typeof riskForMcpTool> }> = [];
    let omitted = 0;
    for (const spec of specs) {
      const tooLarge = JSON.stringify(spec.inputSchema).length > MCP_LIMITS.schemaChars;
      if (kept.length >= MCP_LIMITS.toolsPerServer || tooLarge) {
        omitted += 1;
        continue;
      }
      kept.push({ spec, risk: riskForMcpTool(spec) });
    }

    return this.db.transaction(async (tx) => {
      const added: string[] = [];
      const changed: Array<{ toolName: string; fields: string[] }> = [];
      const seen = new Set<string>();

      for (const { spec, risk } of kept) {
        seen.add(spec.name);
        const toolName = mcpToolName(server.slug, spec.name);
        const description = spec.description.slice(0, MCP_LIMITS.descriptionChars);
        const before = byName.get(spec.name);
        const fields = before
          ? (
              [
                ["description", before.description, description],
                ["schema", JSON.stringify(before.inputSchema), JSON.stringify(spec.inputSchema)],
                ["risk", before.risk, risk.risk],
                ["claims", JSON.stringify(before.annotations), JSON.stringify(spec.annotations)],
                ["name", before.toolName, toolName],
              ] as Array<[string, string, string]>
            )
              .filter(([, was, now]) => was !== now)
              .map(([field]) => field)
          : [];
        const values = {
          description,
          inputSchema: spec.inputSchema,
          annotations: spec.annotations as McpToolAnnotationsShape,
          risk: risk.risk,
          sideEffects: risk.sideEffects as NonNullable<ToolManifest["sideEffects"]>,
          idempotent: risk.idempotent,
          dimension: (risk.dimension ?? null) as ToolManifest["dimension"] | null,
          riskSource: risk.source,
          riskReason: risk.because,
          toolName,
          lastSeenAt: this.now(),
          updatedAt: this.now(),
        };
        if (before && !fields.length) {
          await tx.update(mcpTools).set({ lastSeenAt: values.lastSeenAt }).where(eq(mcpTools.id, before.id));
          continue;
        }
        if (before) {
          await tx.update(mcpTools).set(values).where(eq(mcpTools.id, before.id));
          changed.push({ toolName, fields });
          continue;
        }
        await tx.insert(mcpTools).values({
          organizationId: scope.organizationId,
          companyId: scope.companyId!,
          serverId: id,
          name: spec.name,
          ...values,
          firstSeenAt: this.now(),
        });
        added.push(toolName);
      }

      // A tool the server no longer offers stops existing here, which is what makes the record a record: the grant
      // on it remains in an allowlist and matches nothing, rather than pointing at a tool nobody can call.
      const gone = existing.filter((tool) => !seen.has(tool.name));
      if (gone.length) await tx.delete(mcpTools).where(scoped(scope, { organizationId: mcpTools.organizationId, companyId: mcpTools.companyId }, inArray(mcpTools.id, gone.map((tool) => tool.id))));

      const [row] = await tx
        .update(mcpServers)
        .set({ lastInspectedAt: this.now(), lastError: null, updatedAt: this.now() })
        .where(scoped(scope, { organizationId: mcpServers.organizationId, companyId: mcpServers.companyId }, eq(mcpServers.id, id)))
        .returning();

      await emitEvent(tx, {
        organizationId: scope.organizationId,
        companyId: scope.companyId,
        type: "mcp.inspected",
        actor: scope.actor,
        payload: { serverId: id, slug: server.slug, tools: kept.length, added: added.length, removed: gone.length, changed: changed.length, omitted },
      });

      return {
        ok: true,
        error: null,
        server: row as unknown as McpServerRow,
        added,
        removed: gone.map((tool) => tool.toolName),
        changed,
        omitted,
        total: kept.length,
      };
    });
  }

  /**
   * What the runtime needs: the enabled tools of the enabled installs, grouped by the install they came from.
   *
   * One query rather than one per server, and no connection: this is read at the start of every activity that may
   * call a tool, so it has to be cheap and it must not depend on anybody else's process being up. A server that
   * has since gone away fails the call that reaches it, with the server's name in the sentence.
   */
  async forRuntime(scope: TenantScope): Promise<Array<{ install: McpInstall; tools: StoredMcpTool[] }>> {
    const servers = (await this.db
      .select()
      .from(mcpServers)
      .where(scoped(scope, { organizationId: mcpServers.organizationId, companyId: mcpServers.companyId }, eq(mcpServers.enabled, true)))) as unknown as McpServerRow[];
    if (!servers.length) return [];
    const rows = (await this.db
      .select()
      .from(mcpTools)
      .where(scoped(scope, { organizationId: mcpTools.organizationId, companyId: mcpTools.companyId }, inArray(mcpTools.serverId, servers.map((server) => server.id))))) as unknown as McpToolRow[];
    return servers.map((server) => ({
      install: installOf(server),
      tools: rows
        .filter((tool) => tool.serverId === server.id && tool.enabled)
        .map((tool) => ({
          serverId: server.id,
          serverName: server.name,
          serverSlug: server.slug,
          toolName: tool.toolName,
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          risk: tool.risk,
          sideEffects: tool.sideEffects as StoredMcpTool["sideEffects"],
          idempotent: tool.idempotent,
          dimension: (tool.dimension ?? undefined) as StoredMcpTool["dimension"],
        })),
    }));
  }
}

// ---------- grants ----------

/**
 * Whether an agent may call a tool, and what says so.
 *
 * The same `matchTool` the runtime uses, so the surface's answer and a run's answer are the same answer: an
 * exact name, a server wildcard, or nothing.
 */
export function grantedBy(allowlist: readonly string[], toolName: string): string | null {
  return allowlist.find((pattern) => matchTool(pattern, toolName)) ?? null;
}

/**
 * The allowlist after a grant or a revocation. Pure, so the API can hand it to the agent update it already has
 * rather than inventing a second place where permissions live.
 *
 * `toolNames: null` means the whole server. Revoking one tool from an agent that holds the server wildcard has to
 * *materialise* the wildcard — the remaining tools are written out by name — because otherwise "revoke this one"
 * would either do nothing or take the other five away too, and both are worse than a longer list.
 */
export function applyGrant(input: { allowlist: readonly string[]; slug: string; toolNames: string[] | null; serverTools: readonly string[]; granted: boolean }): string[] {
  const { allowlist, slug, toolNames, serverTools, granted } = input;
  const prefix = `mcp.${slug}.`;
  const wildcard = mcpToolPattern(slug);
  const unique = (patterns: string[]) => [...new Set(patterns)];

  if (granted) {
    if (toolNames === null) {
      // Everything, and so nothing narrower that it already covers.
      return unique([...allowlist.filter((pattern) => !(pattern.startsWith(prefix) && pattern !== wildcard)), wildcard]);
    }
    const added = toolNames.map((tool) => (tool.startsWith(prefix) ? tool : `${prefix}${tool}`)).filter((tool) => !grantedBy(allowlist, tool));
    return unique([...allowlist, ...added]);
  }

  if (toolNames === null) return allowlist.filter((pattern) => !pattern.startsWith(prefix));

  const revoked = new Set(toolNames.map((tool) => (tool.startsWith(prefix) ? tool : `${prefix}${tool}`)));
  if (!allowlist.includes(wildcard)) return allowlist.filter((pattern) => !revoked.has(pattern));
  return unique([...allowlist.filter((pattern) => pattern !== wildcard), ...serverTools.filter((tool) => !revoked.has(tool))]);
}
