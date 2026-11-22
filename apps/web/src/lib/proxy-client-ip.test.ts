import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { proxy } from "../proxy";
import { proxyClientHeaders } from "./proxy-client-ip";

afterEach(() => vi.unstubAllEnvs());

describe("client IP handoff", () => {
  it("uses only Vercel's edge headers or an available socket IP", () => {
    const incoming = new Headers({ "x-vercel-forwarded-for": "192.0.2.1", "x-forwarded-for": "192.0.2.2, 192.0.2.3" });
    expect(proxyClientHeaders(incoming, { VERCEL: "1", STEWARD_PROXY_SECRET: "test-secret" })).toEqual({ "x-steward-client-ip": "192.0.2.1", "x-steward-proxy-secret": "test-secret" });
    incoming.delete("x-vercel-forwarded-for");
    expect(proxyClientHeaders(incoming, { VERCEL: "1", STEWARD_PROXY_SECRET: "test-secret" })["x-steward-client-ip"]).toBe("192.0.2.2");
    expect(proxyClientHeaders(incoming, { STEWARD_PROXY_SECRET: "test-secret" })).toEqual({});
    expect(proxyClientHeaders(incoming, { STEWARD_PROXY_SECRET: "test-secret" }, "127.0.0.1")["x-steward-client-ip"]).toBe("127.0.0.1");
    expect(proxyClientHeaders(incoming, { VERCEL: "1" })).toEqual({});
  });

  it("strips spoofed handoff headers and signs API requests only when configured", () => {
    vi.stubEnv("VERCEL", "1");
    const request = () => new NextRequest("https://web.test/api/v1/auth/config", { headers: { "x-steward-client-ip": "spoof", "x-steward-proxy-secret": "spoof", "x-vercel-forwarded-for": "192.0.2.1" } });
    vi.stubEnv("STEWARD_PROXY_SECRET", "");
    const unsigned = proxy(request());
    expect(unsigned.status).toBe(200);
    expect(unsigned.headers.get("x-middleware-next")).toBe("1");
    expect(unsigned.headers.get("x-middleware-request-x-steward-proxy-secret")).toBeNull();
    expect(unsigned.headers.get("x-middleware-request-x-steward-client-ip")).toBeNull();
    vi.stubEnv("STEWARD_PROXY_SECRET", "test-secret");
    const signed = proxy(request());
    expect(signed.headers.get("x-middleware-request-x-steward-client-ip")).toBe("192.0.2.1");
    expect(signed.headers.get("x-middleware-request-x-steward-proxy-secret")).toBe("test-secret");
  });

  it("keeps the app redirect and session precheck unchanged without a secret", () => {
    vi.stubEnv("STEWARD_PROXY_SECRET", "");
    const redirect = proxy(new NextRequest("https://web.test/app/tasks?view=all"));
    expect(redirect.status).toBe(307);
    expect(redirect.headers.get("location")).toBe("https://web.test/login?next=%2Fapp%2Ftasks%3Fview%3Dall");
    const signedIn = proxy(new NextRequest("https://web.test/app", { headers: { cookie: "steward_session=test" } }));
    expect(signedIn.headers.get("x-middleware-next")).toBe("1");
  });
});
