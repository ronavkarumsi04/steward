import { createServer, connect, type Server, type Socket } from "node:net";
import pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { connectTemporal, temporalConfigFromEnv } from "@steward/workflows";
import { createApiRuntime, type ApiRuntime } from "./runtime.js";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://steward:steward@localhost:5432/steward";
const temporal = temporalConfigFromEnv();
let available = false;
let runtime: ApiRuntime | undefined;
let proxy: Server | undefined;
const sockets = new Set<Socket>();

beforeAll(async () => {
  const pool = new pg.Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 1_500 });
  try {
    await pool.query("select 1");
    const client = await connectTemporal(temporal, 1_500);
    await client.connection.close();
    available = true;
  } catch (error) {
    if (process.env.CI) throw error;
  } finally { await pool.end(); }
});

afterAll(async () => {
  await runtime?.close();
  for (const socket of sockets) socket.destroy();
  if (proxy?.listening) await new Promise<void>((resolve, reject) => proxy!.close((error) => error ? reject(error) : resolve()));
});

it("recovers real Temporal connectivity after an unavailable boot, without restarting the API", async (context) => {
  if (!available) return context.skip();
  // Reserve a loopback port, then close it: boot must genuinely fail to reach Temporal.
  const reservation = createServer();
  await new Promise<void>((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const address = reservation.address();
  if (!address || typeof address === "string") throw new Error("No loopback port");
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  runtime = await createApiRuntime({ listen: false, migrate: false, env: {
    NODE_ENV: "test", DATABASE_URL: databaseUrl, DATABASE_POOL_MAX: "2",
    STEWARD_MASTER_KEY: "a".repeat(64), SESSION_SECRET: "b".repeat(64), LOG_LEVEL: "silent",
    BROWSER_PROVIDER: "none", TEMPORAL_CONNECT_TIMEOUT_MS: "200",
    TEMPORAL_ADDRESS: `127.0.0.1:${address.port}`, TEMPORAL_NAMESPACE: temporal.namespace,
    TEMPORAL_TASK_QUEUE: `recovery-test-${process.pid}-${Date.now()}`,
  } });
  expect(runtime.workflows).toBeNull();
  expect(runtime.core.pool.options.max).toBe(2);
  expect(await (await runtime.app.request("http://api.test/health")).json()).toMatchObject({ ok: true, temporal: "unavailable" });

  const target = new URL(`http://${temporal.address}`);
  proxy = createServer((downstream) => {
    const upstream = connect(Number(target.port), target.hostname);
    for (const socket of [downstream, upstream]) {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      socket.on("error", () => { downstream.destroy(); upstream.destroy(); });
    }
    downstream.pipe(upstream); upstream.pipe(downstream);
  });
  await new Promise<void>((resolve) => proxy!.listen(address.port, "127.0.0.1", resolve));
  await expect.poll(() => runtime!.workflows !== null, { timeout: 40_000, interval: 250 }).toBe(true);
  expect(await (await runtime.app.request("http://api.test/health")).json()).toMatchObject({ temporal: "connected" });
  const readiness = await runtime.app.request("http://api.test/ready");
  expect(readiness.status).toBe(503);
  expect(await readiness.json()).toMatchObject({ temporal: "connected", executions: "unavailable" });
}, 50_000);
