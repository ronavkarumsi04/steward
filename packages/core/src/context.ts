import pino from "pino";
import { EnvMasterKeyProvider, EnvelopeCrypto } from "@steward/crypto";
import { createDb, type Db } from "@steward/db";
import type pg from "pg";
type Pool = pg.Pool;

export interface CoreConfig {
  databaseUrl: string;
  masterKey: string;
  sessionSecret: string;
  appUrl: string;
  apiUrl: string;
  env: "development" | "test" | "production";
  logLevel?: string;
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
    const v = env[k];
    if (!v) throw new Error(`Missing required environment variable ${k}`);
    return v;
  };
  const nodeEnv = (env.NODE_ENV ?? "development") as CoreConfig["env"];
  return {
    databaseUrl: req("DATABASE_URL"),
    masterKey: req("STEWARD_MASTER_KEY"),
    sessionSecret: req("SESSION_SECRET"),
    appUrl: env.APP_URL ?? "http://localhost:3000",
    apiUrl: env.API_URL ?? "http://localhost:4000",
    env: nodeEnv === "production" || nodeEnv === "test" ? nodeEnv : "development",
    logLevel: env.LOG_LEVEL,
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
  const { db, pool } = createDb(config.databaseUrl);
  const crypto = new EnvelopeCrypto(new EnvMasterKeyProvider(config.masterKey));
  return { db, pool, crypto, config, log: createLogger(config, name) };
}
