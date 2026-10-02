import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const factory = vi.hoisted(() => vi.fn());
vi.mock("server-only", () => ({}));
vi.mock("@steward/api/runtime", () => ({ createApiRuntime: factory }));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [{ name: "steward_session", value: "test-session" }] }) }));

beforeEach(() => { vi.resetModules(); factory.mockReset(); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("server API transport", () => {
  it("uses the embedded API with cookies and query intact even when the HTTP API is unreachable", async () => {
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No loopback API"));
    factory.mockResolvedValue({ app: { fetch: (r: Request) => Response.json({ path: new URL(r.url).pathname, query: new URL(r.url).search, cookie: r.headers.get("cookie") }) } });
    const { serverTransport } = await import("./server-transport");
    const { createClient } = await import("./api");
    const transport = serverTransport({ EMBEDDED_API: "true", APP_URL: "https://steward.example/", API_INTERNAL_URL: "http://127.0.0.1:1" });
    const api = createClient({ ...transport, baseUrl: `${transport.baseUrl}/v1`, cookie: "steward_session=test-session" });
    expect(await api.get("/auth/me?view=current")).toEqual({ path: "/v1/auth/me", query: "?view=current", cookie: "steward_session=test-session" });
    expect(network).not.toHaveBeenCalled();
    expect(factory).toHaveBeenCalledWith(expect.objectContaining({ listen: false, migrate: false }));
  });

  it("shares cold startup across server calls and normalizes browser route prefixes", async () => {
    let ready!: (value: unknown) => void;
    factory.mockReturnValue(new Promise((resolve) => { ready = resolve; }));
    const { handleEmbeddedApi, embeddedFetch } = await import("./embedded-api");
    const one = embeddedFetch("https://steward.example/v1/auth/me");
    const two = handleEmbeddedApi(new Request("https://steward.example/api/v1/auth/config"));
    await vi.waitFor(() => expect(factory).toHaveBeenCalledTimes(1));
    ready({ app: { fetch: (r: Request) => Response.json({ path: new URL(r.url).pathname }) } });
    expect(await (await one).json()).toEqual({ path: "/v1/auth/me" });
    expect(await (await two).json()).toEqual({ path: "/v1/auth/config" });
  });

  it("redacts startup errors and retries the next invocation", async () => {
    factory.mockRejectedValueOnce(new Error("credential-bearing startup failure"));
    factory.mockResolvedValueOnce({ app: { fetch: () => Response.json({ ok: true }) } });
    const { embeddedFetch } = await import("./embedded-api");
    const failed = await embeddedFetch("https://steward.example/ready");
    expect(failed.status).toBe(503);
    expect(failed.headers.get("cache-control")).toBe("no-store");
    expect(failed.headers.get("retry-after")).toBe("5");
    expect(await failed.text()).not.toContain("credential-bearing");
    expect(await (await embeddedFetch("https://steward.example/health")).json()).toEqual({ ok: true });
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("keeps standalone HTTP transport and ignores blank internal URLs", async () => {
    const { serverTransport } = await import("./server-transport");
    const transport = serverTransport({ API_INTERNAL_URL: "  ", API_URL: "http://api:4000/" });
    expect(transport.baseUrl).toBe("http://api:4000");
    expect(transport.fetchImpl).toBe(fetch);
    expect(factory).not.toHaveBeenCalled();
  });

  it("reports unknown registration policy rather than opening signup when embedded startup fails", async () => {
    vi.stubEnv("EMBEDDED_API", "true");
    factory.mockRejectedValue(new Error("sensitive failure"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { getAuthConfig, getMeOptional } = await import("./server");
    expect(await getAuthConfig()).toBeNull();
    expect(await getMeOptional()).toEqual({ user: null, memberships: [] });
    expect(log.mock.calls.flat().join(" ")).not.toContain("sensitive failure");
  });

  it("does not swallow authorization errors or invent a signed-in user", async () => {
    vi.stubEnv("EMBEDDED_API", "true");
    factory.mockResolvedValue({ app: { fetch: () => Response.json({ error: { code: "forbidden", message: "Access denied" } }, { status: 403 }) } });
    const { getAuthConfig } = await import("./server");
    await expect(getAuthConfig()).rejects.toMatchObject({ status: 403, code: "forbidden" });
  });
});
