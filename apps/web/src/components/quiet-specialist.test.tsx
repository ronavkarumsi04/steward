import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { specialistPage, SpecialistLoading } from "./quiet-specialist";
import { QuietSpecialistProvider } from "./quiet-specialist-context";
import { ProjectWorkspace } from "./project-workspace";
import { FinanceCenter } from "./finance-center";
import { GrowthPipeline } from "./growth-pipeline";
import { QuietWorkNavigation } from "./quiet-work-navigation";
import { WORKSPACE_ROUTES } from "@/lib/workspace-navigation";
import WorkspaceLoading from "@/app/app/loading";
import type { GrowthSnapshot } from "@/lib/types";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/server", () => ({ getLocale: async () => "en" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), notFound: () => { throw new Error("NEXT_HTTP_ERROR_FALLBACK;404"); } }));
afterEach(() => vi.unstubAllEnvs());
const html = (element: React.ReactNode) => renderToStaticMarkup(element);

describe("specialist rollout boundary", () => {
  it.each([undefined, "legacy", "unknown"])("keeps the production incumbent unchanged for %s", async (value) => {
    vi.stubEnv("STEWARD_WORKSPACE_SHELL", value);
    vi.stubEnv("VERCEL_ENV", "production");
    const original = createElement("p", null, "Existing company view");
    expect(await specialistPage("projects", async () => original)).toBe(original);
    expect(html(await SpecialistLoading())).toBe(html(createElement(WorkspaceLoading)));
    await expect(specialistPage("projects", async () => { throw new ApiError(403, "forbidden", "old error"); })).rejects.toThrow("old error");
  });
  it.each([
    ["projects", () => import("@/app/app/c/[companyId]/projects/loading")],
    ["chat", () => import("@/app/app/c/[companyId]/chat/loading")],
    ["activity", () => import("@/app/app/c/[companyId]/activity/loading")],
    ["workflows", () => import("@/app/app/c/[companyId]/workflows/loading")],
    ["signals", () => import("@/app/app/c/[companyId]/signals/loading")],
    ["growth", () => import("@/app/app/c/[companyId]/growth/loading")],
    ["finance", () => import("@/app/app/c/[companyId]/finance/loading")],
    ["site", () => import("@/app/app/c/[companyId]/site/loading")],
  ] as const)("retains the workspace skeleton at the shell-off %s boundary", async (_surface, load) => {
    vi.stubEnv("STEWARD_WORKSPACE_SHELL", "legacy");
    vi.stubEnv("VERCEL_ENV", "production");
    const { default: Loading } = await load();
    expect(html(await Loading())).toBe(html(createElement(WorkspaceLoading)));
  });
  it("only wraps the real result when Quiet is selected", async () => {
    vi.stubEnv("STEWARD_WORKSPACE_SHELL", "quiet");
    const render = vi.fn(async () => createElement("p", null, "Actual API output"));
    expect(html(await specialistPage("growth", render))).toContain('data-surface="growth"');
    expect(render).toHaveBeenCalledTimes(1);
    expect(html(await SpecialistLoading())).toContain('aria-busy="true"');
  });
  it.each([403, 503])("shows safe %s recovery instead of an empty dataset or API body", async (status) => {
    vi.stubEnv("STEWARD_WORKSPACE_SHELL", "quiet");
    const result = html(await specialistPage("finance", async () => { throw new ApiError(status, "private", "sensitive upstream body"); }));
    expect(result).toContain(status === 403 ? "Access is limited" : "This view is unavailable");
    expect(result).not.toContain("sensitive upstream body");
    expect(result.includes("Try again")).toBe(status !== 403);
  });
  it("preserves not-found boundaries and unexpected failures", async () => {
    vi.stubEnv("STEWARD_WORKSPACE_SHELL", "quiet");
    await expect(specialistPage("project", async () => { throw new ApiError(404, "missing", "foreign company"); })).rejects.toThrow("404");
    await expect(specialistPage("project", async () => { throw new Error("NEXT_REDIRECT"); })).rejects.toThrow("NEXT_REDIRECT");
    expect(html(await specialistPage("projects", async () => { throw new TypeError("fetch failed"); }))).toContain("Try again");
  });
});

describe("specialist presentation parity", () => {
  it("keeps the incumbent creation form open but discloses it in Quiet", () => {
    const project = createElement(ProjectWorkspace, { companyId: "real-company", initial: [] });
    expect(html(project)).not.toContain("<details");
    const quiet = html(createElement(QuietSpecialistProvider, { surface: "projects", children: project }));
    expect(quiet).toContain('<details class="q-specialist-create">');
    expect(quiet).toContain('name="objective"');
    expect(quiet).toContain("No active projects");
  });
  it("never invents finance zeros when no budgets or usage exist", () => {
    const props = { companyId: "real-company", budgets: [], ledger: [], aiUsage: [] };
    expect(html(createElement(FinanceCenter, props))).toContain("$0.0000");
    const quiet = html(createElement(FinanceCenter, { ...props, quiet: true }));
    expect(quiet.match(/Not available/g)).toHaveLength(4);
    expect(quiet).not.toContain("$0.0000");
  });
  it("does not turn absent lead values into a zero pipeline", () => {
    const snapshot = { leads: [], campaigns: [], outbound: [], outbox: [] } as unknown as GrowthSnapshot;
    const growth = createElement(GrowthPipeline, { companyId: "real-company", initial: snapshot });
    expect(html(growth)).not.toContain("Not available");
    expect(html(createElement(QuietSpecialistProvider, { surface: "growth", children: growth })).match(/Not available/g)).toHaveLength(2);
  });
  it("keeps all grouped work and business URLs available in the phone disclosure", () => {
    const current = WORKSPACE_ROUTES.find((route) => route.suffix === "/finance")!;
    const result = html(createElement(QuietWorkNavigation, { base: "/app/c/company", current }));
    const mobile = result.slice(result.indexOf('<details class="q-work-navigation-mobile"'));
    expect(mobile).toContain("<strong>Finance</strong>");
    for (const route of WORKSPACE_ROUTES.filter((route) => route.group === "work")) expect(mobile).toContain(`href="/app/c/company${route.suffix}"`);
    expect(mobile).toContain('aria-current="page"');
    expect(mobile).not.toContain("<select");
  });
});
