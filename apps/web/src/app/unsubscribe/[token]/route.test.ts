import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";

const { serverFetch } = vi.hoisted(() => ({ serverFetch: vi.fn() }));
vi.mock("@/lib/server", () => ({ API_URL: "http://api.test", serverFetch }));
const context = { params: Promise.resolve({ token: "test-unsubscribe-token" }) };
const request = new Request("http://localhost/unsubscribe/test-unsubscribe-token");
beforeEach(() => {
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("STEWARD_PUBLIC_DESIGN", "quiet");
});
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });

describe("unsubscribe utility contract", () => {
  it.each([GET, POST])("applies suppression once and escapes the recorded address", async (handler) => {
    serverFetch.mockResolvedValue(Response.json({ channel: "email", address: '<img src=x onerror="bad()">@example.test' }));
    const response = await handler(request, context);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const html = await response.text();
    expect(html).toContain("You have been unsubscribed");
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("test-unsubscribe-token");
    expect(html).toContain("Transactional messages");
    expect(serverFetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(serverFetch.mock.calls[0]![1].body)).toEqual({ token: "test-unsubscribe-token" });
  });

  it.each(["invalid", "error", "unreachable"])("does not claim success for %s outcomes", async (reason) => {
    const setup = () => reason === "unreachable" ? serverFetch.mockRejectedValue(new Error("offline")) : serverFetch.mockResolvedValue(Response.json({ error: { code: reason === "invalid" ? "invalid_token" : "internal" } }, { status: 400 }));
    setup();
    const response = await GET(request, context);
    expect(response.status).toBe(400);
    const html = await response.text();
    expect(html).toContain("We could not unsubscribe you");
    expect(html).toContain("a human will remove you manually");
    expect(html).not.toContain("You have been unsubscribed");
    setup();
    const oneClick = await POST(request, context);
    expect(oneClick.status).toBe(400);
    expect(await oneClick.text()).toBe("");
  });

  it("retains the incumbent result in production with the opt-in present", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    serverFetch.mockResolvedValue(Response.json({ channel: "email", address: "recipient@example.test" }));
    expect(await (await GET(request, context)).text()).toContain("#f5f4ec");
  });
});
