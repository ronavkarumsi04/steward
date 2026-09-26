import { AgentServiceFactory } from "@steward/agents";
import type { CompanionBridge } from "@steward/ai";
import { AuthService, EventBus, createCoreContext, createMailer, loadConfig, type ApprovalSignal, type CoreContext } from "@steward/core";
import { runMigrations } from "@steward/db";
// Type-only: the Temporal client is loaded lazily below so a deployment with TEMPORAL_DISABLED=true
// never pulls the workflow engine into its bundle or its cold start.
import type { WorkflowClient } from "@steward/workflows";
import { createApp } from "./app.js";
import { CompanionHub } from "./companion-hub.js";

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

async function connectTemporalWithTimeout(env: NodeJS.ProcessEnv, timeoutMs: number): Promise<WorkflowClient | null> {
  const { WorkflowClient, connectTemporal, temporalConfigFromEnv } = await import("@steward/workflows");
  const temporal = temporalConfigFromEnv(env);
  const client = await Promise.race([
    connectTemporal(temporal),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs).unref()),
  ]);
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
  const core = createCoreContext(config, "api");
  const log = core.log;

  if (options.migrate) {
    await runMigrations();
    log.info("migrations applied");
  }

  let workflows: WorkflowClient | null = null;
  if ((env.TEMPORAL_DISABLED ?? "").trim() !== "true") {
    try {
      const { temporalConnectTimeoutMs } = await import("@steward/workflows");
      workflows = await connectTemporalWithTimeout(env, temporalConnectTimeoutMs(env));
      log.info({ address: env.TEMPORAL_ADDRESS, namespace: env.TEMPORAL_NAMESPACE }, "temporal connected");
    } catch (e) {
      log.error({ err: e instanceof Error ? e.message : String(e) }, "temporal unavailable; runs cannot be started until it is reachable");
    }
  } else {
    log.warn("TEMPORAL_DISABLED=true: run-creating endpoints will answer 503");
  }

  const approvalSignal: ApprovalSignal | undefined = workflows
    ? { notify: async (workflowId, approvalId, decision) => void (await workflows!.signalApproval(workflowId, { approvalId, ...decision })) }
    : undefined;

  const bus = new EventBus(core.pool, log);
  if (options.listen !== false) await bus.start();

  const companionHub = new CompanionHub();
  const services = new AgentServiceFactory({ core, approvalSignal, companionBridge: companionHub });
  const mailer = createMailer(log);
  log.info({ provider: mailer.provider, allowSignup: config.allowSignup }, "platform email + signup policy");
  if (config.env === "production" && mailer.provider === "console") {
    log.warn("PLATFORM_EMAIL_PROVIDER=console in production: invitation and password-reset links are written to the log instead of being delivered");
  }

  const { app } = createApp({ core, auth: new AuthService(core.db), mailer, services, workflows, companionHub, env }, bus);

  return {
    app,
    core,
    workflows,
    companionHub,
    async close() {
      await bus.stop();
      await core.pool.end();
    },
  };
}
