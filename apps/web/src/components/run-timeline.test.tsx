import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RunDetail } from "@/lib/types";
import { RunTimeline } from "./run-timeline";

const start = Date.parse("2026-10-02T12:00:00Z");
const detail: RunDetail = {
  run: {
    id: "running-1",
    taskId: null,
    agentId: "agent-1",
    workflowId: "workflow-1",
    projectId: null,
    conversationId: null,
    plan: null,
    result: null,
    status: "executing",
    trigger: { kind: "manual" },
    intent: "Review a proposal",
    iterations: 0,
    costUsd: "0",
    inputTokens: 0,
    outputTokens: 0,
    error: null,
    startedAt: new Date(start).toISOString(),
    finishedAt: null,
    createdAt: new Date(start).toISOString(),
  },
  steps: [],
  aiCalls: [],
  toolCalls: [],
  artifacts: [],
  approvals: [],
  workflow: null,
};
const render = (observedAt: number) =>
  renderToStaticMarkup(
    createElement(RunTimeline, { detail, companyId: "company-1", observedAt }),
  );

afterEach(() => vi.restoreAllMocks());
describe("run snapshot hydration", () => {
  it("renders identical running verdicts when the client clock advances during hydration", () => {
    vi.spyOn(Date, "now").mockReturnValue(start + 10_000);
    const server = render(start + 10_000);
    vi.spyOn(Date, "now").mockReturnValue(start + 12_000);
    expect(render(start + 10_000)).toBe(server);
    expect(server).toContain("Running — 10s");
  });
  it("updates elapsed evidence when a new snapshot arrives", () => {
    expect(render(start + 12_000)).toContain("Running — 12s");
    expect(render(start + 12_000)).not.toBe(render(start + 10_000));
  });
});
