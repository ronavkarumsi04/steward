import { describe, expect, it } from "vitest";
import { AUTO_REVIEW_SIGNAL_KINDS, RECORDED_SIGNAL_KINDS, REACTABLE_EVENT_TYPES } from "@steward/core";
import { normalizeResendSignal, normalizeStripeSignal } from "./routes/signals.js";

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
    for (const kind of ["payment.completed", "payment.failed", "payment.refunded", "subscription.cancelled", "email.bounced", "email.complained", "email.received"]) expect(AUTO_REVIEW_SIGNAL_KINDS as readonly string[]).toContain(kind);
    for (const kind of ["email.delivered", "email.opened", "email.clicked", "subscription.updated"]) expect(AUTO_REVIEW_SIGNAL_KINDS as readonly string[]).not.toContain(kind);
  });

  it("offers a rule catalog that covers every kind the normalizers can produce", () => {
    // The catalog is what a founder may write a rule against, so it has to be the whole recorded vocabulary:
    // a kind the product stores but the catalog omits would be a signal nothing could ever answer.
    const produced = [
      normalizeStripeSignal({ id: "evt_1", type: "checkout.session.completed", data: { object: { id: "cs_1" } } }),
      normalizeStripeSignal({ id: "evt_2", type: "charge.refunded", data: { object: { id: "ch_1", amount_refunded: 100 } } }),
      normalizeStripeSignal({ id: "evt_3", type: "invoice.payment_failed", data: { object: { id: "in_1" } } }),
      normalizeStripeSignal({ id: "evt_4", type: "customer.subscription.updated", data: { object: { id: "sub_1", status: "past_due" } } }),
      normalizeStripeSignal({ id: "evt_5", type: "customer.subscription.deleted", data: { object: { id: "sub_2" } } }),
      ...["email.delivered", "email.bounced", "email.complained", "email.delivery_delayed", "email.opened", "email.clicked", "email.received"].map((type, i) => normalizeResendSignal({ type, data: { email_id: `em_${i}`, to: ["a@example.com"], subject: "Hello" } }, `msg_${i}`)),
    ].flatMap((signal) => (signal ? [signal.kind] : []));
    expect(produced.length).toBeGreaterThan(10);
    expect(produced.filter((kind) => !(RECORDED_SIGNAL_KINDS as readonly string[]).includes(kind))).toEqual([]);
    // And nothing a rule can name is an event type by accident: the two vocabularies stay separate.
    expect(produced.filter((kind) => (REACTABLE_EVENT_TYPES as readonly string[]).includes(kind))).toEqual([]);
  });
});
