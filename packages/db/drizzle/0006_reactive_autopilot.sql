ALTER TABLE "companies" ADD COLUMN "signal_auto_review" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE "agent_schedules" AS s
SET
  "agent_id" = COALESCE((
    SELECT a."id"
    FROM "agents" AS a
    WHERE a."organization_id" = s."organization_id"
      AND a."company_id" = s."company_id"
      AND a."kind" = 'orchestrator'
      AND a."enabled" = true
    ORDER BY a."created_at" ASC
    LIMIT 1
  ), s."agent_id"),
  "instruction" = CASE
    WHEN s."name" = 'Steward Autopilot · Build' AND s."instruction" = 'AUTOPILOT BUILD cycle: review company goals, recent work, customer evidence, code, deployment state, and open product gaps. Choose the single highest-leverage shippable product improvement, execute it with connected engineering tools, verify it, and leave durable artifacts and follow-up tasks. Do not create busywork.' THEN 'AUTOPILOT BUILD cycle: act as Chief of Staff. Review company goals, active projects, customer evidence, code and deployment state. Choose the single highest-leverage shippable product improvement, use or create the appropriate project, then delegate the bounded implementation to Engineering with delegate.run. Keep the project success signal and next step current, verify the outcome, and do not perform specialist engineering work directly.'
    WHEN s."name" = 'Steward Autopilot · Grow' AND s."instruction" = 'AUTOPILOT GROW cycle: review the target customer, offer, product state, channels, prior growth work, and measurable signals. Choose one bounded distribution or customer-learning experiment. Create or update a campaign record with its objective and audience before external outreach, pass that campaign id into campaign-linked email/social actions, record evidence-backed prospects in the lead pipeline, and record what should be measured next. Never manufacture traction or prospect data.' THEN 'AUTOPILOT GROW cycle: act as Chief of Staff. Review target customer, offer, active projects, channels, prior growth work, and measurable signals. Choose one bounded distribution or customer-learning experiment, use or create the appropriate project, then delegate execution to Marketing or Sales with delegate.run. Require campaign-linked evidence, keep the project next step current, and never manufacture traction or prospect data.'
    WHEN s."name" = 'Steward Autopilot · Earn' AND s."instruction" = 'AUTOPILOT EARN cycle: review the offer, pricing, payment state, revenue signals, and current product. Improve the path from real demand to payment using connected financial tools when appropriate, subject to policy and approvals. Never fabricate revenue, customers, or orders.' THEN 'AUTOPILOT EARN cycle: act as Chief of Staff. Review the offer, pricing, payment state, active projects, revenue signals, and product state. Choose the highest-leverage bounded move toward real revenue, use or create the appropriate project, then delegate financial analysis to Finance and product changes to Engineering with delegate.run. Keep project success criteria current and never fabricate revenue, customers, or orders.'
    ELSE s."instruction"
  END,
  "updated_at" = now()
WHERE s."name" IN ('Steward Autopilot · Build', 'Steward Autopilot · Grow', 'Steward Autopilot · Earn')
  AND EXISTS (
    SELECT 1
    FROM "agents" AS a
    WHERE a."organization_id" = s."organization_id"
      AND a."company_id" = s."company_id"
      AND a."kind" = 'orchestrator'
      AND a."enabled" = true
  );
