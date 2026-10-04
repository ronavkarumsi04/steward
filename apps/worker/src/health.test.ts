import type { Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { closeWorkerHealth, createWorkerHealthServer, listenWorkerHealth } from "./health.js";

let server: Server | undefined;
afterEach(async () => { if (server) await closeWorkerHealth(server); });
async function setup(timeout = 3500) {
  let state = "STARTING";
  const database = vi.fn(async () => {});
  const temporal = vi.fn(async () => ({ connected: true }));
  server = createWorkerHealthServer({ state: () => state, database, temporal }, timeout);
  await listenWorkerHealth(server, 0, "127.0.0.1");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No health address");
  return { url: `http://127.0.0.1:${address.port}`, database, temporal, state: (next: string) => { state = next; } };
}

describe("worker health over HTTP", () => {
  it("keeps process liveness separate from starting, stopping and failed execution", async () => {
    const s = await setup();
    expect((await fetch(s.url + "/health")).status).toBe(200);
    expect((await fetch(s.url + "/ready")).status).toBe(503);
    expect(s.database).not.toHaveBeenCalled();
    expect(s.temporal).not.toHaveBeenCalled();
    s.state("RUNNING");
    const ready = await fetch(s.url + "/ready");
    expect(ready.status).toBe(200);
    expect(ready.headers.get("cache-control")).toBe("no-store");
    expect(await ready.json()).toEqual({ ok: true, state: "RUNNING", commit: "unknown", db: "ok", temporal: "connected" });
    s.state("DRAINING");
    expect((await fetch(s.url + "/health")).status).toBe(200);
    expect((await fetch(s.url + "/ready")).status).toBe(503);
    s.state("FAILED");
    expect((await fetch(s.url + "/health")).status).toBe(503);
  });

  it("reports dependency loss and recovery without caching success or leaking errors", async () => {
    const s = await setup(); s.state("RUNNING");
    expect((await fetch(s.url + "/ready")).status).toBe(200);
    s.database.mockRejectedValueOnce(new Error("postgres://user:secret@host"));
    const dbDown = await fetch(s.url + "/ready");
    expect(dbDown.status).toBe(503);
    expect(await dbDown.json()).toMatchObject({ db: "down", temporal: "connected" });
    s.temporal.mockRejectedValueOnce(new Error("api-key=secret"));
    const temporalDown = await fetch(s.url + "/ready");
    expect(temporalDown.status).toBe(503);
    const body = await temporalDown.text();
    expect(body).not.toMatch(/secret|api-key|postgres:/);
    expect(JSON.parse(body)).toMatchObject({ db: "ok", temporal: "unavailable" });
    expect((await fetch(s.url + "/ready")).status).toBe(200);
  });

  it("bounds an unreachable probe and shares concurrent IO while shutdown wins races", async () => {
    const s = await setup(50); s.state("RUNNING");
    let release: (() => void) | undefined;
    s.database.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
    const probes = [fetch(s.url + "/ready"), fetch(s.url + "/ready")];
    await expect.poll(() => s.database.mock.calls.length).toBe(1);
    s.state("DRAINING");
    const responses = await Promise.all(probes);
    for (const response of responses) {
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ ok: false, state: "DRAINING" });
    }
    expect(s.database).toHaveBeenCalledTimes(1);
    release?.();
  });

  it("serves only health methods/paths and supports HEAD probes", async () => {
    const s = await setup(); s.state("RUNNING");
    const head = await fetch(s.url + "/ready", { method: "HEAD" });
    expect(head.status).toBe(200); expect(await head.text()).toBe("");
    expect((await fetch(s.url + "/ready", { method: "POST" })).status).toBe(405);
    expect((await fetch(s.url + "/secrets")).status).toBe(404);
  });
});
