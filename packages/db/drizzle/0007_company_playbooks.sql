ALTER TABLE "documents" ADD COLUMN "kind" text DEFAULT 'document' NOT NULL;
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "project_id" text;
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "agent_kinds" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "documents_playbook_idx" ON "documents" USING btree ("company_id","kind","project_id");
--> statement-breakpoint
CREATE TABLE "document_versions" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"organization_id" text NOT NULL,
	"company_id" text NOT NULL,
	"document_id" text NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"format" text DEFAULT 'markdown' NOT NULL,
	"folder" text DEFAULT '/' NOT NULL,
	"kind" text DEFAULT 'document' NOT NULL,
	"project_id" text,
	"agent_kinds" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_versions_document_version_idx" UNIQUE("document_id","version")
);
--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "document_versions_company_idx" ON "document_versions" USING btree ("company_id","document_id","version");
--> statement-breakpoint
INSERT INTO "document_versions" ("organization_id", "company_id", "document_id", "version", "title", "content", "format", "folder", "kind", "project_id", "agent_kinds", "created_by", "created_at")
SELECT "organization_id", "company_id", "id", "version", "title", "content", "format", "folder", 'document', NULL, '[]'::jsonb, "created_by", "updated_at" FROM "documents";
