import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, type ApiClient } from "@/lib/api";
import { QuietTeam } from "./quiet-team";
import { QuietKnowledge } from "./quiet-knowledge";
import { QuietAgentRoster } from "./quiet-agent-roster";
import { MembersPanel } from "./members-panel";
import AgentsPage from "@/app/app/c/[companyId]/agents/page";
import KnowledgePage from "@/app/app/c/[companyId]/knowledge/page";
import { AgentsPanel } from "./agents-panel";
import { KnowledgePanel } from "./knowledge";
import type { Agent, Run } from "@/lib/types";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/server", () => ({ serverApi: async () => ({ get }), getLocale: async () => "en" }));
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });
const api = { get } as unknown as ApiClient;
const agent: Agent = { id: "a1", kind: "research", name: "Research", description: "Sources", systemPrompt: "Use sources", enabled: true, toolAllowlist: ["web.search"], routingPolicy: {}, maxIterations: 20, budgetUsdPerRun: null };
const markup = (node: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(node);

describe("Quiet depth boundaries", () => {
  it("shows permission failure rather than a fictional empty roster", async () => {
    get.mockRejectedValue(new ApiError(403, "forbidden", "private server detail"));
    const html = markup(await QuietTeam({ companyId: "north", api, locale: "en" }));
    expect(html).toContain("Your membership does not allow access");
    expect(html).not.toContain("private server detail");
    expect(html).not.toContain("No agents in this view");
    expect(get.mock.calls.every(([path]) => path.startsWith("/companies/north/" ) || path === "/companies/north")).toBe(true);
  });
  it("does not call a missing schedule read an empty schedule list", async () => {
    get.mockImplementation(async (path: string) => {
      if (path.endsWith("/agents")) return { agents: [], defaultAllowlists: {} };
      if (path.includes("/runs?")) return { runs: [] };
      if (path.endsWith("/schedules")) throw new Error("offline");
      return { role: "viewer", company: { settings: {} } };
    });
    const html = markup(await QuietTeam({ companyId: "north", api, locale: "en" }));
    expect(html).toContain("could not be loaded");
    expect(html).not.toContain("No schedules yet");
    expect(html).toContain("No agents in this view");
  });
  it("fails knowledge closed if membership or scope context is missing", async () => {
    get.mockRejectedValue(new Error("database secret"));
    const html = markup(await QuietKnowledge({ companyId: "north", api, locale: "en", tab: "memory" }));
    expect(html).toContain("could not be loaded");
    expect(html).not.toContain("/companies/");
    expect(html).not.toContain("database secret");
    expect(html).not.toContain("No memories");
    expect(html).toContain("?tab=memory");
  });
  it("labels absence of cost and activity honestly, while retaining real zero limits", () => {
    const props = { companyId: "north", agents: [agent], runs: null, overview: null, busy: false, editable: false, onEdit: vi.fn(), onToggle: vi.fn() };
    const html = markup(createElement(QuietAgentRoster, props));
    expect(html).toContain("Not available");
    expect(html).not.toContain("$0.00");
    expect(html).toContain("Enabled is configuration, not worker health");
    expect(markup(createElement(QuietAgentRoster, { ...props, agents: [{ ...agent, budgetUsdPerRun: "0" }] }))).toContain("$0.00");
  });
  it("shows the latest real run with its state, not a made-up healthy worker", () => {
    const runs = [{ id: "r1", agentId: agent.id, intent: "Source report", status: "failed", createdAt: "2026-11-22T00:00:00Z", error: "Source unavailable" }] as Run[];
    const html = markup(createElement(QuietAgentRoster, { companyId: "north", agents: [agent], runs, overview: null, busy: false, editable: false, onEdit: vi.fn(), onToggle: vi.fn() }));
    expect(html).toContain("/runs/r1"); expect(html).toContain("Source unavailable");
  });
  it("keeps human members distinct and forbids viewer invitation and role controls", () => {
    const html = markup(createElement(MembersPanel, { quiet: true, orgId: "org-north", members: [{ userId: "me", name: "Reader", email: "reader@example.test", role: "viewer", joinedAt: "2026-11-22T00:00:00Z" }], invitations: [], me: "me", myRole: "viewer" }));
    expect(html).toContain('aria-label="Role: reader@example.test"');
    expect(html).toMatch(/<select[^>]*disabled=""/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Invite/);
    expect(html).toContain("Leave");
  });
  it.each([undefined, "legacy", "unexpected"])("preserves incumbent panels with rollout value %s", async (flag) => {
    vi.stubEnv("STEWARD_WORKSPACE_SHELL", flag);
    vi.stubEnv("VERCEL_ENV", "production");
    get.mockResolvedValue({ agents: [], schedules: [], defaultAllowlists: {}, company: { settings: {} }, documents: [], decisions: [], memories: [], pending: [], artifacts: [], projects: [], role: "viewer" });
    const agents = await AgentsPage({ params: Promise.resolve({ companyId: "north" }) });
    const knowledge = await KnowledgePage({ params: Promise.resolve({ companyId: "north" }), searchParams: Promise.resolve({ tab: "memory" }) });
    expect(agents.props.children[1].type).toBe(AgentsPanel);
    expect(knowledge.props.children[1].type).toBe(KnowledgePanel);
    expect(agents.props.children[1].props.quiet).toBeUndefined();
    expect(knowledge.props.children[1].props.quiet).toBeUndefined();
  });
});
