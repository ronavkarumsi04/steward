import { describe, expect, it } from "vitest";
import { scheduleRhythm, canTogglePublishedWorkflow } from "./quiet-workflows";

describe("Quiet workflow state and rhythm", () => {
  it("explains weekly, daily and interval cron schedules with the stored time zone", () => {
    expect(scheduleRhythm("0 10 * * 1", "UTC")).toBe("At 10:00, only on Monday · UTC");
    expect(scheduleRhythm("30 9 * * *", "America/New_York")).toBe("At 09:30 · America/New_York");
    expect(scheduleRhythm("*/15 * * * *", "UTC")).toBe("Every 15 minutes · UTC");
  });
  it("never invents a rhythm for an invalid or missing expression", () => {
    expect(scheduleRhythm(null, "UTC")).toBe("No time set");
    expect(scheduleRhythm("not a cron", "UTC")).toBe("Schedule needs a valid time · UTC");
  });
  it("offers Pause/Resume only after publication and while live targets exist", () => {
    expect(canTogglePublishedWorkflow({ publishedAt: null, liveCount: 0 })).toBe(false);
    expect(canTogglePublishedWorkflow({ publishedAt: "2026-01-01", liveCount: 0 })).toBe(false);
    expect(canTogglePublishedWorkflow({ publishedAt: "2026-01-01", liveCount: 1 })).toBe(true);
    expect(canTogglePublishedWorkflow(undefined)).toBe(false);
  });
});
