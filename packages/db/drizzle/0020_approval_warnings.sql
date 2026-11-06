-- Warnings a tool attaches to an approval request at preflight (no account connected, no consent): facts the
-- approver must see before saying yes to an action that is already known to fail. Older rows carry none.
ALTER TABLE "approvals" ADD COLUMN IF NOT EXISTS "warnings" json DEFAULT '[]'::json NOT NULL;
