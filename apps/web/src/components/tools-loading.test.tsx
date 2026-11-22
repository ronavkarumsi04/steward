import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Suspense } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ConnectionsPage from "@/app/app/c/[companyId]/integrations/page";
import McpPage from "@/app/app/c/[companyId]/mcp/page";
import BrowserPage from "@/app/app/c/[companyId]/browser/page";
import CodePage from "@/app/app/c/[companyId]/code/page";
import OrgConnectionsPage from "@/app/app/(shell)/org/[orgId]/integrations/page";
import ProvidersPage from "@/app/app/(shell)/org/[orgId]/providers/page";
import { QuietToolsLoading } from "./quiet-tools";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "localhost:3000" }) }));
vi.mock("@/lib/server", () => ({
  serverApi: async () => ({ get }),
  tryApi: (read: () => Promise<unknown>) => read(),
  requireMe: async () => ({ memberships: [{ organizationId: "org", role: "owner" }] }),
}));
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });

const companyProps = { params: Promise.resolve({ companyId: "company" }), searchParams: Promise.resolve({}) };
const orgProps = { params: Promise.resolve({ orgId: "org" }), searchParams: Promise.resolve({}) };
const routes = [
  { path: "c/[companyId]/integrations", page: () => ConnectionsPage(companyProps) },
  { path: "c/[companyId]/mcp", page: () => McpPage(companyProps) },
  { path: "c/[companyId]/browser", page: () => BrowserPage(companyProps) },
  { path: "c/[companyId]/code", page: () => CodePage(companyProps) },
  { path: "(shell)/org/[orgId]/integrations", page: () => OrgConnectionsPage(orgProps) },
  { path: "(shell)/org/[orgId]/providers", page: () => ProvidersPage(orgProps) },
];

function response(path: string) {
  if (path === "/companies/company") return { company: { organizationId: "org" }, role: "owner" };
  return { catalog: [], integrations: [], types: [], providers: [], models: [], usage: [], devices: [], sessions: [], defaultRepo: null };
}

describe.each(routes)("Tools loading: $path", ({ path, page }) => {
  it("inherits the parent boundary instead of replacing retained legacy content", () => {
    const loading = fileURLToPath(new URL(`../app/app/${path}/loading.tsx`, import.meta.url));
    expect(existsSync(loading)).toBe(false);
  });

  it.each(["legacy", ""])("keeps shell-off rendering pending until API data is ready (%s)", async shell => {
    vi.stubEnv("STEWARD_WORKSPACE_SHELL", shell);
    vi.stubEnv("VERCEL_ENV", "production");
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    get.mockImplementation(async (url: string) => { await gate; return response(url); });
    let resolved = false;
    const pending = page().then(value => { resolved = true; return value; });
    await vi.waitFor(() => expect(get).toHaveBeenCalled());
    expect(resolved).toBe(false);
    release();
    const result = await pending;
    expect(result.type).not.toBe(Suspense);
  });

  it("keeps a page-local loading boundary only for Quiet", async () => {
    vi.stubEnv("STEWARD_WORKSPACE_SHELL", "quiet");
    const result = await page();
    expect(result.type).toBe(Suspense);
    expect(result.props.fallback.type).toBe(QuietToolsLoading);
    expect(get).not.toHaveBeenCalled();
  });
});
