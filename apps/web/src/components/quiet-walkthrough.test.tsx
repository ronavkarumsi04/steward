import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { BrowserWorkspaceRead, CodeWorkspaceRead, StewardEvent, WorkflowWorkspaceRead } from "@/lib/types";
import { QuietSpecialistProvider } from "./quiet-specialist-context";
import { ActivityCenter } from "./activity-center";
import { WorkflowStudio } from "./workflow-studio";
import { CodeWorkspace } from "./code-workspace";
import { BrowserWorkspace } from "./browser-workspace";
import { AuthForm } from "./auth-form";
import { QuietHome } from "./quiet-home";
import { quietPublicEnabled } from "@/lib/public-design";
import { landingStoryEnabled } from "@/lib/landing-story";
import { describeWorkflow } from "@steward/core";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/use-events", () => ({ useLiveEvents: (_id: string, options: { initial?: StewardEvent[] }) => ({ events: options.initial ?? [], connected: true }) }));
const html = (node: React.ReactNode) => renderToStaticMarkup(node);
const quiet = (node: React.ReactNode) => createElement(QuietSpecialistProvider, { surface: "workflows", children: node });
const workspace = {
  workflows: [{ id: "w1", name: "Weekly planning", enabled: false, nodes: [
    { id: "t1", kind: "trigger", source: "schedule", kinds: [], cron: "0 10 * * 1", timezone: "UTC" },
    { id: "a1", kind: "agent", agentId: "agent-1", instruction: "Plan the week" },
  ], revision: 0, publishedAt: null, updatedAt: "2026-01-01T00:00:00Z", draftIsLive: false, liveCount: 0, problems: [], broken: [], sentences: [], readings: [], staleTargets: [] }],
  agents: [{ id: "agent-1", name: "Researcher", enabled: true }], projects: [], canManage: true, engine: true,
  catalog: { signalKinds: [], eventTypes: [], severities: [], limits: { nameChars: 120, instructionChars: 2000 } },
} as unknown as WorkflowWorkspaceRead;

