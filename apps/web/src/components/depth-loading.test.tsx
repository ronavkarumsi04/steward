import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Suspense } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AgentsPage from "@/app/app/c/[companyId]/agents/page";
import GraphPage from "@/app/app/c/[companyId]/graph/page";
import KnowledgePage from "@/app/app/c/[companyId]/knowledge/page";
import MembersPage from "@/app/app/(shell)/org/[orgId]/members/page";
import { AgentsPanel } from "./agents-panel";
import { KnowledgeGraph } from "./knowledge-graph";
import { KnowledgePanel } from "./knowledge";
import { MembersPanel } from "./members-panel";
import { DepthLoading } from "./quiet-depth";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/server", () => ({
  serverApi: async () => ({ get }),
  getLocale: async () => "en",
  requireMe: async () => ({
    user: { id: "owner" },
    memberships: [{ organizationId: "north", name: "North", role: "owner" }],
  }),
  tryApi: async <T,>(read: () => Promise<T>) => read(),
}));
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });

const companyParams = () => Promise.resolve({ companyId: "north" });
const routes = [
  { name: "agents", segment: "c/[companyId]/agents", panel: AgentsPanel,
    render: () => AgentsPage({ params: companyParams() }) },
  { name: "graph", segment: "c/[companyId]/graph", panel: KnowledgeGraph,
    render: () => GraphPage({ params: companyParams() }) },
  { name: "knowledge", segment: "c/[companyId]/knowledge", panel: KnowledgePanel,
    render: () => KnowledgePage({ params: companyParams(), searchParams: Promise.resolve({ tab: "memory" }) }) },
  { name: "members", segment: "(shell)/org/[orgId]/members", panel: MembersPanel,
    render: () => MembersPage({ params: Promise.resolve({ orgId: "north" }) }) },
];

describe.each(routes)("$name loading boundary", ({ segment, panel, render }) => {
  it("leaves shell-off loading to the incumbent parent boundary", () => {
    // Next installs a route Suspense boundary whenever this file exists, even
    // if its component returns null or PageSkeleton when Quiet is off. That
    // changes pending Link navigation as well as the hard-load fallback.
    const loadingFile = new URL(`../app/app/${segment}/loading.tsx`, import.meta.url);
    expect(existsSync(fileURLToPath(loadingFile))).toBe(false);
  });

  it.each([undefined, "legacy", "unexpected"])("preserves the legacy page without a local fallback for %s", async (shell) => {
    vi.stubEnv("STEWARD_WORKSPACE_SHELL", shell);
    vi.stubEnv("VERCEL_ENV", "production");
    get.mockResolvedValue({
      agents: [], schedules: [], defaultAllowlists: {}, company: { settings: {} },
      documents: [], decisions: [], memories: [], pending: [], artifacts: [], projects: [],
      members: [], invitations: [], role: "owner",
    });
    const page = await render();
    expect(page.type).not.toBe(Suspense);
    expect(page.props.children[1].type).toBe(panel);
    expect(page.props.children[1].props.quiet).toBeUndefined();
    expect(get).toHaveBeenCalled();
  });

  it.each([["quiet", "production"], [undefined, "preview"]])("places only Quiet data reads behind local Suspense (%s, %s)", async (shell, deployment) => {
    vi.stubEnv("STEWARD_WORKSPACE_SHELL", shell);
    vi.stubEnv("VERCEL_ENV", deployment);
    const page = await render();
    expect(page.type).toBe(Suspense);
    expect(page.props.fallback.type).toBe(DepthLoading);
    expect(page.props.fallback.props.locale).toBe("en");
    expect(get).not.toHaveBeenCalled();
  });
});
