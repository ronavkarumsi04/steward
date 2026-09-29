import { createDb } from "@steward/db";
import { expiryFor, MemoryService } from "@steward/memory";

/**
 * Write an automatic memory the way the agent runtime does (ADR-0022 §1, `packages/agents/src/runtime.ts`).
 *
 * The confirmation queue is a founder's review of what *runs* have decided to remember, and no request can create
 * one: the API's write route records a person's act, while a run's own write carries `source: { type: "auto" }` and
 * a 21-day life that a confirmation cancels. A queue that can only ever be demonstrated by a request would be a
 * queue nobody can test, so this reproduces the runtime's exact write — the same `MemoryService.save` call with the
 * same source, confidence, importance and expiry — against the same Postgres the running stack uses. What the
 * browser then reads is a real row of the kind a run leaves behind, not a shape invented for the test.
 *
 * `expiresAt` overrides that window: a near date drives "expires tomorrow", and one in the past drives a memory
 * that has already lapsed and so is not read back.
 */

/** Matches `docker compose` and `scripts/verify-boot.sh`, so the suite seeds the stack it is pointed at. */
const DATABASE_URL = process.env.DATABASE_URL?.trim() || "postgres://steward:steward@localhost:5432/steward";

export async function seedAutomaticMemory(input: { organizationId: string; companyId: string; content: string; title?: string; expiresAt?: Date | null }): Promise<string> {
  const { db, pool } = createDb(DATABASE_URL);
  try {
    const saved = await new MemoryService({
      db,
      // The seed is the test's own act, so it is honest about that in the event it emits; the *memory's* source is
      // the runtime's, because that is the row under test.
      scope: { organizationId: input.organizationId, companyId: input.companyId, actor: { type: "system", component: "e2e-seed" } },
    }).save({
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
    await pool.end();
  }
}
