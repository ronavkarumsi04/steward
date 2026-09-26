/**
 * Migration integrity tests. Every schema change has to be provable in two ways: the journal and the SQL
 * files agree, and the invariants a migration claims to create actually exist in a live database.
 *
 * The last check is the one that earns its keep. It fails when a new tenant table is added without the
 * composite foreign key, which is precisely how the tenancy gaps that migration 0009 fixes were introduced
 * — a promise in a document is not enforcement, and a test that reads the live catalog is.
 *
 * Live checks are skipped when the database is unreachable, so unit-only runs still pass.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
const drizzleDir = path.resolve(here, "../drizzle");
const url = process.env.DATABASE_URL ?? "postgres://steward:steward@localhost:5432/steward";

const journal = JSON.parse(readFileSync(path.join(drizzleDir, "meta", "_journal.json"), "utf8")) as { entries: Array<{ idx: number; tag: string }> };

/**
 * Tables that own data by company but deliberately have no foreign key to companies:
 * suppression records exist to keep an opt-out honored *after* an organization is deleted, so they must
 * survive the cascade. Everything else with both columns must be constrained.
 */
const TENANT_FK_EXCEPTIONS = ["suppression_list"];

describe("migration journal", () => {
  it("numbers entries from zero without gaps", () => {
    expect(journal.entries.map((e) => e.idx)).toEqual(journal.entries.map((_, i) => i));
  });

  it("has a SQL file for every journal entry", () => {
    const files = readdirSync(drizzleDir);
    for (const entry of journal.entries) expect(files, `${entry.tag}.sql must exist`).toContain(`${entry.tag}.sql`);
  });

  it("has no SQL file that the journal does not know about", () => {
    const known = new Set(journal.entries.map((e) => e.tag));
    const orphans = readdirSync(drizzleDir)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => f.replace(/\.sql$/, ""))
      .filter((tag) => !known.has(tag));
    expect(orphans).toEqual([]);
  });
});

let pool: pg.Pool | null = null;
beforeAll(async () => {
  try {
    const probe = new pg.Pool({ connectionString: url, connectionTimeoutMillis: 1500 });
    await probe.query("select 1");
    pool = probe;
  } catch {
    pool = null;
  }
});
afterAll(async () => {
  await pool?.end();
});

/** Runs only when a database is reachable; skipped (not silently passed) otherwise. */
const live = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (!pool) {
      console.warn(`skipped (no database at ${url}): ${name}`);
      return;
    }
    await fn();
  });

async function fixture() {
  const suffix = Math.random().toString(36).slice(2, 10);
  const orgA = `org_a_${suffix}`;
  const orgB = `org_b_${suffix}`;
  const companyA = `co_a_${suffix}`;
  const q = pool!;
  await q.query(`insert into organizations (id, name, slug) values ($1,$2,$3), ($4,$5,$6)`, [orgA, "Tenant A", orgA, orgB, "Tenant B", orgB]);
  await q.query(`insert into companies (id, organization_id, name, slug) values ($1,$2,$3,$4)`, [companyA, orgA, "Tenant A Co", companyA]);
  return {
    orgA,
    orgB,
    companyA,
    async cleanup() {
      await q.query(`delete from companies where id = $1`, [companyA]).catch(() => undefined);
      await q.query(`delete from organizations where id = any($1)`, [[orgA, orgB]]).catch(() => undefined);
    },
  };
}

describe("migration invariants", () => {
  live("has applied every migration in the journal", async () => {
    const { rows } = await pool!.query<{ n: string }>(`select count(*)::text as n from drizzle.__drizzle_migrations`);
    expect(Number(rows[0]!.n)).toBeGreaterThanOrEqual(journal.entries.length);
  });

  live("constrains every company-owned table to one organization at the database level", async () => {
    const { rows } = await pool!.query<{ table_name: string }>(`
      select c.table_name
      from information_schema.columns c
      join information_schema.columns o
        on o.table_name = c.table_name and o.column_name = 'organization_id' and o.is_nullable = 'NO' and o.table_schema = 'public'
      where c.table_schema = 'public' and c.table_name <> 'companies' and c.column_name = 'company_id' and c.is_nullable = 'NO'
      order by c.table_name
    `);
    const tables = rows.map((r) => r.table_name).filter((t) => !TENANT_FK_EXCEPTIONS.includes(t));
    const { rows: constrained } = await pool!.query<{ conname: string }>(`select conname from pg_constraint where conname like '%\\_tenant\\_fk'`);
    const have = new Set(constrained.map((c) => c.conname.replace(/_tenant_fk$/, "")));
    expect(tables.length).toBeGreaterThan(20);
    expect(tables.filter((t) => !have.has(t))).toEqual([]);
  });

  live("rejects a row whose company belongs to a different organization", async () => {
    const f = await fixture();
    try {
      // organization_id says tenant B, company_id belongs to tenant A: unrepresentable after 0009.
      await expect(
        pool!.query(`insert into tasks (organization_id, company_id, title, created_by) values ($1,$2,$3,$4::jsonb)`, [f.orgB, f.companyA, "cross-tenant", '{"type":"user"}']),
      ).rejects.toThrow(/tenant_fk|foreign key/i);
    } finally {
      await f.cleanup();
    }
  });

  live("deduplicates signals per company rather than globally", async () => {
    const f = await fixture();
    const suffix = Math.random().toString(36).slice(2, 8);
    try {
      const insert = `insert into business_signals (organization_id, company_id, provider, external_id, kind, title) values ($1,$2,$3,$4,$5,$6)`;
      await pool!.query(insert, [f.orgA, f.companyA, `test_${suffix}`, "evt-1", "test", "first"]);
      // Same provider + external id inside the same company is a duplicate and must be rejected.
      await expect(pool!.query(insert, [f.orgA, f.companyA, `test_${suffix}`, "evt-1", "test", "duplicate"])).rejects.toThrow(/unique|duplicate key/i);
      // A different company may legitimately see the same external id; unique index must not be global.
      const { rows } = await pool!.query<{ indexdef: string }>(`select indexdef from pg_indexes where indexname = 'business_signals_company_provider_external_idx'`);
      expect(rows[0]?.indexdef).toContain("company_id");
    } finally {
      await f.cleanup();
    }
  });

  live("keeps suppression records after their organization is deleted", async () => {
    const f = await fixture();
    const suffix = Math.random().toString(36).slice(2, 8);
    const address = `opt-out-${suffix}@example.com`;
    try {
      await pool!.query(`insert into suppression_list (organization_id, company_id, channel, address, reason) values ($1,$2,$3,$4,$5)`, [f.orgA, f.companyA, "email", address, "test"]);
      await pool!.query(`delete from organizations where id = $1`, [f.orgA]);
      const { rows } = await pool!.query<{ n: string }>(`select count(*)::text as n from suppression_list where address = $1`, [address]);
      expect(Number(rows[0]!.n)).toBe(1);
    } finally {
      await pool!.query(`delete from suppression_list where address = $1`, [address]).catch(() => undefined);
      await f.cleanup();
    }
  });
});
