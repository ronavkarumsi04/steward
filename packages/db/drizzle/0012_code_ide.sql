-- The code IDE: a repository a founder reads, edits and runs from inside Steward.
--
-- Two tables, and the split is the point:
--   1. code_sessions — an editing session against one repository and one base ref. It records the branch the
--                      changes are meant for and the run that is committing them, if one exists. Nothing is
--                      written to the repository by this table; a session is a proposal.
--   2. code_changes  — one proposed change per file: the text as it is in the repository (`original`) and the
--                      text it should have (`contents`). `contents` null means delete, `original` null means the
--                      file is new, and both are nullable because neither default has a meaning here.
--
-- The unique index on (session_id, path) is the same idea as the reaction one-fire index: a session holds at most
-- one proposal per file, so the diff a founder approves cannot have two answers for the same path.
--> statement-breakpoint
CREATE TABLE "code_sessions" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"organization_id" text NOT NULL,
	"company_id" text NOT NULL,
	"repo" text NOT NULL,
	"base_ref" text NOT NULL,
	"branch" text NOT NULL,
	"title" text NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"apply_run_id" text,
	"created_by" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "code_changes" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"organization_id" text NOT NULL,
	"company_id" text NOT NULL,
	"session_id" text NOT NULL,
	"path" text NOT NULL,
	"original" text,
	"contents" text,
	"original_sha" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "code_sessions" ADD CONSTRAINT "code_sessions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "code_sessions" ADD CONSTRAINT "code_sessions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "code_changes" ADD CONSTRAINT "code_changes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "code_changes" ADD CONSTRAINT "code_changes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- A change without its session is not a change: discarding a session discards its proposals with it.
ALTER TABLE "code_changes" ADD CONSTRAINT "code_changes_session_id_code_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."code_sessions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- Same tenancy invariant as every other company-owned table (0009): a row's company must belong to the
-- organization the row claims.
ALTER TABLE "code_sessions" ADD CONSTRAINT "code_sessions_tenant_fk" FOREIGN KEY ("company_id","organization_id") REFERENCES "companies" ("id","organization_id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "code_changes" ADD CONSTRAINT "code_changes_tenant_fk" FOREIGN KEY ("company_id","organization_id") REFERENCES "companies" ("id","organization_id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE UNIQUE INDEX "code_changes_path_idx" ON "code_changes" USING btree ("session_id","path");
--> statement-breakpoint
CREATE INDEX "code_changes_company_idx" ON "code_changes" USING btree ("company_id","session_id");
--> statement-breakpoint
CREATE INDEX "code_sessions_company_idx" ON "code_sessions" USING btree ("company_id","created_at");
--> statement-breakpoint
CREATE INDEX "code_sessions_run_idx" ON "code_sessions" USING btree ("apply_run_id");
