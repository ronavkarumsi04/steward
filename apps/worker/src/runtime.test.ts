import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createServer, connect, type Server, type Socket } from "node:net";
import { once } from "node:events";
import { createServer as createTlsServer } from "node:tls";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, expect, it } from "vitest";
import { createDb } from "@steward/db";
import { connectTemporal, temporalConfigFromEnv } from "@steward/workflows";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://steward:steward@localhost:5432/steward";
const temporal = temporalConfigFromEnv();
let available = false;
let child: ChildProcess | undefined;
let output = "";
let proxy: Server | undefined;
const sockets = new Set<Socket>();

beforeAll(async () => {
  const { pool } = createDb(databaseUrl, 1);
  try {
    const query = { text: "select 1", query_timeout: 1500 };
    await pool.query(query);
    const client = await connectTemporal(temporal, 1500);
    await client.connection.close();
    available = true;
  } catch (error) { if (process.env.CI) throw error; }
  finally { await pool.end(); }
});

async function stopProxy() {
  for (const socket of sockets) socket.destroy();
  if (proxy?.listening) await new Promise<void>((resolve, reject) => proxy!.close((err) => err ? reject(err) : resolve()));
}
async function stopChild() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  const timer = setTimeout(() => child?.kill("SIGKILL"), 10_000);
  try { await exited; } finally { clearTimeout(timer); }
}
afterEach(async () => { await stopChild(); await stopProxy(); });

async function reservePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No loopback address");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}
function startWorker(healthPort: number, address: string, extra: NodeJS.ProcessEnv = {}) {
  child = spawn(process.execPath, ["dist/main.js"], {
    cwd: new URL("..", import.meta.url), stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, DOTENV_CONFIG_PATH: "/dev/null", NODE_ENV: "production", DATABASE_URL: databaseUrl,
      STEWARD_MASTER_KEY: "a".repeat(64), SESSION_SECRET: "b".repeat(64), LOG_LEVEL: "info",
      BROWSER_PROVIDER: "none", SANDBOX_PROVIDER: "none", RUN_MIGRATIONS_ON_START: "false",
      TEMPORAL_DISABLED: "false", TEMPORAL_ADDRESS: address, TEMPORAL_NAMESPACE: temporal.namespace,
      TEMPORAL_TASK_QUEUE: `worker-health-test-${process.pid}-${Date.now()}`,
      TEMPORAL_CONNECT_TIMEOUT_MS: "10000", WORKER_HEALTH_HOST: "127.0.0.1", WORKER_HEALTH_PORT: String(healthPort),
      ...extra },
  });
  output = "";
  const collect = (data: Buffer) => { output = (output + data.toString()).slice(-16_000); };
  child.stdout?.on("data", collect); child.stderr?.on("data", collect);
  return child;
}
async function status(url: string): Promise<number> {
  try { return (await fetch(url, { signal: AbortSignal.timeout(4500) })).status; }
  catch { return 0; }
}

async function waitForStartup(url: string): Promise<void> {
  try {
    // Cold workflow bundling shares the CI runner with other integration suites.
    // Match the container's startup budget; outage recovery keeps its own deadline.
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      if (child && (child.exitCode !== null || child.signalCode !== null)) {
        throw new Error(`Worker exited before readiness (code=${child.exitCode}, signal=${child.signalCode})`);
      }
      if (await status(url + "/ready") === 200) return;
      await new Promise<void>((resolve) => setTimeout(resolve, 250));
    }
    throw new Error("Worker readiness remained unavailable for 60 seconds");
  } catch (error) {
    throw new Error(`Worker startup did not reach readiness. Captured worker output:\n${output}`, { cause: error });
  }
}

