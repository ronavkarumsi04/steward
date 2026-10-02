import type { Client } from "@temporalio/client";
import { describe, expect, it, vi } from "vitest";
import { WorkflowClient } from "./client.js";

function setup() {
  const describeNamespace = vi.fn(async () => ({}));
  const describeTaskQueue = vi.fn(async (_input: { namespace: string; taskQueue: { name: string }; taskQueueType: number }) => ({ pollers: [{ lastAccessTime: { seconds: Math.floor(Date.now() / 1_000) } }] }));
  const withDeadline = vi.fn(async (_deadline: number, call: () => Promise<unknown>) => call());
  const client = { options: { namespace: "company-os" }, workflowService: { describeNamespace, describeTaskQueue }, connection: { withDeadline } };
  return { workflows: new WorkflowClient(client as unknown as Client, "steward"), describeNamespace, describeTaskQueue, withDeadline };
}

describe("execution readiness", () => {
  it("checks the configured namespace and both worker queues with a bounded deadline", async () => {
    const s = setup();
    const before = Date.now();
    expect(await s.workflows.readiness(true)).toEqual({ connected: true, workers: true });
    expect(s.describeNamespace).toHaveBeenCalledWith({ namespace: "company-os" });
    expect(s.describeTaskQueue.mock.calls.map((call) => call[0])).toEqual([
      { namespace: "company-os", taskQueue: { name: "steward" }, taskQueueType: 1 },
      { namespace: "company-os", taskQueue: { name: "steward" }, taskQueueType: 2 },
    ]);
    expect(s.withDeadline.mock.calls[0]![0]).toBeGreaterThanOrEqual(before + 3_000);
  });

  it("does not claim readiness when one queue has no workers or only stale pollers", async () => {
    const s = setup();
    s.describeTaskQueue.mockResolvedValueOnce({ pollers: [] });
    expect(await s.workflows.readiness(true)).toEqual({ connected: true, workers: false });
    s.describeTaskQueue.mockResolvedValue({ pollers: [{ lastAccessTime: { seconds: Math.floor(Date.now() / 1_000) - 120 } }] });
    expect(await s.workflows.readiness(true)).toEqual({ connected: true, workers: false });
  });

  it("reports namespace failure and task-queue inspection failure as unavailable", async () => {
    const s = setup();
    s.describeNamespace.mockRejectedValueOnce(new Error("wrong namespace"));
    expect(await s.workflows.readiness(true)).toEqual({ connected: false, workers: false });
    expect(s.describeTaskQueue).not.toHaveBeenCalled();
    s.describeTaskQueue.mockRejectedValueOnce(new Error("access denied"));
    expect(await s.workflows.readiness(true)).toEqual({ connected: false, workers: false });
  });

  it("checks connectivity without claiming worker readiness for a UI health request", async () => {
    const s = setup();
    expect(await s.workflows.readiness()).toEqual({ connected: true, workers: false });
    expect(s.describeTaskQueue).not.toHaveBeenCalled();
  });
});
