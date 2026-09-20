# Security policy

## Reporting a vulnerability

Please do **not** open a public issue for security problems. Email the maintainers at the address in the repository profile (or use GitHub's private vulnerability reporting if enabled). Include reproduction steps and the affected version/commit. We aim to acknowledge reports within 3 business days.

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
- Put the API and web behind TLS; set `APP_URL`/`API_URL` to the public HTTPS origins.
- Run the worker with `SANDBOX_DOCKER_HOST` pointing at an isolated Docker daemon, not the control-plane socket.
- Back up Postgres; it is the only source of truth (Temporal history is in the same Postgres instance under a separate database).
- Rotate `STEWARD_MASTER_KEY` using `STEWARD_PREVIOUS_MASTER_KEYS`.
