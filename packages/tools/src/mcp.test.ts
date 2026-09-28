import { fileURLToPath } from "node:url";
import { getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";
import type { ToolContext } from "./registry.js";
import {
  callMcpTool,
  describeMcpFailure,
  listMcpTools,
  mcpToolDefinitions,
  mcpToolName,
  mcpToolPattern,
  mcpTarget,
  riskForMcpTool,
  type McpInstall,
  type McpToolSpec,
} from "./mcp.js";

/**
 * The MCP seam, exercised against a real server.
 *
 * Every connection test below spawns `fixtures/mcp-server.mjs` as a child process and speaks the actual
 * protocol to it. That is slower than a stub and it is the only version worth having: the things that break in
 * this seam are a handshake, a spawned process's environment, an error result that must not look like success,
 * and a failure that must arrive as a sentence — none of which a mock we wrote would catch.
 */

const FIXTURE = fileURLToPath(new URL("../fixtures/mcp-server.mjs", import.meta.url));

/**
 * Windows adds a handful of variables from the logon session itself to every process it starts — which domain
 * the machine is joined to, where Windows is installed — and no environment block can take them away. They are
 * facts about the machine and not about Steward, so they are named here rather than papered over; the assertion
 * that follows is that nothing beyond this set and the protocol library's own safe set reaches a server.
 */
const OS_INJECTED = ["WINDIR", "USERDOMAIN", "LOGONSERVER", "COMPUTERNAME"];

const install = (over: Partial<McpInstall> = {}): McpInstall => ({
  name: "Fixture ledger",
  slug: "ledger",
  transport: "stdio",
  command: process.execPath,
  args: [FIXTURE],
  ...over,
});

const spec = (over: Partial<McpToolSpec> = {}): McpToolSpec => ({ name: "do_thing", description: "", inputSchema: { type: "object", properties: {} }, annotations: {}, ...over });

describe("mcp names", () => {
  it("names a tool after its install, so two servers cannot mean the same thing", () => {
    expect(mcpToolName("ledger", "lookup_invoice")).toBe("mcp.ledger.lookup_invoice");
    // A server is free to call a tool something a model provider would refuse as a function name.
    expect(mcpToolName("ledger", "2FA verify")).toBe("mcp.ledger.2fa_verify");
    expect(mcpToolName("Ledger API", "x")).toBe("mcp.ledger_api.x");
    // Two servers offering the same tool are two tools, which is the whole reason for the prefix.
    expect(mcpToolName("crm", "search")).not.toBe(mcpToolName("mail", "search"));
    expect(mcpToolPattern("ledger")).toBe("mcp.ledger.*");
  });

  it("describes where an install points in the words a founder would use", () => {
    expect(mcpTarget(install({ args: ["-y", "ledger-mcp"] }))).toBe(`${process.execPath} -y ledger-mcp`);
    expect(mcpTarget(install({ transport: "http", url: "https://mcp.example.com/mcp" }))).toBe("https://mcp.example.com/mcp");
  });
});

describe("mcp risk", () => {
  it("derives a band from the server's claims, the tool's name, and nothing at all — and says which", () => {
    const read = riskForMcpTool(spec({ name: "lookup_invoice", annotations: { readOnlyHint: true } }));
    expect(read).toMatchObject({ risk: "LOW", sideEffects: "none", readOnly: true, source: "hint", dimension: undefined });
    expect(read.because).toContain("only reads");

    const byName = riskForMcpTool(spec({ name: "list_orders" }));
    expect(byName).toMatchObject({ risk: "LOW", readOnly: true, source: "name" });

    const destructive = riskForMcpTool(spec({ name: "delete_customer", annotations: { destructiveHint: true } }));
    expect(destructive).toMatchObject({ risk: "HIGH", sideEffects: "external", readOnly: false, source: "hint", dimension: "external_write" });

    const named = riskForMcpTool(spec({ name: "purge_sessions" }));
    expect(named).toMatchObject({ risk: "HIGH", source: "name" });

    // The one that would be dangerous to get wrong: a name that reads as a query over an annotation that says
    // it writes is a write, and the reason is recorded so nobody has to guess why the band looks odd.
    const liar = riskForMcpTool(spec({ name: "get_and_reissue", annotations: { readOnlyHint: false, destructiveHint: true } }));
    expect(liar).toMatchObject({ risk: "HIGH", readOnly: false, source: "hint" });

    const unknown = riskForMcpTool(spec({ name: "reschedule" }));
    expect(unknown).toMatchObject({ risk: "MEDIUM", readOnly: false, source: "default" });
    expect(unknown.because).toContain("nothing about it");
  });

  it("lets a company's own classification beat every derived signal", () => {
    const risky = riskForMcpTool(spec({ name: "list_orders", annotations: { readOnlyHint: true } }), { overrides: { list_orders: { risk: "HIGH", sideEffects: "external" } } });
    expect(risky).toMatchObject({ risk: "HIGH", sideEffects: "external", source: "override" });
    expect(risky.because).toBe("This company classified it HIGH.");
    // And raising the floor for a server whose claims nobody wants to take on faith.
    expect(riskForMcpTool(spec({ name: "reschedule" }), { defaultRisk: "HIGH" }).risk).toBe("HIGH");
  });
});

describe("mcp against a real server", () => {
  it("lists every tool a spawned server offers, with its schema and its own claims", async () => {
    const tools = await listMcpTools(install());
    expect(tools.map((tool) => tool.name)).toEqual(["lookup_invoice", "delete_customer", "reschedule", "get_and_reissue", "post_webhook", "env_report"]);
    const invoice = tools.find((tool) => tool.name === "lookup_invoice")!;
    expect(invoice.description).toContain("Read one invoice");
    expect(invoice.annotations.readOnlyHint).toBe(true);
    expect(invoice.inputSchema).toMatchObject({ type: "object" });
    // A tool with no annotations carries none, rather than carrying a default we invented for it.
    expect(tools.find((tool) => tool.name === "reschedule")!.annotations).toEqual({});
  }, 60_000);

  it("calls a tool, and reports the tool's own declared failure as a failure rather than as output", async () => {
    const ok = await callMcpTool(install(), "lookup_invoice", {});
    expect(ok.ok).toBe(true);
    expect(ok.text).toContain("250.00 GBP");
    expect(ok.media).toBe(0);

    const refused = await callMcpTool(install(), "post_webhook", { url: "https://example.com/refuse" });
    expect(refused.ok).toBe(false);
    expect(refused.text).toContain("refused the payload");
  }, 60_000);

  it("gives a spawned server the machine's minimum and none of the deployment's", async () => {
    const reported = (await callMcpTool(install({ env: { LEDGER_TOKEN: "tok_1" } }), "env_report", {})).text.split(",").filter(Boolean);
    // The install's own variables are there, because that is how a server is given its own credentials.
    expect(reported).toContain("LEDGER_TOKEN");
    // Everything else is the protocol library's own safe set — read from the library rather than from a copy of
    // the list kept in this repository, so the claim cannot drift away from the behaviour. The deployment's
    // database, its master key and every provider credential are in neither set, which is the difference between
    // installing a tool and being handed a host.
    const machineMinimum = Object.keys(getDefaultEnvironment());
    const extra = reported.filter((key) => key !== "LEDGER_TOKEN" && !machineMinimum.includes(key) && !OS_INJECTED.includes(key));
    expect(extra, `a spawned server saw variables nobody gave it: ${extra.join(", ")}`).toEqual([]);
    // The point of the whole test: no credential of this deployment is visible from a server's process.
    for (const secret of ["DATABASE_URL", "MASTER_KEY", "OPENAI_API_KEY", "STRIPE_SECRET_KEY", "PLATFORM_EMAIL_API_KEY"]) expect(reported).not.toContain(secret);
  }, 60_000);

  it("says what could not be started when a command does not exist, rather than hanging or throwing", async () => {
    const broken = install({ command: "steward-mcp-that-does-not-exist" });
    const error = await listMcpTools(broken).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(Error);
    const sentence = describeMcpFailure(error, broken);
    expect(sentence).toContain("Could not start “Fixture ledger”");
    expect(sentence).toContain("steward-mcp-that-does-not-exist");
    // Whether the host refuses to start anything or starts something that dies before answering, the founder is
    // told which of the two it was, in a sentence that names the thing to go and fix.
    expect(sentence).toMatch(/Nothing on Steward's host could run that command|It started and then stopped before answering/);
  }, 60_000);

  it("refuses to point a remote transport at the deployment's own network", async () => {
    const metadata = install({ transport: "http", url: "http://169.254.169.254/mcp", command: null, args: [] });
    const error = await listMcpTools(metadata).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(Error);
    expect(describeMcpFailure(error, metadata)).toContain("not an address this deployment will connect to");
  }, 60_000);
});

describe("mcp as a tool the runtime can call", () => {
  const context = { scope: { organizationId: "org", companyId: "co", actor: { type: "system", component: "test" } }, services: {}, log: () => {} } as unknown as ToolContext;

  it("builds a tool definition from the stored row and calls the real server through it", async () => {
    const fixtures = await listMcpTools(install());
    const invoice = fixtures.find((tool) => tool.name === "lookup_invoice")!;
    const [tool] = mcpToolDefinitions(install(), [
      {
        serverId: "srv_1",
        serverName: "Fixture ledger",
        serverSlug: "ledger",
        toolName: mcpToolName("ledger", "lookup_invoice"),
        name: invoice.name,
        description: invoice.description,
        inputSchema: invoice.inputSchema,
        ...riskForMcpTool(invoice),
      },
    ]);
    expect(tool!.manifest.name).toBe("mcp.ledger.lookup_invoice");
    expect(tool!.manifest.source).toBe("mcp");
    expect(tool!.manifest.description).toBe(`[MCP: Fixture ledger] ${invoice.description}`);
    expect(tool!.manifest.risk).toBe("LOW");
    // Read-only, so there is no "Steward cannot read this back" caveat to make.
    expect((await tool!.preflight!({}, context)).alternatives).toEqual([]);

    // Third-party output comes back wrapped, because a tool's result is content and not instruction.
    const result = await tool!.execute({}, context);
    expect(result.ok).toBe(true);
    expect(result.untrusted).toBe(true);
    expect(result.content).toContain('<untrusted_content source="mcp:Fixture ledger/lookup_invoice">');
    expect(result.content).toContain("250.00 GBP");

    // And a failing call is a failed tool call, with the server's own words in it.
    const [webhook] = mcpToolDefinitions(install(), [{ serverId: "srv_1", serverName: "Fixture ledger", serverSlug: "ledger", toolName: mcpToolName("ledger", "post_webhook"), name: "post_webhook", description: "", inputSchema: {}, ...riskForMcpTool(spec({ name: "post_webhook", annotations: { destructiveHint: true } })) }]);
    const failed = await webhook!.execute({ url: "https://example.com/refuse" }, context);
    expect(failed.ok).toBe(false);
    expect(failed.content).toContain("refused the payload");
  }, 60_000);

  it("fails a call with a sentence when the server is gone, instead of removing the tool", async () => {
    const gone = install({ command: "steward-mcp-that-does-not-exist" });
    const [tool] = mcpToolDefinitions(gone, [{ serverId: "srv_2", serverName: "Fixture ledger", serverSlug: "ledger", toolName: mcpToolName("ledger", "lookup_invoice"), name: "lookup_invoice", description: "Read one invoice.", inputSchema: {}, ...riskForMcpTool(spec({ name: "lookup_invoice", annotations: { readOnlyHint: true } })) }]);
    const result = await tool!.execute({}, context);
    expect(result.ok).toBe(false);
    expect(result.content).toContain("Could not start");
  }, 60_000);
});
