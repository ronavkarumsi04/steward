import cronstrue from "cronstrue";
import type { WorkflowView } from "./types";

/** Describe the stored wall-clock rhythm, not a guessed next execution or local time. */
export function scheduleRhythm(cron: string | null, timezone: string | null): string {
  if (!cron?.trim()) return "No time set";
  const zone = timezone ?? "UTC";
  try {
    return `${cronstrue.toString(cron, { use24HourTimeFormat: true, throwExceptionOnParseError: true })} · ${zone}`;
  } catch {
    return `Schedule needs a valid time · ${zone}`;
  }
}

export function canTogglePublishedWorkflow(workflow: Pick<WorkflowView, "publishedAt" | "liveCount"> | undefined): boolean {
  return Boolean(workflow?.publishedAt && workflow.liveCount > 0);
}
