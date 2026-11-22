import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { ApiDeps, AppEnv } from "./context.js";
import { clientIp, rateLimit } from "./middleware.js";

async function ip(env: NodeJS.ProcessEnv, headers: Record<string, string> = {}, address?: string) {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("deps", { env } as ApiDeps);
    await next();
  });
  app.get("/", (c) => c.text(clientIp(c)));
  return (await app.request("http://test/", { headers }, address ? { incoming: { socket: { remoteAddress: address } } } : undefined)).text();
}

describe("clientIp", () => {
  it("ignores all forwarded headers without proxy trust and uses the socket", async () => {
    expect(await ip({}, { "x-real-ip": "spoof", "x-forwarded-for": "spoof", "x-vercel-forwarded-for": "spoof" }, "192.0.2.10")).toBe("192.0.2.10");
    expect(await ip({ TRUST_PROXY: "false" }, { "x-real-ip": "spoof" })).toBe("local");
  });
  it("prefers Vercel's header when trusted", async () => {
    expect(await ip({ TRUST_PROXY: "true", VERCEL: "1" }, { "x-vercel-forwarded-for": "192.0.2.1", "x-forwarded-for": "spoof, 192.0.2.2", "x-real-ip": "192.0.2.3" })).toBe("192.0.2.1");
  });
  it("ignores spoofed Vercel headers on an external API", async () => {
    expect(await ip({ TRUST_PROXY: "true" }, { "x-vercel-forwarded-for": "spoof", "x-forwarded-for": "192.0.2.2" })).toBe("192.0.2.2");
  });
  it("uses authenticated client IP handoffs before proxy headers", async () => {
    expect(await ip({ STEWARD_PROXY_SECRET: "test-shared-secret" }, { "x-steward-proxy-secret": "test-shared-secret", "x-steward-client-ip": "192.0.2.1", "x-forwarded-for": "spoof" }, "192.0.2.10")).toBe("192.0.2.1");
    for (const secret of [undefined, "wrong", "same-length-wrong!"]) {
      expect(await ip({ STEWARD_PROXY_SECRET: "test-shared-secret" }, { ...(secret ? { "x-steward-proxy-secret": secret } : {}), "x-steward-client-ip": "spoof" }, "192.0.2.10")).toBe("192.0.2.10");
    }
    expect(await ip({}, { "x-steward-proxy-secret": "anything", "x-steward-client-ip": "spoof" }, "192.0.2.10")).toBe("192.0.2.10");
  });
  it("selects from the right and ignores a spoofed leftmost entry", async () => {
    const headers = { "x-forwarded-for": "spoof, 192.0.2.1, 192.0.2.2" };
    expect(await ip({ TRUST_PROXY: "true" }, headers)).toBe("192.0.2.2");
    expect(await ip({ TRUST_PROXY: "true", TRUST_PROXY_HOPS: "1" }, headers)).toBe("192.0.2.2");
    expect(await ip({ TRUST_PROXY: "true", TRUST_PROXY_HOPS: "2" }, headers)).toBe("192.0.2.1");
  });
  it("falls back to trusted real IP, then socket/local on absent or invalid chains", async () => {
    expect(await ip({ TRUST_PROXY: "true" }, { "x-real-ip": "192.0.2.3" })).toBe("192.0.2.3");
    for (const hops of ["0", "-1", "invalid", "5"]) {
      expect(await ip({ TRUST_PROXY: "true", TRUST_PROXY_HOPS: hops }, { "x-forwarded-for": "spoof" }, "192.0.2.10")).toBe("192.0.2.10");
    }
    expect(await ip({ TRUST_PROXY: "true" })).toBe("local");
  });
});

describe("rateLimit cleanup", () => {
  it("does not evict an idle bucket before its full refill period", async () => {
    vi.useFakeTimers();
    try {
      const app = new Hono<AppEnv>();
      app.use("*", async (c, next) => {
        c.set("deps", { env: {} } as ApiDeps);
        await next();
      });
      app.use("*", rateLimit({ capacity: 1, refillPerSec: 1 / 900 }));
      app.onError((err, c) => c.json({ error: err.message }, 429));
      app.get("/", (c) => c.text("ok"));
      expect((await app.request("http://test/")).status).toBe(200);
      await vi.advanceTimersByTimeAsync(11 * 60_000);
      expect((await app.request("http://test/")).status).toBe(429);
      await vi.advanceTimersByTimeAsync(4 * 60_000);
      expect((await app.request("http://test/")).status).toBe(200);
      await vi.advanceTimersByTimeAsync(16 * 60_000);
      expect((await app.request("http://test/")).status).toBe(200);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
});
