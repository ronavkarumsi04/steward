/** Response shapes for the Steward API as consumed by the web app. */
import type { AutonomyLevel, CompanyProfile, ModelInfo, RiskLevel, RunStatus, TaskStatus } from "@steward/schema";

export interface User {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  isSuperadmin: boolean;
}
export interface Membership {
  organizationId: string;
  role: "owner" | "admin" | "member" | "viewer";
  name: string;
  slug: string;
}
export interface Me {
  user: User | null;
  memberships: Membership[];
}

export interface Company {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  status: "active" | "paused" | "archived";
  autonomyLevel: AutonomyLevel;
  outboundPaused: boolean;
  timezone: string;
  quietHours: { start: string; end: string } | null;
  settings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
export interface Goal {
  id: string;
  title: string;
  description: string;
  metric: string | null;
  target: string | null;
  horizon: string | null;
  status: string;
  priority: number;
}
export interface Agent {
  id: string;
  kind: string;
  name: string;
  description: string;
  systemPrompt: string;
  enabled: boolean;
  toolAllowlist: string[];
  routingPolicy: Record<string, unknown>;
  maxIterations: number;
  budgetUsdPerRun: string | null;
}
export interface Budget {
  category: "ai" | "infra" | "ads" | "messaging" | "payments" | "total";
  period: string;
  limitUsd: number;
  spentUsd: number;
  reservedUsd: number;
  remainingUsd: number;
  softThresholdPct: number;
  hardStop: boolean;
  exhausted: boolean;
  overSoftThreshold: boolean;
}
export interface Policy {
  id: string;
  dimension: string;
  mode: string;
  maxRiskWithoutApproval: RiskLevel | null;
  limits: Record<string, number>;
}
export interface CompanyProfileVersion {
  version: number;
  profile: CompanyProfile;
  source: "user" | "agent" | "ingestion";
  createdAt: string;
}
export interface CompanyOverview {
  company: Company;
  profile: CompanyProfileVersion | null;
  goals: Goal[];
  agents: Agent[];
  budgets: Budget[];
  taskCounts: Record<string, number>;
  pendingApprovals: number;
  policies: Policy[];
  role: Membership["role"];
}

export type ProjectStatus = "active" | "blocked" | "complete" | "cancelled";
export interface Project {
  id: string;
  organizationId: string;
  companyId: string;
  name: string;
  description: string;
  objective: string;
  status: ProjectStatus;
  successSignal: string;
  nextStep: string;
  repoIntegrationId: string | null;
  repoFullName: string | null;
  defaultBranch: string;
  deployIntegrationId: string | null;
  deployProjectId: string | null;
  productionUrl: string | null;
  sandboxImage: string | null;
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
export interface ProjectCampaign {
  id: string;
  projectId: string | null;
  name: string;
  channel: string;
  status: string;
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
export interface ProjectSnapshot {
  project: Project;
  tasks: Task[];
  runs: Run[];
  artifacts: Artifact[];
  decisions: Decision[];
  conversations: Conversation[];
  campaigns: ProjectCampaign[];
  signals: BusinessSignal[];
}

export type SignalState = "unread" | "reviewing" | "reviewed" | "dismissed";
export type SignalSeverity = "info" | "positive" | "warning" | "critical";
export interface BusinessSignal {
  id: string;
  organizationId: string;
  companyId: string;
  integrationId: string | null;
  provider: string;
  externalId: string;
  kind: string;
  title: string;
  summary: string;
  severity: SignalSeverity;
  state: SignalState;
  projectId: string | null;
  customerRef: string | null;
  data: Record<string, unknown>;
  reviewRunId: string | null;
  occurredAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: "low" | "medium" | "high" | "urgent";
  assigneeAgentId: string | null;
  goalId: string | null;
  projectId: string | null;
  result: Record<string, unknown> | null;
  labels: string[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  dueAt: string | null;
}

export interface Run {
  id: string;
  agentId: string;
  taskId: string | null;
  projectId: string | null;
  conversationId: string | null;
  trigger: Record<string, unknown>;
  status: RunStatus;
  intent: string;
  plan: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  error: string | null;
  workflowId: string | null;
  costUsd: string;
  inputTokens: number;
  outputTokens: number;
  iterations: number;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}
export interface RunStep {
  id: string;
  stepIndex: number;
  kind: string;
  title: string;
  status: string;
  input: unknown;
  output: unknown;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
}
export interface ToolCall {
  id: string;
  toolName: string;
  input: unknown;
  output: unknown;
  status: string;
  risk: RiskLevel;
  approvalId: string | null;
  durationMs: number | null;
  createdAt: string;
}
export interface Artifact {
  id: string;
  runId: string | null;
  taskId: string | null;
  projectId: string | null;
  kind: string;
  title: string;
  url: string | null;
  content: string | null;
  mimeType: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}
export interface Approval {
  id: string;
  runId: string | null;
  taskId: string | null;
  agentId: string | null;
  action: string;
  reason: string;
  payload: Record<string, unknown>;
  risk: RiskLevel;
  dimension: string;
  estimatedCostUsd: string | null;
  affectedSystem: string;
  alternatives: string[];
  status: "pending" | "approved" | "denied" | "expired" | "cancelled";
  resolvedBy: string | null;
  resolution: Record<string, unknown> | null;
  resolvedAt: string | null;
  expiresAt: string;
  createdAt: string;
}
export interface RunDetail {
  run: Run;
  steps: RunStep[];
  toolCalls: ToolCall[];
  artifacts: Artifact[];
  approvals: Approval[];
  workflow: unknown;
}

export interface Conversation {
  id: string;
  title: string;
  projectId: string | null;
  agentId: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface Message {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  parts: unknown[];
  runId: string | null;
  status: string;
  createdAt: string;
}

export interface StewardEvent {
  seq: number;
  id: string;
  companyId: string | null;
  type: string;
  actor: Record<string, unknown>;
  payload: Record<string, unknown>;
  correlation: Record<string, string>;
  createdAt: string;
}

export interface Document {
  id: string;
  title: string;
  content?: string;
  format: string;
  folder: string;
  kind: "document" | "playbook";
  projectId: string | null;
  agentKinds: string[];
  version: number;
  updatedAt: string;
}
export interface DocumentVersion {
  id: string;
  documentId: string;
  version: number;
  title: string;
  content: string;
  format: string;
  folder: string;
  kind: "document" | "playbook";
  projectId: string | null;
  agentKinds: string[];
  createdBy: Record<string, unknown>;
  createdAt: string;
}
export interface Decision {
  id: string;
  title: string;
  rationale: string;
  decidedBy: Record<string, unknown>;
  runId: string | null;
  projectId: string | null;
  status: string;
  createdAt: string;
}
export interface Memory {
  id: string;
  kind: string;
  scope: string;
  title: string;
  content: string;
  importance: number;
  tags: string[];
  createdAt: string;
}

export interface ProviderType {
  type: string;
  displayName: string;
  protocol: string;
  authMethod: string;
  defaultBaseUrl?: string;
  local: boolean;
  docsUrl?: string;
  subscriptionNote?: string;
}
export interface CompanionDevice {
  id: string;
  organizationId: string;
  userId: string | null;
  name: string;
  status: "pairing" | "paired" | "revoked";
  capabilities: string[];
  pairingExpiresAt: string | null;
  lastSeenAt: string | null;
  createdAt: string;
  online: boolean;
}

export interface ProviderCredential {
  id: string;
  companyId: string | null;
  providerType: string;
  label: string;
  authMethod: string;
  baseUrl: string | null;
  secretLast4: string | null;
  status: string;
  lastVerifiedAt: string | null;
  lastError: string | null;
  enabled: boolean;
  priority: number;
}
export interface ProviderModel {
  credentialId: string;
  provider: string;
  model: ModelInfo;
  healthy: boolean;
}
export interface IntegrationCatalogEntry {
  id: string;
  name: string;
  category: string;
  authKind: string;
  oauth: boolean;
  oauthConfigured?: boolean;
  fields: Array<{ key: string; label: string; secret: boolean; placeholder?: string; help?: string }>;
  docsUrl: string;
  actions: Array<{ id: string; name?: string; description?: string; risk?: RiskLevel }>;
  status: "implemented" | "framework" | "planned";
}
export interface Integration {
  id: string;
  companyId: string | null;
  type: string;
  label: string;
  status: string;
  authKind: string;
  externalAccountId: string | null;
  scopes: string[];
  lastError: string | null;
  lastCheckedAt: string | null;
  createdAt: string;
  webhookUrl: string | null;
  definition: IntegrationCatalogEntry;
}
export interface UsageRow {
  provider: string;
  model: string;
  calls: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  errors: number;
}

export interface BusinessPulse {
  windowDays: number;
  payments: { connected: boolean; available: boolean; provider: "stripe" | null };
  balance: {
    available: Array<{ amount: number; currency: string }>;
    pending: Array<{ amount: number; currency: string }>;
  } | null;
  revenue: {
    chargesCount: number;
    grossByCurrencyMinor: Record<string, number>;
    activeSubscriptions: number;
    newCustomers: number;
  } | null;
}

export type LeadStage = "new" | "qualified" | "contacted" | "interested" | "won" | "lost";
export interface Lead {
  id: string;
  contactId: string | null;
  title: string;
  stage: LeadStage;
  valueUsd: string | null;
  notes: string;
  externalRef: Record<string, string>;
  contactName: string | null;
  contactEmail: string | null;
  contactCompany: string | null;
  source: string | null;
  optedOutAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export type CampaignChannel = "email" | "social" | "ads";
export type CampaignStatus = "draft" | "active" | "paused" | "completed" | "cancelled";
export interface Campaign {
  id: string;
  organizationId: string;
  companyId: string;
  projectId: string | null;
  name: string;
  channel: CampaignChannel;
  status: CampaignStatus;
  config: { objective?: string; audience?: string; budgetUsd?: number | null; [key: string]: unknown };
  stats: Record<string, number>;
  delivery: Record<string, number>;
  createdAt: string;
  updatedAt: string;
}
export interface OutboundActivity {
  id: string;
  channel: string;
  provider: string;
  recipient: string;
  subject: string | null;
  status: string;
  externalId: string | null;
  campaignId: string | null;
  runId: string | null;
  error: string | null;
  createdAt: string;
}
export interface GrowthSnapshot {
  leads: Lead[];
  outbound: OutboundActivity[];
  campaigns: Campaign[];
}
