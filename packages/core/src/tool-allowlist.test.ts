import { describe, expect, it } from "vitest";
import { EXPLICIT_NO_TOOLS } from "@steward/tools";
import { AGENT_TOOL_ALLOWLIST_LIMIT, AGENT_TOOL_DENYLIST_LIMIT, toolAllowlistLimitIssue } from "./work.js";

describe("tool allowlist admission limits", () => {
  it("counts unique positive and deny entries separately, excluding the explicit no-tools marker", () => {
    const positives = Array.from({ length: AGENT_TOOL_ALLOWLIST_LIMIT }, (_, i) => `web.tool_${i}`);
    const denies = Array.from({ length: AGENT_TOOL_DENYLIST_LIMIT }, (_, i) => `!web.blocked_${i}`);
    expect(toolAllowlistLimitIssue([])).toBeNull();
    expect(toolAllowlistLimitIssue([EXPLICIT_NO_TOOLS, ...positives, ...positives, ...denies])).toBeNull();
    expect(toolAllowlistLimitIssue([...positives, "web.extra"])).toContain("positive");
    expect(toolAllowlistLimitIssue([...denies, "!web.extra"])).toContain("deny");
  });

  it("admits unchanged or reduced over-limit lists but rejects count increases in either dimension", () => {
    const positives = Array.from({ length: AGENT_TOOL_ALLOWLIST_LIMIT + 3 }, (_, i) => `web.tool_${i}`);
    const denies = Array.from({ length: AGENT_TOOL_DENYLIST_LIMIT + 3 }, (_, i) => `!web.blocked_${i}`);
    const previous = [...positives, ...denies];
    expect(toolAllowlistLimitIssue(previous, previous)).toBeNull();
    expect(toolAllowlistLimitIssue([...positives.slice(1), ...denies.slice(1)], previous)).toBeNull();
    expect(toolAllowlistLimitIssue([...previous, "web.extra"], previous)).toContain("positive");
    expect(toolAllowlistLimitIssue([...previous, "!web.extra"], previous)).toContain("deny");
  });

  it("admits MCP-generated denies past the bound without exempting positive growth", () => {
    const positives = Array.from({ length: AGENT_TOOL_ALLOWLIST_LIMIT }, (_, i) => `web.tool_${i}`);
    const denies = Array.from({ length: AGENT_TOOL_DENYLIST_LIMIT }, (_, i) => `!web.blocked_${i}`);
    const previous = [...positives, ...denies];
    expect(toolAllowlistLimitIssue([...previous, "!mcp.server.tool"], previous, true)).toBeNull();
    expect(toolAllowlistLimitIssue([...previous, "mcp.server.tool"], previous, true)).toContain("positive");
  });
});
