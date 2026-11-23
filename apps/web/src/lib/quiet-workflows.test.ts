import { describe, expect, it } from "vitest";
import { scheduleRhythm, quietWorkflowSentence, canTogglePublishedWorkflow } from "./quiet-workflows";

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
  it("changes only the schedule prefix, including when instructions contain schedule code", () => {
    const rest = "Researcher starts a run: “Explain 0 10 * * 1 and When every “*/15 * * * *” tick, exactly.”. A tick that arrives while the last run is still going is skipped.";
    expect(quietWorkflowSentence(`When every “0 10 * * 1” tick, ${rest}`))
      .toBe(`At 10:00, only on Monday · UTC: ${rest}`);
    const event = `When Steward records run.status, ${rest}`;
    const signal = `When a site.changed signal arrives, ${rest}`;
    expect(quietWorkflowSentence(event)).toBe(event);
    expect(quietWorkflowSentence(signal)).toBe(signal);
  });
  it("preserves a server-side narrowing clause and never invents a schedule for unfinished drafts", () => {
    expect(quietWorkflowSentence("When every “*/15 * * * *” tick (Europe/London) in Launch, Researcher starts a run."))
      .toBe("Every 15 minutes · Europe/London in Launch, Researcher starts a run.");
    expect(quietWorkflowSentence("When every “?” tick, the chosen agent starts a run."))
      .toBe("No time set: the chosen agent starts a run.");
    expect(quietWorkflowSentence("When every “not a cron” tick, the chosen agent starts a run."))
      .toBe("Schedule needs a valid time · UTC: the chosen agent starts a run.");
  });
  it("keeps published work stoppable when an incomplete draft hides its live count", () => {
    const incompleteDraft = { publishedAt: "2026-01-01", liveCount: 0, problems: [{ code: "agent_missing" }] };
    expect(canTogglePublishedWorkflow({ publishedAt: null })).toBe(false);
    expect(canTogglePublishedWorkflow(incompleteDraft)).toBe(true);
    expect(canTogglePublishedWorkflow({ publishedAt: "2026-01-01" })).toBe(true);
    expect(canTogglePublishedWorkflow(undefined)).toBe(false);
  });
});
