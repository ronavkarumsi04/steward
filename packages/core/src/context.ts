import pino from "pino";
import { EnvMasterKeyProvider, EnvelopeCrypto, hmacSign } from "@steward/crypto";
import { createDb, type Db } from "@steward/db";
import type pg from "pg";
type Pool = pg.Pool;

export interface CoreConfig {
  databaseUrl: string;
  databasePoolMax: number;
  masterKey: string;
  previousMasterKeys: Record<string, string>;
  sessionSecret: string;
  appUrl: string;
  apiUrl: string;
  /** URL other services (worker, web SSR) use to reach the API; differs from apiUrl inside container networks. */
  apiInternalUrl: string;
  env: "development" | "test" | "production";
  logLevel?: string;
  /** Public self-registration. When false, only the first user and invited emails can register. */
  allowSignup: boolean;
}

function parseKeyMap(value: string | undefined): Record<string, string> {
  if (!value || value.trim() === "") return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("STEWARD_PREVIOUS_MASTER_KEYS must be a JSON object of {keyId: key}");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("STEWARD_PREVIOUS_MASTER_KEYS must be a JSON object of {keyId: key}");
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof v !== "string") throw new Error(`STEWARD_PREVIOUS_MASTER_KEYS["${k}"] must be a string`);
    out[k] = v;
  }
  return out;
}

export function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  const v = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  throw new Error("Expected a boolean (true/false, yes/no, on/off, or 1/0)");
}

export interface CoreContext {
  db: Db;
  pool: Pool;
  crypto: EnvelopeCrypto;
  config: CoreConfig;
  log: pino.Logger;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): CoreConfig {
  const req = (k: string) => {
    const v = env[k]?.trim();
    if (!v) throw new Error(`Missing required environment variable ${k}`);
    return v;
  };
  const nodeEnv = env.NODE_ENV?.trim() || "development";
  if (!["development", "test", "production"].includes(nodeEnv)) throw new Error("NODE_ENV must be development, test, or production");
  const databaseUrl = req("DATABASE_URL");
  const masterKey = req("STEWARD_MASTER_KEY");
  const sessionSecret = req("SESSION_SECRET");
  const databasePoolMax = Number(env.DATABASE_POOL_MAX?.trim() || 5);
  if (!Number.isInteger(databasePoolMax) || databasePoolMax < 1 || databasePoolMax > 100) throw new Error("DATABASE_POOL_MAX must be an integer between 1 and 100");
  if (!/^postgres(?:ql)?:\/\//.test(databaseUrl)) throw new Error("DATABASE_URL must be a PostgreSQL URL");
  const previousMasterKeys = parseKeyMap(env.STEWARD_PREVIOUS_MASTER_KEYS);
  try {
    // Use the same decoder as encryption: existing hex and base64 keys must remain usable.
    new EnvMasterKeyProvider(masterKey, previousMasterKeys);
  } catch {
    throw new Error("STEWARD_MASTER_KEY and STEWARD_PREVIOUS_MASTER_KEYS must contain 32-byte keys (hex or base64)");
  }
  if (sessionSecret.length < 32) throw new Error("SESSION_SECRET must contain at least 32 characters");
  const url = (key: string, fallback: string) => {
    const value = env[key]?.trim() || fallback;
    try {
      const parsed = new URL(value);
      if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error();
      if (key === "APP_URL" && parsed.pathname !== "/") throw new Error();
      return value.replace(/\/$/, "");
    } catch {
      throw new Error(`${key} must be an HTTP(S) URL without credentials, query, or fragment${key === "APP_URL" ? " (origin only)" : ""}`);
    }
  };
  const appUrl = url("APP_URL", "http://localhost:3000");
  const apiUrl = url("API_URL", "http://localhost:4000");
  return {
    databaseUrl,
    databasePoolMax,
    masterKey,
    previousMasterKeys,
    sessionSecret,
    appUrl,
    apiUrl,
    apiInternalUrl: url("API_INTERNAL_URL", apiUrl),
    env: nodeEnv as CoreConfig["env"],
    logLevel: env.LOG_LEVEL,
    allowSignup: parseBoolean(env.ALLOW_SIGNUP, nodeEnv !== "production"),
  };
}

export function createLogger(config: Pick<CoreConfig, "env" | "logLevel">, name: string): pino.Logger {
  return pino({
    name,
    level: config.logLevel ?? (config.env === "production" ? "info" : "debug"),
    redact: { paths: ["*.apiKey", "*.secret", "*.password", "*.token", "*.authorization", "req.headers.cookie", "req.headers.authorization"], censor: "[redacted]" },
    ...(config.env === "development" ? { transport: { target: "pino/file", options: { destination: 1 } } } : {}),
  });
}

export function createCoreContext(config: CoreConfig, name = "steward"): CoreContext {
  const crypto = new EnvelopeCrypto(new EnvMasterKeyProvider(config.masterKey, config.previousMasterKeys));
  const { db, pool } = createDb(config.databaseUrl, config.databasePoolMax);
  return { db, pool, crypto, config, log: createLogger(config, name) };
}

/**
 * Shared secret for service-to-service calls (worker → API companion proxy). Set STEWARD_INTERNAL_TOKEN
 * explicitly in production; otherwise it is derived from the master key so single-host setups work unconfigured.
 */
export function internalServiceToken(config: Pick<CoreConfig, "masterKey">, env: NodeJS.ProcessEnv = process.env): string {
  return env.STEWARD_INTERNAL_TOKEN || hmacSign(config.masterKey, "steward-internal-service-v1");
}
