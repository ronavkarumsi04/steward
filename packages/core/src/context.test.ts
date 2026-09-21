import { describe, expect, it } from "vitest";
import { loadConfig } from "./context.js";

const base = {
  DATABASE_URL: "postgres://x",
  STEWARD_MASTER_KEY: "a".repeat(64),
  SESSION_SECRET: "s".repeat(32),
};

describe("loadConfig", () => {
  it("defaults previousMasterKeys to an empty map", () => {
    expect(loadConfig({ ...base }).previousMasterKeys).toEqual({});
    expect(loadConfig({ ...base, STEWARD_PREVIOUS_MASTER_KEYS: "  " }).previousMasterKeys).toEqual({});
  });

  it("parses a JSON map of previous keys", () => {
    const cfg = loadConfig({ ...base, STEWARD_PREVIOUS_MASTER_KEYS: JSON.stringify({ deadbeef: "b".repeat(64) }) });
    expect(cfg.previousMasterKeys).toEqual({ deadbeef: "b".repeat(64) });
  });

  it("rejects malformed previous-key maps with a descriptive error", () => {
    for (const bad of ["not json", "[]", '"str"', '{"k": 1}']) {
      expect(() => loadConfig({ ...base, STEWARD_PREVIOUS_MASTER_KEYS: bad })).toThrow(/STEWARD_PREVIOUS_MASTER_KEYS/);
    }
  });

  it("parses ALLOW_SIGNUP and NODE_ENV", () => {
    expect(loadConfig({ ...base }).allowSignup).toBe(true);
    expect(loadConfig({ ...base, ALLOW_SIGNUP: "false" }).allowSignup).toBe(false);
    expect(loadConfig({ ...base, NODE_ENV: "production" }).env).toBe("production");
    expect(loadConfig({ ...base, NODE_ENV: "staging" }).env).toBe("development");
  });
});
