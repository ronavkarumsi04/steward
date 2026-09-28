import { describe, expect, it } from "vitest";
import { bodyFromForm, describeInspection, emptyForm, formFrom, grantSummary, heldCount, holders, parseEnv, parseHeaders, parseLines, riskSourceLabel, serverPattern, sortTools, standing, standingLabel, standingTone, transportLabel } from "./mcp";
import type { McpServerView, McpToolView } from "./types";

const tool = (over: Partial<McpToolView> = {}): McpToolView => ({
  id: over.name ?? "t",
  name: "lookup_invoice",
  toolName: "mcp.ledger.lookup_invoice",
  description: "Read one invoice.",
  risk: "LOW",
  riskSource: "hint",
  riskReason: "The server says this tool only reads.",
  sideEffects: "none",
  idempotent: true,
  dimension: null,
  enabled: true,
  grantedTo: [],
  ...over,
});

const server = (over: Partial<McpServerView> = {}): McpServerView => ({
  id: "srv_1",
  name: "Fixture ledger",
  slug: "ledger",
  purpose: "",
  transport: "stdio",
  target: "node server.mjs",
  description: "Fixture ledger runs `node server.mjs` on Steward's host.",
  enabled: true,
  inspectedAt: "2026-01-01T00:00:00.000Z",
  error: null,
  tools: [tool()],
  command: "/usr/bin/node",
  args: ["server.mjs"],
  url: null,
  envKeys: ["LEDGER_TOKEN"],
  headerKeys: [],
  ...over,
});

describe("the install form", () => {
  it("sends only the half of the form that belongs to the transport", () => {
    const stdio = bodyFromForm({ ...emptyForm(), name: " Ledger ", slug: "LEDGER", command: " npx ", args: "-y\nacme-mcp\n\n", env: "TOKEN=a=b\nbroken\n" }, { editing: false });
    expect(stdio).toEqual({ name: "Ledger", slug: "ledger", purpose: "", transport: "stdio", command: "npx", args: ["-y", "acme-mcp"], env: { TOKEN: "a=b" }, url: null, headers: {} });

    const http = bodyFromForm({ ...emptyForm(), name: "Ledger", slug: "ledger", transport: "http", url: " https://mcp.example.com/mcp ", headers: "Authorization: Bearer x\nBroken line\n" }, { editing: false });
    expect(http).toEqual({ name: "Ledger", slug: "ledger", purpose: "", transport: "http", command: null, args: [], env: {}, url: "https://mcp.example.com/mcp", headers: { Authorization: "Bearer x" } });
  });

  it("never sends a slug on an edit, because a slug cannot change", () => {
    const body = bodyFromForm({ ...emptyForm(), name: "Ledger", slug: "something-else", transport: "stdio", command: "npx" }, { editing: true });
    expect(body).not.toHaveProperty("slug");
  });

  it("keeps the stored credentials when an edit leaves the field empty, and replaces them when it does not", () => {
    // Values are never sent back to a browser, so an empty field means "unchanged" rather than "wipe it".
    const kept = bodyFromForm({ ...emptyForm(), name: "Ledger", transport: "stdio", command: "npx", env: "" }, { editing: true });
    expect(kept).not.toHaveProperty("env");
    // Creating has nothing to keep, so an empty field is an empty set.
    expect(bodyFromForm({ ...emptyForm(), name: "Ledger", transport: "stdio", command: "npx" }, { editing: false })).toHaveProperty("env", {});

    const replaced = bodyFromForm({ ...emptyForm(), name: "Ledger", transport: "stdio", command: "npx", env: "TOKEN=new" }, { editing: true });
    expect(replaced).toHaveProperty("env", { TOKEN: "new" });
    // The same for headers, on an http install.
    expect(bodyFromForm({ ...emptyForm(), name: "Ledger", transport: "http", url: "https://x.test/mcp", headers: "" }, { editing: true })).not.toHaveProperty("headers");
  });

  it("reads a line-based field the way a person writes it, and ignores a line that is not one", () => {
    expect(parseLines("a\n  b  \n\n")).toEqual(["a", "b"]);
    expect(parseEnv("A=1\nB =\n=empty\nnokey\nC=two=three\n")).toEqual({ A: "1", B: "", C: "two=three" });
    expect(parseHeaders("A: 1\nB:two:three\nnocolon\n")).toEqual({ A: "1", B: "two:three" });
  });

  it("starts an edit from what is stored, and never from a stored credential", () => {
    const form = formFrom(server({ transport: "http", url: "https://mcp.example.com/mcp", command: null, args: [], headerKeys: ["Authorization"], envKeys: [] }));
    expect(form).toMatchObject({ name: "Fixture ledger", slug: "ledger", transport: "http", url: "https://mcp.example.com/mcp", command: "", args: "", headers: "", env: "" });
    const stdio = formFrom(server());
    expect(stdio).toMatchObject({ command: "/usr/bin/node", args: "server.mjs", url: "", env: "", headers: "" });
  });
});

