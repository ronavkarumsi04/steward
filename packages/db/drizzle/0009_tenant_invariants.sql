-- Tenant invariants, tenant-safe signal deduplication, and resumable privacy jobs.
--
-- These three changes belong in the database rather than in every call site:
--   1. Signals deduplicate per company. The old unique index was on (provider, external_id) alone, so an
--      external id already recorded by one company silently blocked the same id for every other company.
--   2. A privacy job records its progress, so a large export or deletion can be resumed by a retry instead
--      of restarting (or claiming success for work that never happened).
--   3. Every company-owned row must belong to the organization that owns its company. The application
--      checks both ids, but nothing stopped a bug or a script from writing a row whose company belongs to
--      a different organization; the composite foreign keys below make that unrepresentable.
--> statement-breakpoint
DROP INDEX IF EXISTS "business_signals_provider_external_idx";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "business_signals_company_provider_external_idx" ON "business_signals" USING btree ("company_id","provider","external_id");
--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD COLUMN IF NOT EXISTS "progress" jsonb;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "companies_id_organization_idx" ON "companies" USING btree ("id","organization_id");
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'company_profiles','goals','agents','agent_schedules','projects','deployments','tasks','agent_runs',
    'agent_run_steps','tool_calls','approvals','policies','budgets','budget_ledger','memories','decisions',
    'entities','conversations','messages','model_preferences','webhooks','business_signals','artifacts',
    'contacts','leads','campaigns','outbound_messages','support_tickets','documents','document_versions',
    'financial_snapshots','messaging_consents'
  ] LOOP
    IF to_regclass(t) IS NULL THEN
      CONTINUE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = t || '_tenant_fk') THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("company_id","organization_id") REFERENCES "companies" ("id","organization_id") ON DELETE CASCADE',
        t, t || '_tenant_fk'
      );
    END IF;
  END LOOP;
END $$;
