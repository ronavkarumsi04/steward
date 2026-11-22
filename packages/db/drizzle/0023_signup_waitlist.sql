ALTER TABLE "users" ADD COLUMN "signup_source" text DEFAULT 'legacy' NOT NULL;
--> statement-breakpoint
CREATE INDEX "users_self_serve_created_idx" ON "users" ("created_at") WHERE "signup_source" = 'self_serve';
--> statement-breakpoint
CREATE TABLE "waitlist_entries" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "email" text NOT NULL,
  "name" text,
  "note" text,
  "reason" text NOT NULL CHECK ("reason" IN ('closed', 'capped')),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "admitted_at" timestamptz,
  "admitted_by" text REFERENCES "users"("id") ON DELETE SET NULL,
  "token_hash" text,
  "admission_expires_at" timestamptz,
  "registered_at" timestamptz,
  "user_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "waitlist_email_normalized" CHECK ("email" = lower(trim("email")))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "waitlist_email_idx" ON "waitlist_entries" ("email");
--> statement-breakpoint
CREATE UNIQUE INDEX "waitlist_token_idx" ON "waitlist_entries" ("token_hash");
