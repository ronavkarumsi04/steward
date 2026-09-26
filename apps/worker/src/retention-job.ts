import { RetentionService, type createCoreContext } from "@steward/core";
import type { Db } from "@steward/db";
import { RETENTION_POLICY } from "@steward/legal";

/** Derived from the core context so this file needs no direct pino dependency. */
type Logger = ReturnType<typeof createCoreContext>["log"];

const INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Published windows, keyed by rule id, taken straight from the legal policy the retention page renders. */
function windows(): Record<string, number> {
  return Object.fromEntries(RETENTION_POLICY.filter((r) => r.sweepDays !== null).map((r) => [r.id, r.sweepDays as number]));
}

/**
 * Runs the retention sweep on boot and every six hours, so the "deleted automatically" claims on the
 * Retention Policy page are true of a running deployment rather than aspirational. A failure is
 * logged and retried on the next tick; it must never take the worker down.
 */
export function startRetentionJob(db: Db, log: Logger) {
  const service = new RetentionService(db);

  const runOnce = async (reason: string) => {
    try {
      const result = await service.sweep(windows());
      if (result.total > 0) log.info({ reason, deleted: result.deleted, total: result.total }, "retention sweep removed expired records");
      else log.debug({ reason }, "retention sweep found nothing to remove");
    } catch (err) {
      log.error({ err, reason }, "retention sweep failed; will retry on the next interval");
    }
  };

  void runOnce("startup");
  const timer = setInterval(() => void runOnce("scheduled"), INTERVAL_MS);
  // Never hold the process open just for housekeeping.
  timer.unref();
  return () => clearInterval(timer);
}
