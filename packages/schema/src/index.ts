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
  "run.step",
  "run.tool_call",
  "run.completed",
  "approval.requested",
  "approval.resolved",
  "approval.expired",
  "budget.threshold",
  "budget.exhausted",
  "memory.written",
  "decision.recorded",
  "document.created",
  "document.updated",
  "integration.connected",
  "integration.needs_reauth",
  "integration.error",
  "integration.webhook",
  "provider.connected",
  "provider.error",
  "message.created",
  "deployment.status",
  "schedule.fired",
  "agent.updated",
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
  "entity",
  "performance",
]);
export type MemoryKind = z.infer<typeof MemoryKind>;

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

export const ID = z.string().min(1);
export const Paginated = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });

export const RISK_ORDER: Record<RiskLevel, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };
export const TIER_ORDER: Record<QualityTier, number> = { economy: 0, standard: 1, premium: 2, frontier: 3 };
