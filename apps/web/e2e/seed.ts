import { createDb, type Db } from "@steward/db";
import { expiryFor, MemoryService } from "@steward/memory";
import type { Actor, Role, TenantScope } from "@steward/schema";

/**
 * The one place this suite reaches past the API into the stack's own Postgres, and the rules for doing it.
 *
 * Almost everything these tests need, they create the way a founder does: register, onboard, and let the API record
 * the act — because the point of a browser test is that the request, the row and the page are one story. But a
 * little of what the product *shows* is not the caller's to write. A memory a run decided to remember carries the
 * run's own provenance (`source: { type: "auto" }`) and a life a confirmation cancels; a live browser session
 * belongs to the agent's process. No request can create either, and for the same reason both times: every write
 * route records the caller's act. That is exactly the property that makes a provenance line worth printing, so the
 * gap is not a missing endpoint to be added — it is the shape of the thing.
 *
 * So this seam exists for that class of state, under three rules:
 *
 *  1. **It writes the way the product writes.** A seeder calls the product's own service with the product's own
 *     values, never hand-written SQL, and names the real write it reproduces. A change to that write's meaning is a
 *     change here, which is the one failure mode a fixture cannot have: a row that is right today and wrong in
 *     silence tomorrow. A spec may also drive a product service against the connection this opens (`browser-live`
 *     does), under the same rule — the service is the writer, this file only hands it the database.
 *  2. **It seeds the stack under test.** One connection string, resolved the way `scripts/verify-boot.sh` resolves
 *     it, and whatever it opens it closes. A seed that quietly wrote to another database would be worse than none.
 *  3. **It stays test-only.** `e2e/` is outside the Next build and outside the app's `tsconfig`, nothing in this
 *     file is reachable from `src`, and the app depends on the packages below only as dev dependencies for this
 *     reason.
 *
 * The default is still the API: anything a spec *can* create through a request, it creates in the spec.
 */

/** Matches `docker compose` and `scripts/verify-boot.sh`, so the suite seeds the stack it is pointed at. */
const DATABASE_URL = process.env.DATABASE_URL?.trim() || "postgres://steward:steward@localhost:5432/steward";

/** The pool type, taken from the factory rather than named, so this file needs no dependency on `pg` itself. */
type SeedPool = ReturnType<typeof createDb>["pool"];

export interface SeedDb {
  /** The product's own client, for the services a seeder hands it to. */
  db: Db;
  /** Raw SQL, for the one read no service exposes (a company's organisation). */
  pool: SeedPool;
  close(): Promise<void>;
}

/** Open the stack's Postgres for a test. Always closed in a `finally`, even when the test fails halfway. */
export function openSeedDb(connectionString = DATABASE_URL): SeedDb {
  const { db, pool } = createDb(connectionString);
  return { db, pool, close: () => pool.end() };
}

/**
 * The scope a seeded row belongs to: the company's own organisation, resolved from the company itself rather than
 * assumed from the session, so a seed cannot end up filed under the wrong tenant.
 *
 * The actor defaults to a system component, because a seed is the test's act — and a row whose *provenance* is
 * under test takes that from the seeder's own `source`, not from this.
 */
export async function seedScope(seed: SeedDb, companyId: string, opts: { actor?: Actor; role?: Role } = {}): Promise<TenantScope> {
  const { rows } = await seed.pool.query<{ organization_id: string }>("select organization_id from companies where id = $1", [companyId]);
  const organizationId = rows[0]?.organization_id;
  if (!organizationId) throw new Error(`No company ${companyId} in this database — nothing was seeded.`);
  return { organizationId, companyId, role: opts.role, actor: opts.actor ?? { type: "system", component: "e2e-seed" } };
}

/**
 * A memory a run decided to remember (ADR-0022 §1), reproduced from `packages/agents/src/runtime.ts`.
 *
 * The confirmation queue is a founder's review of what runs have kept, and no request can put a row in it: the
 * API's write route records a person's act. This is the same `MemoryService.save` call the runtime makes, with the
 * same source, confidence, importance and 21-day life, so what the browser reads is a real row of the kind a run
 * leaves behind and not a shape invented for the test.
 *
 * `expiresAt` overrides that window: a near date drives the "expires tomorrow" sentence, and one in the past drives
 * a memory that has already lapsed and so is not read back.
 */
export async function seedAutomaticMemory(input: { companyId: string; content: string; title?: string; expiresAt?: Date | null }): Promise<string> {
  const seed = openSeedDb();
  try {
    const saved = await new MemoryService({ db: seed.db, scope: await seedScope(seed, input.companyId) }).save({
      kind: "episodic",
      title: input.title ?? "Chief of Staff: the run ended without a clean verification",
      content: input.content,
      importance: 3,
      confidence: 0.5,
      tags: ["orchestrator"],
      source: { type: "auto", component: "agent-runtime" },
      expiresAt: input.expiresAt === undefined ? expiryFor("auto") : input.expiresAt,
    });
    return saved.id;
  } finally {
    await seed.close();
  }
}
