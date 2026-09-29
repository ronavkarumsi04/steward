-- Memory 2.0: a memory that earns its place, and can be corrected rather than only deleted (ADR-0022).
--
-- Memory is the one row in this product that is read by a model without being asked for: it is retrieved by
-- relevance into the prompt of a run that never requested it, and the agent plans on it as true. That is why a
-- memory needs more than a write path. This migration adds the half that lets a company change its mind.
--
--   1. A correction is a version, not an overwrite. `memory_revisions` keeps the words a correction replaced,
--      with the author and the reason, so "what did this say before, and who changed it" is answerable.
--
--   2. The columns that make a memory trustworthy become real: `corrected_by`/`corrected_at` name the person who
--      fixed it, `superseded_at` dates the fact that replaced it (beside the `superseded_by` that was here but
--      nothing ever wrote), `confirmations`/`last_confirmed_at` count a person's agreement, and `about_entity_id`
--      points a fact at the thing it is about.
--
--   3. `kind = 'entity'` stops being a home for identity. `entities` owns who and what a name refers to now
--      (0016), and a second home for the same idea is exactly the duplication the graph exists to remove. Every
--      existing entity memory is folded into `entities` — keeping its content as an attribute and its provenance
--      — and the rows are then removed, so there is one answer to "what do we know about Acme" rather than two.
--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "superseded_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "corrected_by" jsonb;
--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "corrected_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "confirmations" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "last_confirmed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "about_entity_id" text;
--> statement-breakpoint
-- A fact outlives the thing it named: deleting an entity leaves the memory standing, unfiled.
ALTER TABLE "memories" ADD CONSTRAINT "memories_about_entity_id_entities_id_fk" FOREIGN KEY ("about_entity_id") REFERENCES "public"."entities"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "memory_revisions" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"organization_id" text NOT NULL,
	"company_id" text NOT NULL,
	"memory_id" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"content" text NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"author" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "memory_revisions" ADD CONSTRAINT "memory_revisions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "memory_revisions" ADD CONSTRAINT "memory_revisions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- A revision without the memory it belongs to is not a history, so forgetting a memory takes its versions with it.
ALTER TABLE "memory_revisions" ADD CONSTRAINT "memory_revisions_memory_id_memories_id_fk" FOREIGN KEY ("memory_id") REFERENCES "public"."memories"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- Same tenancy invariant as every other company-owned table (0009).
ALTER TABLE "memory_revisions" ADD CONSTRAINT "memory_revisions_tenant_fk" FOREIGN KEY ("company_id","organization_id") REFERENCES "companies" ("id","organization_id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE INDEX "memory_revisions_memory_idx" ON "memory_revisions" USING btree ("memory_id","created_at");
--> statement-breakpoint
-- The review queue: an automatic memory about to expire that nobody has confirmed.
CREATE INDEX "memories_review_idx" ON "memories" USING btree ("company_id","expires_at");
--> statement-breakpoint
-- Fold every existing entity memory into the graph. The name fold is the same one the graph itself uses
-- (0016): lower-case, surrounding and collapsed space, trailing punctuation dropped. A name the company already
-- knows is *confirmed* rather than duplicated, and the memory's text is kept as an attribute either way.
INSERT INTO "entities" ("organization_id", "company_id", "type", "name", "normalized_name", "attributes", "confidence", "source", "first_seen_run_id", "last_confirmed_at")
SELECT
	"organization_id",
	"company_id",
	'other',
	COALESCE(NULLIF("title", ''), "content"),
	regexp_replace(lower(btrim(regexp_replace(btrim(COALESCE(NULLIF("title", ''), "content")), '\s+', ' ', 'g'))), '[.,;:!?]+$', ''),
	jsonb_build_object('note', "content"),
	"confidence",
	CASE WHEN COALESCE("source" ->> 'type', '') = 'agent' THEN 'agent' ELSE 'founder' END,
	"created_by_run_id",
	now()
FROM "memories"
WHERE "kind" = 'entity'
ON CONFLICT ("company_id", "type", "normalized_name")
DO UPDATE SET "attributes" = "entities"."attributes" || EXCLUDED."attributes", "last_confirmed_at" = now();
--> statement-breakpoint
-- One home for identity: the entity memories have moved into the graph, so the rows go.
DELETE FROM "memories" WHERE "kind" = 'entity';
