import { ReactionService, type ReactionLauncher, type createCoreContext } from "@steward/core";
import type { Db } from "@steward/db";

/** Derived from the core context so this file needs no direct pino dependency. */
type Logger = ReturnType<typeof createCoreContext>["log"];

/** Half a minute: quick enough that a reaction feels like a response, cheap enough to run forever. */
const INTERVAL_MS = 30_000;

/**
 * Reactions over the recorded event log.
 *
 * The sweep is not a queue. It reads only the event types some enabled rule listens for, refuses to answer a
 * record a reaction produced, and moves a durable bookmark that never goes backwards — so a restart resumes
 * where it left off, and a replayed window is harmless because the fire ledger refuses duplicates. A tick that
 * finds nothing costs one indexed query; a deployment with no event rules costs nothing at all.
 *
 * Failures are logged and retried on the next tick: a broken rule must never be the reason the worker goes
 * down, and the events it did not reach stay ahead of the bookmark rather than being lost.
 */
export function startReactionsJob(db: Db, log: Logger, launcher: ReactionLauncher | null, intervalMs = INTERVAL_MS) {
  const service = new ReactionService(db);
  let sweeping = false;

  const runOnce = async (reason: string) => {
    if (sweeping) return; // a slow sweep must not stack up behind the timer
    sweeping = true;
    try {
      const report = await service.sweep({ launcher });
      if (report.started || report.queued || report.failed) log.info({ reason, ...report }, "reactions answered recorded events");
      else log.debug({ reason, ...report }, "reactions found nothing to answer");
    } catch (err) {
      log.error({ err, reason }, "reaction sweep failed; will retry on the next interval");
    } finally {
      sweeping = false;
    }
  };

  void runOnce("startup");
  const timer = setInterval(() => void runOnce("scheduled"), intervalMs);
  // Never hold the process open just for reactions.
  timer.unref();
  return () => clearInterval(timer);
}
