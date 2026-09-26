import { describe, expect, it } from "vitest";
import { assessApprovalPayload, canonicalJson, needsFreshApproval, payloadFingerprint } from "./approval.js";

const approved = { to: "founder@example.com", subject: "Launch", body: "Ship it" };

describe("canonical payload identity", () => {
  it("ignores key order and nesting, so equal payloads fingerprint equally", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
    expect(payloadFingerprint({ b: 1, a: 2 })).toBe(payloadFingerprint({ a: 2, b: 1 }));
  });

  it("distinguishes real changes, including array order", () => {
    expect(payloadFingerprint(approved)).not.toBe(payloadFingerprint({ ...approved, subject: "Launch " }));
    expect(payloadFingerprint([1, 2])).not.toBe(payloadFingerprint([2, 1]));
    expect(payloadFingerprint({ n: 1 })).not.toBe(payloadFingerprint({ n: "1" }));
  });
});

describe("approval coverage", () => {
  it("treats an untouched payload as covered and never re-asks for it", () => {
    const assessment = assessApprovalPayload({ approved, executing: JSON.parse(JSON.stringify(approved)), approvedRisk: "HIGH", executingRisk: "HIGH" });
    expect(assessment.edited).toBe(false);
    expect(assessment.riskEscalated).toBe(false);
    // Even when policy would demand approval again, the human already said yes to exactly this payload.
    expect(needsFreshApproval({ assessment, policyRequiresApproval: true })).toBe(false);
  });

  it("requires a fresh decision when an edit raises risk", () => {
    const assessment = assessApprovalPayload({ approved, executing: { ...approved, body: "Ship it to every customer" }, approvedRisk: "LOW", executingRisk: "HIGH" });
    expect(assessment.edited).toBe(true);
    expect(assessment.riskEscalated).toBe(true);
    expect(assessment.detail).toContain("LOW → HIGH");
    expect(needsFreshApproval({ assessment, policyRequiresApproval: false })).toBe(true);
  });

  it("requires a fresh decision when policy would not auto-approve the edited action", () => {
    const assessment = assessApprovalPayload({ approved: { amountUsd: 10 }, executing: { amountUsd: 5000 }, approvedRisk: "MEDIUM", executingRisk: "MEDIUM" });
    expect(assessment.edited).toBe(true);
    expect(assessment.riskEscalated).toBe(false);
    expect(needsFreshApproval({ assessment, policyRequiresApproval: true })).toBe(true);
  });

  it("allows an edit that lowers risk and stays policy-clean", () => {
    const assessment = assessApprovalPayload({ approved: { amountUsd: 500 }, executing: { amountUsd: 5 }, approvedRisk: "HIGH", executingRisk: "LOW" });
    expect(assessment.edited).toBe(true);
    expect(assessment.riskEscalated).toBe(false);
    expect(needsFreshApproval({ assessment, policyRequiresApproval: false })).toBe(false);
  });
});
