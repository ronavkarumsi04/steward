import {
  RISK_ORDER,
  type AutonomyLevel,
  type PolicyDecision,
  type PolicyDimension,
  type PolicyRule,
  type RiskLevel,
  type ToolManifest,
} from "@steward/schema";

export interface PolicyContext {
  autonomyLevel: AutonomyLevel;
  rules: PolicyRule[];
  /** Spend already committed in the current period per dimension (USD). */
  spentUsd?: Partial<Record<PolicyDimension, { day: number; month: number }>>;
  /** Action counts in the current windows per dimension. */
  counts?: Partial<Record<PolicyDimension, { hour: number; day: number }>>;
  outboundPaused?: boolean;
  quietHoursActive?: boolean;
}

export interface ActionRequest {
  tool: Pick<ToolManifest, "name" | "risk" | "dimension" | "sideEffects" | "idempotent" | "costCategory">;
  estimatedCostUsd?: number;
  /** Explicit dimension override (e.g. deploy to production vs preview). */
  dimension?: PolicyDimension;
  risk?: RiskLevel;
}

/** Default per-autonomy-level policies. Level 4 still routes CRITICAL actions through approval. */
export function defaultRules(level: AutonomyLevel): PolicyRule[] {
  const dims: PolicyDimension[] = ["ai_spend", "infra_spend", "ad_spend", "email_send", "social_publish", "code_deploy", "prod_deploy", "db_mutation", "customer_comms", "payments", "external_write"];
  return dims.map((dimension) => {
    let mode: PolicyRule["mode"] = "approve";
    let maxRiskWithoutApproval: RiskLevel | undefined;
    const limits: PolicyRule["limits"] = {};
    switch (level) {
      case 0:
        mode = dimension === "ai_spend" ? "allow" : "deny";
        break;
      case 1:
        mode = dimension === "ai_spend" ? "allow" : "approve";
        maxRiskWithoutApproval = dimension === "ai_spend" ? "LOW" : undefined;
        break;
      case 2:
        mode = dimension === "ai_spend" ? "allow" : "approve";
        maxRiskWithoutApproval = dimension === "ai_spend" ? "MEDIUM" : "LOW";
        break;
      case 3:
        mode = ["ad_spend", "payments", "prod_deploy"].includes(dimension) ? "approve" : "allow";
        maxRiskWithoutApproval = ["ad_spend", "payments", "prod_deploy"].includes(dimension) ? "LOW" : "MEDIUM";
        if (dimension === "email_send") Object.assign(limits, { perHourCount: 20, perDayCount: 100 });
        if (dimension === "social_publish") Object.assign(limits, { perDayCount: 5 });
        if (dimension === "infra_spend") Object.assign(limits, { perActionUsd: 25, perMonthUsd: 100 });
        break;
      case 4:
        mode = "allow";
        maxRiskWithoutApproval = ["ad_spend", "payments"].includes(dimension) ? "MEDIUM" : "HIGH";
        if (dimension === "email_send") Object.assign(limits, { perHourCount: 100, perDayCount: 1000 });
        if (dimension === "social_publish") Object.assign(limits, { perDayCount: 20 });
        if (dimension === "ad_spend") Object.assign(limits, { perDayUsd: 50, perMonthUsd: 500 });
        if (dimension === "infra_spend") Object.assign(limits, { perActionUsd: 100, perMonthUsd: 500 });
        if (dimension === "payments") Object.assign(limits, { perActionUsd: 100 });
        break;
    }
    return { dimension, mode, maxRiskWithoutApproval, limits };
  });
}

export function dimensionFor(action: ActionRequest): PolicyDimension | null {
  if (action.dimension) return action.dimension;
  if (action.tool.dimension) return action.tool.dimension;
  if (action.tool.sideEffects === "external") return "external_write";
  return null;
}

/**
 * Evaluates whether an action may proceed. Order of precedence:
 * kill switches → deny rules → CRITICAL always requires approval → count/spend limits → risk threshold.
 */
