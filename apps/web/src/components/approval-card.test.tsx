import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Approval } from "@/lib/types";
import { ApprovalCard } from "./approval-card";
import { ApprovalsList } from "./approvals-list";
import { LocaleProvider } from "./locale-provider";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));

const base: Approval = {
  id: "a1", runId: "r1", taskId: null, agentId: "ag1", action: "email.send", reason: "Follow up with the pilot customer",
  payload: { to: "ada@example.com", subject: "Your pilot", text: "Hi Ada — here is the plan." }, risk: "HIGH", dimension: "email_send",
  estimatedCostUsd: null, affectedSystem: "resend", alternatives: [], status: "pending", resolvedBy: null, resolution: null, resolvedAt: null,
  expiresAt: "2026-11-05T00:00:00.000Z", createdAt: "2026-11-03T10:00:00.000Z",
};

describe("ApprovalCard for an outbox action", () => {
  it("does not promise to record decisions on closed requests", () => {
    for (const props of [
      { approval: { ...base, status: "cancelled" as const } },
      ...(["cancelled", "failed", "succeeded"] as const).map((status) => ({ approval: base, run: { id: "r1", status } })),
    ]) {
      const html = renderToStaticMarkup(createElement(ApprovalCard, { companyId: "c1", ...props }));
      expect(html).toContain("This request is closed. No decision can be recorded");
      expect(html).not.toContain("A decision is still recorded");
      expect(html).not.toContain("record your answer");
      expect(html).not.toContain('aria-label="If you decide"');
    }
  });
  it("localizes closed approval copy in Spanish", () => {
    for (const status of ["cancelled", "succeeded"] as const) {
      const html = renderToStaticMarkup(createElement(LocaleProvider, { locale: "es", children: createElement(ApprovalCard, { companyId: "c1", approval: base, run: { id: "r1", status } }) }));
      expect(html).toContain(status === "cancelled" ? "la ejecución se canceló antes de tomar una decisión" : "la ejecución ha terminado");
      expect(html).not.toContain("the run was cancelled");
      expect(html).not.toContain("the run has finished");
    }
  });
  it("keeps stale pending requests closed in the legacy approvals list", () => {
    const html = renderToStaticMarkup(createElement(ApprovalsList, { companyId: "c1", approvals: [base], runsById: { r1: { id: "r1", status: "cancelled" } } }));
    expect(html).toContain("the run was cancelled before a decision");
    expect(html).not.toMatch(/<button[^>]*>Approve/);
  });
  it.each(["cancelled", "failed", "succeeded"] as const)("closes stale pending approvals when the run is %s", (status) => {
    const html = renderToStaticMarkup(createElement(ApprovalCard, { companyId: "c1", approval: base, run: { id: "r1", status } }));
    expect(html).not.toMatch(/<button[^>]*>Approve/);
    expect(html).not.toMatch(/<button[^>]*>Decline/);
    expect(html).toContain(status === "cancelled" ? "the run was cancelled before a decision" : "Closed — the run has finished");
  });
  it("renders a cancelled approval as closed", () => {
    const html = renderToStaticMarkup(createElement(ApprovalCard, { companyId: "c1", approval: { ...base, status: "cancelled" } }));
    expect(html).toContain("the run was cancelled before a decision");
    expect(html).not.toMatch(/<button[^>]*>Approve/);
  });
  const post: Approval = { ...base, action: "social.publish", dimension: "social_publish", affectedSystem: "linkedin", reason: "social_publish actions require approval at autonomy level 2", payload: { network: "linkedin", text: "Mixed delimiters. Broken encoding.\n\nMost tools guess." } };

  it("shows the post as text with its channel and length, and folds the JSON and blast radius away", () => {
    const html = renderToStaticMarkup(createElement(ApprovalCard, { companyId: "c1", approval: post }));
    expect(html).toContain("Post to everyone");
    expect(html).toContain("Mixed delimiters. Broken encoding.");
    expect(html).toContain("/ 3000 characters");
    expect(html).toContain("Raw payload");
    expect(html.indexOf("&quot;network&quot;: &quot;linkedin&quot;")).toBeGreaterThan(html.indexOf("Raw payload"));
    expect(html).toMatch(/<details[^>]*aria-label="Blast radius"(?![^>]*open)/);
    expect(html).toContain("What this rule means");
  });

  it("keeps the decoded-fields view for any other action", () => {
    const deploy: Approval = { ...base, action: "deploy.production", dimension: "deploy", affectedSystem: "vercel", payload: { target: "production" } };
    const html = renderToStaticMarkup(createElement(ApprovalCard, { companyId: "c1", approval: deploy }));
    expect(html).not.toContain("Post to everyone");
    expect(html).not.toContain("What this rule means");
    expect(html).toMatch(/<details[^>]*aria-label="Blast radius"[^>]*open/);
  });
});
