/**
 * The parts of watching a browser that are arithmetic rather than markup.
 *
 * A live view is the kind of surface that is easy to get quietly wrong: which frame is "now", whether a Stop button
 * should exist at all, what a status actually means to someone who did not read the schema. Those decisions are
 * made here, once, in functions that take the shapes the API sends and are asserted in `browser.test.ts` — so the
 * component below is a description of a screen rather than a place where state rules live.
 */

import type { BrowserFrameView, BrowserSessionView, BrowserStatus } from "./types";

/** The sentence a status is: what happened, not which enum member it is. */
export function statusLabel(status: BrowserStatus): string {
  return { live: "Live", stopped: "Stopped by you", closed: "Finished", failed: "Failed" }[status];
}

/** The tone a status is shown in, matching the `Pill` tones the rest of the app uses. */
export function statusTone(status: BrowserStatus): "ok" | "accent" | "warn" | "danger" | "neutral" {
  const tones = { live: "accent", stopped: "warn", closed: "neutral", failed: "danger" } as const;
  return tones[status];
}

/** Whether the session is still using a browser right now. */
export const isLive = (session: Pick<BrowserSessionView, "status">): boolean => session.status === "live";

/**
 * Whether a Stop button belongs on the screen.
 *
 * Two conditions, and both are load-bearing: there is something to stop, and this person is allowed to stop it. A
 * viewer gets the page and no control — the API refuses the call anyway, so showing the button would be offering
 * something that cannot work.
 */
export const canStop = (session: Pick<BrowserSessionView, "status">, canControl: boolean): boolean => canControl && isLive(session);

/**
 * The line under a session's address: what it has done and where it is.
 *
 * Deliberately built from counts rather than prose a page supplied, because a founder reading "step 7" and seeing
 * seven entries in the log is how they learn the log is complete.
 */
export function sessionSummary(session: Pick<BrowserSessionView, "stepCount" | "frameCount" | "lastAction" | "status" | "stopReason" | "error">): string {
  const parts = [`${session.stepCount} step${session.stepCount === 1 ? "" : "s"}`, `${session.frameCount} frame${session.frameCount === 1 ? "" : "s"}`];
  if (session.lastAction) parts.push(`last: ${session.lastAction}`);
  const counts = parts.join(" · ");
  if (session.status === "stopped" && session.stopReason) return `${counts} — stopped: ${session.stopReason}`;
  if (session.status === "failed" && session.error) return `${counts} — failed: ${session.error}`;
  return counts;
}

/** Why a session ended, in the founder's words, or null while it has not. */
export function endingNote(session: Pick<BrowserSessionView, "status" | "stopReason" | "error" | "lastNote">): string | null {
  if (session.status === "stopped") return session.stopReason ?? "You stopped this session.";
  if (session.status === "failed") return session.error ?? "The browser or the page went away.";
  if (session.status === "closed") return session.lastNote ?? "Finished.";
  return null;
}

/** The newest frame, which is the page as it looks now — or null before anything has been captured. */
export function newestFrame(frames: BrowserFrameView[]): BrowserFrameView | null {
  return frames.length ? frames[frames.length - 1]! : null;
}

/**
 * The frame to show, given what the founder has clicked.
 *
 * Following the newest frame is the live view; picking one from the log is the review. The chosen frame wins when it
 * is still in the list, and a frame that has been swept falls back to the newest rather than showing a broken image.
 */
export function shownFrame(frames: BrowserFrameView[], chosenId: string | null): BrowserFrameView | null {
  if (chosenId) {
    const chosen = frames.find((frame) => frame.id === chosenId);
    if (chosen) return chosen;
  }
  return newestFrame(frames);
}

/** Whether the image being shown is the current page rather than one the founder went back to. */
export const isFollowingLive = (frames: BrowserFrameView[], chosenId: string | null): boolean => {
  const shown = shownFrame(frames, chosenId);
  const newest = newestFrame(frames);
  return shown !== null && shown.id === newest?.id;
};

/**
 * The URL of one frame image.
 *
 * The `v` is the frame's id: the API caches a frame for a minute, so a fixed URL would leave a founder watching an
 * image that never changes while the page under it does. Each frame has its own URL, which is what makes the live
 * view move.
 */
export function frameSrc(companyId: string, sessionId: string, frame: Pick<BrowserFrameView, "id"> | null, choice?: string): string {
  const base = `/api/v1/companies/${companyId}/browser/sessions/${sessionId}`;
  return `${frame ? `${base}/frames/${frame.id}` : `${base}/frame`}?v=${encodeURIComponent(choice ?? frame?.id ?? "latest")}`;
}

/**
 * The step log: newest first, because the question a founder has while watching is "what just happened".
 *
 * Every row carries the frame it produced, so clicking one shows that moment, and `unchanged` marks the steps whose
 * frame was identical to the one before: Playwright taking a screenshot of a page that did not move is worth
 * seeing, but it should read as "nothing changed" rather than as a repeated image.
 */
export interface StepRow {
  frame: BrowserFrameView;
  /** `Step 3` — the frame's own position, which is also its step. */
  label: string;
  action: string;
  /** True when this frame's bytes are identical to the previous one's. */
  unchanged: boolean;
}

export function stepLog(frames: BrowserFrameView[]): StepRow[] {
  return frames
    .map((frame, index) => ({
      frame,
      label: `Step ${frame.seq}`,
      action: frame.action || "Read the page",
      unchanged: index > 0 && frames[index - 1]!.digest === frame.digest,
    }))
    .reverse();
}

/** The address a founder reads, shortened the way a browser shows one: the host, and the path if it is short. */
export function shortUrl(url: string, maxLength = 64): string {
  try {
    const parsed = new URL(url);
    const shown = `${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}${parsed.search}`;
    return shown.length > maxLength ? `${shown.slice(0, maxLength - 1)}…` : shown;
  } catch {
    return url.length > maxLength ? `${url.slice(0, maxLength - 1)}…` : url;
  }
}

/**
 * Whether a session is worth offering as the one to watch when the page opens.
 *
 * A live session beats a finished one, and the most recent of each kind wins, because the page should open on what
 * is happening rather than on what happened yesterday.
 */
export function preferredSession(sessions: BrowserSessionView[]): BrowserSessionView | null {
  if (!sessions.length) return null;
  const live = sessions.filter(isLive);
  const pool = live.length ? live : sessions;
  return pool.reduce((best, session) => (new Date(session.createdAt) > new Date(best.createdAt) ? session : best), pool[0]!);
}
