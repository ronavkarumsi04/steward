import { BrowserService } from "@steward/core";
import type { Db } from "@steward/db";
import type { BrowserProvider } from "@steward/browser";
import type { createCoreContext } from "@steward/core";

/** Derived from the core context so this file needs no direct pino dependency. */
type Logger = ReturnType<typeof createCoreContext>["log"];

/** Five minutes: long enough to be cheap, short enough that a founder never watches a page that is not there. */
const INTERVAL_MS = 5 * 60 * 1000;

/**
 * The housekeeping a browser session needs after the process that opened it is gone.
 *
 * A worker that died mid-page leaves a row that says `live` with no browser behind it, which is the one state this
 * feature must never leave a founder in: they would watch an empty box forever. So the worker closes what has gone
 * quiet — fifteen minutes with nothing typed or clicked — and writes the reason on the session, which is *closed*
 * and not *stopped* because nobody decided it. Frames are images of a moment and are dropped after a week; the
 * session row stays, because the record of what happened is the thing worth keeping.
 *
 * It is handed the provider so the page is actually closed rather than only marked closed. On a stack with no
 * browser the provider is null and the sweep still does its work on the rows, which is what makes the sentence a
 * founder reads true on the machine that has no Chromium.
 */
export function startBrowserJob(db: Db, log: Logger, provider: BrowserProvider | null) {
  const service = new BrowserService(db, provider);

  const runOnce = async (reason: string) => {
    try {
      // Pages this process holds for sessions that are no longer live. A founder's Stop is written by the API —
      // which holds no browser — so the guard refusing the next action is not enough on its own: the page should
      // go away too, and this is where the worker notices.
      const orphaned = await service.closeOrphaned();
      if (orphaned.closed.length) log.info({ reason, sessions: orphaned.closed }, "closed browser pages whose sessions are no longer live");

      const result = await service.sweepStale();
      if (result.closed || result.framesDeleted) log.info({ reason, closed: result.closed, framesDeleted: result.framesDeleted }, "browser housekeeping closed quiet sessions");
      else log.debug({ reason }, "browser housekeeping found nothing to close");
    } catch (err) {
      log.error({ err, reason }, "browser housekeeping failed; will retry on the next interval");
    }
  };

  void runOnce("startup");
  const timer = setInterval(() => void runOnce("scheduled"), INTERVAL_MS);
  // Never hold the process open just for housekeeping.
  timer.unref();
  return () => clearInterval(timer);
}
