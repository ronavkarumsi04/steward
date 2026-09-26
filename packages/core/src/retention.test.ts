import { describe, expect, it } from "vitest";
import { RETENTION_POLICY, sweptRules } from "@steward/legal";
import { SMS_STOP_KEYWORDS, inboundSmsIntent, unsubscribeToken, verifyUnsubscribeToken } from "./privacy.js";
import { SWEEP_SPECS } from "./retention.js";

const masterKey = "test-master-key-not-a-real-secret";

describe("retention sweep matches the published policy", () => {
  it("implements every rule that the policy says is enforced automatically", () => {
    const implemented = new Set(SWEEP_SPECS.map((s) => s.ruleId));
    for (const rule of sweptRules()) {
      expect(implemented, `no sweep implementation for rule "${rule.id}"`).toContain(rule.id);
    }
  });

  it("does not sweep anything the policy says is kept", () => {
    for (const spec of SWEEP_SPECS) {
      const rule = RETENTION_POLICY.find((r) => r.id === spec.ruleId);
      expect(rule, `sweep spec "${spec.ruleId}" has no matching policy rule`).toBeDefined();
      expect(rule?.sweepDays, `"${spec.ruleId}" is swept but the policy says it is not`).not.toBeNull();
    }
  });

  it("keeps the audit trail and suppression records out of the sweep", () => {
    const swept = SWEEP_SPECS.map((s) => s.table);
    for (const table of ["agent_runs", "agent_run_steps", "ai_calls", "tool_calls", "audit_log", "suppression_list", "messages", "memories"]) {
      expect(swept, `${table} must never be swept`).not.toContain(table);
    }
  });
});

describe("unsubscribe tokens", () => {
  const payload = { organizationId: "org-1", companyId: "co-1", address: "person@example.com", channel: "email" as const };

  it("round-trips a signed payload", () => {
    const verified = verifyUnsubscribeToken(masterKey, unsubscribeToken(masterKey, payload));
    expect(verified).toMatchObject(payload);
  });

  it("rejects a tampered payload", () => {
    const token = unsubscribeToken(masterKey, payload);
    const [body, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...payload, address: "someone-else@example.com" })).toString("base64url");
    expect(verifyUnsubscribeToken(masterKey, `${forged}.${sig}`)).toBeNull();
    expect(verifyUnsubscribeToken(masterKey, `${body}.deadbeef`)).toBeNull();
  });

  it("rejects a token signed with a different master key", () => {
    const token = unsubscribeToken("another-key", payload);
    expect(verifyUnsubscribeToken(masterKey, token)).toBeNull();
  });

  it("rejects malformed tokens instead of throwing", () => {
    for (const bad of ["", ".", "not-a-token", "a.b.c"]) {
      expect(() => verifyUnsubscribeToken(masterKey, bad)).not.toThrow();
      expect(verifyUnsubscribeToken(masterKey, bad)).toBeNull();
    }
  });
});

describe("SMS keyword handling", () => {
  it("treats every FCC-listed revocation keyword as a stop", () => {
    for (const keyword of SMS_STOP_KEYWORDS) {
      expect(inboundSmsIntent(keyword), `"${keyword}" must revoke consent`).toBe("stop");
    }
  });

  it("handles case, punctuation, and surrounding whitespace", () => {
    expect(inboundSmsIntent("  STOP!  ")).toBe("stop");
    expect(inboundSmsIntent("Opt Out.")).toBe("stop");
    expect(inboundSmsIntent("unsubscribe")).toBe("stop");
  });

  it("recognizes start and help, and leaves normal replies alone", () => {
    expect(inboundSmsIntent("START")).toBe("start");
    expect(inboundSmsIntent("HELP")).toBe("help");
    expect(inboundSmsIntent("yes please send me the pricing")).toBe("other");
    expect(inboundSmsIntent("stop by the office tomorrow")).toBe("other");
  });
});
