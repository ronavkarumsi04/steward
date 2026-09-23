-- Add campaign visibility/management only to agents that still use Steward's prior default allowlists.
-- Customized agent permissions are intentionally preserved.
UPDATE agents
SET tool_allowlist = tool_allowlist || '["campaign.list"]'::jsonb, updated_at = now()
WHERE kind = 'orchestrator'
  AND tool_allowlist = '["memory.*","task.*","document.*","decision.*","goal.*","company.*","lead.list","web.*","slack.post"]'::jsonb;
--> statement-breakpoint

UPDATE agents
SET tool_allowlist = tool_allowlist || '["campaign.*"]'::jsonb, updated_at = now()
WHERE kind = 'marketing'
  AND tool_allowlist = '["web.*","memory.*","document.*","decision.record","lead.*","email.send","social.publish","task.update","goal.list","company.profile"]'::jsonb;
--> statement-breakpoint

UPDATE agents
SET tool_allowlist = tool_allowlist || '["campaign.list"]'::jsonb, updated_at = now()
WHERE kind = 'sales'
  AND tool_allowlist = '["web.*","memory.*","lead.*","email.send","document.*","decision.record","task.update","goal.list","company.profile"]'::jsonb;
