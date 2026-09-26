ALTER TABLE "users" ADD COLUMN "marketing_opt_in_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "marketing_opt_out_at" timestamp with time zone;
--> statement-breakpoint
CREATE INDEX "events_created_idx" ON "events" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX "webhook_deliveries_created_idx" ON "webhook_deliveries" USING btree ("created_at");
--> statement-breakpoint
CREATE TABLE "agreements" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"user_id" text NOT NULL,
	"document" text NOT NULL,
	"version" text NOT NULL,
	"statement" text NOT NULL,
	"source" text DEFAULT 'web' NOT NULL,
	"ip" text,
	"user_agent" text,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "agreements_user_doc_version_idx" ON "agreements" USING btree ("user_id","document","version");
--> statement-breakpoint
CREATE INDEX "agreements_user_idx" ON "agreements" USING btree ("user_id","document","accepted_at");
--> statement-breakpoint
CREATE TABLE "privacy_requests" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"organization_id" text,
	"user_id" text,
	"email" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"details" text DEFAULT '' NOT NULL,
	"resolution_note" text,
	"verified_at" timestamp with time zone,
	"fulfilled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "privacy_requests_status_idx" ON "privacy_requests" USING btree ("status","created_at");
--> statement-breakpoint
CREATE INDEX "privacy_requests_user_idx" ON "privacy_requests" USING btree ("user_id","created_at");
--> statement-breakpoint
CREATE TABLE "messaging_consents" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"organization_id" text NOT NULL,
	"company_id" text NOT NULL,
	"channel" text NOT NULL,
	"address" text NOT NULL,
	"status" text NOT NULL,
	"source" text NOT NULL,
	"evidence" text DEFAULT '' NOT NULL,
	"granted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "messaging_consents_address_idx" ON "messaging_consents" USING btree ("company_id","channel",lower("address"));
--> statement-breakpoint
CREATE INDEX "messaging_consents_status_idx" ON "messaging_consents" USING btree ("company_id","channel","status");
