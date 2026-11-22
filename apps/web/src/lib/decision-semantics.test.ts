import { describe, expect, it } from "vitest";
import { approvalSnapshot, canonicalJson, isDecisionOpen, recordedUsd } from "./decision-semantics";
import type { Approval } from "./types";

describe("decision and cost semantics", () => {
  it("does not invent a zero for an unavailable charge or estimate", () => {
    for (const value of [null, undefined, "", "bad", -1]) expect(recordedUsd(value)).toBeNull();
    expect(recordedUsd("0.0000")).toBe("$0.00");
    expect(recordedUsd("0.0024")).toBe("$0.0024");
    expect(recordedUsd(1200, "es")).toContain("1200");
  });
  it("compares nested payloads independent of object key order but not array order", () => {
    expect(canonicalJson({ b: [{ z: 2, a: 1 }], a: 0 })).toBe(canonicalJson({ a: 0, b: [{ a: 1, z: 2 }] }));
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });
  it("invalidates reviewed content and scope without treating delivery metadata as a payload change", () => {
    const a = { payload: { to: "test@example.com" }, warnings: [], risk: "HIGH", affectedSystem: "email" } as unknown as Approval;
    expect(approvalSnapshot(a)).not.toBe(approvalSnapshot({ ...a, payload: { to: "elsewhere@example.com" } }));
    expect(approvalSnapshot(a)).not.toBe(approvalSnapshot({ ...a, affectedSystem: "other-account" }));
    expect(approvalSnapshot(a)).toBe(approvalSnapshot({ ...a, signalDelivered: true }));
  });
  it("fails closed for expired or malformed expiry even before the sweeper updates the row", () => {
    const a = { status: "pending", expiresAt: "2030-01-01T00:00:00Z" } as Approval;
    expect(isDecisionOpen(a, Date.parse("2029-01-01"))).toBe(true);
    expect(isDecisionOpen(a, Date.parse(a.expiresAt))).toBe(false);
    expect(isDecisionOpen({ ...a, expiresAt: "bad" })).toBe(false);
    expect(isDecisionOpen({ ...a, status: "approved" }, 0)).toBe(false);
  });
});
