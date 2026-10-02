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

  it("preserves supported hex/base64 keys and validates rotated keys before opening resources", () => {
    const encoded = Buffer.alloc(32, 7).toString("base64");
    expect(loadConfig({ ...base, STEWARD_MASTER_KEY: encoded }).masterKey).toBe(encoded);
    expect(loadConfig({ ...base, STEWARD_PREVIOUS_MASTER_KEYS: JSON.stringify({ previous: encoded }) }).previousMasterKeys).toEqual({ previous: encoded });
    expect(() => loadConfig({ ...base, STEWARD_PREVIOUS_MASTER_KEYS: JSON.stringify({ previous: "secret" }) })).toThrow(/STEWARD_PREVIOUS_MASTER_KEYS/);
    try { loadConfig({ ...base, STEWARD_PREVIOUS_MASTER_KEYS: JSON.stringify({ previous: "secret" }) }); }
    catch (error) { expect((error as Error).message).not.toContain("secret"); }
  });

  it("parses ALLOW_SIGNUP and NODE_ENV", () => {
    expect(loadConfig({ ...base }).allowSignup).toBe(true);
    expect(loadConfig({ ...base, ALLOW_SIGNUP: "false" }).allowSignup).toBe(false);
    expect(loadConfig({ ...base, NODE_ENV: "production" }).env).toBe("production");
    expect(loadConfig({ ...base, NODE_ENV: "production" }).allowSignup).toBe(false);
    expect(loadConfig({ ...base, NODE_ENV: "production", ALLOW_SIGNUP: "true" }).allowSignup).toBe(true);
    expect(() => loadConfig({ ...base, NODE_ENV: "staging" })).toThrow(/NODE_ENV/);
  });

  it("rejects malformed keys, secrets and URLs without echoing their values", () => {
    for (const [key, value] of Object.entries({ DATABASE_URL: "https://secret@example.com", STEWARD_MASTER_KEY: "secret", SESSION_SECRET: "secret", APP_URL: "https://secret@example.com", API_URL: "ftp://secret", API_INTERNAL_URL: "https://x.test/?secret" })) {
      try { loadConfig({ ...base, [key]: value }); throw new Error("expected validation failure"); }
      catch (error) { expect((error as Error).message).toContain(key); expect((error as Error).message).not.toContain(value); }
    }
    expect(() => loadConfig({ ...base, APP_URL: "https://x.test/path" })).toThrow(/origin only/);
    expect(() => loadConfig({ ...base, SESSION_SECRET: "   " })).toThrow(/Missing/);
  });

  it("normalizes optional blank URLs consistently", () => {
    expect(loadConfig({ ...base, APP_URL: " ", API_INTERNAL_URL: "", API_URL: " https://api.test/ " })).toMatchObject({ appUrl: "http://localhost:3000", apiUrl: "https://api.test", apiInternalUrl: "https://api.test" });
  });

  it("honours bounded per-process pool limits for serverless hosts", () => {
    expect(loadConfig({ ...base, DATABASE_POOL_MAX: "2" }).databasePoolMax).toBe(2);
    for (const value of ["0", "101", "1.5", "NaN"]) expect(() => loadConfig({ ...base, DATABASE_POOL_MAX: value })).toThrow(/DATABASE_POOL_MAX/);
  });
});
