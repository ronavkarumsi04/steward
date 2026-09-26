# Records of Processing Activities

A GDPR Article 30 style record for the hosted Steward service, written from the actual schema in
`packages/db/src/schema.ts`. The **retention column is the same configuration the retention sweep enforces**
(`packages/legal/src/config.ts` → `RETENTION_POLICY`), so this document and the product agree.

Roles: for account-holder data we are the **controller**; for the business records a customer puts in
(contacts, messages, CRM data), the customer is the **controller** and we are the **processor** under the DPA.

| Data category | Source | Purpose | Lawful basis | Where stored | Processors involved | Retention | Deletion procedure |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Account record (name, email, password hash, avatar, memberships, settings) | The person registering | Operate the account, authenticate | Contract | `users`, `organizations`, `memberships` | Hosting, database | Until account deletion | `DELETE /v1/privacy/account` |
| Authentication data (session token hash, IP, user agent, one-time tokens) | Automatically on sign-in; password reset requests | Keep sessions, prevent account takeover | Legitimate interests (security) | `sessions`, `email_verifications` | Hosting, database | 14 days (sessions), 30 minutes (reset tokens) — swept automatically | Sweep on expiry; revoked instantly on deletion |
| Clickwrap acceptances (document, version, statement, IP, user agent, timestamp) | The person accepting, at registration and on version changes | Prove which terms were agreed to | Legal obligation / contract | `agreements` | Hosting, database | Life of the account | Cascades with account deletion |
| Company and business configuration (companies, profiles, goals, projects, tasks, documents and versions, playbooks) | Customer input, agent output | Provide the product | Contract | Tenant tables | Hosting, database | Life of the company | Company/organization deletion |
| Agent and automation records (runs, steps, plans, model calls, tool calls, approvals, decisions, policies, budgets, ledger) | Agents, on customer instructions | Audit trail: show what was done, under which authorization, at what cost | Contract; legitimate interests (accountability) | `agent_runs`, `agent_run_steps`, `ai_calls`, `tool_calls`, `approvals`, `decisions`, `policies`, `budgets`, `budget_ledger` | Hosting, database; model providers receive prompt content | Life of the company (never swept) | Company/organization deletion |
| Conversations and messages | Customer input, agent output | Provide the assistant experience | Contract | `conversations`, `messages` | Hosting, database, model providers | Life of the company; individual conversations deletable | Delete conversation, or company deletion |
| Memories and embeddings | Agents, from customer data | Recall business context | Contract | `memories` (pgvector) | Hosting, database; embedding provider if configured | Life of the company | Delete memory, or company deletion |
| Artifacts (files and generated output) | Customer uploads, agent output | Deliver work product | Contract | `artifacts` + operator storage | Hosting, storage | Until deleted | Delete artifact (bytes removed); company deletion |
| Contacts, leads, campaigns, outbound messages | Customer input, integrations, agent output | Run growth workflows; prove what was sent | Contract (customer is controller) | `contacts`, `leads`, `campaigns`, `outbound_messages` | Email/SMS providers the customer connects | Life of the company | Company deletion; **suppression records retained** |
| Suppression / opt-out records | Unsubscribe clicks, STOP replies, customer import | Honor opt-outs; comply with CAN-SPAM/TCPA | Legal obligation | `suppression_list`, `contacts.opted_out_at` | Hosting, database | Retained after account deletion, minimized | Deliberately not deleted |
| Consent records (SMS/email consent evidence) | Customer input, inbound replies | Prove consent existed | Legal obligation | `messaging_consents` | Hosting, database | Life of the company | Company deletion |
| Support tickets and threads | Customer input, connected mailbox | Answer customer questions | Contract | `support_tickets`, `documents` | Hosting, database, model providers | Life of the company | Company deletion |
| Integration configuration and credentials | Customer configuration | Call the services the customer connected | Contract | `integrations`, `integration_credentials`, `provider_credentials`, `oauth_identities` | The provider itself | Until disconnected | Disconnect deletes the credential |
| API keys, webhooks, webhook deliveries | Customer configuration | Let customers integrate | Contract | `api_keys`, `webhooks`, `webhook_deliveries` | Hosting, database | Keys until revoked; deliveries 30 days — swept | Delete key; org deletion |
| Activity events | System | Live activity feed, debugging | Legitimate interests (operations) | `events` | Hosting, database | 90 days — swept automatically | Sweep, then org deletion |
| Security audit log | System, on sensitive actions | Answer who did what; investigate incidents | Legitimate interests (security); legal obligation | `audit_log` | Hosting, database | Life of the organization | Organization deletion |
| Privacy requests (kind, status, resolution note) | The requester | Track and prove how a rights request was handled | Legal obligation | `privacy_requests` | Hosting, database | Retained as compliance evidence | Deliberately not deleted |
| Technical request metadata | Automatically | Secure and operate the API; rate limiting | Legitimate interests (security) | API process memory and platform logs | Hosting provider | Minutes to days depending on the platform log | Log rotation by the platform |
| Backups | Operator | Recover from failure | Legitimate interests (availability) | Operator backup storage | Operator storage | Rolling 30 days | Roll off the window |

## Automated decision-making

Agents run tools and choices automatically inside policies the customer configures (autonomy levels 0–4,
approval gates, budgets, per-dimension rules). No decision with legal or similarly significant effects on an
individual is made by Steward on its own initiative; where such a decision happens the customer is the
decision-maker and must provide the human review their law requires. See the AI and Autonomous Agent Terms.

## Cross-border transfers

Where personal data protected by GDPR/UK GDPR leaves the EEA or UK, transfers rely on the Standard
Contractual Clauses and the UK Addendum, with a transfer impact assessment on file per vendor. Customers who
need data to stay in a region should self-host in that region, which removes us from the processing chain
entirely.

## Review

Review this record whenever the schema changes in a way that adds a new category of personal data — a new
tenant table appears automatically in the export and deletion paths (they are discovered from
`information_schema`), but this document is maintained by hand and must be updated too.