describe("how an install stands", () => {
  it("tells apart a server nobody asked from one that was asked and did not answer", () => {
    expect(standing(server({ inspectedAt: null, tools: [] }))).toBe("never_inspected");
    expect(standing(server({ inspectedAt: null, error: "Could not start “Fixture ledger”.", tools: [] }))).toBe("unreachable");
    expect(standing(server({ tools: [] }))).toBe("empty");
    expect(standing(server())).toBe("ready");
    // Paused beats all of it: a paused server offers nothing whatever its record says.
    expect(standing(server({ enabled: false, error: "Could not start." }))).toBe("paused");
    for (const state of ["paused", "unreachable", "never_inspected", "empty", "ready"] as const) {
      expect(standingLabel(state).length).toBeGreaterThan(3);
      expect(standingTone(state)).toBeTruthy();
    }
    // A paused server's own band says what pausing cost, so the page does not depend on a notice that scrolls away.
    expect(standingLabel("paused")).toContain("no agent can call any of its tools");
  });

  it("names the transport and the provenance of a risk band in words rather than in wire names", () => {
    expect(transportLabel("stdio")).toContain("host");
    expect(transportLabel("sse")).toContain("SSE");
    expect(transportLabel("carrier-pigeon")).toBe("carrier-pigeon");
    expect(riskSourceLabel("override")).toBe("your own classification");
    expect(riskSourceLabel("hint")).toContain("server");
    expect(riskSourceLabel("default")).toContain("nothing");
  });

  it("puts the tools that can do the most damage first, because that is the list a new install is read for", () => {
    const sorted = sortTools([tool({ name: "z_read", risk: "LOW" }), tool({ name: "b_delete", risk: "HIGH" }), tool({ name: "a_write", risk: "HIGH" }), tool({ name: "c_change", risk: "MEDIUM" })]);
    expect(sorted.map((row) => row.name)).toEqual(["a_write", "b_delete", "c_change", "z_read"]);
  });

  it("summarises who holds what, per agent rather than per tool", () => {
    const held = server({
      tools: [
        tool({ name: "lookup_invoice", grantedTo: [{ agentId: "a1", agentName: "Engineer", pattern: "mcp.ledger.*" }, { agentId: "a2", agentName: "Researcher", pattern: "mcp.ledger.*" }] }),
        tool({ name: "reschedule", grantedTo: [{ agentId: "a1", agentName: "Engineer", pattern: "mcp.ledger.*" }] }),
      ],
    });
    expect(holders(held).map((row) => row.agentName)).toEqual(["Engineer", "Researcher"]);
    expect(heldCount(held, "a1")).toBe(2);
    expect(heldCount(held, "a2")).toBe(1);
    expect(grantSummary(held)).toBe("Granted to Engineer (2 of 2), Researcher (1 of 2).");
    expect(grantSummary(server({ tools: [tool()] }))).toContain("no agent may call any of it");
    expect(serverPattern("ledger")).toBe("mcp.ledger.*");
  });

  it("says what an inspection found, including what it dropped", () => {
    expect(describeInspection({ ok: false, error: "Could not start “Ledger”.", added: [], removed: [], changed: [], omitted: 0, total: 0 })).toBe("Could not start “Ledger”.");
    expect(describeInspection({ ok: true, error: null, added: ["a"], removed: [], changed: [], omitted: 0, total: 6 })).toContain("6 tool(s) recorded. 1 new.");
    const drifted = describeInspection({ ok: true, error: null, added: [], removed: ["x"], changed: [{ toolName: "mcp.ledger.reschedule", fields: ["risk"] }], omitted: 2, total: 5 });
    expect(drifted).toContain("1 changed since last time");
    expect(drifted).toContain("a grant on those now matches nothing");
    expect(drifted).toContain("2 not recorded");
  });
});
