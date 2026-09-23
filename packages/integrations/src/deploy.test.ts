import { afterEach, describe, expect, it, vi } from "vitest";
import { VercelProvider } from "./deploy.js";

afterEach(() => vi.unstubAllGlobals());

describe("Vercel project domains", () => {
  it("adds a domain with the current project-domain API and preserves verification challenges", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      name: "app.example.com",
      apexName: "example.com",
      projectId: "prj_123",
      verified: false,
      verification: [{ type: "TXT", domain: "_vercel.example.com", value: "vc-domain-verify=abc", reason: "Pending verification" }],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const provider = new VercelProvider({ fields: { token: "secret-token", teamId: "team_123" } });
    const domain = await provider.addDomain("prj_123", "app.example.com");

    expect(domain.verified).toBe(false);
    expect(domain.verification?.[0]?.type).toBe("TXT");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.vercel.com/v10/projects/prj_123/domains?teamId=team_123");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ authorization: "Bearer secret-token" });
    expect(JSON.parse(String(init.body))).toEqual({ name: "app.example.com" });
  });

  it("lists and verifies project domains", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ domains: [{ name: "example.com", projectId: "prj_123", verified: false }], pagination: { count: 1 } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ name: "example.com", apexName: "example.com", projectId: "prj_123", verified: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new VercelProvider({ fields: { token: "secret-token" } });

    expect(await provider.listDomains("prj_123")).toEqual([expect.objectContaining({ name: "example.com", verified: false })]);
    expect((await provider.verifyDomain("prj_123", "example.com")).verified).toBe(true);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.vercel.com/v9/projects/prj_123/domains?limit=100");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://api.vercel.com/v9/projects/prj_123/domains/example.com/verify");
  });
});
