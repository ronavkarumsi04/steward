# Deploying Steward

Steward is two halves with very different hosting needs:

| Half | What it is | Where it can run |
| --- | --- | --- |
| **Web** (`apps/web`) | Next.js 16 app. Server components call the API; the browser talks to the API through a same-origin `/api/v1/*` rewrite, so cookies stay first-party. | **Vercel** (free Hobby tier is enough), or the `web` container. |
| **Backend** (`apps/api`, `apps/worker`, Postgres + pgvector, Redis, Temporal) | Long-running processes. The worker holds open gRPC streams to Temporal and runs agent steps that take minutes; Temporal itself needs a database and a server process. | Any always-on Linux host with Docker (a $0 Oracle Cloud *Always Free* ARM VM, a Hetzner CX22, Fly.io machines, a home server) — **not** Vercel functions. |

The recommended free/cheap topology:

```
Browser ──HTTPS──▶ Vercel (Next.js)  ──/api/v1 rewrite──▶ https://api.example.com (Caddy, auto-TLS)
                                                               │
                                                               ├─ api      (Hono)
                                                               ├─ worker   (Temporal worker)
                                                               ├─ temporal (server + UI, loopback only)
                                                               ├─ postgres (pgvector, loopback only)
                                                               └─ redis    (loopback only)
```

Everything below assumes you own a domain and can create two DNS records (`app.` for Vercel, `api.` for the backend host).

---

## 1. Backend host

### 1.1 Provision

- Any x86-64 or arm64 Linux VM with ≥ 2 vCPU / 4 GB RAM, Docker Engine ≥ 24 and the Compose plugin.
- Open inbound TCP **80** and **443** (and UDP 443 for HTTP/3, optional). Leave everything else closed — the compose file binds Postgres, Redis, Temporal and the API to `127.0.0.1` only.
- Point `api.example.com` (an `A`/`AAAA` record) at the VM.

### 1.2 Configure

```sh
git clone https://github.com/ronavkarumsi04/steward.git && cd steward
cp .env.example .env
```

Edit `.env`. Values that **must** change from the example:

| Variable | Set to |
| --- | --- |
| `NODE_ENV` | `production` |
| `STEWARD_MASTER_KEY` | `openssl rand -hex 32` — encrypts every provider key and integration secret at rest. Losing it means re-entering all keys. Back it up separately from the database. |
| `SESSION_SECRET` | `openssl rand -hex 32` |
| `POSTGRES_PASSWORD` | a long random password (used by compose to build `DATABASE_URL`) |
| `APP_URL` | `https://app.example.com` — the public web URL. Used for CORS, cookie `Secure`, and the links inside invitation / password-reset emails. |
| `API_URL` | `https://api.example.com` |
| `API_DOMAIN` | `api.example.com` — Caddy requests a Let's Encrypt certificate for this name. |
| `ACME_EMAIL` | your email, for certificate expiry notices (optional but recommended) |
| `TRUST_PROXY` | `true` — the API sits behind Caddy; this makes rate limits and audit logs use the real client IP from `X-Forwarded-For`. |
| `ALLOW_SIGNUP` | `true` until you have registered the first owner, then `false` (see §4). |
| `PLATFORM_EMAIL_PROVIDER` / `PLATFORM_EMAIL_FROM` / `RESEND_API_KEY` | see §3 |
| `SANDBOX_PROVIDER` | `none` unless you have a dedicated Docker host for agent code execution (see §5) |

`CORS_ORIGINS` is only needed if you serve the web app from more than one origin (e.g. a Vercel preview domain): comma-separated list of extra origins.

### 1.3 Run

```sh
docker compose --profile backend up -d --build
docker compose --profile backend logs -f api caddy
```

The `backend` profile starts Postgres, Redis, Temporal, the API, the worker and Caddy. The API applies migrations on start (`RUN_MIGRATIONS_ON_START=true`). Within a minute Caddy has a certificate and:

