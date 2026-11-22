import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cloneElement, Suspense, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import ConnectionsPage from "@/app/app/c/[companyId]/integrations/page";
import McpPage from "@/app/app/c/[companyId]/mcp/page";
import BrowserPage from "@/app/app/c/[companyId]/browser/page";
import CodePage from "@/app/app/c/[companyId]/code/page";
import OrgConnectionsPage from "@/app/app/(shell)/org/[orgId]/integrations/page";
import ProvidersPage from "@/app/app/(shell)/org/[orgId]/providers/page";
import { QuietToolsFrame, QuietToolsLoading } from "./quiet-tools";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "localhost:3000" }) }));
vi.mock("@/lib/server", () => ({
  serverApi: async () => ({ get }),
  tryApi: (read: () => Promise<unknown>) => read(),
  requireMe: async () => ({ memberships: [
    { organizationId: "other-org", name: "Other organization", role: "owner" },
    { organizationId: "org", name: "Active organization", role: "owner" },
  ] }),
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

async function loadedContent(node: ReactElement): Promise<ReactElement> {
  if (node.type === QuietToolsFrame) return cloneElement(node as ReactElement<{ children: null }>, { children: null });
  if (typeof node.type === "function") {
    return loadedContent(await (node.type as (props: unknown) => ReactElement | Promise<ReactElement>)(node.props));
  }
  return node;
}

function chrome(node: ReactElement) {
  const markup = renderToStaticMarkup(node);
  return [...markup.matchAll(/<(header|nav) class="(?:quiet-page-heading|quiet-organization-nav)"[^>]*>[\s\S]*?<\/\1>/g)].map(match => match[0]);
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

  it("keeps destination headings, scope and organization navigation identical while loading", async () => {
    vi.stubEnv("STEWARD_WORKSPACE_SHELL", "quiet");
    get.mockImplementation(async (url: string) => response(url));
    const boundary = await page();
    const fallback = boundary.props.fallback;
    const content = await loadedContent(boundary.props.children);
    const loadingChrome = chrome(fallback);
    expect(loadingChrome.length).toBeGreaterThan(0);
    expect(loadingChrome).toEqual(chrome(content));
    expect(renderToStaticMarkup(fallback)).not.toContain(">Loading tools</h1>");
  });
});

describe.each(routes.filter(route => route.path.startsWith("(shell)/org/")))("Organization identity: $path", ({ page }) => {
  it.each([false, true])("names the active organization before Tools resolve and retains it in loaded/error chrome (unavailable: %s)", async unavailable => {
    vi.stubEnv("STEWARD_WORKSPACE_SHELL", "quiet");
    if (unavailable) get.mockRejectedValue(new Error("upstream unavailable"));
    else get.mockImplementation(async (url: string) => response(url));
    const boundary = await page();
    expect(get).not.toHaveBeenCalled();
    const loadingChrome = chrome(boundary.props.fallback);
    expect(loadingChrome.join("")).toContain("Active organization · Shared across");
    expect(loadingChrome.join("")).not.toContain("Other organization");
    expect(loadingChrome).toEqual(chrome(await loadedContent(boundary.props.children)));
  });
});
