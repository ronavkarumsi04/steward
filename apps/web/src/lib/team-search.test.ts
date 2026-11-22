import { expect, it } from "vitest";
import { agentMatches } from "./team-search";
import type { Agent } from "./types";

it("searches the translated displayed role as well as raw capabilities", () => {
  const agent = { name: "Engineer", kind: "engineering", description: "Build", toolAllowlist: ["code.read"] } as Agent;
  expect(agentMatches(agent, "Ingeniería", "es")).toBe(true);
  expect(agentMatches(agent, "engineering", "en")).toBe(true);
  expect(agentMatches(agent, "code.read", "es")).toBe(true);
  expect(agentMatches(agent, "finance", "es")).toBe(false);
});
