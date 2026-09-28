-- The knowledge graph: what the company knows, as one thing.
--
-- `entities` has been in the schema since the beginning and nothing ever wrote to it, because a name on its own
-- is not knowledge — it is a noun with no evidence. This migration makes the table into the thing the graph
-- needed, and adds the half that was missing.
--
--   1. entities now has an *identity*. `normalized_name` is the name folded to one spelling (lower-case,
--      surrounding and collapsed space, trailing punctuation dropped) and is unique per (company, type), so two
--      ways of writing the same name are one row instead of two nodes in the graph. `aliases` keeps the other
--      spellings a company has used — including every spelling a merged duplicate arrived with — because the
--      answer to "why is this not two rows?" has to survive the merge. `source`, `first_seen_run_id`,
--      `confidence` and `last_confirmed_at` are the provenance: a claim in this table can always be traced to
--      the person or the run that made it.
--
--   2. entity_links is new: a claim that one of those things is connected to something the company has a row
--      for. The target is named by (target_kind, target_id) and resolved at read time rather than copied, so a
--      link can never disagree with the row it is about. A target that has since been deleted is *reported* as
--      dangling — the surface says the thing it pointed at is gone and offers to drop the claim — which is the
--      honest alternative to cascading from here into nine tables.
--
-- Nothing about the derived half of the graph is stored anywhere: task→project, run→agent, artifact→run,
-- memory→run and the rest are read from the columns the product already writes. That is what keeps the graph
-- from being a second copy of the database that drifts from it.
--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "normalized_name" text;
--> statement-breakpoint
UPDATE "entities" SET "normalized_name" = regexp_replace(lower(btrim(regexp_replace(btrim("name"), '\s+', ' ', 'g'))), '[.,;:!?]+$', '');
--> statement-breakpoint
ALTER TABLE "entities" ALTER COLUMN "normalized_name" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "aliases" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "confidence" numeric(4, 3) DEFAULT '0.700' NOT NULL;
--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "source" text DEFAULT 'founder' NOT NULL;
--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "first_seen_run_id" text;
--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "last_confirmed_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
DROP INDEX "entities_name_idx";
--> statement-breakpoint
-- Identity, not spelling: this is the index that decides what one thing is.
CREATE UNIQUE INDEX "entities_identity_idx" ON "entities" USING btree ("company_id","type","normalized_name");
--> statement-breakpoint
CREATE INDEX "entities_company_type_idx" ON "entities" USING btree ("company_id","type","name");
--> statement-breakpoint
CREATE TABLE "entity_links" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"organization_id" text NOT NULL,
	"company_id" text NOT NULL,
	"entity_id" text NOT NULL,
	"relation" text NOT NULL,
	"target_kind" text NOT NULL,
	"target_id" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"source" text DEFAULT 'founder' NOT NULL,
	"created_by_run_id" text,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "entity_links" ADD CONSTRAINT "entity_links_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "entity_links" ADD CONSTRAINT "entity_links_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- A link without the thing it is about is not a claim, so forgetting an entity takes its claims with it. The
-- service moves links before it deletes an entity it is merging into another, which is how knowledge survives a
-- merge; this constraint is what stops a claim outliving its author.
ALTER TABLE "entity_links" ADD CONSTRAINT "entity_links_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- Same tenancy invariant as every other company-owned table (0009): a row's company must belong to the
-- organization the row claims.
ALTER TABLE "entity_links" ADD CONSTRAINT "entity_links_tenant_fk" FOREIGN KEY ("company_id","organization_id") REFERENCES "companies" ("id","organization_id") ON DELETE CASCADE;
--> statement-breakpoint
-- The claim itself. Recording the same connection twice is one row rather than a doubled neighborhood.
CREATE UNIQUE INDEX "entity_links_claim_idx" ON "entity_links" USING btree ("company_id","entity_id","relation","target_kind","target_id");
--> statement-breakpoint
CREATE INDEX "entity_links_entity_idx" ON "entity_links" USING btree ("entity_id","created_at");
--> statement-breakpoint
CREATE INDEX "entity_links_target_idx" ON "entity_links" USING btree ("company_id","target_kind","target_id");
