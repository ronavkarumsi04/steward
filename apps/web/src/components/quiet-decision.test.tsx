import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Approval, CompanyOverview } from "@/lib/types";
import { QuietApprovalDetail } from "./quiet-approval-detail";
import { QuietOverview } from "./quiet-overview";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));
const approval: Approval = { id: "approval-1", action: "email.send", reason: "Please review this exact draft", payload: { to: "review@example.com", text: "Review draft" }, risk: "HIGH", dimension: "email_send", affectedSystem: "test-email-account", estimatedCostUsd: "0", runId: null, taskId: null, agentId: null, alternatives: [], status: "pending", resolvedAt: null, resolvedBy: null, resolution: null, createdAt: "2026-01-01T00:00:00Z", expiresAt: "2099-01-01T00:00:00Z", workflowId: null };
const overview = { company: { id: "company-1", name: "Test workspace", organizationId: "org-1", autonomyLevel: 1, timezone: "UTC" }, role: "owner", agents: [], budgets: [], pendingApprovals: 1 } as unknown as CompanyOverview;

describe("Quiet decision surfaces", () => {
  it("keeps the exact recipient, payload, scope and zero estimate available before deciding", () => {
    const html = renderToStaticMarkup(createElement(QuietApprovalDetail, { approval, overview, run: null }));
    for (const fact of ["review@example.com", "Review draft", "email_send", "test-email-account", "$0.00", "Approve action", "Decline", "not a cap or a charge"]) expect(html).toContain(fact);
    expect(html).not.toContain("text-overflow");
  });
  it("does not offer decision controls to a viewer", () => {
    const html = renderToStaticMarkup(createElement(QuietApprovalDetail, { approval, overview: { ...overview, role: "viewer" }, run: null }));
    expect(html).toContain("Read-only");
    expect(html).not.toContain(">Approve action</button>");
    expect(html).not.toContain('data-persistent="true"');
  });
  it("keeps approval review usable with an unsupported saved timezone and labels the UTC fallback", () => {
    const html = renderToStaticMarkup(createElement(QuietApprovalDetail, { approval, overview: { ...overview, company: { ...overview.company, timezone: "GMT+5" } }, run: null }));
    expect(html).toContain("Approve action");
    expect(html).toContain("UTC");
    expect(html).not.toContain("GMT+5");
  });
  it("disables expired pending requests before the server sweeper changes their status", () => {
    const html = renderToStaticMarkup(createElement(QuietApprovalDetail, { approval: { ...approval, expiresAt: "2000-01-01T00:00:00Z" }, overview, run: null }));
    expect(html).toContain("cannot be decided");
    expect(html).toMatch(/disabled="">Approve action/);
    expect(html).toMatch(/disabled="">Decline/);
  });
  it("preserves the saved edited payload and workflow-delivery failure as a decision, not execution success", () => {
    const html = renderToStaticMarkup(createElement(QuietApprovalDetail, { approval: { ...approval, status: "approved", signalDelivered: false, resolution: { editedPayload: { to: "revised@example.com", text: "Edited draft" } } }, overview, run: null }));
    expect(html).toContain("revised@example.com");
    expect(html).toContain("Edited draft");
    expect(html).toContain("delivery is unconfirmed");
    expect(html).toContain("Decision history");
    expect(html).not.toContain('data-persistent="true"');
  });
  it("identifies the decider from real member data and keeps a truthful fallback when unavailable", () => {
    const decided = { ...approval, status: "approved" as const, resolvedBy: "user-1" };
    const html = renderToStaticMarkup(createElement(QuietApprovalDetail, { approval: decided, overview, run: null, members: [{ userId: "user-1", name: "Test reviewer", email: "reviewer@example.test" }] }));
    expect(html).toContain("Test reviewer (reviewer@example.test)");
    const missing = renderToStaticMarkup(createElement(QuietApprovalDetail, { approval: decided, overview, run: null }));
    expect(missing).toContain("Member name not available");
  });
  it("keeps work and decisions visible when the provider ledger fails, without inventing spend", async () => {
    const get = vi.fn(async (path: string) => {
      if (path.includes("providers/usage")) throw new Error("offline");
      return path.includes("approvals") ? { approvals: [] } : { runs: [] };
    });
    const node = await QuietOverview({ overview, locale: "en", api: { get } as never });
    const html = renderToStaticMarkup(node);
    expect(html).toContain("Not available");
    expect(html).toContain("No decisions waiting");
    expect(html).toContain("No active runs");
    expect(html).not.toContain("$0.00");
    expect(get.mock.calls.some(([path]) => path.includes("companyId=company-1&days=30"))).toBe(true);
  });
  it("does not let an expired pending record displace a request that can be decided", async () => {
    const get = vi.fn(async (path: string) => path.includes("approvals") ? { approvals: [
      { ...approval, id: "expired", action: "expired.action", expiresAt: "2000-01-01T00:00:00Z" },
      { ...approval, id: "open", action: "actionable.action" },
    ] } : path.includes("providers/usage") ? { usage: [] } : { runs: [] });
    const html = renderToStaticMarkup(await QuietOverview({ overview, locale: "en", api: { get } as never }));
    expect(html).toContain("actionable.action");
    expect(html).not.toContain("expired.action");
  });
});
