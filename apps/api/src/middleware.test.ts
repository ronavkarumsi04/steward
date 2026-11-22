import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { ApiDeps, AppEnv } from "./context.js";
import { clientIp } from "./middleware.js";

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
    expect(await ip({ TRUST_PROXY: "true" }, { "x-vercel-forwarded-for": "192.0.2.1", "x-forwarded-for": "spoof, 192.0.2.2", "x-real-ip": "192.0.2.3" })).toBe("192.0.2.1");
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
