import { describe, expect, it, vi } from "vitest";
import type { Approval, Run } from "./types";
import { approvalActionLabel, approvalWorkLabel } from "./approval-row";
import { loadApprovalContext } from "./quiet-record-context";
import { runCostValue } from "./work-loop";

const request: Approval = { id: "a", action: "browser.act", reason: "external_write", payload: { kind: "wait", ms: 500 }, taskId: "task-1", runId: "run-1", agentId: null, risk: "LOW", dimension: "external_write", affectedSystem: "the open page", estimatedCostUsd: null, alternatives: [], status: "pending", resolvedAt: null, resolvedBy: null, resolution: null, createdAt: "2026-01-01T00:00:00Z", expiresAt: "2099-01-01T00:00:00Z", workflowId: null };

describe("Quiet approval row context", () => {
  it("describes the recorded browser action rather than the policy dimension", () => {
    expect(approvalActionLabel(request, "en")).toBe("Wait 0.5 seconds in the browser");
    expect(approvalActionLabel({ ...request, payload: { kind: "wait", ms: 1000 } }, "en")).toBe("Wait 1 second in the browser");
    expect(approvalActionLabel({ ...request, payload: { kind: "click", selector: "text=Save draft" } }, "en")).toBe("Click text=Save draft");
    expect(approvalActionLabel({ ...request, payload: { kind: "type", selector: "#subject", text: "private draft", submit: true } }, "en")).toBe("Type into #subject and press Enter");
    expect(approvalActionLabel({ ...request, payload: { kind: "wait", ms: -1 } }, "en")).toBe("Review browser action");
  });
  it("uses only linked names, falling back truthfully when reads fail", () => {
    expect(approvalWorkLabel(request, { taskTitle: "Prepare launch notes", runIntent: "Review the draft\nFull instructions" }, "en")).toBe("Task: Prepare launch notes");
    expect(approvalWorkLabel(request, { taskTitle: null, runIntent: "Review the draft\nFull instructions" }, "en")).toBe("Run: Review the draft");
    expect(approvalWorkLabel(request, undefined, "en")).toBe("Run run-1 · name not available");
    expect(approvalWorkLabel({ ...request, taskId: null, runId: null }, undefined, "en")).toBe("No linked task or run");
    expect(approvalActionLabel(request, "es")).toContain("0,5");
  });
  it("uses two list reads on an older API and reports partial context explicitly", async () => {
    const get = vi.fn(async (path: string) => {
      if (path.endsWith("/runs?limit=200")) return { runs: [{ id: "run-1", taskId: "task-1", intent: "Check the browser" }] };
      throw new Error("task unavailable");
    });
    const contexts = await loadApprovalContext({ get } as never, "company-1", [request, { ...request, id: "b", taskId: null }]);
    expect(contexts.a).toEqual({ taskTitle: null, runIntent: "Check the browser", runStatus: null, unavailable: true });
    expect(contexts.b).toEqual(contexts.a);
    expect(get.mock.calls.map(([path]) => path).sort()).toEqual(["/companies/company-1/runs?limit=200", "/companies/company-1/tasks?limit=200"]);
  });
  it("needs no extra API read for projected work names", async () => {
    const get = vi.fn();
    const contexts = await loadApprovalContext({ get } as never, "company-1", [{ ...request, workContext: { taskTitle: "Prepare draft", runIntent: null } }]);
    expect(contexts.a?.taskTitle).toBe("Prepare draft");
    expect(get).not.toHaveBeenCalled();
  });
  it("never fans out across companies in an old-API Inbox, marking missing names explicitly", async () => {
    const get = vi.fn();
    const contexts = await Promise.all(Array.from({ length: 100 }, (_, i) => loadApprovalContext({ get } as never, `company-${i}`, [{ ...request, id: `a-${i}` }], false)));
    expect(get).not.toHaveBeenCalled();
    expect(contexts.every((context) => Object.values(context).every((row) => row.unavailable))).toBe(true);
  });
});

describe("Evidence-backed run costs across Quiet lists", () => {
  it("keeps unproven zeros unavailable without reads, preserving a projected recorded zero", () => {
    const runs = ["untouched", "recorded", "estimated", "old-api", "paid"].map((id) => ({ id, costUsd: id === "paid" ? "0.025" : "0.000000", ...(id !== "old-api" ? { hasRecordedZeroCost: id === "recorded" } : {}) })) as Run[];
    expect(Object.fromEntries(runs.map((run) => [run.id, runCostValue(run)]))).toEqual({ untouched: null, recorded: "0.000000", estimated: null, "old-api": null, paid: "0.025" });
  });
});

it("bounds long selectors and email subjects visibly, without altering exact payload", () => {
  for (const approval of [{ ...request, payload: { kind: "click", selector: "#" + "a".repeat(1000) } }, { ...request, action: "email.send", payload: { to: "review@example.com", subject: "Review ".repeat(200) } }]) {
    const original = structuredClone(approval.payload);
    const label = approvalActionLabel(approval, "en");
    expect(Array.from(label).length).toBeLessThanOrEqual(140);
    expect(label.endsWith("…")).toBe(true);
    expect(approval.payload).toEqual(original);
  }
});
