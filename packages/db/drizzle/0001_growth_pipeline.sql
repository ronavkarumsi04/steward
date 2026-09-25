-- Give only untouched default agents access to the new growth pipeline tools.
-- User-customized allowlists are intentionally left unchanged.
UPDATE agents
SET tool_allowlist = tool_allowlist || '["lead.list"]'::jsonb, updated_at = now()
WHERE kind = 'orchestrator'
  AND tool_allowlist = '["memory.*","task.*","document.*","decision.*","goal.*","company.*","web.*","slack.post"]'::jsonb;
--> statement-breakpoint

UPDATE agents
SET tool_allowlist = tool_allowlist || '["lead.*"]'::jsonb, updated_at = now()
WHERE kind = 'marketing'
  AND tool_allowlist = '["web.*","memory.*","document.*","decision.record","email.send","social.publish","task.update","goal.list","company.profile"]'::jsonb;
--> statement-breakpoint

UPDATE agents
SET tool_allowlist = tool_allowlist || '["lead.*"]'::jsonb, updated_at = now()
WHERE kind = 'sales'
  AND tool_allowlist = '["web.*","memory.*","email.send","document.*","decision.record","task.update","goal.list","company.profile"]'::jsonb;
