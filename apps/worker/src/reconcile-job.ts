import { ReconcileService, type ApprovalSignal, type RunLauncher, type createCoreContext } from "@steward/core";
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
export function startReconcileJob(db: Db, log: Logger, launcher: RunLauncher | null, approvalSignal?: ApprovalSignal) {
  const service = new ReconcileService(db, launcher, undefined, approvalSignal);
  let sweeping = false;

  const runOnce = async (reason: string) => {
    if (sweeping) return;
    sweeping = true;
    try {
      const report = await service.sweep();
      const total = Object.values(report).reduce((a, b) => a + b, 0);
      if (total > 0) log.warn({ reason, ...report }, "reconciliation repaired stuck state");
      else log.debug({ reason }, "reconciliation found nothing to repair");
    } catch (err) {
      log.error({ err, reason }, "reconciliation sweep failed; will retry on the next interval");
    } finally {
      sweeping = false;
    }
  };

  void runOnce("startup");
  const timer = setInterval(() => void runOnce("scheduled"), INTERVAL_MS);
  // Never hold the process open just for housekeeping.
  timer.unref();
  return () => clearInterval(timer);
}
