# Vendor and Data Processing Register

This register is the **factual source** the public [Subprocessors page](../../packages/legal/src/subprocessors.ts)
and Privacy Policy are built from. Keep it in sync: if a vendor is added to the deployment, add it here,
then add the configuration that makes the public page show it.

Two categories, kept deliberately separate:

- **Subprocessors** — vendors *we* engage to run the hosted service. They act on our instructions.
- **Customer-connected services** — services *the customer* connects with their own account and key. They act
  on the customer's instructions and are governed by the customer's own agreement.

Conflating the two is the most common way a subprocessor page becomes misleading.

## Subprocessors

| Vendor | Role | Data received | Region | Retention at vendor | Contract / transfer | Security notes | Owner |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Vercel Inc. (only when `VERCEL` is set) | Serves the web app, TLS termination, CDN | Account identifiers, session cookie values, request metadata; page payloads in transit | United States (+ edge) | Request logs per Vercel retention; no customer data stored by default | DPA accepted in the Vercel account; SCCs/UK Addendum for EU/UK transfers | Encryption in transit, HSTS, no persistent storage of tenant data | Maintainer with Vercel access |
| Operator-managed PostgreSQL (`LEGAL_DATABASE_PROVIDER`) | Primary datastore | Everything described in the Privacy Policy except artifact file bytes; credentials as ciphertext | Deployment region (`LEGAL_HOSTING_REGION`) | For the life of the data; vendor retains only its own backups | Vendor DPA if managed; SCCs where the region is outside the EEA/UK | Private network, TLS, least-privilege DB role | Maintainer with DB access |
| Operator-managed object/file storage | Artifacts and generated files | Artifact bytes and metadata | Deployment region | Until deleted by the customer or with the account | Operator-controlled | Not publicly listable; served through the API | Maintainer with storage access |
| Temporal Technologies (Temporal Cloud, only when `TEMPORAL_API_KEY` is set) | Workflow orchestration | Workflow inputs/outputs, run identifiers, task payloads | United States | Workflow history per namespace retention | DPA + SCCs/UK Addendum | mTLS or API key, namespace isolation | Maintainer with Temporal access |
| Resend (only when `PLATFORM_EMAIL_PROVIDER=resend`) | Transactional email for the platform itself | Recipient address, message body (invitation and reset links) | United States | Vendor retention for delivery logs | DPA + SCCs/UK Addendum | API key scoped to sending; no tenant content beyond the email body | Maintainer with Resend access |
| Additional vendors (`LEGAL_ADDITIONAL_SUBPROCESSORS`) | Declared by the operator | As declared | As declared | As declared | As declared | As declared | Operator |

**Not subprocessors, do not list them here:** OpenAI, Anthropic, Google, AWS Bedrock, OpenRouter, Ollama,
Stripe, Twilio, Slack, GitHub, HubSpot, Notion, Supabase, Neon, LinkedIn, X, Postmark, SendGrid, SMTP
providers, Vercel-as-a-customer-integration, and any mailbox or CRM a customer connects. Those are the
customer's own providers.

## How to add or change a subprocessor

1. **Assess.** What personal data does it receive, where is it processed, does it need a transfer mechanism,
   what is its retention, and is there a security review (SOC 2 report, ISO certificate, or documented
   controls) on file?
2. **Contract.** Accept the vendor's DPA, or sign one that contains Article 28 terms. Record the date in this register.
3. **Configure.** Set the environment variable that activates it (`VERCEL`, `PLATFORM_EMAIL_PROVIDER=resend`,
   `TEMPORAL_API_KEY`, `LEGAL_DATABASE_PROVIDER`, `LEGAL_ADDITIONAL_SUBPROCESSORS`) so the public page reflects reality.
4. **Notify.** Update the Subprocessors page, bump its version, and give business customers at least **30 days**
   notice of a new subprocessor for personal data. Record the notice date here.
5. **Verify.** Load `/legal/subprocessors` and confirm the row appears with the right location and mechanism.

## Review cadence

- Quarterly: confirm each active vendor still matches this register, and that no decommissioned vendor is
  still listed.
- On any incident involving a vendor: reassess and record the outcome.
- On any new deployment region: re-evaluate transfer mechanisms and update `LEGAL_HOSTING_REGION`.

## Customer-connected services (references only)

Documented for customers on `/legal/integrations`, with scopes and data flows. Enabling one lets Steward
call that provider on the customer's behalf. The customer's agreement with the provider governs it, and the
customer is responsible for complying with the provider's terms — including any prohibition on bulk sending,
scraping, or automated actions through their account.
