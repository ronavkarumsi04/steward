import { describe, expect, it } from "vitest";
import { workerConfigFromEnv } from "./config.js";

describe("worker deployment configuration", () => {
  it("disables implicit Docker and startup migrations in production", () => {
    expect(workerConfigFromEnv({ NODE_ENV: "production" })).toMatchObject({ sandboxProvider: "none", migrate: false, healthHost: "127.0.0.1", healthPort: 4340 });
    expect(workerConfigFromEnv({})).toMatchObject({ sandboxProvider: "docker", migrate: true });
    expect(workerConfigFromEnv({ NODE_ENV: "production", RUN_MIGRATIONS_ON_START: "true", SANDBOX_PROVIDER: "docker" })).toMatchObject({ sandboxProvider: "docker", migrate: true });
  });
  it("refuses a disabled worker and invalid booleans before opening resources", () => {
    expect(() => workerConfigFromEnv({ TEMPORAL_DISABLED: " true " })).toThrow(/requires Temporal/);
    for (const key of ["TEMPORAL_DISABLED", "RUN_MIGRATIONS_ON_START"]) expect(() => workerConfigFromEnv({ [key]: "sometimes" })).toThrow(`${key} must be a boolean`);
  });
  it("rejects unbounded/fractional concurrency, ports and drain times without echoing values", () => {
    for (const [key, values] of Object.entries({ WORKER_MAX_ACTIVITIES: ["0", "-1", "1.5", "1001", "Infinity"], WORKER_MAX_WORKFLOWS: ["1001"], WORKER_HEALTH_PORT: ["0", "65536"], WORKER_SHUTDOWN_GRACE_MS: ["300001", "secret-value"] })) {
      for (const value of values) {
        expect(() => workerConfigFromEnv({ [key]: value })).toThrow(key);
        try { workerConfigFromEnv({ [key]: value }); } catch (error) { expect(String(error)).not.toContain("secret-value"); }
      }
    }
    expect(workerConfigFromEnv({ WORKER_MAX_ACTIVITIES: " 3 ", WORKER_HEALTH_PORT: "9000" })).toMatchObject({ maxActivities: 3, healthPort: 9000 });
  });
  it("validates bind address, sandbox mode and native logging level", () => {
    expect(() => workerConfigFromEnv({ WORKER_HEALTH_HOST: "user:password@server" })).toThrow(/WORKER_HEALTH_HOST/);
    expect(() => workerConfigFromEnv({ SANDBOX_PROVIDER: "typo" })).toThrow(/SANDBOX_PROVIDER/);
    expect(() => workerConfigFromEnv({ TEMPORAL_LOG_LEVEL: "secret" })).toThrow(/TEMPORAL_LOG_LEVEL/);
    expect(workerConfigFromEnv({ TEMPORAL_LOG_LEVEL: " info ", WORKER_HEALTH_HOST: "0.0.0.0" })).toMatchObject({ temporalLogLevel: "INFO", healthHost: "0.0.0.0" });
  });
});
