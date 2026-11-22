import { describe, expect, it } from "vitest";
import { evidenceView, safeArtifactHref, workHref, workStatuses, lastRecordedAt, cancellable, normalizeWorkFilters, queryValue, runCostValue } from "./work-loop";
import type { RunDetail } from "./types";

describe("Quiet work loop contracts", () => {
  it("keeps completed, cancelled, active and review states distinct", () => {
    expect(workStatuses("runs", "completed")).toBe("succeeded");
    expect(workStatuses("tasks", "completed")).toBe("done");
    expect(workStatuses("runs", "active")).toContain("needs_review");
    expect(workStatuses("runs", "active")).not.toContain("cancelled");
    expect(workStatuses("runs", "all")).toBeUndefined();
    expect(cancellable("needs_review")).toBe(false);
    expect(cancellable("waiting_approval")).toBe(true);
    expect(cancellable("unknown")).toBe(false);
  });
  it("retains task, status and search in inspect/back links without open redirects", () => {
    expect(workHref("c", "runs", { view: "all", status: "failed,cancelled", taskId: "t", q: "a & b" })).toBe("/app/c/c/runs?view=all&status=failed%2Ccancelled&taskId=t&q=a+%26+b");
  });
  it("normalizes repeated URL parameters before filtering or building Back links", () => {
    const filters = normalizeWorkFilters({ q: ["review", "other"], view: ["all", "active"], status: ["failed", "cancelled"], taskId: ["task-1"] });
    expect(filters).toEqual({ q: "review", view: "all", status: "failed", taskId: "task-1" });
    expect(filters.q?.toLocaleLowerCase()).toBe("review");
    expect(queryValue(["/app/c/c/runs?view=all", "//other.test"])).toBe("/app/c/c/runs?view=all");
    expect(queryValue([])).toBeUndefined();
  });
  it("distinguishes an untouched default cost from a ledger-recorded zero", () => {
    expect(runCostValue({ costUsd: "0.000000" })).toBeNull();
    expect(runCostValue({ costUsd: "0" }, [{ status: "error", costEstimated: true, costUsd: "0" }])).toBeNull();
    expect(runCostValue({ costUsd: "0" }, [{ status: "ok", costEstimated: false, costUsd: "0" }])).toBe("0");
    expect(runCostValue({ costUsd: "0.025" })).toBe("0.025");
  });
  it("removes credentials and private reasoning recursively, including JSON-encoded outputs", () => {
    const result = JSON.stringify(evidenceView({ title: "Visible evidence", nested: { api_key: "secret-one", chainOfThought: "private-thought", text: '{"authorization":"secret-two","summary":"Done"}' } }));
    expect(result).toContain("Visible evidence");
    expect(result).toContain("Done");
    for (const value of ["secret-one", "secret-two", "private-thought"]) expect(result).not.toContain(value);
  });
  it("permits real web artifact links, not active scripts or credential URLs", () => {
    for (const value of ["javascript:alert(1)", "//other.test/file", "data:text/html,bad", "https://user:pass@example.test/file"]) expect(safeArtifactHref(value)).toBeNull();
    expect(safeArtifactHref("https://example.test/report")).toBe("https://example.test/report");
    expect(safeArtifactHref("/api/v1/companies/c/artifacts/a")).toBe("/api/v1/companies/c/artifacts/a");
  });
  it("hides system messages, thinking blocks and labelled credentials inside plain-text evidence", () => {
    const result = JSON.stringify(evidenceView({ blocks: [{ role: "system", content: "hidden-system" }, { type: "thinking", content: "hidden-thought" }], output: "Public result <think>hidden-xml</think> api_key=hidden-key", prompt: "hidden-prompt" }));
    expect(result).toContain("Public result");
    for (const value of ["hidden-system", "hidden-thought", "hidden-xml", "hidden-key", "hidden-prompt"]) expect(result).not.toContain(value);
  });
  it("uses actual trace timestamps for last activity, not the observation time", () => {
    const detail = { run: { createdAt: "2026-01-01T00:00:00Z", startedAt: null, finishedAt: null }, steps: [{ startedAt: "2026-01-02T00:00:00Z", finishedAt: null }], aiCalls: [], toolCalls: [], artifacts: [], approvals: [] } as unknown as RunDetail;
    expect(lastRecordedAt(detail)).toBe("2026-01-02T00:00:00Z");
  });
});
