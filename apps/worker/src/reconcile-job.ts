import { ReconcileService, type RunLauncher, type createCoreContext } from "@steward/core";
import type { Db } from "@steward/db";

/** Derived from the core context so this file needs no direct pino dependency. */
type Logger = ReturnType<typeof createCoreContext>["log"];

const INTERVAL_MS = 5 * 60 * 1000;

/**
 * Repairs runs and records that a distributed failure left behind: launches that never started, runs that
 * stopped moving while claiming to work, approvals whose run already finished, and tasks parked waiting for
 * an approval that no longer exists.
 *
 * It runs on boot and every five minutes. Failures are logged and retried on the next tick — reconciliation
 * must never be the reason the worker goes down.
 */
export function startReconcileJob(db: Db, log: Logger, launcher: RunLauncher | null) {
  const service = new ReconcileService(db, launcher);

  const runOnce = async (reason: string) => {
    try {
      const report = await service.sweep();
      const total = Object.values(report).reduce((a, b) => a + b, 0);
      if (total > 0) log.warn({ reason, ...report }, "reconciliation repaired stuck state");
      else log.debug({ reason }, "reconciliation found nothing to repair");
    } catch (err) {
      log.error({ err, reason }, "reconciliation sweep failed; will retry on the next interval");
    }
  };

  void runOnce("startup");
  const timer = setInterval(() => void runOnce("scheduled"), INTERVAL_MS);
  // Never hold the process open just for housekeeping.
  timer.unref();
  return () => clearInterval(timer);
}
