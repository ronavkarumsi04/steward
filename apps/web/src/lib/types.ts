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
export interface PendingAgreement {
  document: "terms" | "privacy" | "acceptable-use";
  title: string;
  acceptedVersion: string | null;
  requiredVersion: string;
}

export interface Me {
  user: User | null;
  memberships: Membership[];
  /** Present when the session must accept a new version of a required document before continuing. */
  pendingAgreements?: PendingAgreement[];
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
export interface BudgetLedgerEntry {
  id: string;
  category: Budget["category"];
  amountUsd: string;
  kind: "reserve" | "settle" | "release" | "charge";
  refType: string | null;
  refId: string | null;
  periodKey: string;
  createdAt: string;
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

export type ReactionSource = "signal" | "event";
export type ReactionFireStatus = "started" | "queued" | "skipped" | "failed";

/** The newest record a rule matches, turned into the exact text its run would receive. */
export interface ReactionPreview {
  candidate: { id: string; kind: string; title: string; severity: string; occurredAt: string | null; projectId: string | null };
  instruction: string;
}

export interface ReactionRule {
  id: string;
  enabled: boolean;
  name: string;
  source: ReactionSource;
  kinds: string[];
  severities: string[];
  projectId: string | null;
  agentId: string;
  instruction: string;
  maxRunsPerHour: number;
  cooldownMinutes: number;
  /** The rule this company's Signals toggle owns, when it is a built-in. */
  builtin: string | null;
  lastFiredAt: string | null;
  fireCount: number;
  /** How many records of this rule's kinds the company has seen in the last seven days. */
  matches7d: number;
  preview: ReactionPreview | null;
}

export interface ReactionFire {
  id: string;
  /** Null once the rule it belonged to was deleted: the ledger outlives the rule. */
  ruleId: string | null;
  agentId: string | null;
  runId: string | null;
  status: ReactionFireStatus;
  reason: string | null;
  source: ReactionSource;
  sourceId: string;
  sourceKind: string;
  severity: string | null;
  projectId: string | null;
  detail: Record<string, unknown>;
  createdAt: string;
}

export interface ReactionCatalog {
  signalKinds: string[];
  eventTypes: string[];
  refusals: Record<string, string>;
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
export interface AICall {
  id: string;
  runId: string | null;
  stepId: string | null;
  provider: string;
  model: string;
  purpose: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  latencyMs: number;
  costUsd: string;
  costEstimated: boolean;
  status: "ok" | "error";
  errorCode: string | null;
  retries: number;
  routingReason: string;
  createdAt: string;
}
export interface ToolCall {
  id: string;
  stepId: string | null;
  toolName: string;
  input: unknown;
  output: unknown;
  status: string;
  risk: RiskLevel;
  policyDecision: Record<string, unknown> | null;
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
  /** Which workflow will be woken by a decision. Null means nothing can be resumed. Optional because a
   * surface that fetched the row before this field existed must not be read as "no workflow". */
  workflowId?: string | null;
  /** Present on the response to a decision, never on a stored row: whether the waiting workflow took it.
   * `false` means the decision is recorded but nothing was resumed, which the surface must say plainly. */
  signalDelivered?: boolean | null;
}
export interface RunDetail {
  run: Run;
  steps: RunStep[];
  aiCalls: AICall[];
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

/**
 * The site studio's shapes, mirroring the API. The catalog is the server's own list of block kinds and fields —
 * the editor is built from it rather than from a second copy of the model — so these types describe the shapes
 * and never restate what the catalog already says.
 */
export type SiteFieldKind = "text" | "paragraph" | "link" | "image" | "email";

export interface SiteField {
  path: string;
  label: string;
  kind: SiteFieldKind;
  max: number;
  required?: boolean;
  placeholder?: string;
  hint?: string;
}

export interface SiteRepeat {
  path: string;
  label: string;
  hint: string;
  min: number;
  max: number;
  item: { kind: "text"; label: string; max: number; required?: boolean } | { kind: "record"; label: string; fields: SiteField[] };
}

export interface SiteBlockSpec {
  kind: string;
  label: string;
  hint: string;
  fields: SiteField[];
  repeats: SiteRepeat[];
  preset: Record<string, unknown>;
}

export interface SiteTheme {
  accent: string;
  font: string;
  radius: string;
  dark: boolean;
}

export interface SiteBlock {
  kind: string;
  [key: string]: unknown;
}

export interface SitePage {
  slug: string;
  title: string;
  description: string;
  blocks: SiteBlock[];
}

export interface SiteModelShape {
  name: string;
  theme: SiteTheme;
  pages: SitePage[];
}

export interface SiteSummary {
  id: string;
  name: string;
  theme: SiteTheme;
  revision: string;
}

export interface SiteVersionSummary {
  id: string;
  number: number;
  digest: string;
  bytes: number;
  pageCount: number;
  fileCount: number;
  artifactId: string | null;
  createdAt: string;
}

export interface SiteStudioRead {
  site: SiteSummary | null;
  model: SiteModelShape | null;
  starter: SiteModelShape | null;
  problems: string[];
  catalog: SiteBlockSpec[];
  versions: SiteVersionSummary[];
  agents: Array<{ id: string; kind: string; name: string }>;
  canEdit: boolean;
}

export interface SitePreview {
  source: "draft" | "version";
  slug: string;
  html: string;
  digest: string | null;
  files: Array<{ path: string; bytes: number }> | null;
  problems: string[];
}

export interface SiteShipResult {
  status: "started" | "queued" | "failed";
  reason: string | null;
  instruction: string;
  run: { id: string; status: string } | null;
}

/* ------------------------------------------------------------------------------------------------ code IDE */

export interface DiffHunk {
  beforeStart: number;
  beforeCount: number;
  afterStart: number;
  afterCount: number;
  /** ` ` unchanged, `-` removed, `+` added. Each line keeps its own terminator, so CRLF diffs as CRLF. */
  lines: string[];
}

export interface FileDiff {
  path: string;
  added: number;
  removed: number;
  hunks: DiffHunk[];
}

export type CodeChangeKind = "added" | "modified" | "deleted";

export interface CodeChangeView {
  path: string;
  original: string | null;
  contents: string | null;
  originalSha: string | null;
  diff: FileDiff;
  summary: string;
  kind: CodeChangeKind;
}

export type CodeSessionState = "draft" | "running" | "applied" | "failed" | "discarded";

export interface CodeSessionView {
  id: string;
  repo: string;
  baseRef: string;
  branch: string;
  title: string;
  state: CodeSessionState;
  applyRunId: string | null;
  runError: string | null;
  createdAt: string;
  updatedAt: string;
  changeCount: number;
  pullUrl: string | null;
}

export interface CodeWorkspaceRead {
  connected: boolean;
  integration: { id: string; label: string } | null;
  defaultRepo: string | null;
  sessions: CodeSessionView[];
  /** The enabled agents a session can be handed to. An apply is a run, so it needs a real agent. */
  agents: Array<{ id: string; kind: string; name: string }>;
  canEdit: boolean;
  sandbox: { provider: string; runsCommands: boolean };
}

export interface CodeRepoOption {
  fullName: string;
  private: boolean;
  defaultBranch: string;
  url: string;
  description: string | null;
  pushedAt: string | null;
}

export interface CodeTreeEntry {
  path: string;
  size: number | null;
}

export interface CodeTreeRead {
  repo: string;
  ref: string;
  defaultBranch: string;
  url: string;
  sha: string;
  truncated: boolean;
  entries: CodeTreeEntry[];
}

export interface CodeFileRead {
  path: string;
  ref: string;
  contents: string;
  sha: string;
  bytes: number;
}

export interface CodeBranchesRead {
  defaultBranch: string;
  branches: Array<{ name: string; protected: boolean }>;
}

export interface CodeSessionRead {
  session: CodeSessionView | null;
  changes: CodeChangeView[];
  patch: string;
  digest: string;
  pullRequests: Array<{ title: string; url: string | null; number: number | null }>;
}

// ---------- Browser sessions ----------

/**
 * Where a session is: live while a page is open, `stopped` when the founder ended it, `closed` when the agent or
 * the sweep did, `failed` when the browser or the page went away.
 */
export type BrowserStatus = "live" | "stopped" | "closed" | "failed";

export interface BrowserSessionView {
  id: string;
  runId: string | null;
  agentId: string | null;
  status: BrowserStatus;
  /** Which browser this deployment used: `playwright`, or `none` on a stack that has none. */
  provider: string;
  url: string;
  startUrl: string;
  title: string;
  width: number;
  height: number;
  stepCount: number;
  frameCount: number;
  lastFrameId: string | null;
  lastAction: string | null;
  lastActionAt: string | null;
  lastNote: string | null;
  stopReason: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  stoppedAt: string | null;
}

/**
 * One screenshot with the sentence that caused it. Frames are the step log: one image per action, in order, so the
 * list a founder scrolls is the same list the model read from.
 */
export interface BrowserFrameView {
  id: string;
  seq: number;
  action: string;
  url: string;
  title: string;
  mimeType: string;
  width: number;
  height: number;
  bytes: number;
  digest: string;
  createdAt: string;
}

export interface BrowserWorkspaceRead {
  provider: string;
  available: boolean;
  /** Why there is no browser, when there is none: the same sentence a refused run carries. */
  reason: string | null;
  sessions: BrowserSessionView[];
  agents: Array<{ id: string; kind: string; name: string }>;
  canControl: boolean;
  frameWindowDays: number;
}

export interface BrowserSessionRead {
  session: BrowserSessionView;
  frames: BrowserFrameView[];
}

export interface BrowserRunResult {
  status: "started" | "queued" | "failed";
  reason: string | null;
  instruction: string;
  run: { id: string; status: string; agentId: string } | null;
}

// ---------- Workflows: the drawings a company's standing work is composed of ----------

/**
 * The vocabulary the API will accept, sent by the server rather than retyped here. A kind this build does not
 * know is refused server-side, so the client never has to be right about what exists — it has to render what it
 * was handed.
 */
export interface WorkflowCatalog {
  nodeKinds: string[];
  triggerSources: WorkflowTriggerSource[];
  signalKinds: string[];
  eventTypes: string[];
  severities: string[];
  limits: { nodes: number; triggers: number; kindsPerTrigger: number; nameChars: number; instructionChars: number; maxRunsPerHour: number; cooldownMinutes: number };
}

export type WorkflowTriggerSource = "signal" | "event" | "schedule";

export interface WorkflowTriggerNode {
  id: string;
  kind: "trigger";
  source: WorkflowTriggerSource;
  /** Signal kinds or recorded event types. Always empty for a schedule. */
  kinds: string[];
  cron: string | null;
  timezone: string | null;
}

export interface WorkflowFilterNode {
  id: string;
  kind: "filter";
  severities: string[];
  projectId: string | null;
}

export interface WorkflowAgentNode {
  id: string;
  kind: "agent";
  agentId: string;
  instruction: string;
}

export interface WorkflowLimitNode {
  id: string;
  kind: "limit";
  maxRunsPerHour: number;
  cooldownMinutes: number;
}

export type WorkflowNode = WorkflowTriggerNode | WorkflowFilterNode | WorkflowAgentNode | WorkflowLimitNode;

/** A problem the server found in a drawing, and the node it belongs to. */
export interface WorkflowProblem {
  code: string;
  where: string;
  message: string;
}

/** The row a trigger compiles to — what would run, in the engine's own field names. */
export interface WorkflowTarget {
  triggerId: string;
  kind: "rule" | "schedule";
  name: string;
  enabled: boolean;
  agentId: string;
  instruction: string;
  source?: "signal" | "event";
  matchKinds?: string[];
  matchSeverities?: string[];
  projectId?: string | null;
  maxRunsPerHour?: number;
  cooldownMinutes?: number;
  cron?: string;
  timezone?: string;
}

/** The row that is actually running behind a trigger, as it stands right now. */
export interface WorkflowLiveRow {
  id: string;
  name: string;
  enabled: boolean;
  instruction: string;
  agentId: string;
  source?: string;
  matchKinds?: string[];
  matchSeverities?: string[];
  projectId?: string | null;
  maxRunsPerHour?: number;
  cooldownMinutes?: number;
  cron?: string;
  timezone?: string;
}

export interface WorkflowReading {
  triggerId: string;
  kind: "rule" | "schedule";
  targetId: string | null;
  /** True when this trigger was published and the row behind it is gone. */
  missing: boolean;
  /** What changed in the live row without the drawing knowing, in a founder's words. */
  drift: string[];
  live: WorkflowLiveRow | null;
  target: WorkflowTarget;
}

export interface WorkflowView {
  id: string;
  name: string;
  enabled: boolean;
  nodes: WorkflowNode[];
  revision: number;
  publishedAt: string | null;
  updatedAt: string;
  /** True when everything this drawing would run is exactly what is running. */
  draftIsLive: boolean;
  liveCount: number;
  /** Everything to settle before this could run, unfinished items included. */
  problems: WorkflowProblem[];
  /** The subset that is wrong rather than undecided: a drawing cannot be stored with these either. */
  broken: WorkflowProblem[];
  sentences: string[];
  staleTargets: Array<{ triggerId: string; kind: string; targetId: string; name: string }>;
  readings: WorkflowReading[];
}

export interface WorkflowPreview {
  problems: WorkflowProblem[];
  broken: WorkflowProblem[];
  sentences: string[];
  targets: WorkflowTarget[];
}

/**
 * An MCP server a company installed, and what it may do.
 *
 * Two fields that exist precisely to stop the surface implying more than it knows: `inspectedAt` (has anybody
 * actually asked this server what it offers?) and `riskSource` (did that band come from the company, the server's
 * own claim about itself, the tool's name, or from nothing at all?).
 */
export interface McpToolView {
  id: string;
  /** The name the server answers to, which is what a call sends. */
  name: string;
  /** The name Steward knows it by — `mcp.<slug>.<name>` — which is what a grant is written in terms of. */
  toolName: string;
  description: string;
  risk: RiskLevel;
  riskSource: string;
  riskReason: string;
  sideEffects: string;
  idempotent: boolean;
  dimension: string | null;
  enabled: boolean;
  grantedTo: Array<{ agentId: string; agentName: string; pattern: string }>;
}

export interface McpServerView {
  id: string;
  name: string;
  slug: string;
  purpose: string;
  transport: string;
  /** Where it points: the command line, or the address. */
  target: string;
  description: string;
  enabled: boolean;
  inspectedAt: string | null;
  /** Why the last inspection failed, or the reason it needs another one. */
  error: string | null;
  tools: McpToolView[];
  /** Where it points, sent as it is: the command line, or the address. Not secret, and the edit form starts here. */
  command: string | null;
  args: string[];
  url: string | null;
  /** The variables and headers this install carries, by name only — a credential's value is never sent back. */
  envKeys: string[];
  headerKeys: string[];
}

export interface McpMarketplaceRead {
  servers: McpServerView[];
  agents: Array<{ id: string; name: string; kind: string; enabled: boolean }>;
  catalog: {
    transports: string[];
    /** The bounds the API enforces, sent so the surface can say them before a founder hits one. */
    limits: { serversPerCompany: number; toolsPerServer: number; nameChars: number; purposeChars: number };
    /** Whether this deployment runs programs for stdio installs, and whether it dials its own network. */
    stdio: boolean;
    privateTargets: boolean;
  };
  canManage: boolean;
}

/** The outcome of one inspection, which is a fact about the server rather than a success or a failure of a request. */
export interface McpInspectionResult {
  ok: boolean;
  error: string | null;
  added: string[];
  removed: string[];
  changed: Array<{ toolName: string; fields: string[] }>;
  omitted: number;
  total: number;
  server: McpServerView;
  notices: string[];
}

/**
 * The install form, in the shape a text box gives it: one argument per line, `KEY=value` for variables, and
 * `Header: value` for headers. Both halves exist whatever the transport is, because switching transport while
 * writing should not lose what was typed.
 */
export interface McpInstallForm {
  name: string;
  slug: string;
  purpose: string;
  transport: string;
  command: string;
  args: string;
  env: string;
  url: string;
  headers: string;
}

export interface WorkflowWorkspaceRead {
  workflows: WorkflowView[];
  agents: Array<{ id: string; name: string; enabled: boolean }>;
  projects: Array<{ id: string; name: string }>;
  catalog: WorkflowCatalog;
  /** Whether a schedule drawn here would actually tick: a deployment without an engine registers nothing. */
  engine: boolean;
  canManage: boolean;
}

export interface CodeApplyResult {
  status: "started" | "queued" | "failed";
  reason: string | null;
  instruction: string;
  digest: string;
  run: { id: string; status: string } | null;
}
