import type { AIGateway } from "@steward/ai";
import type { AgentService, ApprovalService, BudgetService, CompanyService, ConversationService, DocumentService, IntegrationService, GrowthService, ProviderCredentialService, ProjectService, ReactionService, RunService, SiteService, TaskService, EventService } from "@steward/core";
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
  /** The company's website, so an agent can be handed a page without owning the only copy of it. */
  sites: SiteService;
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
