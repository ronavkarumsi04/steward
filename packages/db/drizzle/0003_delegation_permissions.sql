-- Add durable specialist delegation only to Chief of Staff agents still using known Steward default allowlists.
-- Customized permissions are intentionally preserved.
UPDATE agents
SET tool_allowlist = tool_allowlist || '["delegate.run"]'::jsonb, updated_at = now()
WHERE kind = 'orchestrator'
  AND tool_allowlist IN (
    '["memory.*","task.*","document.*","decision.*","goal.*","company.*","campaign.list","lead.list","web.*","slack.post"]'::jsonb,
    '["memory.*","task.*","document.*","decision.*","goal.*","company.*","lead.list","web.*","slack.post","campaign.list"]'::jsonb,
    '["memory.*","document.*","decision.*","task.*","goal.*","company.*","campaign.list","lead.list","web.*","slack.post"]'::jsonb
  );