it("recovers readiness across a real Temporal outage, restarts, and exits cleanly on SIGTERM", async (context) => {
  if (!available) return context.skip();
  const target = new URL(`http://${temporal.address}`);
  proxy = createServer((downstream) => {
    const upstream = connect(Number(target.port || 7233), target.hostname);
    for (const socket of [downstream, upstream]) {
      sockets.add(socket); socket.on("close", () => sockets.delete(socket));
      socket.on("error", () => { downstream.destroy(); upstream.destroy(); });
    }
    downstream.pipe(upstream); upstream.pipe(downstream);
  });
  const proxyPort = await reservePort();
  const healthPort = await reservePort();
  const listen = () => new Promise<void>((resolve) => proxy!.listen(proxyPort, "127.0.0.1", resolve));
  await listen();
  const url = `http://127.0.0.1:${healthPort}`;
  startWorker(healthPort, `127.0.0.1:${proxyPort}`);
  await waitForStartup(url);
  await stopProxy();
  expect(await status(url + "/health")).toBe(200);
  expect(await status(url + "/ready")).toBe(503);
  await listen();
  await expect.poll(() => status(url + "/ready"), { timeout: 25_000, interval: 250 }).toBe(200);
  await stopChild();
  expect(child!.exitCode, output).toBe(0);
  expect(await status(url + "/health")).toBe(0);
  startWorker(healthPort, `127.0.0.1:${proxyPort}`);
  await waitForStartup(url);
  await stopChild();
  expect(child!.exitCode, output).toBe(0);
}, 180_000);

it("exits nonzero and releases its health listener after an unreachable boot", async (context) => {
  if (!available) return context.skip();
  const healthPort = await reservePort();
  const unavailablePort = await reservePort();
  const worker = startWorker(healthPort, `127.0.0.1:${unavailablePort}`, { TEMPORAL_CONNECT_TIMEOUT_MS: "500" });
  const [code] = await once(worker, "exit");
  expect(code).toBe(1);
  expect(await status(`http://127.0.0.1:${healthPort}/health`)).toBe(0);
}, 15_000);

it("refuses disabled execution as a deployment error rather than a successful process exit", async () => {
  const worker = startWorker(await reservePort(), "127.0.0.1:1", { TEMPORAL_DISABLED: "true" });
  const [code] = await once(worker, "exit");
  expect(code).toBe(1);
}, 15_000);

it("boots both Temporal connections over verified TLS and refuses an untrusted certificate", async (context) => {
  if (!available) return context.skip();
  await stopProxy();
  const dir = await mkdtemp(join(tmpdir(), "steward-worker-tls-"));
  try {
    const certPath = join(dir, "cert.pem");
    const keyPath = join(dir, "key.pem");
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=localhost",
      "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1", "-addext", "basicConstraints=critical,CA:FALSE",
      "-addext", "extendedKeyUsage=serverAuth", "-keyout", keyPath, "-out", certPath], { stdio: "ignore" });
    const target = new URL(`http://${temporal.address}`);
    proxy = createTlsServer({ key: await readFile(keyPath), cert: await readFile(certPath), ALPNProtocols: ["h2"] }, (downstream) => {
      const upstream = connect(Number(target.port || 7233), target.hostname);
      for (const socket of [downstream, upstream]) {
        sockets.add(socket); socket.on("close", () => sockets.delete(socket));
        socket.on("error", () => { downstream.destroy(); upstream.destroy(); });
      }
      downstream.pipe(upstream); upstream.pipe(downstream);
    });
    // Handshake failures must be contained by the test proxy, not surfaced as uncaught process errors.
    proxy.on("tlsClientError", () => {});
    await new Promise<void>((resolve) => proxy!.listen(0, "127.0.0.1", resolve));
    const address = proxy.address();
    if (!address || typeof address === "string") throw new Error("No TLS proxy address");
    const healthPort = await reservePort();
    startWorker(healthPort, `127.0.0.1:${address.port}`, { TEMPORAL_TLS: "true", TEMPORAL_TLS_CA_PATH: certPath });
    await waitForStartup(`http://127.0.0.1:${healthPort}`);
    await stopChild(); expect(child!.exitCode, output).toBe(0);
    const untrusted = startWorker(healthPort, `127.0.0.1:${address.port}`, { TEMPORAL_TLS: "true", TEMPORAL_TLS_CA_PATH: "" });
    const [code] = await once(untrusted, "exit");
    expect(code).toBe(1);
    expect(await status(`http://127.0.0.1:${healthPort}/ready`)).toBe(0);
  } finally { await stopChild(); await stopProxy(); await rm(dir, { recursive: true, force: true }); }
}, 100_000);
