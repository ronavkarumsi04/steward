import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  vector,
} from "drizzle-orm/pg-core";

const id = (name = "id") => text(name).primaryKey().default(sql`gen_random_uuid()::text`);
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => ts("created_at").notNull().defaultNow();
const updatedAt = () => ts("updated_at").notNull().defaultNow();
const json = <T>(name: string) => jsonb(name).$type<T>();

// ---------- Identity ----------
export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull(),
  emailVerifiedAt: ts("email_verified_at"),
  passwordHash: text("password_hash"),
  name: text("name").notNull().default(""),
  avatarUrl: text("avatar_url"),
  isSuperadmin: boolean("is_superadmin").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("users_email_idx").on(sql`lower(${t.email})`)]);

export const sessions = pgTable("sessions", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  expiresAt: ts("expires_at").notNull(),
  lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
  ip: text("ip"),
  userAgent: text("user_agent"),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("sessions_token_idx").on(t.tokenHash), index("sessions_user_idx").on(t.userId)]);

export const emailVerifications = pgTable("email_verifications", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  purpose: text("purpose").notNull(), // verify_email | reset_password
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
  createdAt: createdAt(),
});

export const oauthIdentities = pgTable("oauth_identities", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  providerUserId: text("provider_user_id").notNull(),
  email: text("email"),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("oauth_identity_idx").on(t.provider, t.providerUserId)]);

// ---------- Tenancy ----------
export const organizations = pgTable("organizations", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  settings: json<Record<string, unknown>>("settings").notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("org_slug_idx").on(t.slug)]);

export const memberships = pgTable("memberships", {
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: text("role").notNull(), // owner|admin|member|viewer
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.organizationId, t.userId] })]);

