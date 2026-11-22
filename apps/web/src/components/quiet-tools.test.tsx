import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import type { CompanyOverview, Integration, IntegrationCatalogEntry, ProviderCredential } from "@/lib/types";
import { IntegrationsPanel } from "./integrations-panel";
import { ProvidersPanel } from "./providers-panel";
import { QuietConnections, QuietProviders } from "./quiet-tools-pages";
import { QuietToolsFrame, ToolsReadError } from "./quiet-tools";
import ConnectionsPage from "@/app/app/c/[companyId]/integrations/page";
import McpPage from "@/app/app/c/[companyId]/mcp/page";
import BrowserPage from "@/app/app/c/[companyId]/browser/page";
import CodePage from "@/app/app/c/[companyId]/code/page";
import OrgConnectionsPage from "@/app/app/(shell)/org/[orgId]/integrations/page";
import ProvidersPage from "@/app/app/(shell)/org/[orgId]/providers/page";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "localhost:3000" }) }));
vi.mock("@/lib/server", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/server")>(), serverApi: async () => ({ get }), requireMe: async () => ({ user: { id: "user" }, memberships: [{ organizationId: "org", name: "Test organization", role: "viewer" }] }) }));
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });

const overview = { company: { id: "company", organizationId: "org", name: "Test company" }, role: "owner" } as CompanyOverview;
const entry: IntegrationCatalogEntry = { id: "github", name: "GitHub", category: "code", status: "implemented", authKind: "token", oauth: false, fields: [{ key: "token", label: "Token", secret: true }], actions: [], docsUrl: "https://docs.github.com" };
const connection: Integration = { id: "inherited", companyId: null, type: "github", label: "Test connection", status: "needs_reauth", authKind: "token", externalAccountId: "test-account", scopes: ["repo"], createdAt: "2026-01-01T00:00:00Z", lastCheckedAt: null, lastError: "SECRET_SHOULD_NOT_RENDER", webhookUrl: "https://example.test/SECRET_WEBHOOK", definition: entry };
const html = (node: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(node);

describe("Quiet connections", () => {
  it("keeps inherited connections read-only and does not echo upstream errors or webhook credentials", () => {
    const output = html(createElement(IntegrationsPanel, { quiet: true, orgId: "org", companyId: "company", catalog: [], integrations: [connection], isAdmin: true }));
    expect(output).toContain("Managed at organization level");
    expect(output).toContain("test-account");
    expect(output).toContain("repo");
    for (const forbidden of ["Disconnect</button>", "Copy webhook", "SECRET_SHOULD_NOT_RENDER", "SECRET_WEBHOOK"]) expect(output).not.toContain(forbidden);
  });
  it("preserves company controls but hides webhook URLs and disables writes for viewers", () => {
    const output = html(createElement(IntegrationsPanel, { quiet: true, orgId: "org", companyId: "company", catalog: [entry], integrations: [{ ...connection, companyId: "company" }], isAdmin: false }));
    expect(output).toContain("Copy webhook");
    expect(output).not.toContain("SECRET_WEBHOOK");
    expect(output).not.toContain("Disconnect</button>");
    expect(output).toMatch(/disabled="">Connect/);
  });
  it("uses the company's organization and scoped endpoint; a failed catalog does not hide saved connections", async () => {
    get.mockImplementation(async (path: string) => {
      if (path === "/integrations/catalog") throw new Error("SECRET_SHOULD_NOT_RENDER");
      return { integrations: [connection] };
    });
    const output = html(await QuietConnections({ api: { get } as never, orgId: "org", companyId: "company", overview }));
    expect(get).toHaveBeenCalledWith("/orgs/org/integrations?companyId=company");
    expect(output).toContain("Test connection");
    expect(output).toContain("Could not load available services");
    expect(output).not.toContain("SECRET_SHOULD_NOT_RENDER");
  });
  it("does not turn an unavailable connection list into an empty success or an OAuth query into proof of connection", async () => {
    get.mockRejectedValue(new ApiError(403, "forbidden", "SECRET_SHOULD_NOT_RENDER"));
    const output = html(await QuietConnections({ api: { get } as never, orgId: "org", oauth: { connected: "UNTRUSTED_PROVIDER", error: "SECRET_CALLBACK" } }));
    expect(output).toContain("Connections unavailable");
    expect(output).toContain("Authorization did not complete");
    for (const forbidden of ["Nothing connected", "SECRET_CALLBACK", "UNTRUSTED_PROVIDER", "SECRET_SHOULD_NOT_RENDER"]) expect(output).not.toContain(forbidden);
  });
});

describe("Quiet providers and safe failures", () => {
  it("does not invent zero spend for an empty ledger or redisplay credentials/errors", () => {
    const provider = { id: "provider", label: "Test provider", providerType: "openai", secretLast4: "S3CR", authMethod: "api_key", status: "error", enabled: true, priority: 100, lastError: "SECRET_ERROR" } as ProviderCredential;
    const output = html(createElement(ProvidersPanel, { quiet: true, orgId: "org", providers: [provider], types: [], models: [], usage: [], devices: [], isAdmin: false }));
    expect(output).toContain("Not available");
    expect(output).toContain("Credential stored");
    for (const forbidden of ["$0.0000", "S3CR", "SECRET_ERROR", "Add and test"]) expect(output).not.toContain(forbidden);
  });
  it("retains providers when optional model, ledger and companion reads fail", async () => {
    get.mockImplementation(async (path: string) => {
      if (path.endsWith("/providers")) return { providers: [] };
      if (path === "/providers/types") return { types: [] };
      throw new Error("SECRET_FAILURE");
    });
    const output = html(await QuietProviders({ api: { get } as never, orgId: "org", membership: { organizationId: "org", name: "Test org", slug: "test", role: "viewer" }, serverUrl: "http://localhost:3000/api" }));
    expect(output).toContain("Configured providers");
    expect(output).toContain("Read-only");
    expect(output).toContain("Usage · last 30 days · Not available");
    expect(output).not.toContain("No AI calls recorded yet");
    expect(output).not.toContain("SECRET_FAILURE");
  });
  it.each([403, 404, 500])("renders a safe recovery without sensitive payloads for status %s", status => {
    const output = html(createElement(ToolsReadError, { error: new ApiError(status, "error", "SECRET_PAYLOAD"), subject: "Tools", href: "/app" }));
    expect(output).toContain("Reload page");
    expect(output).not.toContain("SECRET_PAYLOAD");
  });
});

describe("route rollout boundary", () => {
  it.each(["legacy", "unexpected", ""]) ("keeps company connections on the incumbent screen for %s", async value => {
    vi.stubEnv("STEWARD_WORKSPACE_SHELL", value);
    vi.stubEnv("VERCEL_ENV", "production");
    get.mockImplementation(async (path: string) => path === "/companies/company" ? overview : path === "/integrations/catalog" ? { catalog: [] } : { integrations: [] });
    const page = await ConnectionsPage({ params: Promise.resolve({ companyId: "company" }) });
    expect(page.type).not.toBe(QuietConnections);
    expect(html(page)).not.toContain("quiet-tools");
  });
  it("routes company and organization connections and providers through Quiet only when opted in", async () => {
    vi.stubEnv("STEWARD_WORKSPACE_SHELL", "quiet");
    get.mockResolvedValue(overview);
    const company = await ConnectionsPage({ params: Promise.resolve({ companyId: "company" }) });
    expect(company.type).toBe(QuietConnections);
    expect(company.props.orgId).toBe("org");
    const org = await OrgConnectionsPage({ params: Promise.resolve({ orgId: "other-org" }), searchParams: Promise.resolve({}) });
    expect(org.type).toBe(QuietConnections);
    expect(org.props.membership).toBeUndefined();
    const providers = await ProvidersPage({ params: Promise.resolve({ orgId: "org" }) });
    expect(providers.type).toBe(QuietProviders);
  });
  it("uses safe, scoped failure views for MCP, browser and code instead of disguising outages as empty lists", async () => {
    vi.stubEnv("STEWARD_WORKSPACE_SHELL", "quiet");
    get.mockRejectedValue(new ApiError(503, "offline", "SECRET_OUTAGE"));
    const pages = [await McpPage({ params: Promise.resolve({ companyId: "company" }) }), await BrowserPage({ params: Promise.resolve({ companyId: "company" }), searchParams: Promise.resolve({}) }), await CodePage({ params: Promise.resolve({ companyId: "company" }), searchParams: Promise.resolve({}) })];
    for (const page of pages) {
      expect(page.type).toBe(QuietToolsFrame);
      expect(html(page)).toContain("Reload page");
      expect(html(page)).not.toContain("SECRET_OUTAGE");
    }
  });
});
