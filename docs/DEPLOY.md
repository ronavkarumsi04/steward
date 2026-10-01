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
# {"ok":true,"version":"0.1.0","commit":"unknown","db":"ok","temporal":"connected"}
```

`commit` is the field §2.4 describes: an image that was built with `GIT_COMMIT_SHA` (a `--build-arg`) names its commit, and one that was not says `unknown` rather than guessing.

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

### 2.1 Single-project mode: the API served by the same deployment

If you would rather not run a second host, set `EMBEDDED_API=true` on the Vercel project and the Next
app serves the API itself from `apps/web/src/app/embedded-api/[...path]/route.ts`, which builds the same
runtime the standalone server uses (`apps/api/src/runtime.ts`). The `/api/v1/*` rewrite then points inward,
so the browser, cookies, and CSRF behaviour are identical to the split setup.

| Variable | Value | Why |
| --- | --- | --- |
| `EMBEDDED_API` | `true` | Read **at build time** — it selects the internal rewrite. Changing it requires a redeploy. |
| `API_URL` | omitted | Only used by the external-API rewrite and by `apps/api` for its own URLs. |
| `DATABASE_URL` | `postgresql://…` | See 2.2. |
| `DATABASE_POOL_MAX` | `2` | Each serverless instance holds its own pool; keep it small. |
| `STEWARD_MASTER_KEY`, `SESSION_SECRET` | 32-byte random hex | Encrypts stored credentials and signs sessions. Generate per environment and keep them out of git. |
| `APP_URL` | `https://app.example.com` | Also the only origin the API accepts for state-changing requests, so it must match the deployed URL exactly. |
| `RUN_MIGRATIONS_ON_START` | `false` | Cold starts would otherwise race each other applying the same migration. Apply them from a shell instead. |
| `TEMPORAL_DISABLED` | `true` unless you have Temporal | Without it the instance tries to reach a Temporal endpoint and waits for the connect timeout on every cold start. |

The trade-offs are real: a serverless function is not a long-lived process, so the event stream falls
back to 2-second polling (it is built for that — see `streamEvents` in `apps/api/src/routes/work.ts`), an
SSE connection is closed when the function hits its duration limit and reconnects from its last event
id, and agent runs need a real Temporal endpoint, which this mode does not provide.

#### What this repository's own hosted instance sets

The deployment this repository runs (Vercel project `steward`, team `novara-exosystems-projects`) is this mode,
for Production only: `EMBEDDED_API=true`, `DATABASE_URL` (Supabase project `steward-prod`, reached through the
`aws-0-…` pooler with `uselibpqcompat=true&sslmode=require`), `STEWARD_MASTER_KEY`, `SESSION_SECRET`,
`APP_URL=https://steward-eosin.vercel.app`, `DATABASE_POOL_MAX=2`, `RUN_MIGRATIONS_ON_START=false`,
`TEMPORAL_DISABLED=true`, `BROWSER_PROVIDER=none`, `TRUST_PROXY=true`. Migrations are applied from a checkout with the same
`DATABASE_URL` (`pnpm db:migrate`), never on cold start.

`steward-eosin.vercel.app` is the project's assigned public domain, and it is the only public door: the
`*.vercel.app` system domains (including the per-deployment URLs) stay behind Vercel Authentication, so the
canonical domain is what `APP_URL` names and what a user should be given.

Three things this mode does not have, said out loud rather than implied: email is the console
(`RESEND_API_KEY` unset), so invitation and password-reset links land in the function log instead of an inbox;
Temporal is absent, so a call that would start a run answers `503` with the reason rather than pretending to
start one; and there is no browser, so `BROWSER_PROVIDER=none` is set and a browsing run is refused with the
package's own sentence. That last one was learned the hard way — a serverless bundle carries `playwright-core`
without its files, so `auto`'s probe threw during the API's own start-up and every route answered
`api_unavailable`, including the ones that have nothing to do with a browser; `browserProviderFromEnv` now
turns a missing engine into `DisabledBrowserProvider` rather than an exception that takes the API down.

### 2.2 Managed Postgres (Supabase)

The database is ordinary PostgreSQL. It needs the `vector` and `pgcrypto` extensions, which
`runMigrations()` creates for you. Give the application its own role rather than using the provider's
superuser:

```sql
create extension if not exists vector;
create extension if not exists pgcrypto;
create role steward_app login password '<generated>';
grant create on database postgres to steward_app;   -- the migrator creates its own schema
```

Then apply the schema from the repository (this is also how you apply new migrations later):

```bash
DATABASE_URL='postgresql://steward_app.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?uselibpqcompat=true&sslmode=require' \
  pnpm --filter @steward/db migrate
```

Two details worth knowing before they cost you an afternoon:

- **Use the pooler host, not `db.<ref>.supabase.co`.** New Supabase projects resolve that name to an
  IPv6 address only, and many build and serverless environments have no outbound IPv6.
- **`sslmode=require` alone fails against the pooler** with `self-signed certificate in certificate
  chain` — recent `pg` treats `require` as `verify-full`, and the pooler's CA is not in Node's trust
  store. `uselibpqcompat=true&sslmode=require` keeps the connection encrypted with libpq's semantics.

Because the tables are created by your own role, Supabase's Data API roles (`anon`, `authenticated`) get
no privileges on them — verify, and enable row-level security as well, since table owners are unaffected
by it and future migrations may run as a different role:

```sql
select c.relname, has_table_privilege('anon', c.oid, 'SELECT')
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r';

do $$ declare t record;
begin
  for t in select n.nspname, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r'
  loop execute format('alter table %I.%I enable row level security', t.nspname, t.relname); end loop;
end $$;
```

Steward never uses the Data API, so RLS policies are unnecessary — the absence of grants is the control.

### Why the rewrite instead of calling the API directly?

The browser only ever talks to `app.example.com`. Vercel forwards `/api/v1/*` to the API, so the session cookie the API sets is a first-party cookie on `app.example.com`, `SameSite=Lax` works, and there is no cross-origin CORS/credentials dance. SSE streams pass through Vercel's rewrite layer unbuffered.

---

### 2.3 The build environment is part of the build

A deployment is a build, and a build reads the environment. `next.config.ts` chooses the `/api/v1/*` rewrite
from `EMBEDDED_API` at build time, which means a bundle built with the switch off can never be repaired by
switching it on: the variable has to be part of what distinguishes one build from another. Turborepo's cache
key only includes the variables the build task declares in `turbo.json`, so every variable a build-critical
file reads is named there, and `apps/web/src/lib/build-env.test.ts` reads `next.config.ts`,
`src/lib/server.ts` and `src/app/layout.tsx` off disk and fails when one is missing.

This is not a hypothetical: the first hosted deployment of this repository was a **cache hit** from a build
made before `EMBEDDED_API` existed. The landing page served `200`, and every `/api/v1/*` call answered with
Vercel's `DNS_HOSTNAME_RESOLVED_PRIVATE` page, because the restored bundle still rewrote to
`http://localhost:4000`. Redeploying the same commit with the variable set changed nothing — the cache key was
identical. If a hosted deployment serves pages and no API, check what the build was given (and what it was
keyed by) before checking the network.

### 2.4 Which commit is being served

A hosted instance that cannot name its own commit cannot be told apart from the one before it — and this
one proved it: every check was green for five days while production served a bundle older than `main`. So
`/health` states one:

```sh
curl -s https://app.example.com/health
# {"ok":true,"version":"0.1.0","commit":"ef63b83","db":"ok","temporal":"connected"}
```

`commit` is the seven-character short sha of `VERCEL_GIT_COMMIT_SHA`, the variable Vercel sets for the build
and for the function (the same variable is available at runtime, so nothing has to be baked into the bundle
to read it). An image built by this repository's own Dockerfiles can pass the same fact as `GIT_COMMIT_SHA`.
When neither is set the answer is `unknown`, never a guess: the field exists so that a checker can compare it
against a repository, and a plausible-looking sha would make that comparison lie in the one direction that
matters. Because it is read at **runtime**, it is deliberately absent from Turborepo's build cache key
(§2.3): nothing about the bundle depends on it, and adding it would throw the cache away on every deployment
without changing a byte.

The other half is the check that reads it from outside the deployment: `pnpm hosted:check`
(`scripts/hosted-check.mjs`) fetches the landing page, a legal page, the document list the sign-up form
accepts, a login attempt that must be refused as a wrong password, and `/health` — then compares the reported
commit against this checkout's `HEAD` and fails when they disagree, because "the hosted instance lags the
repository" is otherwise a fact nobody sees. It needs no account and no token, and `EXPECT=any` skips the
comparison for a deployment that is deliberately older. `.github/workflows/hosted-check.yml` runs the same
script daily and on demand; deliberately not on push, since after every push to `main` the difference is
expected until someone deploys, and a check that is red after every merge is a check nobody reads.

**Deploying this repository's own instance.** Project `steward` has no git connection, so pushing to `main`
does not rebuild production: deployments are created from the commit being deployed — through the Vercel API, or `vercel --prod` from a
checkout — and the field above is what makes the result checkable afterwards. To
restore self-deploying `main`, connect `ronavkarumsi04/steward` to the project in Vercel's Git settings with
the settings §2 describes (Root Directory `apps/web`); the per-deployment `*.vercel.app` URLs stay behind
Vercel Authentication either way, and the assigned domain is the door (§2.1).

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

See `docs/THREAT_MODEL.md` for the full trust boundaries, and `docs/compliance/README.md` for the
compliance artifacts this deployment is expected to have in place (incident response, vendor register,
records of processing, admin access, backup/DR).

---

## 6. Pre-launch checklist

- [ ] `curl https://api.example.com/health` returns `"db":"ok","temporal":"connected"`
- [ ] `https://app.example.com` loads; register → onboard → create a company works
- [ ] Invite yourself from a second address; the email arrives and the link registers + joins
- [ ] "Forgot password" email arrives; the link resets and signs you in
- [ ] `ALLOW_SIGNUP=false` in `.env`; `/register` shows the invitation-only card
- [ ] Postgres backup cron in place; `.env` (master key) stored in a password manager **separately from the backups**
- [ ] `/legal` loads, and the Terms, Privacy, AUP and DPA render without unresolved `{{placeholders}}`
- [ ] `LEGAL_*` variables set so the documents name the real operator, contact channel, hosting region and subprocessors
- [ ] `/legal/subprocessors` lists only vendors this deployment actually uses
- [ ] Registration requires the clickwrap and `agreements` rows are written with version, timestamp and IP
- [ ] `/app/account` exports your own data and `/app/org/<id>/privacy` exports the organization's data (check the manifest lists the exclusions)
- [ ] Deleting a test account removes it, keeps suppression records, and leaves a `privacy_requests` row
- [ ] A marketing email sent through an integration carries a working one-click `List-Unsubscribe` and reaches `/unsubscribe/<token>`
- [ ] SMS is blocked without a recorded consent, and replying STOP revokes it
- [ ] The retention sweep logs on worker boot (expired sessions, tokens, invitations, events, webhook logs)
- [ ] `docs/THIRD_PARTY_NOTICES.md` regenerated after any dependency change (`node scripts/generate-third-party-notices.mjs`)
- [ ] Backup restored into a scratch database at least once; restore time recorded in `docs/compliance/BACKUP_AND_DR.md`
- [ ] Provider keys added under **Org → Providers**; budgets set under **Org → Budgets**
- [ ] `SANDBOX_PROVIDER` decided (§5)

CI (`.github/workflows/ci.yml`) runs lint, typecheck, build, unit/integration tests against real Postgres + Temporal, the production boot verification (`pnpm verify:boot`, including the Playwright golden path), and builds all three Docker images on every push and pull request.
