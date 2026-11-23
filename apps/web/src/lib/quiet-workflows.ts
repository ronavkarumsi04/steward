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

/** Reword only describeWorkflow's leading schedule clause, never its instruction or run guarantees.
 * Read the server's sentence rather than draft nodes, which can change before a preview returns. */
export function quietWorkflowSentence(sentence: string): string {
  return sentence.replace(
    /^When every “([^”]*)” tick(?: \(([^)]*)\))?(,)?/,
    (_clause, cron: string, timezone: string | undefined, comma: string | undefined) =>
      `${scheduleRhythm(cron === "?" ? null : cron, timezone ?? "UTC")}${comma ? ":" : ""}`,
  );
}

export function canTogglePublishedWorkflow(workflow: Pick<WorkflowView, "publishedAt"> | undefined): boolean {
  // An incomplete saved draft reports liveCount=0 even while its previously published work is still running.
  // Publication, not the draft's comparison result, determines whether that work must remain stoppable.
  return Boolean(workflow?.publishedAt);
}
