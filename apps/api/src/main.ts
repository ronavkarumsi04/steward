import "dotenv/config";
import { serve } from "@hono/node-server";
import { createApiRuntime } from "./runtime.js";

async function main() {
  const runtime = await createApiRuntime({ migrate: process.env.RUN_MIGRATIONS_ON_START !== "false", env: process.env });
  const { app, core } = runtime;
  const log = core.log;

  const port = Number(process.env.API_PORT || new URL(core.config.apiUrl).port || 4000);
  const server = serve({ fetch: app.fetch, port, hostname: process.env.API_HOST ?? "0.0.0.0" }, (info) => log.info({ port: info.port }, "steward api listening"));

  const shutdown = async () => {
    log.info("api shutting down");
    server.close();
    await runtime.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
