import { sql } from "drizzle-orm";
import type { Actor, EventType } from "@steward/schema";
import type { DbOrTx } from "./client.js";
import { events } from "./schema.js";

export interface EmitEventInput {
  organizationId: string;
  companyId?: string | null;
  type: EventType;
  actor: Actor;
  payload?: Record<string, unknown>;
  correlation?: Record<string, string>;
}

export const EVENTS_CHANNEL = "steward_events";

/** Appends an event and notifies listeners in the same transaction. */
export async function emitEvent(tx: DbOrTx, input: EmitEventInput) {
  const [row] = await tx
    .insert(events)
    .values({
      organizationId: input.organizationId,
      companyId: input.companyId ?? null,
      type: input.type,
      actor: input.actor as Record<string, unknown>,
      payload: input.payload ?? {},
      correlation: input.correlation ?? {},
    })
    .returning();
  if (!row) throw new Error("failed to insert event");
  const note = JSON.stringify({ seq: row.seq, companyId: row.companyId, organizationId: row.organizationId, type: row.type });
  await tx.execute(sql`select pg_notify(${EVENTS_CHANNEL}, ${note})`);
  return row;
}