describe("Quiet walkthrough regressions", () => {
  it("keeps legacy workflow headings and controls but gives Quiet a readable unpublished drawing", () => {
    const node = createElement(WorkflowStudio, { companyId: "company", initial: workspace });
    expect(html(node)).toContain('data-testid="workflow-toggle"');
    expect(html(node)).toContain("0 10 * * 1 UTC");
    const result = html(quiet(node));
    expect(result).toContain("Saved workflows");
    expect(result).toContain("At 10:00, only on Monday · UTC");
    expect(result).toContain("Drawn, not published");
    expect(result).not.toContain('data-testid="workflow-toggle"');
    expect(result).not.toContain('pill-warn">Paused');
  });
  it("keeps published incomplete work controllable without claiming it was never published", () => {
    for (const enabled of [true, false]) {
      const initial: WorkflowWorkspaceRead = {
        ...workspace,
        workflows: workspace.workflows.map((workflow) => ({
          ...workflow,
          enabled,
          publishedAt: "2026-01-01T00:00:00Z",
          liveCount: 0,
          nodes: workflow.nodes.map((node) => node.kind === "agent" ? { ...node, instruction: "" } : node),
          problems: [{ code: "instruction_missing", where: "a1", message: "Add an instruction." }],
        })),
      };
      const node = createElement(WorkflowStudio, { companyId: "company", initial });
      const result = html(quiet(node));
      expect(result).toContain(`data-testid="workflow-toggle">${enabled ? "Pause" : "Resume"}</button>`);
      expect(result).toContain("This workflow has been published");
      expect(result).not.toContain("this drawing has not been published");
      expect(result).not.toContain("0 live row(s)");
      expect(html(node)).toContain("Nothing is running yet: this drawing has not been published.");
    }
  });
  it("explains the server's schedule sentence in Quiet without changing the legacy paragraph", () => {
    for (const canManage of [true, false]) {
      for (const [cron, timezone, rhythm] of [
        ["0 10 * * 1", "UTC", "At 10:00, only on Monday · UTC"],
        ["30 9 * * *", "America/New_York", "At 09:30 · America/New_York"],
      ]) {
        const initial: WorkflowWorkspaceRead = {
          ...workspace,
          canManage,
          workflows: workspace.workflows.map((workflow) => {
            const nodes = workflow.nodes.map((node) => node.kind === "trigger" ? { ...node, cron, timezone } : node);
            return { ...workflow, nodes, sentences: describeWorkflow(nodes, { agents: workspace.agents, projects: workspace.projects }) };
          }),
        };
        const node = createElement(WorkflowStudio, { companyId: "company", initial });
        const sentences = (markup: string) => markup.match(/data-testid="workflow-sentences">(.*?)<\/ul>/)?.[1];
        const original = initial.workflows[0]!.sentences[0]!;
        expect(sentences(html(node))).toBe(`<li class="text-sm">${original}</li>`);
        const result = sentences(html(quiet(node)));
        expect(result).toBe(`<li class="text-sm">${rhythm}: Researcher starts a run: “Plan the week”. A tick that arrives while the last run is still going is skipped.</li>`);
        expect(result).not.toContain(cron);
      }
    }
  });
  it("preserves raw activity in the inspector, not in the Quiet row heading", () => {
    const event: StewardEvent = { id: "event-1", companyId: "company", seq: 1, type: "run.status", createdAt: "2026-01-01T00:00:00Z", actor: { type: "agent", agentId: "agent-1" }, payload: { status: "waiting_approval" }, correlation: {} };
    const node = createElement(ActivityCenter, { companyId: "company", initial: [event], projects: [], agents: [{ id: "agent-1", name: "Researcher" }] });
    expect(html(node)).toContain(">run.status</span>");
    const result = html(quiet(node));
    const row = result.slice(result.indexOf('data-event-type="run.status"'));
    const summary = row.slice(0, row.indexOf("<details"));
    expect(summary).toContain("Run updated");
    expect(summary).toContain("Waiting for approval");
    expect(summary).toContain("Researcher");
    expect(summary).not.toContain(">run.status</span>");
    expect(summary).not.toContain("agent-1");
    expect(row.slice(row.indexOf("<details"))).toContain("run.status");
  });
  it("uses the Quiet Connections name and preserves the scoped destination", () => {
    const initial = { connected: false, agents: [] } as unknown as CodeWorkspaceRead;
    const props = { companyId: "company", initial, initialRepo: null, initialRef: null, initialTree: null, initialBranches: null };
    expect(html(createElement(CodeWorkspace, props))).toContain(">Integrations</a>");
    const result = html(createElement(CodeWorkspace, { ...props, quiet: true }));
    expect(result).toContain('href="/app/c/company/integrations">Connections</a>');
    expect(result).not.toContain(">Integrations</a>");
  });
  it("does not call an empty browser live just because the event stream is connected", () => {
    const initial = { available: true, canControl: true, agents: [], sessions: [] } as unknown as BrowserWorkspaceRead;
    const props = { companyId: "company", initial, initialSession: null };
    expect(html(createElement(BrowserWorkspace, props))).toContain(">Live</span>");
    expect(html(createElement(BrowserWorkspace, { ...props, quiet: true }))).not.toContain(">Live</span>");
  });
  it("links Quiet home to the existing story without changing the access destination", () => {
    const result = html(createElement(QuietHome, { entry: "/login", label: "Sign in", note: "Invitation only", story: false, storyAvailable: true }));
    expect(result).toContain('href="/?experience=story"');
    expect(result).toContain("Explore the 3D story");
    expect(result).toContain('href="/pilot/waitlist"');
    expect(result).toContain('href="#how"');
  });
  it("does not offer a dead story link when only the Quiet public preview is enabled", () => {
    const env = { NODE_ENV: "production", STEWARD_PUBLIC_DESIGN: "quiet", STEWARD_PUBLIC_PREVIEW: "true" };
    expect(quietPublicEnabled(env)).toBe(true);
    expect(landingStoryEnabled("story", env)).toBe(false);
    const result = html(createElement(QuietHome, { entry: "/login", label: "Sign in", note: "Invitation only", story: false, storyAvailable: landingStoryEnabled("story", env) }));
    expect(result).not.toContain('href="/?experience=story"');
    expect(result).toContain('href="#how"');
  });
  it("labels Quiet access honestly without changing legacy copy or the signup route", () => {
    expect(html(createElement(AuthForm, { mode: "login" }))).toContain(">Register</a>");
    const result = html(createElement(AuthForm, { mode: "login", quiet: true }));
    expect(result).toContain('href="/register">Request access</a>');
    expect(result).not.toContain(">Register</a>");
  });
});
