import { AgentServiceFactory } from "@steward/agents";
import type { CompanionBridge } from "@steward/ai";
import { AuthService, EventBus, createCoreContext, createLogger, createMailer, loadConfig, parseBoolean, type ApprovalSignal, type CoreContext } from "@steward/core";
import { browserProviderFromEnv, type BrowserProvider } from "@steward/browser";
import { runMigrations } from "@steward/db";
// Type-only: the Temporal client is loaded lazily below so a deployment with TEMPORAL_DISABLED=true
// never pulls the workflow engine into its bundle or its cold start.
import type { WorkflowClient } from "@steward/workflows";
import { createApp } from "./app.js";
import { CompanionHub } from "./companion-hub.js";
import { WorkflowConnection } from "./workflow-connection.js";

export interface RuntimeOptions {
  env?: NodeJS.ProcessEnv;
  /**
   * Apply pending migrations before serving. Long-running hosts only: cold-starting serverless
   * instances would race each other applying the same migration.
   */
  migrate?: boolean;
  /** Open the LISTEN connection that fans Postgres notifications out to SSE handlers. */
  listen?: boolean;
}

type App = ReturnType<typeof createApp>["app"];

export interface ApiRuntime {
  app: App;
  core: CoreContext;
  /** Null when Temporal is disabled or unreachable; run-creating endpoints answer 503 with a reason. */
  workflows: WorkflowClient | null;
  companionHub: CompanionBridge;
  close(): Promise<void>;
}

async function connectWorkflows(env: NodeJS.ProcessEnv): Promise<WorkflowClient> {
  const { WorkflowClient, connectTemporal, temporalConfigFromEnv } = await import("@steward/workflows");
  const temporal = temporalConfigFromEnv(env);
  const { temporalConnectTimeoutMs } = await import("@steward/workflows");
  // Use the SDK's bounded connect, rather than abandoning a live connection behind Promise.race.
  const client = await connectTemporal(temporal, temporalConnectTimeoutMs(env));
  return new WorkflowClient(client, temporal.taskQueue);
}

/**
 * Builds the API wiring once, so the long-running server (`main.ts`) and the serverless entry
 * (`serverless.ts`) cannot drift apart. Everything here is safe to run per-instance: the pool is
 * capped by DATABASE_POOL_MAX and the event bus degrades to a warning when LISTEN is unavailable.
 */
export async function createApiRuntime(options: RuntimeOptions = {}): Promise<ApiRuntime> {
  const env = options.env ?? process.env;
  const config = loadConfig(env);
  // Validate local configuration before creating network resources.
  const mailer = createMailer(createLogger(config, "api"), env);
  const disabled = parseBoolean(env.TEMPORAL_DISABLED, false);
  const core = createCoreContext(config, "api");
  const log = core.log;
  const connection = new WorkflowConnection<WorkflowClient>({
    disabled,
    retryMs: 30_000,
    connect: () => connectWorkflows(env),
    onConnected: () => log.info("temporal connected"),
    onUnavailable: () => log.error("temporal unavailable; connection will retry in 30 seconds"),
  });
  const bus = new EventBus(core.pool, log);
  let browserForCleanup: BrowserProvider | undefined;
  const close = async () => {
    const results = await Promise.allSettled([connection.close(), browserForCleanup?.dispose(), bus.stop()]);
    await core.pool.end();
    if (results.some((result) => result.status === "rejected")) {
      log.warn("API runtime resource cleanup failed");
      throw new Error("API runtime resource cleanup failed");
    }
  };
  try {
    if (options.migrate) {
      await runMigrations();
      log.info("migrations applied");
    }
    await connection.ensure();
    if (disabled) log.warn("TEMPORAL_DISABLED=true: run-creating endpoints will answer 503");

    // Keep the signal hook attached even when boot cannot connect; recovery must restore approvals too.
    const approvalSignal: ApprovalSignal = { notify: async (workflowId, approvalId, decision) => {
      const workflows = connection.current;
      if (!workflows) throw new Error("Workflow engine unavailable");
      const delivered = await workflows.signalApproval(workflowId, { approvalId, ...decision });
      if (!delivered) throw new Error("Approval workflow was not found");
    } };

    if (options.listen !== false) await bus.start();

    const companionHub = new CompanionHub();

    // The API never opens a page — pages live in the worker that holds them — but it does have to answer "does this
    // deployment have a browser?" honestly, and the cheapest true answer is the same probe the worker makes. The
    // provider's handles stay empty here; it exists so the sentence a founder reads is a fact about the image and not
    // a guess made from an environment variable.
    const { provider: browser, mode: browserMode } = await browserProviderFromEnv(env);
    browserForCleanup = browser;
    const browserState = await browser.availability();
    log.info({ provider: browser.name, mode: browserMode, available: browserState.available, reason: browserState.reason }, "browser availability");

    const services = new AgentServiceFactory({ core, env, approvalSignal, companionBridge: companionHub, browser });
    log.info({ provider: mailer.provider, allowSignup: config.allowSignup }, "platform email + signup policy");
    if (config.env === "production" && mailer.provider === "console") {
      log.warn("Platform email delivery is unavailable: configure PLATFORM_EMAIL_PROVIDER=resend");
    }

    const { app } = createApp({ core, auth: new AuthService(core.db), mailer, services, get workflows() { return connection.current; }, companionHub, env }, bus);

    return {
      app,
      core,
      get workflows() { return connection.current; },
      companionHub,
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
