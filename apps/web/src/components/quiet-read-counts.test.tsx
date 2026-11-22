import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Approval, CompanyOverview, Run } from "@/lib/types";
import { QuietWork } from "./quiet-work";
import { QuietApprovals } from "./quiet-approvals";
import { QuietApprovalDetail } from "./quiet-approval-detail";
import { QuietOverview } from "./quiet-overview";
import { QuietRunDetail } from "./quiet-run-detail";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/app/c/company/runs", useSearchParams: () => new URLSearchParams() }));

const overview = { company: { id: "company", name: "Recorded workspace", autonomyLevel: 1, timezone: "UTC" }, role: "owner", agents: [], goals: [], budgets: [] } as unknown as CompanyOverview;
const run = { id: "run", agentId: "agent", taskId: null, status: "waiting_approval", costUsd: "0.000000", intent: "Check draft", createdAt: "2026-01-01T00:00:00Z", trigger: {} } as Run;
const approval: Approval = { id: "a", runId: run.id, taskId: null, agentId: run.agentId, action: "browser.act", reason: "external_write", risk: "LOW", dimension: "external_write", payload: { kind: "wait", ms: 500 }, status: "pending", expiresAt: "2099-01-01T00:00:00Z", createdAt: run.createdAt, affectedSystem: "browser", alternatives: [], estimatedCostUsd: null, resolution: null, resolvedAt: null, resolvedBy: null, workContext: { taskTitle: "Check draft", runIntent: null } };

describe("bounded Quiet page API reads (shell/auth reads excluded)", () => {
  for (const count of [1, 100]) {
    it(`loads ${count} zero-cost Runs in three reads, without fetching any run detail`, async () => {
      const get = vi.fn(async (path: string) => path.includes("/runs?") ? { runs: Array.from({ length: count }, (_, i) => ({ ...run, id: `run-${i}`, hasRecordedZeroCost: i % 2 === 0 })) } : path.endsWith("/agents") ? { agents: [] } : overview);
      const page = await QuietWork({ companyId: "company", kind: "runs", filters: {}, locale: "en", api: { get } as never });
      renderToStaticMarkup(page);
      expect(get).toHaveBeenCalledTimes(3);
      expect(get.mock.calls.filter(([path]) => /\/runs\/[^?]+/.test(path))).toHaveLength(0);
    });
    for (const oldApi of [false, true]) it(`loads ${count} Approvals in ${oldApi ? 3 : 1} reads on ${oldApi ? "old" : "new"} API`, async () => {
      const rows = Array.from({ length: count }, (_, i) => ({ ...approval, id: `a-${i}`, workContext: oldApi ? undefined : approval.workContext }));
      const get = vi.fn(async (path: string) => path.includes("/approvals?") ? { approvals: rows } : path.includes("/runs?") ? { runs: [run] } : { tasks: [] });
      const html = renderToStaticMarkup(await QuietApprovals({ companyId: "company", status: "pending", locale: "en", api: { get } as never }));
      expect(get).toHaveBeenCalledTimes(oldApi ? 3 : 1);
      expect(html).toContain("Check draft");
      expect(get.mock.calls.some(([path]) => /\/(tasks|runs)\/[^?]+/.test(path))).toBe(false);
    });
  }
  it("does not turn a refused list into an empty success or attempt per-row fallback", async () => {
    const get = vi.fn(async () => { throw new Error("429"); });
    const html = renderToStaticMarkup(await QuietApprovals({ companyId: "company", status: "pending", locale: "en", api: { get } as never }));
    expect(get).toHaveBeenCalledTimes(1);
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("No decisions waiting");
  });
  it("marks old-API name failures explicitly rather than silently changing the row", async () => {
    const get = vi.fn(async (path: string) => { if (path.includes("/approvals?")) return { approvals: [{ ...approval, workContext: undefined }] }; throw new Error("429"); });
    const html = renderToStaticMarkup(await QuietApprovals({ companyId: "company", status: "pending", locale: "en", api: { get } as never }));
    expect(get).toHaveBeenCalledTimes(3);
    expect(html).toContain("Some linked work names could not be loaded");
    expect(html).toContain("name not available");
  });
  for (const evidence of [undefined, false, true]) it(`keeps Overview, Runs, supporting work and inspector cost equal with proof=${evidence}`, async () => {
    const record = { ...run, hasRecordedZeroCost: evidence };
    const get = vi.fn(async (path: string) => path.includes("/approvals?") ? { approvals: [] } : path.includes("/runs?") ? { runs: [record] } : path.endsWith("/agents") ? { agents: [] } : path.includes("providers/usage") ? { usage: [] } : overview);
    const home = renderToStaticMarkup(await QuietOverview({ overview, locale: "en", api: { get } as never }));
    const rows = renderToStaticMarkup(await QuietWork({ companyId: "company", kind: "runs", filters: {}, locale: "en", api: { get } as never }));
    const supporting = renderToStaticMarkup(createElement(QuietApprovalDetail, { approval, overview, run: record }));
    const inspector = renderToStaticMarkup(createElement(QuietRunDetail, { companyId: "company", initial: { run: record, aiCalls: [{ id: "call", provider: "test", model: "fixture", status: "ok", costEstimated: false, costUsd: "0", inputTokens: 0, outputTokens: 0, latencyMs: 0 }], steps: [], toolCalls: [], artifacts: [], approvals: [], workflow: null } as never, task: null, overview, observedAt: Date.now(), back: "/app/c/company/runs" }));
    for (const html of [home, rows, supporting, inspector]) {
      expect(html).toContain(evidence === true ? "$0.00" : "Not available");
      if (evidence !== true) expect(html).not.toMatch(/Recorded run cost[^<]*\$0\.00/);
      expect(html.includes("The same run total cannot yet be verified across views")).toBe(evidence === undefined);
    }
  });
});
