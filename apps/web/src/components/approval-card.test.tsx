import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Approval } from "@/lib/types";
import { ApprovalCard } from "./approval-card";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));

const base: Approval = {
  id: "a1", runId: "r1", taskId: null, agentId: "ag1", action: "email.send", reason: "Follow up with the pilot customer",
  payload: { to: "ada@example.com", subject: "Your pilot", text: "Hi Ada — here is the plan." }, risk: "HIGH", dimension: "email_send",
  estimatedCostUsd: null, affectedSystem: "resend", alternatives: [], status: "pending", resolvedBy: null, resolution: null, resolvedAt: null,
  expiresAt: "2026-11-05T00:00:00.000Z", createdAt: "2026-11-03T10:00:00.000Z",
};

describe("ApprovalCard for an outbox action", () => {
  const post: Approval = { ...base, action: "social.publish", dimension: "social_publish", affectedSystem: "linkedin", payload: { network: "linkedin", text: "Mixed delimiters. Broken encoding.\n\nMost tools guess." } };

  it("shows the post as text with its channel and length, and folds the JSON and blast radius away", () => {
    const html = renderToStaticMarkup(createElement(ApprovalCard, { companyId: "c1", approval: post }));
    expect(html).toContain("Post to everyone");
    expect(html).toContain("Mixed delimiters. Broken encoding.");
    expect(html).toContain("/ 3000 characters");
    expect(html).toContain("Raw payload");
    expect(html.indexOf("&quot;network&quot;: &quot;linkedin&quot;")).toBeGreaterThan(html.indexOf("Raw payload"));
    expect(html).toMatch(/<details[^>]*aria-label="Blast radius"(?![^>]*open)/);
  });

  it("keeps the decoded-fields view for any other action", () => {
    const deploy: Approval = { ...base, action: "deploy.production", dimension: "deploy", affectedSystem: "vercel", payload: { target: "production" } };
    const html = renderToStaticMarkup(createElement(ApprovalCard, { companyId: "c1", approval: deploy }));
    expect(html).not.toContain("Post to everyone");
    expect(html).toMatch(/<details[^>]*aria-label="Blast radius"[^>]*open/);
  });
});
