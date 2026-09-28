/**
 * Other people's tools, in the registry a run actually reads.
 *
 * The marketplace stores what each installed server offers; this is the one place that turns those rows into
 * tools the runtime can call. Two things about it are load-bearing:
 *
 *   1. **It reads rows, never a handshake.** A run's tool list is built from `mcp_tools`, so starting a run never
 *      waits on somebody else's process and never depends on a server being up. A server that has since gone
 *      away fails the call that reaches it, in its own words, which is a visible failure rather than a tool that
 *      quietly disappeared from under the agent that planned around it.
 *   2. **It registers everything and grants nothing.** Registration is what makes a name resolvable; the agent's
 *      own allowlist is what decides whether the model is ever offered it. That split is why installing a server
 *      changes what no agent may do, and why the marketplace's job is to make granting a deliberate act by a
 *      person rather than a side effect of an install.
 *
 * The registry is built per call rather than cached, because "the rows are the truth" has to hold at both ends:
 * a tool inspected a moment ago is callable on the next run, and a server a founder just removed stops existing
 * immediately instead of lingering in a long-lived worker's memory.
 */

import type { AgentServices } from "./services.js";
import { mcpToolDefinitions, type McpInstall, type StoredMcpTool, type ToolDefinition, type ToolRegistry } from "@steward/tools";

export interface McpServerTools {
  install: McpInstall;
  tools: StoredMcpTool[];
}

/** Adds a company's inspected MCP tools to a registry, leaving every built-in tool exactly as it was. */
export function registerMcpTools(registry: ToolRegistry, servers: McpServerTools[]): ToolRegistry {
  for (const { install, tools } of servers) for (const tool of mcpToolDefinitions(install, tools)) registry.register(tool);
  return registry;
}

/**
 * A registry with this company's MCP tools in it, for the *scope* of the services passed in — which is the whole
 * of the tenancy boundary here: another company's servers are not in the query that feeds this.
 */
export async function registryWithMcpTools(base: ToolRegistry, services: AgentServices): Promise<ToolRegistry> {
  return registerMcpTools(base, await services.mcp.forRuntime(services.scope));
}

/** The MCP tools one agent may actually call, resolved the way the runtime resolves them. */
export async function mcpToolsFor(services: AgentServices, base: ToolRegistry, allowlist: string[]): Promise<ToolDefinition[]> {
  const registry = await registryWithMcpTools(base, services);
  return registry.list({ allow: allowlist }).filter((tool) => tool.manifest.source === "mcp");
}
