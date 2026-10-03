import { createServer, type Server } from "node:http";

export interface WorkerHealthDependencies {
  commit?: string;
  state(): string;
  database(): Promise<unknown>;
  temporal(): Promise<{ connected: boolean }>;
}

async function bounded<T>(probe: () => Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([Promise.resolve().then(probe), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Probe deadline exceeded")), timeoutMs);
      timer.unref();
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

/** Process liveness is separate from execution readiness. Never return raw dependency errors or configuration. */
export function createWorkerHealthServer(deps: WorkerHealthDependencies, timeoutMs = 3500): Server {
  const commit = /^[a-f0-9]{7,40}$/i.test(deps.commit ?? "") ? deps.commit!.toLowerCase().slice(0, 7) : "unknown";
  let pending: Promise<{ db: string; temporal: string }> | undefined;
  const probe = () => {
    // Coalesce simultaneous probes; do not cache a previous success through an outage.
    pending ??= Promise.allSettled([
      bounded(deps.database, timeoutMs), bounded(deps.temporal, timeoutMs),
    ]).then(([db, temporal]) => ({
      db: db.status === "fulfilled" ? "ok" : "down",
      temporal: temporal.status === "fulfilled" && temporal.value.connected ? "connected" : "unavailable",
    })).finally(() => { pending = undefined; });
    return pending;
  };
  const server = createServer((req, res) => {
    void (async () => {
      res.setHeader("cache-control", "no-store");
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.setHeader("x-content-type-options", "nosniff");
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.setHeader("allow", "GET, HEAD");
        res.writeHead(405); res.end(JSON.stringify({ error: "method_not_allowed" })); return;
      }
      if (req.url !== "/health" && req.url !== "/ready") {
        res.writeHead(404); res.end(JSON.stringify({ error: "not_found" })); return;
      }
      if (req.url === "/health") {
        const state = deps.state();
        const ok = state !== "FAILED" && state !== "STOPPED";
        res.writeHead(ok ? 200 : 503); res.end(req.method === "HEAD" ? undefined : JSON.stringify({ ok, state, commit })); return;
      }
      // Do not start dependency IO during boot/drain. Check state again after IO so shutdown wins a race.
      const dependencies = deps.state() === "RUNNING" ? await probe() : { db: "unchecked", temporal: "unchecked" };
      const state = deps.state();
      const ok = state === "RUNNING" && dependencies.db === "ok" && dependencies.temporal === "connected";
      res.writeHead(ok ? 200 : 503);
      res.end(req.method === "HEAD" ? undefined : JSON.stringify({ ok, state, commit, ...dependencies }));
    })().catch(() => {
      if (!res.headersSent) res.writeHead(503);
      res.end(JSON.stringify({ ok: false, error: "probe_unavailable" }));
    });
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  return server;
}

export async function listenWorkerHealth(server: Server, port: number, host: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const error = (err: Error) => reject(err);
    server.once("error", error);
    server.listen(port, host, () => { server.off("error", error); resolve(); });
  });
}

export async function closeWorkerHealth(server: Server): Promise<void> {
  if (!server.listening) return;
  server.closeIdleConnections();
  await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
}
