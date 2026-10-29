import "dotenv/config";
import { createRequire } from "node:module";
import type { Server } from "node:http";
import { NativeConnection, Runtime, Worker, DefaultLogger, type LogLevel } from "@temporalio/worker";
import { AgentServiceFactory } from "@steward/agents";
import { browserProviderFromEnv } from "@steward/browser";
import { createCoreContext, internalServiceToken, loadConfig, type ApprovalSignal } from "@steward/core";
import { closeDb, runMigrations } from "@steward/db";
import { LocalDockerSandboxProvider, type SandboxProvider } from "@steward/sandbox";
import { WorkflowClient, connectTemporal, temporalConfigFromEnv, temporalTlsMaterial } from "@steward/workflows";
import { createActivities } from "./activities.js";
import { HttpCompanionBridge } from "./companion-bridge.js";
import { startReactionsJob } from "./reactions-job.js";
import { startReconcileJob } from "./reconcile-job.js";
import { startRetentionJob } from "./retention-job.js";
import { startBrowserJob } from "./browser-job.js";
import { workerConfigFromEnv, WorkerConfigError } from "./config.js";
import { closeWorkerHealth, createWorkerHealthServer, listenWorkerHealth } from "./health.js";
import { WorkerResources } from "./lifecycle.js";

const require = createRequire(import.meta.url);

function sandboxFromEnv(env: NodeJS.ProcessEnv, provider: string): SandboxProvider | undefined {
  if (provider !== "docker") return undefined;
  const host = env.SANDBOX_DOCKER_HOST;
  if (host) {
    const u = new URL(host.includes("://") ? host : `tcp://${host}`);
    return new LocalDockerSandboxProvider({ host: u.hostname, port: Number(u.port || 2375) });
  }
  return new LocalDockerSandboxProvider();
}

