import { describe, expect, it, vi } from "vitest";
import type { TenantScope } from "@steward/schema";
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
    expect(registry.get("delegate.run")?.manifest).toMatchObject({
      risk: "MEDIUM",
      dimension: "ai_spend",
      sideEffects: "internal",
      costCategory: "ai",
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
    expect(orchestrator).toEqual(expect.arrayContaining(["lead.list", "campaign.list", "delegate.run"]));
    expect(engineering).not.toContain("delegate.run");
    expect(finance).not.toContain("delegate.run");
    const marketing = registry.list({ allow: DEFAULT_TOOL_ALLOWLIST.marketing ?? [] }).map((t) => t.manifest.name);
    const sales = registry.list({ allow: DEFAULT_TOOL_ALLOWLIST.sales ?? [] }).map((t) => t.manifest.name);
    expect(marketing).toEqual(expect.arrayContaining(["lead.list", "lead.create", "lead.update", "campaign.list", "campaign.create", "campaign.update"]));
    expect(sales).toEqual(expect.arrayContaining(["lead.list", "lead.create", "lead.update", "campaign.list"]));
    expect(sales).not.toContain("campaign.create");
  });
});


describe("durable delegation", () => {
  it("creates a child task and starts a separate specialist workflow", async () => {
    const registry = buildToolRegistry();
    const tool = registry.get("delegate.run");
    expect(tool).toBeDefined();
    const taskCreate = vi.fn(async (_scope: TenantScope, input: { title: string; labels: string[] }) => ({ id: "task-child", title: input.title, status: "todo", labels: input.labels }));
    const runCreate = vi.fn(async (_scope: TenantScope, input: { agentId: string; taskId: string; trigger: Record<string, unknown> }) => ({ id: "run-child", agentId: input.agentId, taskId: input.taskId, trigger: input.trigger }));
    const attachWorkflow = vi.fn(async () => undefined);
    const start = vi.fn(async () => ({ workflowId: "run-run-child", workflowRunId: "temporal-child" }));
    const scope: TenantScope = { organizationId: "org-1", companyId: "company-1", actor: { type: "system", component: "test" } };
    const steward = {
      scope,
      agents: { byKind: vi.fn(async () => ({ id: "agent-eng", kind: "engineering", name: "Engineer", budgetUsdPerRun: "2.5000" })) },
      tasks: { list: vi.fn(async () => []), create: taskCreate, update: vi.fn(async () => undefined) },
      runs: { create: runCreate, attachWorkflow, setStatus: vi.fn(async () => undefined) },
      runWorkflowLauncher: { start },
    };
    const result = await tool!.execute({ assigneeKind: "engineering", title: "Ship onboarding", instruction: "Implement and verify the onboarding flow end to end.", priority: "high" }, {
      scope: steward.scope, agentId: "agent-chief", runId: "run-parent", taskId: "task-parent", services: { steward }, signal: undefined, log: () => undefined,
    });
    expect(result.ok).toBe(true);
    expect(taskCreate).toHaveBeenCalledWith(steward.scope, expect.objectContaining({ assigneeAgentId: "agent-eng", parentTaskId: "task-parent", labels: expect.arrayContaining(["delegated", "delegated-from:run-parent"]) }));
    expect(runCreate).toHaveBeenCalledWith(steward.scope, expect.objectContaining({ agentId: "agent-eng", taskId: "task-child", trigger: expect.objectContaining({ kind: "delegation", parentRunId: "run-parent", parentAgentId: "agent-chief" }) }));
    expect(start).toHaveBeenCalledWith({ runId: "run-child", scope: { organizationId: "org-1", companyId: "company-1" } });
    expect(attachWorkflow).toHaveBeenCalledWith(steward.scope, "run-child", "run-run-child", "temporal-child");
  });
});
