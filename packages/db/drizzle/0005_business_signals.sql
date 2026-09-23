CREATE TABLE "business_signals" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"organization_id" text NOT NULL,
	"company_id" text NOT NULL,
	"integration_id" text,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"state" text DEFAULT 'unread' NOT NULL,
	"project_id" text,
	"customer_ref" text,
	"data" json DEFAULT '{}'::json NOT NULL,
	"review_run_id" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "business_signals" ADD CONSTRAINT "business_signals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "business_signals" ADD CONSTRAINT "business_signals_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "business_signals" ADD CONSTRAINT "business_signals_integration_id_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "business_signals" ADD CONSTRAINT "business_signals_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "business_signals" ADD CONSTRAINT "business_signals_review_run_id_agent_runs_id_fk" FOREIGN KEY ("review_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "business_signals_provider_external_idx" ON "business_signals" USING btree ("provider","external_id");
--> statement-breakpoint
CREATE INDEX "business_signals_company_state_idx" ON "business_signals" USING btree ("company_id","state","occurred_at");
--> statement-breakpoint
CREATE INDEX "business_signals_project_idx" ON "business_signals" USING btree ("project_id","occurred_at");
