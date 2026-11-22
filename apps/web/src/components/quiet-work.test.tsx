import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CompanyOverview, RunDetail, Task } from "@/lib/types";
import { QuietWork } from "./quiet-work";
import { QuietRunDetail } from "./quiet-run-detail";
import { QuietRunRecord } from "./quiet-run-record";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
const at = "2026-01-01T00:00:00Z";
const overview = { role: "owner", company: { id: "company", autonomyLevel: 1, timezone: "UTC" }, agents: [], budgets: [], policies: [] } as unknown as CompanyOverview;
const detail: RunDetail = { run: { id: "run", agentId: "agent", taskId: null, projectId: null, conversationId: null, trigger: {}, status: "executing", intent: "Check recorded evidence", plan: null, result: null, error: null, workflowId: null, costUsd: "", inputTokens: 0, outputTokens: 0, iterations: 0, createdAt: at, startedAt: at, finishedAt: null }, steps: [], aiCalls: [], toolCalls: [], artifacts: [], approvals: [], workflow: null };

describe("Quiet work surfaces", () => {
  it("retains records when assignment context fails, without claiming an empty list", async () => {
    const get = vi.fn(async (path: string) => {
      if (path.includes("/agents")) throw new Error("offline");
      if (path.includes("/runs?")) return { runs: [detail.run] };
      return overview;
    });
    const html = renderToStaticMarkup(await QuietWork({ companyId: "company", kind: "runs", filters: { status: "executing", taskId: "task" }, api: { get } as never, locale: "en" }));
    expect(html).toContain("Check recorded evidence");
    expect(html).toContain("Some work data could not be loaded");
    expect(html).toContain("Not available");
    expect(html).not.toContain("$0.00");
    expect(get.mock.calls[0]![0]).toContain("taskId=task");
    expect(html).toContain("from=");
  });
  it("does not turn a failed records read into empty work", async () => {
    const get = vi.fn(async (path: string) => {
      if (path.includes("/tasks?")) throw new Error("offline");
      if (path.endsWith("agents")) return { agents: [] };
      if (path.endsWith("goals")) return { goals: [] };
      return overview;
    });
    const html = renderToStaticMarkup(await QuietWork({ companyId: "company", kind: "tasks", filters: {}, api: { get } as never, locale: "en" }));
    expect(html).toContain("missing data is not an empty list");
    expect(html).not.toContain("No tasks in this view");
  });
  it("shows real empty traces, unavailable cost, and a measured cancel bar for active runs", () => {
    const html = renderToStaticMarkup(createElement(QuietRunDetail, { companyId: "company", initial: detail, overview, observedAt: Date.parse(at), back: "/app/c/company/runs" }));
    expect(html).toContain("No steps recorded yet");
    expect(html).toContain("No artifacts recorded yet");
    expect(html).toContain("Not available");
    expect(html).not.toContain("$0.00");
    expect(html).toContain('data-persistent="true"');
    expect(html).toContain("Cancel run");
  });
  it("separates a recorded title from its constraints and shows the linked goal without inventing usage", () => {
    const html = renderToStaticMarkup(createElement(QuietRunDetail, {
      companyId: "company", initial: { ...detail, run: { ...detail.run, taskId: "task", intent: "Draft a brief\n\nRead notes only.", costUsd: "0.000000" } },
      task: { id: "task", title: "Draft a brief", goalId: "goal" } as Task,
      overview: { ...overview, goals: [{ id: "goal", title: "Prepare the weekly brief" }] } as CompanyOverview,
      observedAt: Date.parse(at), back: "/app/c/company/runs",
    }));
    expect(html).toMatch(/<h1[^>]*>Draft a brief<\/h1>/);
    expect(html).toContain("Read notes only.");
    expect(html).toContain("Prepare the weekly brief");
    expect(html).toContain("Run details");
    expect(html).not.toContain("$0.00");
    expect(html.match(/Requests a stop to future work/g)).toHaveLength(1);
  });
  it("hides mutation controls for viewers, missing membership and terminal records", () => {
    for (const context of [null, { ...overview, role: "viewer" as const }]) {
      const html = renderToStaticMarkup(createElement(QuietRunDetail, { companyId: "company", initial: detail, overview: context, observedAt: Date.parse(at), back: "/app/c/company/runs" }));
      expect(html).not.toContain('data-persistent="true"');
    }
    const html = renderToStaticMarkup(createElement(QuietRunDetail, { companyId: "company", initial: { ...detail, run: { ...detail.run, status: "failed", error: "Source read failed" } }, overview, observedAt: Date.parse(at), back: "/app/c/company/runs" }));
    expect(html).toContain("Source read failed");
    expect(html).toContain("No automatic retry");
    expect(html).not.toContain('data-persistent="true"');
  });
  it("preserves a short recorded constraint after a leading newline", () => {
    const html = renderToStaticMarkup(createElement(QuietRunDetail, { companyId: "company", initial: { ...detail, run: { ...detail.run, intent: "\nDo not send." } }, overview, observedAt: Date.parse(at), back: "/app/c/company/runs" }));
    expect(html).toMatch(/<h1[^>]*>Run details<\/h1>/);
    expect(html).toContain("Do not send.");
  });
  it("keeps the timeline outside the existence of a result and exposes partial artifacts safely", () => {
    const html = renderToStaticMarkup(createElement(QuietRunRecord, { detail: { ...detail, artifacts: [{ id: "artifact", runId: "run", taskId: null, projectId: null, kind: "draft", title: "Partial source notes", url: "javascript:alert(1)", content: '{"summary":"Usable partial notes","apiKey":"must-not-render","reasoning":"private-reasoning"}', mimeType: "application/json", metadata: {}, createdAt: at }] }, companyId: "company", locale: "en", observedAt: Date.parse(at), timeZone: "UTC" }));
    expect(html).toContain("Run timeline");
    expect(html).toContain("Partial source notes");
    expect(html).toContain("Usable partial notes");
    expect(html).not.toContain("must-not-render");
    expect(html).not.toContain("private-reasoning");
    expect(html).not.toContain("javascript:");
  });
});
