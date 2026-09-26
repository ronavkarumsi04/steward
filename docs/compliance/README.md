# Compliance Documentation

Internal records and procedures that back the public legal documents. Everything here is meant to be
**truthful about what the project actually does**, including what it does not do yet.

## Public documents (in the app, `/legal/*`)

Written as data in `packages/legal`, versioned, rendered at `/legal`:

| Document | Why it exists |
| --- | --- |
| Terms of Service | The contract for the hosted service |
| Privacy Policy | CalOPPA/GDPR-compliant notice, including the Google Limited Use disclosure |
| Acceptable Use Policy | Limits on agent use, including anti-spam and safety-control evasion |
| AI and Autonomous Agent Terms | What agents can get wrong, who is responsible, AI disclosure duties |
| Integrations and Connected Accounts | Scopes, data flows, and revocation before you connect |
| Subprocessors | Vendors **we** use, generated from deployment configuration |
| Data Processing Addendum | Article 28 processor terms plus SCCs by reference |
| Retention and Deletion Policy | Per-category windows, generated from the same config the sweep enforces |
| Cookie Notice | The one session cookie and the two storage keys |
| Security | Implemented controls and explicit limitations |
| Accessibility Statement | WCAG 2.2 AA target, what is implemented, what is unverified |
| API and Webhook Terms | Keys, rate limits, webhook responsibilities |
| Copyright and IP Complaints | Notice and counter-notice process |
| Third-Party Notices | Generated from the installed dependency graph |
| Support Policy | Channels and the absence of an SLA |

## Internal documents (this folder)

| Document | Covers |
| --- | --- |
| [`INCIDENT_RESPONSE.md`](./INCIDENT_RESPONSE.md) | Detection, severity, containment, credential revocation, breach notification, postmortem |
| [`VENDOR_REGISTER.md`](./VENDOR_REGISTER.md) | Every production vendor: data, region, contract, transfer mechanism, owner |
| [`RECORDS_OF_PROCESSING.md`](./RECORDS_OF_PROCESSING.md) | Article 30 record mapped to the real schema and retention config |
| [`LAW_ENFORCEMENT_REQUESTS.md`](./LAW_ENFORCEMENT_REQUESTS.md) | Verification, minimization, notification, logging |
| [`ADMIN_ACCESS.md`](./ADMIN_ACCESS.md) | Least privilege, break-glass, and the Google Limited Use human-access rules |
| [`BACKUP_AND_DR.md`](./BACKUP_AND_DR.md) | RPO/RTO targets, backup contents, restore procedure, quarterly test |

## Where policy meets code

A promise that only exists in prose is a liability. These links are the implementation:

| Promise | Implementation |
| --- | --- |
| Registration requires accepting current terms | `apps/api/src/routes/auth.ts` → `buildAgreements`, recorded in `packages/core/src/auth.ts` inside the registration transaction |
| Re-acceptance after a version change | `pendingAgreements` from `packages/legal`, surfaced by `/auth/me` and enforced by the app gate |
| Export and deletion actually work | `packages/core/src/privacy.ts` — tables discovered from `information_schema`, no hand-maintained list |
| Retention windows are enforced | `packages/core/src/retention.ts` + `apps/worker/src/retention-job.ts`, cross-checked against the policy by `retention.test.ts` |
| Marketing email carries a working one-click opt-out | `packages/agents/src/outbound.ts`, applied by the `email.send` tool |
| SMS is blocked without consent, and STOP revokes it | `sms.send` tool + `PrivacyService.consentStatus` / `inboundSmsIntent` |
| Subprocessor page reflects reality | `packages/legal/src/subprocessors.ts` derives rows from `VERCEL`, `TEMPORAL_API_KEY`, `PLATFORM_EMAIL_PROVIDER`, `LEGAL_*` |
| Third-party notices exist | `scripts/generate-third-party-notices.mjs` → `docs/THIRD_PARTY_NOTICES.md` |

## Operated by an open-source project, not a company

There is currently **no incorporated entity**. The documents say so plainly rather than implying one. That
has consequences worth stating internally too: there is no corporate officer to sign a DPA, no SOC 2 report
to hand over, no 24/7 on-call rota, and liability is limited accordingly. When an entity exists, update
`LEGAL_ENTITY_NAME` and `LEGAL_ENTITY_ADDRESS`, bump the document versions that mention the operator, and the
clickwrap will re-prompt every user automatically.

## Outstanding external items (cannot be solved by code)

1. **Google OAuth verification.** `gmail.readonly` is a restricted scope and `gmail.send` is sensitive, so the
   production OAuth client needs Google's verification, and restricted-scope use generally requires a
   third-party security assessment. Until that completes, the Google integration cannot be offered to
   external users at scale.
2. **Sales tax and business registration** — only relevant if the service ever charges subscribers. It does
   not today, and the Terms say so.
3. **Independent security testing and accessibility audit** — both are disclosed as not performed. Neither
   claim is made anywhere in the product or the documents.
4. **Counsel review.** These documents are written to be accurate and complete about the product. They are not
   a substitute for a lawyer reading them before a customer relies on them.