export function evaluate(ctx: PolicyContext, action: ActionRequest): PolicyDecision {
  const risk = action.risk ?? action.tool.risk;
  const dimension = dimensionFor(action);
  if (!dimension) {
    return { decision: "allow", reason: "internal action without external side effects", dimension: "external_write", risk };
  }
  const rule = ctx.rules.find((r) => r.dimension === dimension) ?? defaultRules(ctx.autonomyLevel).find((r) => r.dimension === dimension)!;

  if (ctx.outboundPaused && ["email_send", "social_publish", "customer_comms"].includes(dimension)) {
    return { decision: "deny", reason: "Outbound communications are paused for this company", dimension, risk };
  }
  if (ctx.autonomyLevel === 0 && action.tool.sideEffects === "external") {
    return { decision: "deny", reason: "Company is in read-only mode (autonomy level 0)", dimension, risk };
  }
  if (rule.mode === "deny") return { decision: "deny", reason: `Policy denies ${dimension} actions`, dimension, risk };
  if (risk === "CRITICAL") return { decision: "require_approval", reason: "CRITICAL-risk actions always require human approval", dimension, risk };

  const limits = rule.limits ?? {};
  const counts = ctx.counts?.[dimension];
  if (limits.perHourCount !== undefined && (counts?.hour ?? 0) >= limits.perHourCount)
    return { decision: "require_approval", reason: `Hourly limit of ${limits.perHourCount} ${dimension} actions reached`, dimension, risk };
  if (limits.perDayCount !== undefined && (counts?.day ?? 0) >= limits.perDayCount)
    return { decision: "require_approval", reason: `Daily limit of ${limits.perDayCount} ${dimension} actions reached`, dimension, risk };
  const cost = action.estimatedCostUsd ?? 0;
  const spent = ctx.spentUsd?.[dimension];
  if (limits.perActionUsd !== undefined && cost > limits.perActionUsd)
    return { decision: "require_approval", reason: `Estimated cost $${cost.toFixed(2)} exceeds per-action limit $${limits.perActionUsd}`, dimension, risk };
  if (limits.perDayUsd !== undefined && (spent?.day ?? 0) + cost > limits.perDayUsd)
    return { decision: "require_approval", reason: `Daily ${dimension} budget $${limits.perDayUsd} would be exceeded`, dimension, risk };
  if (limits.perMonthUsd !== undefined && (spent?.month ?? 0) + cost > limits.perMonthUsd)
    return { decision: "require_approval", reason: `Monthly ${dimension} budget $${limits.perMonthUsd} would be exceeded`, dimension, risk };

  if (ctx.quietHoursActive && ["email_send", "social_publish", "customer_comms"].includes(dimension))
    return { decision: "require_approval", reason: "Quiet hours are active for outbound communication", dimension, risk };

  if (rule.mode === "approve") {
    const max = rule.maxRiskWithoutApproval;
    if (max && RISK_ORDER[risk] <= RISK_ORDER[max]) return { decision: "allow", reason: `${risk} risk is within the auto-approve threshold (${max})`, dimension, risk };
    return { decision: "require_approval", reason: `${dimension} actions require approval at autonomy level ${ctx.autonomyLevel}`, dimension, risk };
  }
  // mode === allow
  const max = rule.maxRiskWithoutApproval ?? "HIGH";
  if (RISK_ORDER[risk] <= RISK_ORDER[max]) return { decision: "allow", reason: `Allowed by policy (${risk} ≤ ${max})`, dimension, risk };
  return { decision: "require_approval", reason: `${risk} risk exceeds the auto-approve threshold (${max})`, dimension, risk };
}

/** Risk classification for common action shapes; independent of model confidence. */
export function classifyRisk(input: { dimension: PolicyDimension; reversible: boolean; audience?: "internal" | "customers" | "public"; costUsd?: number; production?: boolean }): RiskLevel {
  const { dimension, reversible, audience, costUsd = 0, production } = input;
  if (dimension === "payments" && (!reversible || costUsd > 100)) return "CRITICAL";
  if (dimension === "ad_spend" && costUsd > 100) return "CRITICAL";
  if (dimension === "db_mutation" && !reversible && production) return "CRITICAL";
  if (dimension === "prod_deploy") return "HIGH";
  if (["email_send", "social_publish", "customer_comms"].includes(dimension)) return audience === "public" || audience === "customers" ? "HIGH" : "MEDIUM";
  if (dimension === "infra_spend") return costUsd > 25 ? "HIGH" : "MEDIUM";
  if (dimension === "code_deploy") return production ? "HIGH" : "MEDIUM";
  if (!reversible) return "HIGH";
  return "LOW";
}

export function isQuietHours(now: Date, quiet: { start: string; end: string } | null | undefined, timezone: string): boolean {
  if (!quiet) return false;
  const fmt = new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: timezone });
  const [h, m] = fmt.format(now).split(":").map(Number);
  const cur = (h ?? 0) * 60 + (m ?? 0);
  const toMin = (s: string) => {
    const [hh, mm] = s.split(":").map(Number);
    return (hh ?? 0) * 60 + (mm ?? 0);
  };
  const start = toMin(quiet.start);
  const end = toMin(quiet.end);
  return start <= end ? cur >= start && cur < end : cur >= start || cur < end;
}
