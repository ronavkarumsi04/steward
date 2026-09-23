import { describe, expect, it } from "vitest";
import { buildToolRegistry, DEFAULT_TOOL_ALLOWLIST } from "./tools.js";

describe("operator capability surface", () => {
  it("exposes launch and payment-path tools with policy dimensions", () => {
    const registry = buildToolRegistry();
    expect(registry.get("deploy.create_project")?.manifest).toMatchObject({
      risk: "MEDIUM",
      dimension: "infra_spend",
      sideEffects: "external",
    });
    expect(registry.get("stripe.create_offer")?.manifest).toMatchObject({
      risk: "HIGH",
      dimension: "payments",
      sideEffects: "external",
    });
  });

  it("keeps launch/payment mutations inside specialist default tool boundaries", () => {
    const registry = buildToolRegistry();
    const engineering = registry.list({ allow: DEFAULT_TOOL_ALLOWLIST.engineering ?? [] }).map((t) => t.manifest.name);
    const finance = registry.list({ allow: DEFAULT_TOOL_ALLOWLIST.finance ?? [] }).map((t) => t.manifest.name);
    const orchestrator = registry.list({ allow: DEFAULT_TOOL_ALLOWLIST.orchestrator ?? [] }).map((t) => t.manifest.name);

    expect(engineering).toContain("deploy.create_project");
    expect(finance).toContain("stripe.create_offer");
    expect(orchestrator).not.toContain("stripe.create_offer");
    expect(orchestrator).not.toContain("deploy.create_project");
  });
});
