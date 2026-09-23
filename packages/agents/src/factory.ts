import type { CompanionBridge } from "@steward/ai";
import { AgentService, ApprovalService, BudgetService, CompanionService, CompanyService, ConversationService, DocumentService, EventService, IntegrationService, GrowthService, ProviderCredentialService, RunService, TaskService, oauthClientFromEnv, type ApprovalSignal, type CoreContext } from "@steward/core";
import { MemoryService } from "@steward/memory";
import type { SandboxProvider } from "@steward/sandbox";
import type { TenantScope } from "@steward/schema";
import { searchProviderFromEnv } from "@steward/tools";
import type { AgentServices, RunWorkflowLauncher } from "./services.js";

export interface AgentServiceFactoryOptions {
  core: CoreContext;
  sandbox?: SandboxProvider;
  approvalSignal?: ApprovalSignal;
  companionBridge?: CompanionBridge;
  runWorkflowLauncher?: RunWorkflowLauncher;
  env?: NodeJS.ProcessEnv;
}

/** Builds the tenant-scoped service bundle a run needs. Shared services are constructed once; scope-bound ones per call. */
export class AgentServiceFactory {
  readonly companies: CompanyService;
  readonly tasks: TaskService;
  readonly agents: AgentService;
  readonly runs: RunService;
  readonly approvals: ApprovalService;
  readonly budgets: BudgetService;
  readonly documents: DocumentService;
  readonly conversations: ConversationService;
  readonly integrations: IntegrationService;
  readonly growth: GrowthService;
  readonly providers: ProviderCredentialService;
  readonly events: EventService;
  readonly companion: CompanionService;
  private readonly env: NodeJS.ProcessEnv;

  constructor(private readonly o: AgentServiceFactoryOptions) {
    const { db, crypto, config } = o.core;
    this.env = o.env ?? process.env;
    this.companies = new CompanyService(db);
    this.tasks = new TaskService(db);
    this.agents = new AgentService(db);
    this.runs = new RunService(db);
    this.approvals = new ApprovalService(db, o.approvalSignal);
    this.budgets = new BudgetService(db);
    this.documents = new DocumentService(db);
    this.conversations = new ConversationService(db);
    this.integrations = new IntegrationService(db, crypto, { apiUrl: config.apiUrl, oauthClient: (p) => oauthClientFromEnv(p, this.env) });
    this.growth = new GrowthService(db);
    this.providers = new ProviderCredentialService(db, crypto);
    this.events = new EventService(db);
    this.companion = new CompanionService(db);
  }

  forScope(scope: TenantScope): AgentServices {
    const gateway = this.providers.gateway(scope, { budgets: this.budgets, bridge: this.o.companionBridge });
    const memory = new MemoryService({ db: this.o.core.db, scope, gateway });
    return {
      db: this.o.core.db,
      scope,
      gateway,
      memory,
      companies: this.companies,
      tasks: this.tasks,
      agents: this.agents,
      runs: this.runs,
      approvals: this.approvals,
      budgets: this.budgets,
      documents: this.documents,
      conversations: this.conversations,
      integrations: this.integrations,
      growth: this.growth,
      providers: this.providers,
      events: this.events,
      runWorkflowLauncher: this.o.runWorkflowLauncher,
      sandbox: this.o.sandbox,
      search: searchProviderFromEnv(this.env),
      emailFrom: this.env.PLATFORM_EMAIL_FROM,
      appUrl: this.o.core.config.appUrl,
    };
  }
}
