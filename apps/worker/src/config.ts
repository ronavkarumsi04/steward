import { parseBoolean } from "@steward/core";

export class WorkerConfigError extends Error {}

export function workerConfigFromEnv(env: NodeJS.ProcessEnv = process.env) {
  const integer = (key: string, fallback: number, max: number) => {
    const value = Number(env[key]?.trim() || fallback);
    if (!Number.isInteger(value) || value < 1 || value > max) throw new WorkerConfigError(`${key} must be an integer between 1 and ${max}`);
    return value;
  };
  const boolean = (key: string, fallback: boolean) => {
    try { return parseBoolean(env[key], fallback); }
    catch { throw new WorkerConfigError(`${key} must be a boolean`); }
  };
  if (boolean("TEMPORAL_DISABLED", false)) throw new WorkerConfigError("A worker requires Temporal; TEMPORAL_DISABLED must be false");
  const healthHost = env.WORKER_HEALTH_HOST?.trim() || "127.0.0.1";
  if (!["127.0.0.1", "0.0.0.0", "::1", "::"].includes(healthHost)) throw new WorkerConfigError("WORKER_HEALTH_HOST must be a loopback or wildcard bind address");
  const sandboxProvider = env.SANDBOX_PROVIDER?.trim() || (env.NODE_ENV === "production" ? "none" : "docker");
  if (!["none", "docker"].includes(sandboxProvider)) throw new WorkerConfigError("SANDBOX_PROVIDER must be none or docker");
  const temporalLogLevel = env.TEMPORAL_LOG_LEVEL?.trim().toUpperCase() || "WARN";
  if (!["TRACE", "DEBUG", "INFO", "WARN", "ERROR"].includes(temporalLogLevel)) throw new WorkerConfigError("TEMPORAL_LOG_LEVEL must be TRACE, DEBUG, INFO, WARN, or ERROR");
  return {
    healthHost,
    healthPort: integer("WORKER_HEALTH_PORT", 4340, 65535),
    maxActivities: integer("WORKER_MAX_ACTIVITIES", 10, 1000),
    maxWorkflows: integer("WORKER_MAX_WORKFLOWS", 40, 1000),
    shutdownGraceMs: integer("WORKER_SHUTDOWN_GRACE_MS", 30_000, 300_000),
    migrate: boolean("RUN_MIGRATIONS_ON_START", env.NODE_ENV !== "production"),
    sandboxProvider,
    temporalLogLevel,
  };
}
