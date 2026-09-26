# Security policy

## Reporting a vulnerability

Please do **not** open a public issue for security problems. Email the maintainers at the address in the repository profile (or use GitHub's private vulnerability reporting if enabled). Include reproduction steps and the affected version/commit. We aim to acknowledge reports within 3 business days.

Please give us a reasonable opportunity to fix the issue before disclosing it publicly, do not access other people's data, and do not run destructive tests. Good-faith research on your own deployment is welcome.

## What happens next (incident response)

A report that turns into a confirmed incident follows [docs/compliance/INCIDENT_RESPONSE.md](docs/compliance/INCIDENT_RESPONSE.md):
severity classification, containment with credential and session revocation, evidence preservation, subprocessor
notification, customer notification under the DPA, and a written postmortem. Administrators with production
access are bound by [docs/compliance/ADMIN_ACCESS.md](docs/compliance/ADMIN_ACCESS.md), and backups and
restore testing are specified in [docs/compliance/BACKUP_AND_DR.md](docs/compliance/BACKUP_AND_DR.md).

## Published security posture

The honest current state — including what is **not** implemented — is published at `/legal/security` for
customers rather than kept in this file. Highlights: no MFA/WebAuthn yet, environment-held keys rather than
KMS/HSM, no third-party penetration test, and the sandbox is not a hard security boundary. No certification is
claimed anywhere.

## Supported versions

Only the `main` branch and the latest tagged release receive security fixes.

## Security model (summary)

The full analysis lives in [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md). In short:

- **Tenant isolation.** Every repository method and background job requires an explicit `{ organizationId, companyId }` scope. Helpers reject missing scope; cross-tenant access is tested.
- **Secrets.** Provider keys, integration tokens and OAuth refresh tokens are envelope-encrypted (AES-256-GCM data keys wrapped by `STEWARD_MASTER_KEY`, rotatable via `STEWARD_PREVIOUS_MASTER_KEYS`). Plaintext is never returned by the API or written to logs; the UI only sees a hint (last 4 chars).
- **Authentication.** Argon2id passwords (≥10 chars), opaque session tokens stored hashed with a 14-day TTL and daily rotation, HTTP-only `SameSite=Lax` cookie, optional bearer tokens for programmatic access. Cookie-authenticated mutations require a matching `Origin`/`Referer` or the `x-steward-csrf` header.
- **Authorization.** Org roles `owner | admin | member | viewer`; provider/integration/member management requires admin. Company-scoped routes verify membership on every request.
- **Agent safety.** Autonomy levels 0–4 (no unrestricted mode). Tools are risk-classified; critical actions (payments, production deploys, sending to external parties, destructive git operations) always require human approval. Budgets are enforced per category per company. Third-party content (web pages, emails, tool output) is always presented to the model as untrusted data, never as instructions.
- **Code execution.** Agents run code only inside a Docker sandbox with memory/CPU limits and a configurable network policy; use a dedicated Docker host in production.
- **Local companion.** Subscription credentials for Codex never leave the user's machine. The server stores only hashes of pairing codes and device keys; commands are restricted to `ping`, `codex.status`, `codex.exec`; revocation is immediate.
- **Transport.** HTTPS is required in production (the companion CLI refuses plain HTTP to non-localhost servers). Security headers are set on API and web responses.

## Hardening checklist for operators

- Set `ALLOW_SIGNUP=false` once the first owner exists.
- Set the `LEGAL_*` environment variables (see `.env.example`) so the public legal pages name the real operator, contact channel, hosting region and subprocessors. Left blank, the documents truthfully say that no legal entity exists and route contact through the repository.
- Put the API and web behind TLS; set `APP_URL`/`API_URL` to the public HTTPS origins.
- Run the worker with `SANDBOX_DOCKER_HOST` pointing at an isolated Docker daemon, not the control-plane socket.
- Back up Postgres; it is the only source of truth (Temporal history is in the same Postgres instance under a separate database).
- Rotate `STEWARD_MASTER_KEY` using `STEWARD_PREVIOUS_MASTER_KEYS` (procedure in the incident runbook, §6).
- Keep the master key **out** of the backup location: a backup plus the key is a full credential compromise.
- Review the subprocessor register and admin access quarterly, and keep `docs/compliance/RECORDS_OF_PROCESSING.md` in step with schema changes.
- Leave the retention sweep running on the worker — it is what makes the published retention windows true.