```sh
curl https://api.example.com/health
# {"ok":true,"version":"0.1.0","db":"ok","temporal":"connected"}
```

Caddy is configured (`infra/caddy/Caddyfile`) with `flush_interval -1` and no read/write timeouts on the upstream so Server-Sent Events (`/v1/.../events`) and long approval polls stream through unbuffered.

### 1.4 Operate

| Task | Command |
| --- | --- |
| Upgrade | `git pull && docker compose --profile backend up -d --build` (migrations are forward-only and run on API start; run `pnpm db:migrate` out of band if you set `RUN_MIGRATIONS_ON_START=false`) |
| Roll back | `git checkout <previous-tag> && docker compose --profile backend up -d --build`. Schema migrations are additive, so an older API keeps working against a newer schema for one release. |
| Back up | `docker compose exec postgres pg_dump -U steward steward \| gzip > steward-$(date +%F).sql.gz` on a cron. Also back up `.env` (the master key) and the `artifacts` volume. |
| Restore | `gunzip -c dump.sql.gz \| docker compose exec -T postgres psql -U steward steward` |
| Rotate the master key | Set the new `STEWARD_MASTER_KEY` and put the old one in `STEWARD_PREVIOUS_MASTER_KEYS` (`{"<keyId>":"<old hex>"}`; the key id is the first 8 hex chars of `sha256(rawKeyBytes)`: `echo -n "<old hex>" | xxd -r -p | sha256sum | cut -c1-8`). Restart. Existing secrets stay readable with the old key; anything saved from now on uses the new key. Keep the old key listed until every provider key has been re-saved. |
| Temporal UI | Bound to `127.0.0.1:8233`; reach it with `ssh -L 8233:127.0.0.1:8233 user@host`. |
| Logs | JSON (pino) on stdout: `docker compose logs -f api worker`. Point `OTEL_EXPORTER_OTLP_ENDPOINT` at a collector for traces. |

Worker crashes and restarts are safe — runs are Temporal workflows and resume from their last completed activity (`pnpm verify:boot` exercises a SIGKILL mid-run).

### 1.5 Managed alternatives

Any piece can be swapped for a managed service by changing the URL in `.env` and removing the service from the profile:

