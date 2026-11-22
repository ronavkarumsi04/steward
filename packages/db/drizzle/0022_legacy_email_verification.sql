-- Existing accounts predate public signup verification and belong to owners or invitees.
UPDATE "users" SET "email_verified_at" = "created_at" WHERE "email_verified_at" IS NULL;
