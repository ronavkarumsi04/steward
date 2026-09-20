import { describe, expect, it } from "vitest";
import { classifyRisk, defaultRules, evaluate, isQuietHours } from "./index.js";

const tool = (risk: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL", dimension?: "email_send" | "prod_deploy" | "payments" | "ad_spend", sideEffects: "none" | "internal" | "external" = "external") => ({
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
