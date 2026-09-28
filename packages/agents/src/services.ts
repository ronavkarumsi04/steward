import type { AIGateway } from "@steward/ai";
import type { AgentService, ApprovalService, BrowserService, BudgetService, CodeService, CompanyService, ConversationService, DocumentService, GraphService, IntegrationService, GrowthService, McpService, ProviderCredentialService, ProjectService, ReactionService, RunService, SiteService, TaskService, EventService, WorkflowService } from "@steward/core";
import type { Db } from "@steward/db";
import type { MemoryService } from "@steward/memory";
import type { SandboxProvider } from "@steward/sandbox";
import type { SearchProvider } from "@steward/tools";
import type { TenantScope } from "@steward/schema";

export interface RunWorkflowLauncher {
  start(input: { runId: string; scope: { organizationId: string; companyId: string } }): Promise<{ workflowId: string; workflowRunId: string }>;
}

/** Everything a running agent may touch. Constructed per run by the worker with the run's tenant scope. */
export interface AgentServices {
  db: Db;
  scope: TenantScope;
  gateway: AIGateway;
  memory: MemoryService;
  companies: CompanyService;
  projects: ProjectService;
  tasks: TaskService;
  agents: AgentService;
  runs: RunService;
  approvals: ApprovalService;
  budgets: BudgetService;
  documents: DocumentService;
  conversations: ConversationService;
  integrations: IntegrationService;
  growth: GrowthService;
  providers: ProviderCredentialService;
  events: EventService;
  /** The rules that decide which recorded events wake an agent, and the ledger of what they did. */
  reactions: ReactionService;
  /**
   * The drawings that publish those rules and the schedules beside them. Distinct from the workflow *engine*
   * (`deps.workflows` in the API), which is what starts a run once a rule has one: this service composes the
   * rows, the engine runs them.
   */
  workflows: WorkflowService;
  /**
   * What the company knows, as one thing. A run reads it before it acts — the neighbourhood of a name is the
   * difference between an agent that has heard of a customer and one that has read what this company recorded
   * about them — and writes to it when it learns something no column holds.
   */
  graph: GraphService;
  /** The company's website, so an agent can be handed a page without owning the only copy of it. */
  sites: SiteService;
  /** The company's code: an agent can be given a session to commit, and a founder can read what it changed. */
  code: CodeService;
  /** A real browser an agent can drive: opened pages are rows, steps are frames, and the founder can stop them. */
  browser: BrowserService;
  /**
   * The MCP servers this company installed and what each one turned out to offer. The runtime builds its MCP
   * tools from these rows, and an agent reaches one only through its own allowlist — `mcp.<slug>.<tool>`, or the
   * whole server as `mcp.<slug>.*`.
   */
  mcp: McpService;
  /** Starts an already-persisted run as a durable workflow. Present in worker runtimes. */
  runWorkflowLauncher?: RunWorkflowLauncher;
  sandbox?: SandboxProvider;
  search?: SearchProvider;
  /** Operator-configured platform sender for transactional mail sent on behalf of a company. */
  emailFrom?: string;
  appUrl: string;
  /** Deployment master key, used to sign unsubscribe links so they cannot be forged. */
  masterKey: string;
}
