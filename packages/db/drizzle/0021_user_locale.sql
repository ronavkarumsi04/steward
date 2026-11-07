-- The interface language a person chose. A user setting, not an organization one: the same founder reads
-- Steward in the same language in every company they belong to.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "locale" text DEFAULT 'en' NOT NULL;
