import { describe, expect, it } from "vitest";
import { runsHref } from "./run-filters";

describe("run-history navigation", () => {
  it("retains the task when applying and clearing a status filter", () => {
    expect(runsHref("company", "failed,cancelled", "task")).toBe("/app/c/company/runs?status=failed%2Ccancelled&taskId=task");
    expect(runsHref("company", undefined, "task")).toBe("/app/c/company/runs?taskId=task");
  });
  it("introduces no query at the unfiltered company route", () => {
    expect(runsHref("company")).toBe("/app/c/company/runs");
  });
});
