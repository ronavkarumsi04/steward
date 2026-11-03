import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Approval } from "@/lib/types";
import { Inbox } from "./inbox";

vi.mock("./approval-card", () => ({
  ApprovalCard: ({ approval, companyId }: { approval: Approval; companyId: string }) =>
    createElement("article", { "data-company": companyId }, approval.action),
}));

function approval(id: string, action: string): Approval {
  return {
    id,
    runId: null,
    taskId: null,
    agentId: null,
    action,
    reason: "",
    payload: {},
    risk: "HIGH",
    dimension: "email_send",
    estimatedCostUsd: null,
    affectedSystem: "email",
    alternatives: [],
    status: "pending",
    resolvedBy: null,
    resolution: null,
    resolvedAt: null,
    expiresAt: "2026-11-04T00:00:00Z",
    createdAt: "2026-11-03T00:00:00Z",
  };
}

describe("Inbox", () => {
  it("counts every pending request and groups them under the company they belong to", () => {
    const html = renderToStaticMarkup(
      createElement(Inbox, {
        manyOrgs: true,
        groups: [
          { orgName: "Steward", company: { id: "c1", name: "Northwind" }, approvals: [approval("a1", "email.send"), approval("a2", "social.publish")] },
          { orgName: "Side", company: { id: "c2", name: "Acme" }, approvals: [approval("a3", "sms.send")] },
        ],
      }),
    );
    expect(html).toContain("3 requests");
    expect(html).toContain("Northwind");
    expect(html).toContain("Side");
    expect(html.indexOf("email.send")).toBeLessThan(html.indexOf("sms.send"));
    expect(html).toContain('data-company="c2"');
    expect(html).toContain("/app/c/c1/approvals");
  });

  it("says plainly when nothing is waiting", () => {
    const html = renderToStaticMarkup(createElement(Inbox, { manyOrgs: false, groups: [] }));
    expect(html).toContain("Nothing is waiting on you.");
    expect(html).toContain("Nothing pending");
  });
});
