-- Workflows: the reaction rules and schedules a founder draws instead of writes.
--
-- Two tables, and the split is the design:
--   1. workflows        — the drawing. `nodes` is a draft, and `revision`/`published_at` say whether anything
--                         has ever been published from it. Editing a drawing changes nothing that runs.
--   2. workflow_bindings — what each trigger published: one row per (workflow, trigger), naming the rule or the
--                         schedule that carries it out. This is what lets the surface show the live row behind a
--                         node, notice that the row was edited somewhere else, and know which rows are its own
--                         to update or remove.
--
-- The unique index on (workflow_id, trigger_id) is what makes republishing an update rather than a duplicate: a
-- trigger keeps the same rule for the life of the drawing, so the rule's fire history and the ledger rows that
-- point at it stay attached to the rule a founder is looking at.
--
-- `target_id` deliberately has no foreign key. A row deleted by hand is a state the workflow must be able to
-- report ("the rule this workflow published is gone"), and a foreign key would turn that report into a failure
-- to read the workflow at all.
--
-- Note for whoever changes this next: `drizzle-kit generate` cannot be used in this repository. Only
-- `0000_snapshot.json` was ever kept, so the tool diffs today's schema against the initial one and would emit a
-- migration that re-creates most of the database. Migrations here are written by hand, and the journal below
-- with them.
--> statement-breakpoint
CREATE TABLE "workflows" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"organization_id" text NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"nodes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"published_at" timestamp with time zone,
	"created_by" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_bindings" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"organization_id" text NOT NULL,
	"company_id" text NOT NULL,
	"workflow_id" text NOT NULL,
	"trigger_id" text NOT NULL,
	"target_kind" text NOT NULL,
	"target_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workflow_bindings" ADD CONSTRAINT "workflow_bindings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workflow_bindings" ADD CONSTRAINT "workflow_bindings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- A binding without its workflow is not a binding, and a deleted workflow must take its bindings with it or the
-- next workflow to be created could inherit them.
ALTER TABLE "workflow_bindings" ADD CONSTRAINT "workflow_bindings_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- Same tenancy invariant as every other company-owned table (0009): a row's company must belong to the
-- organization the row claims.
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_tenant_fk" FOREIGN KEY ("company_id","organization_id") REFERENCES "companies" ("id","organization_id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "workflow_bindings" ADD CONSTRAINT "workflow_bindings_tenant_fk" FOREIGN KEY ("company_id","organization_id") REFERENCES "companies" ("id","organization_id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE INDEX "workflows_company_idx" ON "workflows" USING btree ("company_id","enabled");
--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_bindings_trigger_idx" ON "workflow_bindings" USING btree ("workflow_id","trigger_id");
--> statement-breakpoint
CREATE INDEX "workflow_bindings_company_idx" ON "workflow_bindings" USING btree ("company_id","target_kind","target_id");
