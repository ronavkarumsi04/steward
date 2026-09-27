-- Browser-use agents: a real browser an agent drives, with the founder watching.
--
-- Two tables, and the split is the design:
--   1. browser_sessions — one browser, where it is now, how many steps it has taken, and whether the founder has
--                         stopped it. The row is the truth; the browser process is a cache held by whichever
--                         worker opened it, so `url` is a column rather than something reconstructed from steps.
--   2. browser_frames   — the page as it looked when a step finished, as a JPEG. Frames are deliberately not
--                         artifacts: an artifact is something a company keeps, and a session produces dozens of
--                         images that are evidence about a moment.
--
-- The unique index on (run_id) where status = 'live' is the one-session-per-run rule: an agent that asks to browse
-- twice gets the session it already has, and a second browser cannot appear behind the founder's back. It is a
-- partial index because a run may legitimately open a session again after the first was closed or stopped.
--> statement-breakpoint
CREATE TABLE "browser_sessions" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"organization_id" text NOT NULL,
	"company_id" text NOT NULL,
	"run_id" text,
	"agent_id" text,
	"status" text DEFAULT 'live' NOT NULL,
	"provider" text NOT NULL,
	"url" text NOT NULL,
	"start_url" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"step_count" integer DEFAULT 0 NOT NULL,
	"frame_count" integer DEFAULT 0 NOT NULL,
	"last_frame_id" text,
	"last_action" text,
	"last_action_at" timestamp with time zone,
	"last_note" text,
	"stopped_at" timestamp with time zone,
	"stopped_by" jsonb,
	"stop_reason" text,
	"closed_at" timestamp with time zone,
	"error" text,
	"created_by" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "browser_frames" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"organization_id" text NOT NULL,
	"company_id" text NOT NULL,
	"session_id" text NOT NULL,
	"seq" integer NOT NULL,
	"action" text NOT NULL,
	"url" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"mime_type" text DEFAULT 'image/jpeg' NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"bytes" integer NOT NULL,
	"digest" text NOT NULL,
	"data" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "browser_sessions" ADD CONSTRAINT "browser_sessions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "browser_sessions" ADD CONSTRAINT "browser_sessions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "browser_frames" ADD CONSTRAINT "browser_frames_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "browser_frames" ADD CONSTRAINT "browser_frames_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- A frame without its session is not a frame: a session that is deleted takes its images with it.
ALTER TABLE "browser_frames" ADD CONSTRAINT "browser_frames_session_id_browser_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."browser_sessions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- Same tenancy invariant as every other company-owned table (0009): a row's company must belong to the
-- organization the row claims.
ALTER TABLE "browser_sessions" ADD CONSTRAINT "browser_sessions_tenant_fk" FOREIGN KEY ("company_id","organization_id") REFERENCES "companies" ("id","organization_id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "browser_frames" ADD CONSTRAINT "browser_frames_tenant_fk" FOREIGN KEY ("company_id","organization_id") REFERENCES "companies" ("id","organization_id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE UNIQUE INDEX "browser_sessions_run_live_idx" ON "browser_sessions" USING btree ("run_id") WHERE status = 'live';
--> statement-breakpoint
CREATE INDEX "browser_sessions_company_idx" ON "browser_sessions" USING btree ("company_id","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "browser_frames_seq_idx" ON "browser_frames" USING btree ("session_id","seq");
--> statement-breakpoint
CREATE INDEX "browser_frames_company_idx" ON "browser_frames" USING btree ("company_id","created_at");
