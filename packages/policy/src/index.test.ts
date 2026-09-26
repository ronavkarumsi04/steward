import { describe, expect, it } from "vitest";
import { classifyPolicyReason, type PolicyDimension, type PolicyReasonCode, type RiskLevel } from "@steward/schema";
import { classifyRisk, defaultRules, evaluate, isQuietHours, type PolicyContext } from "./index.js";
import { assessApprovalPayload } from "./approval.js";

const tool = (risk: RiskLevel, dimension?: PolicyDimension, sideEffects: "none" | "internal" | "external" = "external") => ({
  name: "t",
  risk,
  dimension,
  sideEffects,
  idempotent: false,
  costCategory: "none" as const,
});

describe("policy engine", () => {
  it("level 0 denies external actions", () => {
    expect(evaluate({ autonomyLevel: 0, rules: defaultRules(0) }, { tool: tool("LOW", "email_send") }).decision).toBe("deny");
  });
  it("level 2 requires approval for MEDIUM, allows LOW", () => {
    expect(evaluate({ autonomyLevel: 2, rules: defaultRules(2) }, { tool: tool("MEDIUM", "email_send") }).decision).toBe("require_approval");
    expect(evaluate({ autonomyLevel: 2, rules: defaultRules(2) }, { tool: tool("LOW", "email_send") }).decision).toBe("allow");
  });
  it("level 4 still gates CRITICAL and spend limits", () => {
    const ctx = { autonomyLevel: 4 as const, rules: defaultRules(4) };
    expect(evaluate(ctx, { tool: tool("HIGH", "email_send") }).decision).toBe("allow");
    expect(evaluate(ctx, { tool: tool("CRITICAL", "payments") }).decision).toBe("require_approval");
    expect(evaluate(ctx, { tool: tool("MEDIUM", "ad_spend"), estimatedCostUsd: 80 }).decision).toBe("require_approval");
    expect(evaluate({ ...ctx, counts: { email_send: { hour: 100, day: 100 } } }, { tool: tool("LOW", "email_send") }).decision).toBe("require_approval");
  });
  it("kill switch and internal actions", () => {
    expect(evaluate({ autonomyLevel: 4, rules: defaultRules(4), outboundPaused: true }, { tool: tool("LOW", "email_send") }).decision).toBe("deny");
    expect(evaluate({ autonomyLevel: 1, rules: defaultRules(1) }, { tool: tool("LOW", undefined, "internal") }).decision).toBe("allow");
  });
  it("classifies risk", () => {
    expect(classifyRisk({ dimension: "payments", reversible: false })).toBe("CRITICAL");
    expect(classifyRisk({ dimension: "email_send", reversible: false, audience: "customers" })).toBe("HIGH");
    expect(classifyRisk({ dimension: "code_deploy", reversible: true })).toBe("MEDIUM");
  });
  it("quiet hours across midnight", () => {
    const at = new Date("2026-01-01T23:30:00Z");
    expect(isQuietHours(at, { start: "22:00", end: "07:00" }, "UTC")).toBe(true);
    expect(isQuietHours(new Date("2026-01-01T12:00:00Z"), { start: "22:00", end: "07:00" }, "UTC")).toBe(false);
  });
});

/**
 * A decision surface labels the rule that stopped an action by code, so a sentence the engine can emit that
 * no code recognises would reach a founder as "unknown". Rather than re-state the engine's strings here —
 * which would test this file against itself — this drives the real engine across every level, dimension,
 * risk and limit shape, and the approval module's own edit details, then asserts the vocabulary covers all
 * of it. If a reason is ever reworded or added, this fails instead of the UI quietly degrading.
 */
describe("policy reason vocabulary", () => {
  const dimensions = [
    "ai_spend", "infra_spend", "ad_spend", "email_send", "social_publish",
    "code_deploy", "prod_deploy", "db_mutation", "customer_comms", "payments", "external_write",
  ] as const;
  const risks: RiskLevel[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

  const countsOverEveryCeiling = Object.fromEntries(dimensions.map((d) => [d, { hour: 10_000, day: 10_000 }])) as PolicyContext["counts"];
  const spendOverEveryBudget = Object.fromEntries(dimensions.map((d) => [d, { day: 1_000_000, month: 1_000_000 }])) as PolicyContext["spentUsd"];

  function emitted(): string[] {
    const reasons = new Set<string>();
    for (const autonomyLevel of [0, 1, 2, 3, 4] as const) {
      const rules = defaultRules(autonomyLevel);
      const contexts: PolicyContext[] = [
        { autonomyLevel, rules },
        { autonomyLevel, rules, counts: countsOverEveryCeiling },
        { autonomyLevel, rules, spentUsd: spendOverEveryBudget },
        { autonomyLevel, rules, outboundPaused: true },
        { autonomyLevel, rules, quietHoursActive: true },
        // A company can switch a dimension off entirely, which is the only way to reach the deny rule.
        { autonomyLevel, rules: rules.map((r) => ({ ...r, mode: "deny" as const })) },
      ];
      for (const ctx of contexts) {
        for (const dimension of dimensions) {
          for (const risk of risks) {
            for (const estimatedCostUsd of [0, 1_000_000]) {
              reasons.add(evaluate(ctx, { tool: tool(risk, dimension), estimatedCostUsd }).reason);
            }
          }
        }
      }
    }
    // An action with no external dimension short-circuits before any rule is consulted.
    reasons.add(evaluate({ autonomyLevel: 4, rules: defaultRules(4) }, { tool: tool("LOW", undefined, "internal") }).reason);
    // The approval module's edit details are shown next to the policy line, and can be the whole reason.
    reasons.add(assessApprovalPayload({ approved: { to: "a@b.c" }, executing: { to: "a@b.c" }, approvedRisk: "LOW", executingRisk: "LOW" }).detail);
    reasons.add(assessApprovalPayload({ approved: { to: "a@b.c" }, executing: { to: "x@y.z" }, approvedRisk: "LOW", executingRisk: "LOW" }).detail);
    reasons.add(assessApprovalPayload({ approved: { to: "a@b.c" }, executing: { to: "x@y.z" }, approvedRisk: "LOW", executingRisk: "HIGH" }).detail);
    return [...reasons];
  }

  it("recognises every reason the engine emits", () => {
    const reasons = emitted();
    expect(reasons.length).toBeGreaterThan(30);
    expect(reasons.filter((r) => classifyPolicyReason(r) === "unknown")).toEqual([]);
  });

  it("recognises each rule the sweep reaches, so the pass is not vacuous", () => {
    const codes = new Set<PolicyReasonCode>(emitted().map((r) => classifyPolicyReason(r)));
    const reached: PolicyReasonCode[] = [
      "outbound_paused", "read_only", "policy_denies", "critical_risk", "hourly_limit", "daily_limit",
      "per_action_cost", "daily_budget", "monthly_budget", "quiet_hours", "rule_requires_approval",
      "risk_ceiling", "within_threshold", "allowed_by_policy", "internal_action", "payload_edited",
      "payload_unchanged",
    ];
    for (const code of reached) expect([...codes]).toContain(code);
  });
});
