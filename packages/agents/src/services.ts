import type { AIGateway } from "@steward/ai";
import type { AgentService, ApprovalService, BudgetService, CompanyService, ConversationService, DocumentService, IntegrationService, ProviderCredentialService, RunService, TaskService, EventService } from "@steward/core";
import type { Db } from "@steward/db";
import type { MemoryService } from "@steward/memory";
import type { SandboxProvider } from "@steward/sandbox";
import type { SearchProvider } from "@steward/tools";
import type { TenantScope } from "@steward/schema";

/** Everything a running agent may touch. Constructed per run by the worker with the run's tenant scope. */
export interface AgentServices {
  db: Db;
  scope: TenantScope;
  gateway: AIGateway;
  memory: MemoryService;
  companies: CompanyService;
  tasks: TaskService;
  agents: AgentService;
  runs: RunService;
  approvals: ApprovalService;
  budgets: BudgetService;
  documents: DocumentService;
  conversations: ConversationService;
  integrations: IntegrationService;
  providers: ProviderCredentialService;
  events: EventService;
  sandbox?: SandboxProvider;
  search?: SearchProvider;
  /** Operator-configured platform sender for transactional mail sent on behalf of a company. */
  emailFrom?: string;
  appUrl: string;
}
