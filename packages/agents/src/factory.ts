import type { CompanionBridge } from "@steward/ai";
import { AgentService, ApprovalService, BrowserService, BudgetService, CodeService, CompanionService, CompanyService, ConversationService, DocumentService, EventService, IntegrationService, GrowthService, McpService, ProviderCredentialService, ProjectService, ReactionService, RunService, SignalService, SiteService, TaskService, WorkflowService, oauthClientFromEnv, type ApprovalSignal, type CoreContext } from "@steward/core";
import type { BrowserProvider } from "@steward/browser";
import { MemoryService } from "@steward/memory";
import type { SandboxProvider } from "@steward/sandbox";
import type { TenantScope } from "@steward/schema";
import { searchProviderFromEnv } from "@steward/tools";
import type { AgentServices, RunWorkflowLauncher } from "./services.js";

export interface AgentServiceFactoryOptions {
  core: CoreContext;
  sandbox?: SandboxProvider;
  /**
   * The browser this process may drive, resolved from the environment at boot by whoever owns the process.
   *
   * It is a *process-local* handle cache, so it is passed in rather than built here: the worker that runs agents
   * holds the Chromium, the API process only needs to be able to answer "does this deployment have a browser?"
   * and to stop a session by writing its row.
   */
  browser?: BrowserProvider;
  approvalSignal?: ApprovalSignal;
  companionBridge?: CompanionBridge;
  runWorkflowLauncher?: RunWorkflowLauncher;
  env?: NodeJS.ProcessEnv;
}

/** Builds the tenant-scoped service bundle a run needs. Shared services are constructed once; scope-bound ones per call. */
export class AgentServiceFactory {
  readonly companies: CompanyService;
  readonly projects: ProjectService;
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
  readonly signals: SignalService;
  readonly reactions: ReactionService;
  /** The company's own website: the draft, its versions, and the instruction that ships one. */
  readonly sites: SiteService;
  /** The company's code: the repository read through its integration, and editing sessions a run commits. */
  readonly code: CodeService;
  /** Pages an agent drives with the founder watching, and the frames that make it watchable. */
  readonly browser: BrowserService;
  /** The drawings that publish reaction rules and agent schedules, and the bindings that hold them together. */
  readonly workflows: WorkflowService;
  /**
   * The MCP servers a company installed, what they offer, and who may call what.
   *
   * The deployment's policy is resolved once here, from the environment, so "this stack will not run a program"
   * and "this stack will not connect to its own network" are decisions of the process rather than checks
   * scattered through the surface.
   */
  readonly mcp: McpService;
  readonly companion: CompanionService;
  private readonly env: NodeJS.ProcessEnv;

  constructor(private readonly o: AgentServiceFactoryOptions) {
    const { db, crypto, config } = o.core;
    this.env = o.env ?? process.env;
    this.companies = new CompanyService(db);
    this.projects = new ProjectService(db);
    this.tasks = new TaskService(db);
    this.agents = new AgentService(db);
    this.runs = new RunService(db);
    this.approvals = new ApprovalService(db, o.approvalSignal);
    this.budgets = new BudgetService(db);
    this.documents = new DocumentService(db);
    this.conversations = new ConversationService(db);
    this.integrations = new IntegrationService(db, crypto, { apiUrl: config.apiUrl, oauthClient: (p) => oauthClientFromEnv(p, this.env) });
    this.growth = new GrowthService(db);
    this.providers = new ProviderCredentialService(db, crypto, this.o.core.log);
    this.events = new EventService(db);
    this.signals = new SignalService(db);
    this.reactions = new ReactionService(db);
    this.sites = new SiteService(db);
    this.code = new CodeService(db, this.integrations);
    this.browser = new BrowserService(db, o.browser ?? null);
    this.workflows = new WorkflowService(db);
    this.mcp = new McpService(db, undefined, { stdio: (this.env.MCP_STDIO ?? "").trim().toLowerCase() !== "off", allowPrivate: (this.env.MCP_ALLOW_PRIVATE ?? "").trim().toLowerCase() === "true" });
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
      projects: this.projects,
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
      reactions: this.reactions,
      sites: this.sites,
      code: this.code,
      browser: this.browser,
      workflows: this.workflows,
      mcp: this.mcp,
      runWorkflowLauncher: this.o.runWorkflowLauncher,
      sandbox: this.o.sandbox,
      search: searchProviderFromEnv(this.env),
      emailFrom: this.env.PLATFORM_EMAIL_FROM,
      appUrl: this.o.core.config.appUrl,
      masterKey: this.o.core.config.masterKey,
    };
  }
}
