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
    expect(registry.get("deploy.add_domain")?.manifest).toMatchObject({
      risk: "HIGH",
      dimension: "prod_deploy",
      sideEffects: "external",
    });
    expect(registry.get("deploy.verify_domain")?.manifest).toMatchObject({
      risk: "HIGH",
      dimension: "prod_deploy",
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

    expect(engineering).toEqual(expect.arrayContaining(["deploy.create_project", "deploy.list_domains", "deploy.add_domain", "deploy.verify_domain"]));
    expect(finance).toContain("stripe.create_offer");
    expect(orchestrator).not.toContain("stripe.create_offer");
    expect(orchestrator).not.toContain("deploy.create_project");
    expect(orchestrator).toEqual(expect.arrayContaining(["lead.list", "campaign.list"]));
    const marketing = registry.list({ allow: DEFAULT_TOOL_ALLOWLIST.marketing ?? [] }).map((t) => t.manifest.name);
    const sales = registry.list({ allow: DEFAULT_TOOL_ALLOWLIST.sales ?? [] }).map((t) => t.manifest.name);
    expect(marketing).toEqual(expect.arrayContaining(["lead.list", "lead.create", "lead.update", "campaign.list", "campaign.create", "campaign.update"]));
    expect(sales).toEqual(expect.arrayContaining(["lead.list", "lead.create", "lead.update", "campaign.list"]));
    expect(sales).not.toContain("campaign.create");
  });
});
