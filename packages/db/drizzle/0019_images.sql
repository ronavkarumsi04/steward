-- Pictures as deliverables: what an agent (or the founder) asked an image model for, kept with the company.
-- Shaped like browser_frames (base64 text, tenant FK) but never swept: a post image or a logo candidate is
-- something a company keeps, and each row is also an artifact of the run that produced it.
CREATE TABLE "images" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"organization_id" text NOT NULL,
	"company_id" text NOT NULL,
	"run_id" text,
	"purpose" text DEFAULT 'picture' NOT NULL,
	"prompt" text NOT NULL,
	"model" text NOT NULL,
	"seed" integer DEFAULT 0 NOT NULL,
	"mime_type" text DEFAULT 'image/png' NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"bytes" integer NOT NULL,
	"digest" text NOT NULL,
	"data" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "images" ADD CONSTRAINT "images_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "images" ADD CONSTRAINT "images_tenant_fk" FOREIGN KEY ("company_id","organization_id") REFERENCES "companies" ("id","organization_id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE INDEX "images_company_idx" ON "images" USING btree ("company_id","created_at");
