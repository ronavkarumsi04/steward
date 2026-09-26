import "dotenv/config";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { NativeConnection, Runtime, Worker, DefaultLogger, type LogLevel } from "@temporalio/worker";
import { AgentServiceFactory } from "@steward/agents";
import { createCoreContext, internalServiceToken, loadConfig, type ApprovalSignal } from "@steward/core";
import { runMigrations } from "@steward/db";
import { LocalDockerSandboxProvider, type SandboxProvider } from "@steward/sandbox";
import { WorkflowClient, connectTemporal, temporalConfigFromEnv } from "@steward/workflows";
import { createActivities } from "./activities.js";
import { HttpCompanionBridge } from "./companion-bridge.js";
import { startRetentionJob } from "./retention-job.js";

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

async function nativeTls(cfg: ReturnType<typeof temporalConfigFromEnv>) {
  if (cfg.tls?.clientCertPath && cfg.tls.clientKeyPath) {
      return { clientCertPair: { crt: await readFile(cfg.tls.clientCertPath), key: await readFile(cfg.tls.clientKeyPath) }, serverRootCACertificate: cfg.tls.serverRootCACertPath ? await readFile(cfg.tls.serverRootCACertPath) : undefined };
  }
  return cfg.apiKey?.trim() ? true : undefined;
}

async function main() {
  const config = loadConfig();
  const core = createCoreContext(config, "worker");
  const log = core.log;
  const temporal = temporalConfigFromEnv();

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
  const companionBridge = new HttpCompanionBridge(config.apiInternalUrl, internalServiceToken(config));
  const factory = new AgentServiceFactory({
    core,
    sandbox,
    approvalSignal,
    companionBridge,
    runWorkflowLauncher: { start: (input) => workflows.startRun(input) },
  });
  const activities = createActivities({ core, factory, sandbox, approvalSignal });

  const connection = await NativeConnection.connect({ address: temporal.address, tls: await nativeTls(temporal), apiKey: temporal.apiKey });
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

  log.info({ taskQueue: temporal.taskQueue, namespace: temporal.namespace, address: temporal.address, sandbox: !!sandbox }, "steward worker ready");
  await worker.run();
  await connection.close();
  await client.connection.close();
  await core.pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
