# Incident Response and Data Breach Runbook

Status: **implemented process, no dedicated on-call team.** Be honest with customers about that: this is
a documented runbook for an open-source project, not a 24/7 security operations centre.

Scope: the hosted Steward instance, its database, its subprocessors, and the deployment pipeline.
Self-hosted operators should adapt this file — the containment steps are the same, the notification
duties are theirs.

## 1. Roles

| Role | Who | Responsibility |
| --- | --- | --- |
| Incident lead | Maintainer who picks it up first | Owns the timeline, decisions, and communication |
| Technical responder | A maintainer with production access | Runs containment and recovery |
| Communications | Another maintainer, never the technical responder | Writes customer and public updates |
| Legal/privacy contact | Maintainer acting as privacy contact | Evaluates notification duties under GDPR Art. 33/34, US state breach laws, and the DPA |

One person can hold several roles in a small project, but **the person writing customer communications must
not be the person debugging** — split it as soon as a second maintainer is available.

## 2. Detection

Signals, in rough order of usefulness:

- The retention sweep and worker logs (`/tmp/worker.log` locally; the platform log in production) for repeated failures.
- API logs for `unhandled API error` bursts, 401/403 spikes, or rate-limit saturation.
- Postgres logs for failed authentication, unexpected `COPY`/bulk reads, or schema changes.
- `audit_log` entries for administrative actions nobody claims: role changes, member removals, credential writes.
- Subprocessor notifications (hosting provider, database provider, email provider).
- Reports from users or from the security contact channel.

Triage question one: **is customer data exposed, or is availability affected?** The answer drives everything.

## 3. Severity

| Severity | Definition | Response target |
| --- | --- | --- |
| SEV1 | Confirmed or likely unauthorized access to customer data; master key exposure; credentials leaked | Act immediately, notify affected customers without undue delay |
| SEV2 | Security control bypass without confirmed data access; single-tenant compromise; account takeover | Act within hours |
| SEV3 | Vulnerability requiring specific conditions; no data exposure yet | Fix within days, disclose in release notes |
| SEV4 | Hardening, defence-in-depth, informational | Normal backlog with a priority bump |

## 4. Containment

Pick the smallest action that stops the bleeding, and record the exact time and command for each step.

1. **Revoke credentials**
   - Rotate the leaked secret in the provider's dashboard, then update the deployment environment.
   - Revoke OAuth grants for a compromised integration: `Settings → Integrations → disconnect` (deletes the stored credential) plus the provider's own access page.
   - API keys: `DELETE` the key in `Settings → Providers`, then issue a new one. Old key hashes are useless once deleted.
2. **Revoke sessions**
   - `POST /v1/auth/logout-all` for the affected user, or delete rows in `sessions` for a tenant-wide revocation.
   - In an emergency: `delete from sessions;` — blunt, but it invalidates every session immediately.
3. **Stop outbound harm**
   - `POST /v1/companies/:id/... ` → set `outbound_paused = true` on the company, or pause the org's companies in bulk. This blocks agent sending while you investigate.
   - Suspend the organization's ability to send via the provider's own controls if it is sending spam right now.
4. **Stop the workflow engine**
   - Pause the worker (stop the process or scale the deployment to zero). Running workflows resume when it returns, so this is reversible.
   - Terminate a specific run: `temporal workflow terminate --workflow-id <id>` against the namespace in `TEMPORAL_ADDRESS`.
5. **Isolate the deployment**
   - Take the API offline (`BIND_ADDRESS`/firewall) if the compromise is active and you cannot contain it precisely.
   - Snapshot the database **before** repairing anything if forensic evidence matters.

## 5. Evidence preservation

Before cleaning up: snapshot the database, copy the API/worker logs, and export the relevant `audit_log`,
`events`, and `agent_runs` rows for the affected tenants. Store the copy separately from production, with
access limited to the incident lead. Do not edit or delete audit rows.

## 6. Master key compromise (special case)

The deployment master key encrypts every stored credential. If it is exposed, treat it as SEV1 and:

1. Generate a new key: `openssl rand -hex 32`.
2. Set `STEWARD_MASTER_KEY` to the new value and `STEWARD_PREVIOUS_MASTER_KEYS={"<old-key-prefix>":"<old-key>"}` so existing records can still be read and re-encrypted.
3. Re-enter each provider/integration credential so it is stored under the new key, then remove the previous key.
4. Rotate the underlying credentials at every provider. **Rotating the master key alone does not make leaked plaintext secrets safe** — the secrets themselves must be replaced.

## 7. Recovery

Restore from a backup only if data was destroyed or corrupted: `gunzip -c dump.sql.gz | psql "$DATABASE_URL"`
(see `docs/DEPLOY.md`). After restoration, verify tenant isolation and re-run the migrations from
`packages/db/drizzle` before declaring recovery complete. Then watch `events` and `audit_log` for
recurrence for at least 72 hours.

## 8. Notification

**Customers (DPA obligation).** Notify affected customers without undue delay after becoming aware, with:
what happened, when, what data was involved, what we did, what they should do, and what we will do next.
Threshold: personal data in their tenant was accessed, disclosed, altered, or lost. Send it even when we are
not yet certain — say what is not yet known.

**Regulators (GDPR Art. 33).** Where the incident is likely to result in a risk to individuals' rights and
freedoms, the controller (our business customer) notifies their supervisory authority within 72 hours of
becoming aware; we provide the information they need, in writing. Where Steward is the controller for
account-holder data, that duty is ours. Art. 34 (informing individuals) applies when there is a high risk.

**US state laws.** Breach notification statutes have their own deadlines (commonly 30–60 days) and their own
definitions of personal information. Check the states of the affected individuals; attorney-general notice is
required in several states above thresholds.

**Public disclosure.** Publish a postmortem in the repository after customer notification is complete.
Do not publish customer-identifying detail, and do not use the postmortem as the first notification.

## 9. Postmortem

Within seven days of closing a SEV1/SEV2: timeline, root cause, what detection missed, what made recovery
slow, and concrete follow-ups with owners. Blameless in tone, specific in content. Track follow-ups as
repository issues so they do not evaporate.

## 10. Testing this plan

- Once a quarter: verify a backup restores into a scratch database (see `BACKUP_AND_DR.md`).
- Once a quarter: rotate the master key following section 6 and confirm no credential fails to decrypt.
- Twice a year: walk through a tabletop scenario (leaked master key, compromised integration token, spam
  run) and record what the runbook got wrong.
