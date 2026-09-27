/**
 * The browser page's arithmetic.
 *
 * These are the rules a founder would notice if they were wrong: which frame is "now", whether the Stop button is
 * there, what a status means, and which session the page opens on. None of them need a browser to test, which is
 * the point — the part of a live view that can be wrong without anything looking broken is the part worth
 * asserting.
 */
import { describe, expect, it } from "vitest";
import { canStop, endingNote, frameSrc, isFollowingLive, newestFrame, preferredSession, sessionSummary, shortUrl, shownFrame, statusLabel, statusTone, stepLog } from "./browser";
import type { BrowserFrameView, BrowserSessionView, BrowserStatus } from "./types";

const frame = (seq: number, over: Partial<BrowserFrameView> = {}): BrowserFrameView => ({
  id: `frame-${seq}`,
  seq,
  action: `Click #link-${seq}`,
  url: "https://example.com/pricing",
  title: "Pricing",
  mimeType: "image/jpeg",
  width: 1280,
  height: 800,
  bytes: 1024 * seq,
  digest: `digest-${seq}`,
  createdAt: "2026-09-20T12:00:00.000Z",
  ...over,
});

const session = (over: Partial<BrowserSessionView> = {}): BrowserSessionView => ({
  id: "session-1",
  runId: "run-1",
  agentId: "agent-1",
  status: "live",
  provider: "playwright",
  url: "https://example.com/pricing",
  startUrl: "https://example.com",
  title: "Pricing",
  width: 1280,
  height: 800,
  stepCount: 2,
  frameCount: 2,
  lastFrameId: "frame-2",
  lastAction: "Click #link-2",
  lastActionAt: "2026-09-20T12:00:00.000Z",
  lastNote: null,
  stopReason: null,
  error: null,
  createdAt: "2026-09-20T11:59:00.000Z",
  updatedAt: "2026-09-20T12:00:00.000Z",
  stoppedAt: null,
  ...over,
});

describe("what a session's state says", () => {
  it("names each state as a person would, with a tone that matches", () => {
    const states: BrowserStatus[] = ["live", "stopped", "closed", "failed"];
    expect(states.map(statusLabel)).toEqual(["Live", "Stopped by you", "Finished", "Failed"]);
    expect(states.map(statusTone)).toEqual(["accent", "warn", "neutral", "danger"]);
  });

  it("offers a stop only when there is something to stop and this person may stop it", () => {
    expect(canStop(session(), true)).toBe(true);
    expect(canStop(session(), false)).toBe(false);
    for (const status of ["stopped", "closed", "failed"] as BrowserStatus[]) {
      expect(canStop(session({ status }), true)).toBe(false);
    }
  });

  it("says why it ended, in the words that ended it", () => {
    expect(endingNote(session())).toBeNull();
    expect(endingNote(session({ status: "stopped", stopReason: "Seen enough." }))).toBe("Seen enough.");
    expect(endingNote(session({ status: "failed", error: "The page went away." }))).toBe("The page went away.");
    expect(endingNote(session({ status: "closed", lastNote: "The agent finished with this page." }))).toBe("The agent finished with this page.");
  });

  it("counts steps and frames rather than summarising someone else's prose", () => {
    expect(sessionSummary(session())).toBe("2 steps · 2 frames · last: Click #link-2");
    expect(sessionSummary(session({ stepCount: 1, frameCount: 1, lastAction: null }))).toBe("1 step · 1 frame");
    expect(sessionSummary(session({ status: "stopped", stopReason: "Wrong page." }))).toMatch(/— stopped: Wrong page\.$/);
  });
});

describe("which frame is on screen", () => {
  const frames = [frame(1), frame(2), frame(3)];

  it("follows the newest frame until a step is picked, and goes back to it", () => {
    expect(newestFrame(frames)?.seq).toBe(3);
    expect(newestFrame([])).toBeNull();
    expect(shownFrame(frames, null)?.seq).toBe(3);
    expect(shownFrame(frames, "frame-1")?.seq).toBe(1);
    expect(isFollowingLive(frames, null)).toBe(true);
    expect(isFollowingLive(frames, "frame-1")).toBe(false);
    expect(isFollowingLive(frames, "frame-3")).toBe(true);
  });

  it("falls back to the newest frame when the one that was picked has been swept", () => {
    expect(shownFrame(frames, "frame-gone")?.seq).toBe(3);
    expect(isFollowingLive(frames, "frame-gone")).toBe(true);
  });

  it("gives every frame its own image URL, so a cached one cannot freeze the view", () => {
    const first = frameSrc("company-1", "session-1", frame(1));
    const second = frameSrc("company-1", "session-1", frame(2));
    const latest = frameSrc("company-1", "session-1", null);
    expect(first).toBe("/api/v1/companies/company-1/browser/sessions/session-1/frames/frame-1?v=frame-1");
    expect(second).not.toBe(first);
    expect(latest).toBe("/api/v1/companies/company-1/browser/sessions/session-1/frame?v=latest");
  });

  it("reads the steps newest first, and says when a step changed nothing", () => {
    const rows = stepLog([frame(1), frame(2, { digest: "digest-1" }), frame(3)]);
    expect(rows.map((row) => row.frame.seq)).toEqual([3, 2, 1]);
    expect(rows.map((row) => row.label)).toEqual(["Step 3", "Step 2", "Step 1"]);
    // The second frame has the first frame's bytes: Playwright photographed a page that had not moved.
    expect(rows.map((row) => row.unchanged)).toEqual([false, true, false]);
    expect(stepLog([frame(1, { action: "" })])[0]!.action).toBe("Read the page");
  });
});

describe("which session the page opens on", () => {
  it("prefers what is happening now, and the most recent of whatever it is", () => {
    const oldest = session({ id: "oldest", status: "closed", createdAt: "2026-09-18T10:00:00.000Z" });
    const finishedToday = session({ id: "finished-today", status: "closed", createdAt: "2026-09-21T10:00:00.000Z" });
    const liveNow = session({ id: "live-now", createdAt: "2026-09-20T10:00:00.000Z" });

    // A live session outranks a newer finished one: the page opens on what is happening.
    expect(preferredSession([oldest, liveNow, finishedToday])?.id).toBe("live-now");
    // With nothing live, it opens on the latest thing that happened, whichever order the rows arrive in.
    expect(preferredSession([oldest, finishedToday])?.id).toBe("finished-today");
    expect(preferredSession([finishedToday, oldest])?.id).toBe("finished-today");
    expect(preferredSession([])).toBeNull();
  });
});

describe("reading an address", () => {
  it("shows a host and a short path the way a browser does, and never an ellipsis in the middle of nothing", () => {
    expect(shortUrl("https://example.com/")).toBe("example.com");
    expect(shortUrl("https://www.example.com/pricing?plan=annual")).toBe("www.example.com/pricing?plan=annual");
    expect(shortUrl(`https://example.com/${"a".repeat(200)}`)).toMatch(/…$/);
    expect(shortUrl("not a url")).toBe("not a url");
  });
});
