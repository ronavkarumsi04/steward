import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Approval } from "@/lib/types";
import { Outbox, outboxItem } from "./outbox";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));

const base: Approval = {
  id: "a1", runId: "r1", taskId: null, agentId: "ag1", action: "email.send", reason: "Follow up with the pilot customer",
  payload: { to: "ada@example.com", subject: "Your pilot", text: "Hi Ada — here is the plan." }, risk: "HIGH", dimension: "email_send",
  estimatedCostUsd: null, affectedSystem: "resend", alternatives: [], status: "pending", resolvedBy: null, resolution: null, resolvedAt: null,
  expiresAt: "2026-11-05T00:00:00.000Z", createdAt: "2026-11-03T10:00:00.000Z",
};

describe("outbox", () => {
  it("reads the message from the tool call, not the agent's description", () => {
    expect(outboxItem(base)).toMatchObject({ kind: "email", to: "ada@example.com", subject: "Your pilot", text: "Hi Ada — here is the plan.", field: "text" });
    expect(outboxItem({ ...base, action: "social.publish", payload: { network: "x", text: "We shipped." } })).toMatchObject({ kind: "social", network: "x", to: "public" });
    expect(outboxItem({ ...base, action: "sms.send", payload: { to: "+15550100", body: "Your table is ready." } })).toMatchObject({ kind: "sms", text: "Your table is ready.", field: "body" });
  });

  it("renders each pending message as itself with send and hold actions, and skips decided rows", () => {
    const html = renderToStaticMarkup(createElement(Outbox, { companyId: "c1", items: [base, { ...base, id: "a2", status: "denied" }, { ...base, id: "a3", action: "social.publish", payload: { network: "x", text: "We shipped." } }] }));
    expect(html).toContain("2 messages waiting for you");
    expect(html).toContain("To ada@example.com");
    expect(html).toContain("Hi Ada — here is the plan.");
    expect(html).toContain("Post to everyone");
    expect(html).toContain("11 / 280");
    expect(html).toContain(">Send<");
    expect(html).toContain("Don&#x27;t send");
    expect((html.match(/<article/g) ?? []).length).toBe(2);
  });

  it("says plainly that nothing has left when the queue is empty", () => {
    const html = renderToStaticMarkup(createElement(Outbox, { companyId: "c1", items: [] }));
    expect(html).toContain("Nothing waiting to go out");
  });
});

describe("Outbox rows carry the request's warnings", () => {
  it("shows a not-connected warning above the Send button", () => {
    const warned = { ...base, id: "a-warn", warnings: ["LinkedIn is not connected. Approving will fail until it is connected under Integrations."] };
    const html = renderToStaticMarkup(createElement(Outbox, { companyId: "c1", items: [warned] }));
    expect(html).toContain("LinkedIn is not connected.");
    expect(html.indexOf("LinkedIn is not connected.")).toBeLessThan(html.indexOf(">Send<"));
  });
});