- **Postgres**: Neon, Supabase, Railway (all have free tiers; enable the `vector` extension). Set `DATABASE_URL`.
- **Redis**: Upstash. Set `REDIS_URL` (use the `rediss://` TLS URL).
- **Temporal**: [Temporal Cloud](https://temporal.io/cloud). Set `TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE`, and either `TEMPORAL_API_KEY` or the `TEMPORAL_TLS_*` mTLS paths (see `.env.example`).
- **API + worker**: Fly.io machines or a Kubernetes cluster using `infra/docker/{api,worker}.Dockerfile`. Keep `API_INTERNAL_URL` on the private network.

---

## 2. Web on Vercel

1. **Import** `ronavkarumsi04/steward` in Vercel. Set **Root Directory** to `apps/web`. Vercel reads `apps/web/vercel.json`, which pins the framework to Next.js, runs `pnpm install --frozen-lockfile` and `turbo run build --filter=@steward/web...` from the monorepo root, and uses `turbo-ignore` to skip builds that don't touch the web app or its dependencies.
2. **Environment variables** (Production *and* Preview):

   | Variable | Value | Why |
   | --- | --- | --- |
   | `API_URL` | `https://api.example.com` | `next.config.ts` reads this **at build time** to create the `/api/v1/* → API` rewrite. Changing it requires a redeploy. |
   | `APP_URL` | `https://app.example.com` | Canonical URL for Open Graph metadata. Falls back to Vercel's production URL if unset. |

   Do **not** set `API_INTERNAL_URL` on Vercel — there is no private network between Vercel and your VM; the server components use `API_URL` over public HTTPS.

3. **Domain**: add `app.example.com` in Vercel → Domains and create the CNAME it shows you.
4. **Deploy**. Vercel builds on every push to `main`; PRs get preview URLs. If you want previews to be able to log in, add each preview origin (or `https://*-yourteam.vercel.app` won't work — CORS needs exact origins) to `CORS_ORIGINS` on the backend, or test previews against a staging backend.

`next.config.ts` disables Next's `standalone` output when `VERCEL=1` is present (Vercel produces its own serverless bundle) and keeps it for the Docker image. Security headers (`X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `X-Frame-Options`) are set for every route.

### Why the rewrite instead of calling the API directly?

The browser only ever talks to `app.example.com`. Vercel forwards `/api/v1/*` to the API, so the session cookie the API sets is a first-party cookie on `app.example.com`, `SameSite=Lax` works, and there is no cross-origin CORS/credentials dance. SSE streams pass through Vercel's rewrite layer unbuffered.

---

## 3. Email (invitations, password reset)

The API sends two kinds of email: organization invitations and password-reset links. Both contain single-use, expiring tokens.

| `PLATFORM_EMAIL_PROVIDER` | Behavior |
| --- | --- |
| `console` (default) | Messages — **including the one-time links** — are written to the API log. Fine for development; in production the API logs a warning at start-up and admins have to copy invitation links out of the UI. |
| `resend` | Delivered through [Resend](https://resend.com). Set `RESEND_API_KEY` and `PLATFORM_EMAIL_FROM` (e.g. `Steward <no-reply@example.com>`). The sender domain must be verified in Resend (add the DKIM/SPF records it gives you) or sends fail with a 4xx that the API logs and surfaces as `emailed: false` on the invitation. |

Resend's free tier (3,000 emails/month, 100/day) covers a small team indefinitely. Nothing in Steward's transactional email depends on Resend-specific features — adding another provider is a ~40-line `Mailer` implementation in `packages/core/src/mailer.ts`.

Password-reset requests always return `202` whether or not the address exists, so the endpoint can't be used to enumerate accounts. Reset links expire after 30 minutes, can be used once, and a successful reset revokes every other session for that user.

---

## 4. Sign-up policy

`ALLOW_SIGNUP` controls public self-registration:

- `true` — anyone can register at `/register`.
- `false` — `/register` shows an *invitation-only* notice. **Exception:** while the database has zero users the first registration is still accepted, so you can bootstrap the owner with `ALLOW_SIGNUP=false` from the start. After that, only people holding a valid invitation link (issued from **Org → Members**, emailed automatically) can create accounts, and only with the invited address.

Recommended: leave it `false`, register yourself, invite your team.

---

## 5. Sandbox (agent code execution)

Agents can run code in Docker containers. In the `backend` profile the worker has the host's Docker socket mounted, which is convenient but means a compromised agent step shares the control-plane daemon. For production either:

- set `SANDBOX_PROVIDER=none` (agents still plan, browse, call tools and integrations — they just can't execute arbitrary code), or
- run a **separate** Docker host and point `SANDBOX_DOCKER_HOST=tcp://sandbox-host:2376` (with TLS) at it, then remove the socket mount from the `worker` service.

See `docs/THREAT_MODEL.md` for the full trust boundaries.

---

## 6. Pre-launch checklist

- [ ] `curl https://api.example.com/health` returns `"db":"ok","temporal":"connected"`
- [ ] `https://app.example.com` loads; register → onboard → create a company works
- [ ] Invite yourself from a second address; the email arrives and the link registers + joins
- [ ] "Forgot password" email arrives; the link resets and signs you in
- [ ] `ALLOW_SIGNUP=false` in `.env`; `/register` shows the invitation-only card
- [ ] Postgres backup cron in place; `.env` (master key) stored in a password manager
- [ ] Provider keys added under **Org → Providers**; budgets set under **Org → Budgets**
- [ ] `SANDBOX_PROVIDER` decided (§5)

CI (`.github/workflows/ci.yml`) runs lint, typecheck, build, unit/integration tests against real Postgres + Temporal, the production boot verification (`pnpm verify:boot`, including the Playwright golden path), and builds all three Docker images on every push and pull request.
