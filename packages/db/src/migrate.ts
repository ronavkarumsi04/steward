import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { closeDb, getDb, getPool } from "./client.js";

export async function runMigrations(): Promise<void> {
  const pool = getPool();
  await pool.query("CREATE EXTENSION IF NOT EXISTS vector");
  await pool.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../drizzle");
  await migrate(getDb(), { migrationsFolder: dir });
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  runMigrations()
    .then(async () => {
      console.log("migrations applied");
      await closeDb();
    })
    .catch(async (e) => {
      console.error(e);
      await closeDb();
      process.exit(1);
    });
}
