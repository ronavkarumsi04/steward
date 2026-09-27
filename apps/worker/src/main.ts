import "dotenv/config";
import { createRequire } from "node:module";
import { NativeConnection, Runtime, Worker, DefaultLogger, type LogLevel } from "@temporalio/worker";
import { AgentServiceFactory } from "@steward/agents";
import { browserProviderFromEnv } from "@steward/browser";
import { createCoreContext, internalServiceToken, loadConfig, type ApprovalSignal } from "@steward/core";
import { runMigrations } from "@steward/db";
import { LocalDockerSandboxProvider, type SandboxProvider } from "@steward/sandbox";
import { WorkflowClient, connectTemporal, temporalConfigFromEnv, temporalTlsMaterial } from "@steward/workflows";
import { createActivities } from "./activities.js";
import { HttpCompanionBridge } from "./companion-bridge.js";
import { startReactionsJob } from "./reactions-job.js";
import { startReconcileJob } from "./reconcile-job.js";
import { startRetentionJob } from "./retention-job.js";
import { startBrowserJob } from "./browser-job.js";

const require = createRequire(import.meta.url);

function sandboxFromEnv(env: NodeJS.ProcessEnv): SandboxProvider | undefined {
  if ((env.SANDBOX_PROVIDER ?? "docker") !== "docker") return undefined;
  const host = env.SANDBOX_DOCKER_HOST;
  if (host) {
    const u = new URL(host.includes("://") ? host : `tcp://${host}`);
    return new LocalDockerSandboxProvider({ host: u.hostname, port: Number(u.port || 2375) });
  }
  return new LocalDockerSandboxProvider();
}

async function main() {
  const config = loadConfig();
  const core = createCoreContext(config, "worker");
  const log = core.log;
  const temporal = temporalConfigFromEnv();

  // The worker is nothing without Temporal, so a deployment that disabled it should say so and stop rather
  // than retry a connection that will never succeed. The parsing itself is shared with the API and the
  // embedded runtime, so all three agree on what the environment means.
  if ((process.env.TEMPORAL_DISABLED ?? "").trim() === "true") {
    log.warn("TEMPORAL_DISABLED=true: the worker has no task queue to serve; exiting");
    await core.pool.end();
    return;
  }

  if (process.env.RUN_MIGRATIONS_ON_START !== "false") {
    await runMigrations();
    log.info("migrations applied");
  }

  Runtime.install({ logger: new DefaultLogger((process.env.TEMPORAL_LOG_LEVEL as LogLevel | undefined) ?? "WARN") });

  const client = await connectTemporal(temporal);
  const workflows = new WorkflowClient(client, temporal.taskQueue);
  await workflows.ensureHousekeeping();

  const approvalSignal: ApprovalSignal = {
    notify: async (workflowId, approvalId, decision) => {
      await workflows.signalApproval(workflowId, { approvalId, ...decision });
    },
  };
  const sandbox = sandboxFromEnv(process.env);

  // The browser this worker may drive. `auto` means "whatever this machine actually has": a container without
  // Chromium reports `none` and says why, and a stack that installed it needs no second env var to be allowed to
  // use it. Resolved once at boot because the provider is a process-local cache of open pages.
  const { provider: browser, mode: browserMode } = await browserProviderFromEnv(process.env);
  const browserState = await browser.availability();
  if (!browserState.available) log.warn({ provider: browser.name, mode: browserMode, reason: browserState.reason }, "this worker cannot open a browser; browsing agents will say so instead of clicking");

  const companionBridge = new HttpCompanionBridge(config.apiInternalUrl, internalServiceToken(config));
  const factory = new AgentServiceFactory({
    core,
    sandbox,
    browser,
    approvalSignal,
    companionBridge,
    runWorkflowLauncher: { start: (input) => workflows.startRun(input) },
  });
  const activities = createActivities({ core, factory, sandbox, approvalSignal });

  const connection = await NativeConnection.connect({ address: temporal.address, tls: await temporalTlsMaterial(temporal), apiKey: temporal.apiKey });
  const worker = await Worker.create({
    connection,
    namespace: temporal.namespace,
    taskQueue: temporal.taskQueue,
    workflowsPath: require.resolve("@steward/workflows/workflows"),
    activities,
    maxConcurrentActivityTaskExecutions: Number(process.env.WORKER_MAX_ACTIVITIES ?? 10),
    maxConcurrentWorkflowTaskExecutions: Number(process.env.WORKER_MAX_WORKFLOWS ?? 40),
    identity: `steward-worker@${process.env.HOSTNAME ?? "local"}:${process.pid}`,
  });

  const shutdown = async (sig: string) => {
    log.info({ sig }, "worker shutting down");
    worker.shutdown();
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  // Enforces the published retention windows (expired sessions and tokens, old activity events and
  // webhook logs) without needing an external scheduler.
  startRetentionJob(core.db, log);

  // Repairs the states a distributed failure can leave behind: launches that never started, runs that stopped
  // moving, approvals whose run already finished, and tasks waiting on an approval that no longer exists.
  startReconcileJob(core.db, log, { start: (input) => workflows.startRun(input) });

  // Answers the rules a founder wrote over recorded events (a finished task, an inbound webhook, a failed
  // payment), so work can start from what happened rather than only from the clock.
  startReactionsJob(core.db, log, { start: (input) => workflows.startRun(input) });

  // Closes browser sessions nobody is driving and drops frames past the window, so a session that outlived its run
  // stops claiming to be live and the images of past moments do not accumulate forever.
  startBrowserJob(core.db, log, browser);

  log.info({ taskQueue: temporal.taskQueue, namespace: temporal.namespace, address: temporal.address, sandbox: !!sandbox, browser: browser.name, browserMode }, "steward worker ready");
  await worker.run();
  await browser.dispose().catch((err) => log.warn({ err }, "closing the browser failed"));
  await connection.close();
  await client.connection.close();
  await core.pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
