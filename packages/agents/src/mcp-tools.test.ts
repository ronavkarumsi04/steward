/**
 * The wiring between the marketplace's rows and the registry a run reads.
 *
 * This is the one place the product could quietly become a catalogue: tools that are recorded, shown, grantable
 * and yet never actually in front of an agent. These cases are about the shape of that wiring rather than about
 * the protocol — the seam's own tests spawn a real server — so they run anywhere.
 */
import { describe, expect, it, vi } from "vitest";
import { mcpToolName, type StoredMcpTool } from "@steward/tools";
import { registerMcpTools } from "./mcp-tools.js";
import { buildToolRegistry, DEFAULT_TOOL_ALLOWLIST } from "./tools.js";

const install = { name: "Fixture ledger", slug: "ledger", transport: "stdio" as const, command: "node", args: ["server.mjs"] };

const stored = (name: string, over: Partial<StoredMcpTool> = {}): StoredMcpTool => ({
  serverId: "srv_1",
  serverName: "Fixture ledger",
  serverSlug: "ledger",
  toolName: mcpToolName("ledger", name),
  name,
  description: `${name} on the fixture ledger.`,
  inputSchema: { type: "object", properties: {} },
  risk: "MEDIUM",
  sideEffects: "external",
  idempotent: false,
  ...over,
});

describe("mcp tools in the registry", () => {
  it("registers an inspected server's tools and leaves every built-in exactly as it was", () => {
    const registry = registerMcpTools(buildToolRegistry(), [{ install, tools: [stored("lookup_invoice", { risk: "LOW", sideEffects: "none", idempotent: true }), stored("reschedule")] }]);
    const all = registry.list().map((tool) => tool.manifest.name);
    expect(all).toContain("memory.search");
    expect(all).toContain("mcp.ledger.lookup_invoice");
    expect(all).toContain("mcp.ledger.reschedule");
    expect(registry.get("mcp.ledger.lookup_invoice")!.manifest).toMatchObject({ source: "mcp", risk: "LOW", sideEffects: "none" });
    expect(registry.get("mcp.ledger.lookup_invoice")!.manifest.description).toBe("[MCP: Fixture ledger] lookup_invoice on the fixture ledger.");
  });

  it("offers nothing until a grant names it, because no default allowlist mentions mcp.", () => {
    const registry = registerMcpTools(buildToolRegistry(), [{ install, tools: [stored("lookup_invoice")] }]);
    for (const [kind, allowlist] of Object.entries(DEFAULT_TOOL_ALLOWLIST)) {
      expect(allowlist.some((pattern) => pattern.startsWith("mcp.")), kind).toBe(false);
      expect(registry.list({ allow: allowlist }).some((tool) => tool.manifest.source === "mcp"), kind).toBe(false);
    }
    // The registry knows the tool; the agent's own allowlist is what decides whether it is ever offered.
    expect(registry.list({ allow: ["mcp.ledger.*"] }).map((tool) => tool.manifest.name)).toEqual(["mcp.ledger.lookup_invoice"]);
    expect(registry.list({ allow: [mcpToolName("ledger", "lookup_invoice")] })).toHaveLength(1);
    expect(registry.list({ allow: ["mcp.other.*"] })).toEqual([]);
  });

  it("registers nothing at all for a company with no installs, so a run is exactly the built-ins", () => {
    const base = buildToolRegistry().list().length;
    expect(registerMcpTools(buildToolRegistry(), []).list()).toHaveLength(base);
  });

  it("drops both servers' colliding tools, logs it, and keeps unrelated tools", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const registry = registerMcpTools(buildToolRegistry(), [{ install, tools: [stored("lookup_invoice"), stored("reschedule")] }, { install: { ...install, slug: "other" }, tools: [stored("lookup_invoice", { serverId: "srv_2" }), stored("delete_customer", { serverId: "srv_2" }), stored("search", { serverId: "srv_2", toolName: "mcp.other.search" })] }]);
      expect(registry.get("mcp.ledger.lookup_invoice")).toBeUndefined();
      expect(registry.list({ allow: ["mcp.ledger.*"] })).toEqual([]);
      expect(registry.get("mcp.other.search")).toBeDefined();
      expect(registry.get("memory.search")).toBeDefined();
      expect(warn).toHaveBeenCalledWith(expect.any(String), expect.arrayContaining(["mcp.ledger.lookup_invoice", "mcp.ledger.reschedule", "mcp.ledger.delete_customer"]));
    } finally {
      warn.mockRestore();
    }
  });

  it("excludes an inspected namespace when an uninspected alias is installed", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const registry = registerMcpTools(buildToolRegistry(), [
        { install: { ...install, slug: "a-b" }, tools: [] },
        { install: { ...install, slug: "a_b" }, tools: [stored("lookup_invoice", { toolName: "mcp.a_b.lookup_invoice" })] },
        { install, tools: [stored("reschedule")] },
      ]);
      expect(registry.list({ allow: ["mcp.a_b.*"] })).toEqual([]);
      expect(registry.get("mcp.ledger.reschedule")).toBeDefined();
    } finally {
      warn.mockRestore();
    }
  });
});
