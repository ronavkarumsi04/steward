import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { RunDetail } from "@/lib/types";
import { RunDetailView } from "./run-detail";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/use-events", () => ({ useLiveEvents: () => ({ events: [] }) }));

const observedAt = Date.parse("2026-10-02T12:00:00Z");
const detail: RunDetail = {
  run: {
    id: "finished-run", taskId: null, agentId: "agent-1", workflowId: null,
    projectId: null, conversationId: null, plan: null, result: null,
    status: "succeeded", trigger: { kind: "manual" }, intent: "Write a checklist",
    iterations: 1, costUsd: "0", inputTokens: 0, outputTokens: 0, error: null,
    startedAt: new Date(observedAt).toISOString(), finishedAt: new Date(observedAt).toISOString(),
    createdAt: new Date(observedAt).toISOString(),
  },
  steps: [], aiCalls: [], toolCalls: [], artifacts: [], approvals: [], workflow: null,
};
const render = (result: RunDetail["run"]["result"], status: RunDetail["run"]["status"] = "succeeded", error: string | null = null) => renderToStaticMarkup(createElement(RunDetailView, {
  companyId: "company-1", initial: { ...detail, run: { ...detail.run, result, status, error } }, agents: [], observedAt,
}));

describe("run detail output hierarchy", () => {
  it("shows the actual answer before review and inspection with raw JSON collapsed below", () => {
    const html = render({ finalText: "- Test signup\n- Launch", summary: "Reviewer approved", verification: { passed: true, summary: "Reviewer approved" } });
    expect(html.indexOf("What this run produced")).toBeLessThan(html.indexOf("Test signup"));
    expect(html.indexOf("Test signup")).toBeLessThan(html.indexOf('aria-label="Run inspection"'));
    expect(html.indexOf("Test signup")).toBeLessThan(html.indexOf("Reviewer approved"));
    expect(html).toContain('<summary class="cursor-pointer text-muted">Raw result JSON</summary>');
    expect(html).not.toContain("<details open");
  });

  it("explains missing output without promoting the review summary", () => {
    const html = render({ summary: "Reviewer approved" });
    expect(html).toContain("No output recorded.");
    expect(html.indexOf("No output recorded.")).toBeLessThan(html.indexOf("Reviewer approved"));
  });

  it("retains failure evidence and an empty output state", () => {
    const html = render(null, "failed", "Provider unavailable");
    expect(html).toContain("Provider unavailable");
    expect(html).toContain("No output recorded.");
    expect(html).toContain('aria-label="Run inspection"');
  });
});
