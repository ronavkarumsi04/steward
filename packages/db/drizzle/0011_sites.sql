-- The Site Studio: a company's website as durable rows rather than generated markup.
--
-- Three tables, each removing a way for the editor and the published site to disagree:
--   1. sites         — one per company, holding the name and the theme. A site is a thing a company owns,
--                      not a document an agent happens to have written once.
--   2. site_pages    — an address, a title, and the ordered blocks on it. The unique index on
--                      (site_id, slug) means two pages cannot claim the same address, so the renderer never
--                      has to decide which one wins.
--   3. site_versions — a published snapshot: the whole model, the files it rendered to, and the digest that
--                      makes the two provable against each other. The model is stored rather than referenced,
--                      so a version can be rebuilt byte for byte after the draft has moved on, and
--                      (site_id, number) is unique because a version number is an identity, not a label.
--
-- The bundle itself lives in `artifacts` (kind 'site_bundle'), so a published site is exportable, listable and
-- auditable by every surface that already knows how to show an artifact.
--> statement-breakpoint
CREATE TABLE "sites" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"organization_id" text NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"theme" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_pages" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"organization_id" text NOT NULL,
	"company_id" text NOT NULL,
	"site_id" text NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"blocks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_versions" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"organization_id" text NOT NULL,
	"company_id" text NOT NULL,
	"site_id" text NOT NULL,
	"number" integer NOT NULL,
	"model" jsonb NOT NULL,
	"files" jsonb NOT NULL,
	"digest" text NOT NULL,
	"bytes" integer NOT NULL,
	"page_count" integer NOT NULL,
	"file_count" integer NOT NULL,
	"artifact_id" text,
	"created_by" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "site_pages" ADD CONSTRAINT "site_pages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "site_pages" ADD CONSTRAINT "site_pages_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- A page without its site is not a page: deleting a site takes its pages with it.
ALTER TABLE "site_pages" ADD CONSTRAINT "site_pages_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "site_versions" ADD CONSTRAINT "site_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "site_versions" ADD CONSTRAINT "site_versions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "site_versions" ADD CONSTRAINT "site_versions_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- A published version keeps its record when the bundle artifact is pruned, and keeps the artifact when the row
-- is only being re-pointed: the version is the promise, the artifact is where the bytes live.
ALTER TABLE "site_versions" ADD CONSTRAINT "site_versions_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
-- Same tenancy invariant as every other company-owned table (0009): a row's company must belong to the
-- organization the row claims.
ALTER TABLE "sites" ADD CONSTRAINT "sites_tenant_fk" FOREIGN KEY ("company_id","organization_id") REFERENCES "companies" ("id","organization_id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "site_pages" ADD CONSTRAINT "site_pages_tenant_fk" FOREIGN KEY ("company_id","organization_id") REFERENCES "companies" ("id","organization_id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "site_versions" ADD CONSTRAINT "site_versions_tenant_fk" FOREIGN KEY ("company_id","organization_id") REFERENCES "companies" ("id","organization_id") ON DELETE CASCADE;
--> statement-breakpoint
-- One site per company, enforced rather than assumed: two sites would mean two answers to "what is our site".
CREATE UNIQUE INDEX "sites_company_idx" ON "sites" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX "sites_org_idx" ON "sites" USING btree ("organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "site_pages_slug_idx" ON "site_pages" USING btree ("site_id","slug");
--> statement-breakpoint
CREATE INDEX "site_pages_company_idx" ON "site_pages" USING btree ("company_id","position");
--> statement-breakpoint
CREATE UNIQUE INDEX "site_versions_number_idx" ON "site_versions" USING btree ("site_id","number");
--> statement-breakpoint
CREATE INDEX "site_versions_company_idx" ON "site_versions" USING btree ("company_id","site_id","number");
