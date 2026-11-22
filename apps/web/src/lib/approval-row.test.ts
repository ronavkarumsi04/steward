import { describe, expect, it, vi } from "vitest";
import type { Approval, Run } from "./types";
import { approvalActionLabel, approvalWorkLabel } from "./approval-row";
import { loadApprovalContext, loadRunCosts } from "./quiet-record-context";

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
  it("deduplicates linked reads within company scope and never loads a made-up title", async () => {
    const get = vi.fn(async (path: string) => {
      if (path.endsWith("/runs/run-1")) return { run: { id: "run-1", taskId: "task-1", intent: "Check the browser" } };
      throw new Error("task unavailable");
    });
    const contexts = await loadApprovalContext({ get } as never, "company-1", [request, { ...request, id: "b", taskId: null }]);
    expect(contexts.a).toEqual({ taskTitle: null, runIntent: "Check the browser" });
    expect(contexts.b).toEqual(contexts.a);
    expect(get.mock.calls.map(([path]) => path).sort()).toEqual(["/companies/company-1/runs/run-1", "/companies/company-1/tasks/task-1"]);
  });
  it("does not fetch run traces when a recorded task title already identifies the request", async () => {
    const get = vi.fn(async () => ({ task: { title: "Prepare draft" } }));
    const contexts = await loadApprovalContext({ get } as never, "company-1", [request, { ...request, id: "b" }]);
    expect(contexts.a?.taskTitle).toBe("Prepare draft");
    expect(get).toHaveBeenCalledExactlyOnceWith("/companies/company-1/tasks/task-1");
  });
});

describe("Evidence-backed run costs across Quiet lists", () => {
  it("keeps missing/estimated zeros unavailable, but preserves an explicitly recorded zero", async () => {
    const runs = ["untouched", "recorded", "estimated", "offline", "paid"].map((id) => ({ id, costUsd: id === "paid" ? "0.025" : "0.000000" })) as Run[];
    const get = vi.fn(async (path: string) => {
      const run = runs.find((item) => path.endsWith(`/${item.id}`))!;
      if (run.id === "offline") throw new Error("unavailable");
      return { run, aiCalls: run.id === "untouched" ? [] : [{ status: "ok", costEstimated: run.id === "estimated", costUsd: "0" }] };
    });
    expect(await loadRunCosts({ get } as never, "company-1", runs)).toEqual({ untouched: null, recorded: "0.000000", estimated: null, offline: null, paid: "0.025" });
    expect(get).toHaveBeenCalledTimes(4);
  });
});
