import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

let pool: pg.Pool | undefined;
let db: Db | undefined;

export function getPool(connectionString = process.env.DATABASE_URL): pg.Pool {
  if (!pool) {
    if (!connectionString) throw new Error("DATABASE_URL is not set");
    pool = new pg.Pool({ connectionString, max: Number(process.env.DATABASE_POOL_MAX ?? 10) });
  }
  return pool;
}

export function getDb(connectionString?: string): Db {
  if (!db) db = drizzle(getPool(connectionString), { schema });
  return db;
}

export function createDb(connectionString: string, max = 5): { db: Db; pool: pg.Pool } {
  const p = new pg.Pool({ connectionString, max, connectionTimeoutMillis: 3_000 });
  return { db: drizzle(p, { schema }), pool: p };
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = undefined;
  db = undefined;
}
