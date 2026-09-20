import "dotenv/config";
import { serve } from "@hono/node-server";
import { AgentServiceFactory } from "@steward/agents";
import { AuthService, EventBus, createCoreContext, loadConfig, type ApprovalSignal } from "@steward/core";
import { runMigrations } from "@steward/db";
import { WorkflowClient, connectTemporal, temporalConfigFromEnv } from "@steward/workflows";
import { createApp } from "./app.js";

async function main() {
  const config = loadConfig();
  const core = createCoreContext(config, "api");
  const log = core.log;

  if (process.env.RUN_MIGRATIONS_ON_START !== "false") {
    await runMigrations();
    log.info("migrations applied");
  }

  let workflows: WorkflowClient | null = null;
  if (process.env.TEMPORAL_DISABLED !== "true") {
    const temporal = temporalConfigFromEnv();
    try {
      const client = await connectTemporal(temporal);
      workflows = new WorkflowClient(client, temporal.taskQueue);
      log.info({ address: temporal.address, namespace: temporal.namespace }, "temporal connected");
    } catch (e) {
      log.error({ err: e instanceof Error ? e.message : String(e) }, "temporal unavailable; runs cannot be started until it is reachable");
    }
  }

  const approvalSignal: ApprovalSignal | undefined = workflows
    ? { notify: async (workflowId, approvalId, decision) => void (await workflows!.signalApproval(workflowId, { approvalId, ...decision })) }
    : undefined;

  const bus = new EventBus(core.pool, log);
  await bus.start();

  const services = new AgentServiceFactory({ core, approvalSignal });
  const { app } = createApp({ core, auth: new AuthService(core.db), services, workflows, env: process.env }, bus);

  const port = Number(process.env.API_PORT ?? new URL(config.apiUrl).port ?? 4000);
  const server = serve({ fetch: app.fetch, port, hostname: process.env.API_HOST ?? "0.0.0.0" }, (info) => log.info({ port: info.port }, "steward api listening"));

  const shutdown = async () => {
    log.info("api shutting down");
    server.close();
    await bus.stop();
    await core.pool.end();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
