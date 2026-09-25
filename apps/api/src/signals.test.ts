import { describe, expect, it } from "vitest";
import { normalizeResendSignal, normalizeStripeSignal, shouldAutoReviewSignal } from "./routes/signals.js";

describe("business signal normalization", () => {
  it("normalizes a Stripe checkout without retaining raw payloads", () => {
    const signal = normalizeStripeSignal({
      id: "evt_123",
      type: "checkout.session.completed",
      created: 1_700_000_000,
      data: { object: { id: "cs_123", amount_total: 2500, currency: "usd", payment_status: "paid", customer_details: { email: "buyer@example.com" }, metadata: { steward_project_id: "project_123", ignored_secret: "should-not-be-copied" } } },
      raw_secret: "never persist me",
    });
    expect(signal?.kind).toBe("payment.completed");
    expect(signal?.projectId).toBe("project_123");
    expect(signal?.customerRef).toBe("buyer@example.com");
    expect(signal?.data).toEqual(expect.objectContaining({ checkoutSessionId: "cs_123", amountMinor: 2500, currency: "USD" }));
    expect(JSON.stringify(signal?.data)).not.toContain("raw_secret");
    expect(JSON.stringify(signal?.data)).not.toContain("ignored_secret");
  });

  it("normalizes Resend delivery tags for project correlation", () => {
    const signal = normalizeResendSignal({ type: "email.bounced", data: { email_id: "em_123", to: ["lead@example.com"], subject: "Launch", tags: [{ name: "steward_project_id", value: "project_9" }, { name: "steward_run_id", value: "run_9" }] } }, "msg_123");
    expect(signal?.kind).toBe("email.bounced");
    expect(signal?.severity).toBe("warning");
    expect(signal?.projectId).toBe("project_9");
    expect(signal?.data).toEqual(expect.objectContaining({ emailId: "em_123", stewardRunId: "run_9" }));
  });

  it("ignores unsupported provider events instead of creating inbox noise", () => {
    expect(normalizeStripeSignal({ id: "evt_x", type: "customer.created", data: { object: { id: "cus_x" } } })).toBeNull();
    expect(normalizeResendSignal({ type: "email.sent", data: { email_id: "em_x" } }, "msg_x")).toBeNull();
  });

  it("auto-reviews only action-worthy verified signals", () => {
    for (const kind of ["payment.completed", "payment.failed", "payment.refunded", "subscription.cancelled", "email.bounced", "email.complained", "email.received"]) expect(shouldAutoReviewSignal(kind)).toBe(true);
    for (const kind of ["email.delivered", "email.opened", "email.clicked", "subscription.updated"]) expect(shouldAutoReviewSignal(kind)).toBe(false);
  });
});