async function main() {
  const settings = workerConfigFromEnv();
  const config = loadConfig();
  const temporal = temporalConfigFromEnv();
  const core = createCoreContext(config, "worker");
  const log = core.log;
  const resources = new WorkerResources();
  resources.add("database", () => core.pool.end());
  let worker: Worker | undefined;
  let workflows: WorkflowClient | undefined;
  let draining = false;
  let failed = false;
  let failure: unknown;
  let health: Server | undefined;
  let phase = "health_listener";
  try {
    health = createWorkerHealthServer({
      commit: process.env.GIT_COMMIT_SHA,
      state: () => draining ? "DRAINING" : worker?.getState() ?? "STARTING",
      database: () => {
        const query = { text: "select 1", query_timeout: 3000 };
        return core.pool.query(query);
      },
      temporal: () => workflows ? workflows.readiness() : Promise.resolve({ connected: false }),
    });
    await listenWorkerHealth(health, settings.healthPort, settings.healthHost);
    phase = "migrations";
    if (settings.migrate) {
      resources.add("migration_database", () => closeDb());
      await runMigrations();
      log.info("migrations applied");
    }

    Runtime.install({ logger: new DefaultLogger(settings.temporalLogLevel as LogLevel) });

    phase = "temporal_client";
    const client = await connectTemporal(temporal);
    resources.add("temporal_client", () => client.connection.close());
    const workflowClient = new WorkflowClient(client, temporal.taskQueue);
    workflows = workflowClient;
    phase = "housekeeping_schedule";
    await client.connection.withDeadline(Date.now() + 10_000, () => workflowClient.ensureHousekeeping());

    const approvalSignal: ApprovalSignal = {
      notify: async (workflowId, approvalId, decision) => {
        const delivered = await client.connection.withDeadline(Date.now() + 10_000, () => workflowClient.signalApproval(workflowId, { approvalId, ...decision }));
        if (!delivered) throw new Error("Approval workflow is no longer available");
      },
    };
    const sandbox = sandboxFromEnv(process.env, settings.sandboxProvider);

    // The browser this worker may drive. `auto` means "whatever this machine actually has": a container without
    // Chromium reports `none` and says why, and a stack that installed it needs no second env var to be allowed to
    // use it. Resolved once at boot because the provider is a process-local cache of open pages.
    phase = "browser";
    const { provider: browser, mode: browserMode } = await browserProviderFromEnv(process.env);
    resources.add("browser", () => browser.dispose());
    const browserState = await browser.availability();
    if (!browserState.available) log.warn({ provider: browser.name, mode: browserMode, reason: browserState.reason }, "this worker cannot open a browser; browsing agents will say so instead of clicking");

    const companionBridge = new HttpCompanionBridge(config.apiInternalUrl, internalServiceToken(config));
    const factory = new AgentServiceFactory({
      core,
      sandbox,
      browser,
      approvalSignal,
      companionBridge,
      runWorkflowLauncher: { start: (input) => workflowClient.startRun(input) },
    });
    const activities = createActivities({ core, factory, sandbox, approvalSignal });

    phase = "temporal_worker";
    const connection = await NativeConnection.connect({ address: temporal.address, tls: await temporalTlsMaterial(temporal), apiKey: temporal.apiKey });
    resources.add("temporal_worker_connection", () => connection.close());
    worker = await Worker.create({
      connection,
      namespace: temporal.namespace,
      taskQueue: temporal.taskQueue,
      workflowsPath: require.resolve("@steward/workflows/workflows"),
      activities,
      maxConcurrentActivityTaskExecutions: settings.maxActivities,
      maxConcurrentWorkflowTaskExecutions: settings.maxWorkflows,
      defaultHeartbeatThrottleInterval: "5 seconds",
      maxHeartbeatThrottleInterval: "5 seconds",
      shutdownGraceTime: settings.shutdownGraceMs,
      identity: `steward-worker@${process.env.HOSTNAME ?? "local"}:${process.pid}`,
    });
    const running = worker.run();
    // Observe immediately; both the main await and cleanup still propagate a rejected run.
    void running.catch(() => {});
    const activeWorker = worker;
    resources.add("temporal_worker", async () => {
      if (activeWorker.getState() === "RUNNING") activeWorker.shutdown();
      await running;
    });

    const shutdown = (sig: string) => {
      if (draining) return;
      draining = true;
      log.info({ sig }, "worker shutting down");
      if (worker?.getState() === "RUNNING") worker.shutdown();
    };
    const interrupt = () => shutdown("SIGINT");
    const terminate = () => shutdown("SIGTERM");
    process.on("SIGINT", interrupt);
    process.on("SIGTERM", terminate);
    resources.add("signal_handlers", () => {
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", terminate);
    });

    // Enforces the published retention windows (expired sessions and tokens, old activity events and
    // webhook logs) without needing an external scheduler.
    resources.add("retention_timer", startRetentionJob(core.db, log));

    // Repairs the states a distributed failure can leave behind: launches that never started, runs that stopped
    // moving, approvals whose run already finished, and tasks waiting on an approval that no longer exists.
    resources.add("reconcile_timer", startReconcileJob(core.db, log, { start: (input) => workflowClient.startRun(input) }, approvalSignal));

    // Answers the rules a founder wrote over recorded events (a finished task, an inbound webhook, a failed
    // payment), so work can start from what happened rather than only from the clock.
    resources.add("reaction_timer", startReactionsJob(core.db, log, { start: (input) => workflowClient.startRun(input) }));

    // Closes browser sessions nobody is driving and drops frames past the window, so a session that outlived its run
    // stops claiming to be live and the images of past moments do not accumulate forever.
    resources.add("browser_timer", startBrowserJob(core.db, log, browser));

    phase = "running";
    log.info({ taskQueue: temporal.taskQueue, namespace: temporal.namespace, sandbox: !!sandbox, browser: browser.name, browserMode, healthPort: settings.healthPort }, "steward worker ready");
    await running;
  } catch (error) {
    failed = true;
    // Dependency errors can contain connection strings, API keys or provider bodies. Report the failing seam.
    log.error({ phase, errorType: error instanceof Error ? error.name : "UnknownError" }, "worker failed; deployment must restart it");
    failure = error;
  } finally {
    draining = true;
    // Finish in-flight probes before closing the connections those probes use.
    if (health) {
      try { await closeWorkerHealth(health); }
      catch { log.error({ resource: "health_listener" }, "worker cleanup failed"); if (!failed) { failed = true; failure = new Error("Worker health shutdown failed"); } }
    }
    try { await resources.close((resource) => log.error({ resource }, "worker cleanup failed")); }
    catch (error) { if (!failed) { failed = true; failure = error; } }
  }
  if (failed) throw failure;
}

main().catch((e) => {
  console.error(JSON.stringify({ error: "worker_start_or_run_failed", ...(e instanceof WorkerConfigError ? { message: e.message } : {}) }));
  process.exitCode = 1;
});