export const invitations = pgTable("invitations", {
  id: id(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role").notNull(),
  tokenHash: text("token_hash").notNull(),
  invitedBy: text("invited_by").notNull(),
  expiresAt: ts("expires_at").notNull(),
  acceptedAt: ts("accepted_at"),
  createdAt: createdAt(),
});

export const companies = pgTable("companies", {
  id: id(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  status: text("status").notNull().default("active"), // active|paused|archived
  autonomyLevel: integer("autonomy_level").notNull().default(2),
  outboundPaused: boolean("outbound_paused").notNull().default(false),
  signalAutoReview: boolean("signal_auto_review").notNull().default(false),
  timezone: text("timezone").notNull().default("UTC"),
  quietHours: json<{ start: string; end: string } | null>("quiet_hours"),
  settings: json<Record<string, unknown>>("settings").notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("company_slug_idx").on(t.organizationId, t.slug), index("company_org_idx").on(t.organizationId)]);

export const companyProfiles = pgTable("company_profiles", {
  id: id(),
  organizationId: text("organization_id").notNull(),
  companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  profile: json<Record<string, unknown>>("profile").notNull(),
  source: text("source").notNull().default("user"), // user|agent|ingestion
  createdBy: json<Record<string, unknown>>("created_by").notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("company_profile_version_idx").on(t.companyId, t.version)]);

export const goals = pgTable("goals", {
  id: id(),
  organizationId: text("organization_id").notNull(),
  companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  metric: text("metric"),
  target: text("target"),
  horizon: text("horizon"),
  status: text("status").notNull().default("active"),
  priority: integer("priority").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("goals_company_idx").on(t.companyId)]);

// ---------- Agents, tasks, runs ----------
export const agents = pgTable("agents", {
  id: id(),
  organizationId: text("organization_id").notNull(),
  companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  systemPrompt: text("system_prompt").notNull().default(""),
  enabled: boolean("enabled").notNull().default(true),
  toolAllowlist: json<string[]>("tool_allowlist").notNull().default([]),
  routingPolicy: json<Record<string, unknown>>("routing_policy").notNull().default({}),
  maxIterations: integer("max_iterations").notNull().default(24),
  budgetUsdPerRun: numeric("budget_usd_per_run", { precision: 12, scale: 4 }),
  config: json<Record<string, unknown>>("config").notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("agents_company_idx").on(t.companyId)]);

export const agentSchedules = pgTable("agent_schedules", {
  id: id(),
  organizationId: text("organization_id").notNull(),
  companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  agentId: text("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  cron: text("cron").notNull(),
  timezone: text("timezone").notNull().default("UTC"),
  instruction: text("instruction").notNull().default(""),
  enabled: boolean("enabled").notNull().default(true),
  temporalScheduleId: text("temporal_schedule_id"),
  lastFiredAt: ts("last_fired_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("schedules_company_idx").on(t.companyId)]);

export const projects = pgTable("projects", {
  id: id(),
  organizationId: text("organization_id").notNull(),
  companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  objective: text("objective").notNull().default(""),
  status: text("status").notNull().default("active"),
  successSignal: text("success_signal").notNull().default(""),
  nextStep: text("next_step").notNull().default(""),
  createdBy: json<Record<string, unknown>>("created_by").notNull().default({}),
  repoIntegrationId: text("repo_integration_id"),
  repoFullName: text("repo_full_name"),
  defaultBranch: text("default_branch").notNull().default("main"),
  deployIntegrationId: text("deploy_integration_id"),
  deployProjectId: text("deploy_project_id"),
  productionUrl: text("production_url"),
  sandboxImage: text("sandbox_image"),
  config: json<Record<string, unknown>>("config").notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("projects_company_idx").on(t.companyId)]);

export const deployments = pgTable("deployments", {
  id: id(),
  organizationId: text("organization_id").notNull(),
  companyId: text("company_id").notNull(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  externalId: text("external_id"),
  environment: text("environment").notNull().default("preview"),
  status: text("status").notNull(),
  url: text("url"),
  gitRef: text("git_ref"),
  runId: text("run_id"),
  logsUrl: text("logs_url"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("deployments_project_idx").on(t.projectId, t.createdAt)]);

export const tasks = pgTable("tasks", {
  id: id(),
  organizationId: text("organization_id").notNull(),
  companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  goalId: text("goal_id").references(() => goals.id, { onDelete: "set null" }),
  projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
  parentTaskId: text("parent_task_id"),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  status: text("status").notNull().default("todo"),
  priority: text("priority").notNull().default("medium"),
  assigneeAgentId: text("assignee_agent_id").references(() => agents.id, { onDelete: "set null" }),
  assigneeUserId: text("assignee_user_id"),
  createdBy: json<Record<string, unknown>>("created_by").notNull(),
  dueAt: ts("due_at"),
  result: json<Record<string, unknown> | null>("result"),
  labels: json<string[]>("labels").notNull().default([]),
  position: integer("position").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  completedAt: ts("completed_at"),
}, (t) => [index("tasks_company_status_idx").on(t.companyId, t.status), index("tasks_company_created_idx").on(t.companyId, t.createdAt), index("tasks_project_idx").on(t.projectId, t.createdAt)]);

export const taskDependencies = pgTable("task_dependencies", {
  taskId: text("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  dependsOnTaskId: text("depends_on_task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
}, (t) => [primaryKey({ columns: [t.taskId, t.dependsOnTaskId] })]);

export const agentRuns = pgTable("agent_runs", {
  id: id(),
  organizationId: text("organization_id").notNull(),
  companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  agentId: text("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  taskId: text("task_id").references(() => tasks.id, { onDelete: "set null" }),
  projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
  conversationId: text("conversation_id"),
  trigger: json<Record<string, unknown>>("trigger").notNull(),
  status: text("status").notNull().default("queued"),
  intent: text("intent").notNull().default(""),
  plan: json<Record<string, unknown> | null>("plan"),
  result: json<Record<string, unknown> | null>("result"),
  error: text("error"),
  workflowId: text("workflow_id"),
  workflowRunId: text("workflow_run_id"),
  costUsd: numeric("cost_usd", { precision: 12, scale: 6 }).notNull().default("0"),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  iterations: integer("iterations").notNull().default(0),
  startedAt: ts("started_at"),
  finishedAt: ts("finished_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("runs_company_created_idx").on(t.companyId, t.createdAt), index("runs_task_idx").on(t.taskId), index("runs_project_idx").on(t.projectId, t.createdAt), uniqueIndex("runs_workflow_idx").on(t.workflowId)]);

export const agentRunSteps = pgTable("agent_run_steps", {
  id: id(),
  organizationId: text("organization_id").notNull(),
  companyId: text("company_id").notNull(),
  runId: text("run_id").notNull().references(() => agentRuns.id, { onDelete: "cascade" }),
  stepIndex: integer("step_index").notNull(),
  kind: text("kind").notNull(),
  title: text("title").notNull().default(""),
  status: text("status").notNull().default("running"),
  input: json<unknown>("input"),
  output: json<unknown>("output"),
  error: text("error"),
  idempotencyKey: text("idempotency_key"),
  startedAt: ts("started_at").notNull().defaultNow(),
  finishedAt: ts("finished_at"),
  durationMs: integer("duration_ms"),
}, (t) => [uniqueIndex("run_steps_idx").on(t.runId, t.stepIndex)]);

export const aiCalls = pgTable("ai_calls", {
  id: id(),
  organizationId: text("organization_id").notNull(),
  companyId: text("company_id"),
  runId: text("run_id"),
  stepId: text("step_id"),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  purpose: text("purpose").notNull().default("chat"),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  cachedTokens: integer("cached_tokens").notNull().default(0),
  reasoningTokens: integer("reasoning_tokens").notNull().default(0),
  latencyMs: integer("latency_ms").notNull().default(0),
  costUsd: numeric("cost_usd", { precision: 12, scale: 6 }).notNull().default("0"),
  costEstimated: boolean("cost_estimated").notNull().default(true),
  status: text("status").notNull(), // ok|error
  errorCode: text("error_code"),
  retries: integer("retries").notNull().default(0),
  routingReason: text("routing_reason").notNull().default(""),
  createdAt: createdAt(),
}, (t) => [index("ai_calls_company_created_idx").on(t.companyId, t.createdAt), index("ai_calls_run_idx").on(t.runId)]);

export const toolCalls = pgTable("tool_calls", {
  id: id(),
  organizationId: text("organization_id").notNull(),
  companyId: text("company_id").notNull(),
  runId: text("run_id").notNull(),
  stepId: text("step_id"),
  toolName: text("tool_name").notNull(),
  input: json<unknown>("input"),
  output: json<unknown>("output"),
  status: text("status").notNull(),
  risk: text("risk").notNull(),
  policyDecision: json<Record<string, unknown>>("policy_decision"),
  approvalId: text("approval_id"),
  idempotencyKey: text("idempotency_key"),
  durationMs: integer("duration_ms"),
  createdAt: createdAt(),
}, (t) => [index("tool_calls_run_idx").on(t.runId), uniqueIndex("tool_calls_idem_idx").on(t.idempotencyKey)]);

// ---------- Approvals, policies, budgets ----------
export const approvals = pgTable("approvals", {
  id: id(),
  organizationId: text("organization_id").notNull(),
  companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  runId: text("run_id"),
  taskId: text("task_id"),
  agentId: text("agent_id"),
  action: text("action").notNull(),
  reason: text("reason").notNull(),
  payload: json<Record<string, unknown>>("payload").notNull(),
  risk: text("risk").notNull(),
  dimension: text("dimension").notNull(),
  estimatedCostUsd: numeric("estimated_cost_usd", { precision: 12, scale: 4 }),
  affectedSystem: text("affected_system").notNull(),
  alternatives: json<string[]>("alternatives").notNull().default([]),
  status: text("status").notNull().default("pending"),
  resolvedBy: text("resolved_by"),
  resolution: json<Record<string, unknown> | null>("resolution"),
  resolvedAt: ts("resolved_at"),
  expiresAt: ts("expires_at").notNull(),
  workflowId: text("workflow_id"),
  createdAt: createdAt(),
}, (t) => [index("approvals_company_status_idx").on(t.companyId, t.status)]);

export const policies = pgTable("policies", {
  id: id(),
  organizationId: text("organization_id").notNull(),
  companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  dimension: text("dimension").notNull(),
  mode: text("mode").notNull(),
  maxRiskWithoutApproval: text("max_risk_without_approval"),
  limits: json<Record<string, number>>("limits").notNull().default({}),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("policies_dim_idx").on(t.companyId, t.dimension)]);

export const budgets = pgTable("budgets", {
  id: id(),
  organizationId: text("organization_id").notNull(),
  companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  category: text("category").notNull(), // ai|infra|ads|messaging|payments|total
  period: text("period").notNull().default("monthly"),
  limitUsd: numeric("limit_usd", { precision: 12, scale: 2 }).notNull(),
  softThresholdPct: integer("soft_threshold_pct").notNull().default(80),
  hardStop: boolean("hard_stop").notNull().default(true),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("budgets_cat_idx").on(t.companyId, t.category, t.period)]);

export const budgetLedger = pgTable("budget_ledger", {
  id: id(),
  organizationId: text("organization_id").notNull(),
  companyId: text("company_id").notNull(),
  category: text("category").notNull(),
  amountUsd: numeric("amount_usd", { precision: 12, scale: 6 }).notNull(),
  kind: text("kind").notNull(), // reserve|settle|release|charge
  refType: text("ref_type"),
  refId: text("ref_id"),
  periodKey: text("period_key").notNull(), // YYYY-MM
  createdAt: createdAt(),
}, (t) => [index("ledger_company_period_idx").on(t.companyId, t.periodKey, t.category)]);

// ---------- Memory ----------
export const memories = pgTable("memories", {
  id: id(),
  organizationId: text("organization_id").notNull(),
  companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  scope: text("scope").notNull().default("company"), // company|agent:<id>|conversation:<id>|run:<id>
  title: text("title").notNull().default(""),
  content: text("content").notNull(),
  embedding: vector("embedding", { dimensions: 1536 }),
  embeddingModel: text("embedding_model"),
  source: json<Record<string, unknown>>("source").notNull().default({}),
  confidence: numeric("confidence", { precision: 4, scale: 3 }).notNull().default("0.700"),
  importance: integer("importance").notNull().default(5),
  tags: json<string[]>("tags").notNull().default([]),
  createdByRunId: text("created_by_run_id"),
  expiresAt: ts("expires_at"),
  supersededBy: text("superseded_by"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index("memories_company_kind_idx").on(t.companyId, t.kind),
  index("memories_fts_idx").using("gin", sql`to_tsvector('english', coalesce(${t.title}, '') || ' ' || ${t.content})`),
  index("memories_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
]);

export const decisions = pgTable("decisions", {
  id: id(),
  organizationId: text("organization_id").notNull(),
  companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  rationale: text("rationale").notNull().default(""),
  decidedBy: json<Record<string, unknown>>("decided_by").notNull(),
  runId: text("run_id"),
  taskId: text("task_id"),
  projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
  status: text("status").notNull().default("active"),
  createdAt: createdAt(),
}, (t) => [index("decisions_company_idx").on(t.companyId, t.createdAt), index("decisions_project_idx").on(t.projectId, t.createdAt)]);

export const entities = pgTable("entities", {
  id: id(),
  organizationId: text("organization_id").notNull(),
  companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // person|company|product|competitor|tool|other
  name: text("name").notNull(),
  attributes: json<Record<string, unknown>>("attributes").notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("entities_name_idx").on(t.companyId, t.type, t.name)]);

// ---------- Conversations ----------
export const conversations = pgTable("conversations", {
  id: id(),
  organizationId: text("organization_id").notNull(),
  companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  title: text("title").notNull().default("New conversation"),
  projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
  agentId: text("agent_id"),
  createdBy: text("created_by").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("conversations_company_idx").on(t.companyId, t.updatedAt), index("conversations_project_idx").on(t.projectId, t.updatedAt)]);

export const messages = pgTable("messages", {
  id: id(),
  organizationId: text("organization_id").notNull(),
  companyId: text("company_id").notNull(),
  conversationId: text("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  role: text("role").notNull(), // user|assistant|system|tool
  content: text("content").notNull(),
  parts: json<unknown[]>("parts").notNull().default([]),
  runId: text("run_id"),
  status: text("status").notNull().default("complete"),
  createdAt: createdAt(),
}, (t) => [index("messages_conv_idx").on(t.conversationId, t.createdAt)]);

// ---------- Providers, integrations, credentials ----------
export const providerCredentials = pgTable("provider_credentials", {
  id: id(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  companyId: text("company_id"),
  providerType: text("provider_type").notNull(),
  label: text("label").notNull(),
  authMethod: text("auth_method").notNull(),
  baseUrl: text("base_url"),
  config: json<Record<string, unknown>>("config").notNull().default({}),
  secret: json<Record<string, unknown> | null>("secret"), // Envelope
  secretLast4: text("secret_last4"),
  secretFingerprint: text("secret_fingerprint"),
  status: text("status").notNull().default("unverified"),
  lastVerifiedAt: ts("last_verified_at"),
  lastError: text("last_error"),
  enabled: boolean("enabled").notNull().default(true),
  priority: integer("priority").notNull().default(100),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("provider_creds_org_idx").on(t.organizationId)]);

export const modelPreferences = pgTable("model_preferences", {
  id: id(),
  organizationId: text("organization_id").notNull(),
  companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  purpose: text("purpose").notNull(), // default|planning|coding|research|cheap|embedding
  routingPolicy: json<Record<string, unknown>>("routing_policy").notNull(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("model_prefs_idx").on(t.companyId, t.purpose)]);

export const integrations = pgTable("integrations", {
  id: id(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  companyId: text("company_id").references(() => companies.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // github|vercel|resend|...
  label: text("label").notNull(),
  status: text("status").notNull().default("disconnected"),
  authKind: text("auth_kind").notNull(), // oauth|api_key|token|webhook
  externalAccountId: text("external_account_id"),
  scopes: json<string[]>("scopes").notNull().default([]),
  config: json<Record<string, unknown>>("config").notNull().default({}),
  lastError: text("last_error"),
  lastCheckedAt: ts("last_checked_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("integrations_company_idx").on(t.companyId, t.type)]);

export const integrationCredentials = pgTable("integration_credentials", {
  id: id(),
  organizationId: text("organization_id").notNull(),
  integrationId: text("integration_id").notNull().references(() => integrations.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // access_token|refresh_token|api_key|secret
  secret: json<Record<string, unknown>>("secret").notNull(), // Envelope
  expiresAt: ts("expires_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("integration_creds_idx").on(t.integrationId, t.kind)]);

export const oauthStates = pgTable("oauth_states", {
  id: id(),
  organizationId: text("organization_id").notNull(),
  companyId: text("company_id"),
  userId: text("user_id").notNull(),
  provider: text("provider").notNull(),
  stateHash: text("state_hash").notNull(),
  codeVerifier: text("code_verifier"),
  redirectTo: text("redirect_to"),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("oauth_state_idx").on(t.stateHash)]);

export const apiKeys = pgTable("api_keys", {
  id: id(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  companyId: text("company_id"),
  name: text("name").notNull(),
  keyHash: text("key_hash").notNull(),
  prefix: text("prefix").notNull(),
  scopes: json<string[]>("scopes").notNull().default([]),
  createdBy: text("created_by").notNull(),
  lastUsedAt: ts("last_used_at"),
  revokedAt: ts("revoked_at"),
  expiresAt: ts("expires_at"),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("api_keys_hash_idx").on(t.keyHash)]);

export const webhooks = pgTable("webhooks", {
  id: id(),
  organizationId: text("organization_id").notNull(),
  companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  secret: json<Record<string, unknown>>("secret").notNull(),
  eventTypes: json<string[]>("event_types").notNull().default([]),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: createdAt(),
});

export const webhookDeliveries = pgTable("webhook_deliveries", {
  id: id(),
  organizationId: text("organization_id"),
  direction: text("direction").notNull(), // inbound|outbound
  provider: text("provider").notNull(),
  externalId: text("external_id"),
  webhookId: text("webhook_id"),
  eventId: text("event_id"),
  status: text("status").notNull(),
  attempts: integer("attempts").notNull().default(0),
  responseCode: integer("response_code"),
  payload: json<unknown>("payload"),
  error: text("error"),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("webhook_replay_idx").on(t.provider, t.externalId)]);

export const businessSignals = pgTable("business_signals", {
  id: id(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  integrationId: text("integration_id").references(() => integrations.id, { onDelete: "set null" }),
  provider: text("provider").notNull(),
  externalId: text("external_id").notNull(),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  summary: text("summary").notNull().default(""),
  severity: text("severity").notNull().default("info"), // info|positive|warning|critical
  state: text("state").notNull().default("unread"), // unread|reviewing|reviewed|dismissed
  projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
  customerRef: text("customer_ref"),
  data: json<Record<string, unknown>>("data").notNull().default({}),
  reviewRunId: text("review_run_id").references(() => agentRuns.id, { onDelete: "set null" }),
  occurredAt: ts("occurred_at").notNull().defaultNow(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("business_signals_provider_external_idx").on(t.provider, t.externalId),
  index("business_signals_company_state_idx").on(t.companyId, t.state, t.occurredAt),
  index("business_signals_project_idx").on(t.projectId, t.occurredAt),
]);

// ---------- Companion devices ----------
export const companionDevices = pgTable("companion_devices", {
  id: id(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  deviceKeyHash: text("device_key_hash"),
  pairingCodeHash: text("pairing_code_hash"),
  pairingExpiresAt: ts("pairing_expires_at"),
  capabilities: json<string[]>("capabilities").notNull().default([]),
  status: text("status").notNull().default("pairing"), // pairing|paired|revoked
  lastSeenAt: ts("last_seen_at"),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("companion_key_idx").on(t.deviceKeyHash)]);

// ---------- Events & audit ----------
export const events = pgTable("events", {
  seq: bigserial("seq", { mode: "number" }).primaryKey(),
  id: text("id").notNull().default(sql`gen_random_uuid()::text`),
  organizationId: text("organization_id").notNull(),
  companyId: text("company_id"),
  type: text("type").notNull(),
  actor: json<Record<string, unknown>>("actor").notNull(),
  payload: json<Record<string, unknown>>("payload").notNull().default({}),
  correlation: json<Record<string, string>>("correlation").notNull().default({}),
  createdAt: createdAt(),
}, (t) => [index("events_company_seq_idx").on(t.companyId, t.seq), index("events_org_seq_idx").on(t.organizationId, t.seq)]);

export const auditLog = pgTable("audit_log", {
  id: id(),
  organizationId: text("organization_id").notNull(),
  companyId: text("company_id"),
  actor: json<Record<string, unknown>>("actor").notNull(),
  action: text("action").notNull(),
  target: text("target"),
  metadata: json<Record<string, unknown>>("metadata").notNull().default({}),
  ip: text("ip"),
  createdAt: createdAt(),
}, (t) => [index("audit_org_idx").on(t.organizationId, t.createdAt)]);

// ---------- Engineering ----------

export const artifacts = pgTable("artifacts", {
  id: id(),
  organizationId: text("organization_id").notNull(),
  companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  runId: text("run_id"),
  taskId: text("task_id"),
  projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
  kind: text("kind").notNull(), // document|file|link|pr|deployment|report
  title: text("title").notNull(),
  mimeType: text("mime_type"),
  storageKey: text("storage_key"),
  url: text("url"),
  content: text("content"),
  sizeBytes: integer("size_bytes"),
  metadata: json<Record<string, unknown>>("metadata").notNull().default({}),
  createdAt: createdAt(),
}, (t) => [index("artifacts_company_idx").on(t.companyId, t.createdAt), index("artifacts_project_idx").on(t.projectId, t.createdAt)]);

// ---------- Business ----------
export const contacts = pgTable("contacts", {
  id: id(),
  organizationId: text("organization_id").notNull(),
  companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  email: text("email"),
  name: text("name").notNull().default(""),
  company: text("company"),
  phone: text("phone"),
  source: text("source"),
  attributes: json<Record<string, unknown>>("attributes").notNull().default({}),
  optedOutAt: ts("opted_out_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("contacts_email_idx").on(t.companyId, sql`lower(${t.email})`)]);

export const suppressionList = pgTable("suppression_list", {
  id: id(),
  organizationId: text("organization_id").notNull(),
  companyId: text("company_id").notNull(),
  channel: text("channel").notNull(), // email|sms
  address: text("address").notNull(),
  reason: text("reason").notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("suppression_idx").on(t.companyId, t.channel, sql`lower(${t.address})`)]);

export const leads = pgTable("leads", {
  id: id(),
  organizationId: text("organization_id").notNull(),
  companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  contactId: text("contact_id").references(() => contacts.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  stage: text("stage").notNull().default("new"),
  valueUsd: numeric("value_usd", { precision: 12, scale: 2 }),
  notes: text("notes").notNull().default(""),
  externalRef: json<Record<string, string>>("external_ref").notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("leads_company_idx").on(t.companyId, t.stage)]);

export const campaigns = pgTable("campaigns", {
  id: id(),
  organizationId: text("organization_id").notNull(),
  companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  channel: text("channel").notNull(), // email|social|ads
  status: text("status").notNull().default("draft"),
  config: json<Record<string, unknown>>("config").notNull().default({}),
  stats: json<Record<string, number>>("stats").notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("campaigns_project_idx").on(t.projectId, t.updatedAt)]);

export const outboundMessages = pgTable("outbound_messages", {
  id: id(),
  organizationId: text("organization_id").notNull(),
  companyId: text("company_id").notNull(),
  channel: text("channel").notNull(),
  provider: text("provider").notNull(),
  recipient: text("recipient").notNull(),
  subject: text("subject"),
  body: text("body").notNull(),
  status: text("status").notNull(),
  externalId: text("external_id"),
  campaignId: text("campaign_id"),
  runId: text("run_id"),
  approvalId: text("approval_id"),
  idempotencyKey: text("idempotency_key"),
  error: text("error"),
  createdAt: createdAt(),
}, (t) => [index("outbound_company_created_idx").on(t.companyId, t.createdAt), uniqueIndex("outbound_idem_idx").on(t.idempotencyKey)]);

export const supportTickets = pgTable("support_tickets", {
  id: id(),
  organizationId: text("organization_id").notNull(),
  companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  channel: text("channel").notNull(),
  externalId: text("external_id"),
  fromAddress: text("from_address").notNull(),
  subject: text("subject").notNull().default(""),
  status: text("status").notNull().default("open"),
  priority: text("priority").notNull().default("medium"),
  thread: json<unknown[]>("thread").notNull().default([]),
  draftReply: text("draft_reply"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("tickets_company_idx").on(t.companyId, t.status)]);

export const documents = pgTable("documents", {
  id: id(),
  organizationId: text("organization_id").notNull(),
  companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  content: text("content").notNull().default(""),
  format: text("format").notNull().default("markdown"),
  folder: text("folder").notNull().default("/"),
  createdBy: json<Record<string, unknown>>("created_by").notNull(),
  version: integer("version").notNull().default(1),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("documents_company_idx").on(t.companyId, t.folder)]);

export const financialSnapshots = pgTable("financial_snapshots", {
  id: id(),
  organizationId: text("organization_id").notNull(),
  companyId: text("company_id").notNull(),
  source: text("source").notNull(), // stripe|manual
  periodKey: text("period_key").notNull(),
  metrics: json<Record<string, number>>("metrics").notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("fin_snap_idx").on(t.companyId, t.source, t.periodKey)]);
