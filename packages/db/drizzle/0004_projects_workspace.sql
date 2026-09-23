ALTER TABLE "projects" ADD COLUMN "objective" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "success_signal" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "next_step" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "created_by" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "artifacts" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "decisions" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_project_idx" ON "tasks" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "runs_project_idx" ON "agent_runs" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "conversations_project_idx" ON "conversations" USING btree ("project_id","updated_at");--> statement-breakpoint
CREATE INDEX "artifacts_project_idx" ON "artifacts" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "decisions_project_idx" ON "decisions" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "campaigns_project_idx" ON "campaigns" USING btree ("project_id","updated_at");--> statement-breakpoint
-- Add project management only to Chief of Staff agents still on known Steward defaults.
UPDATE agents SET tool_allowlist = tool_allowlist || '["project.*"]'::jsonb, updated_at = now()
WHERE kind = 'orchestrator' AND tool_allowlist IN (
 '["memory.*","task.*","delegate.run","document.*","decision.*","goal.*","company.*","campaign.list","lead.list","web.*","slack.post"]'::jsonb,
 '["memory.*","task.*","document.*","decision.*","goal.*","company.*","campaign.list","lead.list","web.*","slack.post","delegate.run"]'::jsonb,
 '["memory.*","document.*","decision.*","task.*","delegate.run","goal.*","company.*","campaign.list","lead.list","web.*","slack.post"]'::jsonb
);
