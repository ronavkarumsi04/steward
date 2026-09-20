# Contributing

Thanks for helping build Steward.

## Development setup

```sh
docker compose up -d
pnpm install
pnpm build
pnpm db:migrate
pnpm dev
```

Run `pnpm typecheck && pnpm lint && pnpm test` before pushing. `pnpm test` in `apps/api` needs Postgres and Temporal running (docker compose). `pnpm --filter @steward/web test:e2e` runs Playwright against a running web app (`E2E_BASE_URL`, default `http://localhost:3000`).

## Ground rules

- **No fakes.** Do not add stubbed integrations, fake AI calls, in-memory "durable" state or placeholder routes that pretend to succeed. If something needs a credential you don't have, make it fail loudly with a clear error and document it.
- **Tenant scope everywhere.** New repositories/activities must take `{ organizationId, companyId }` explicitly.
- **Secrets never in plaintext** in responses, logs or tests fixtures.
- **Risky tools need risk classification** in `packages/policy` and an approval path.
- Keep changes focused; follow the surrounding style (TypeScript strict, ESM, zod schemas in `packages/schema`).
- Add or update an ADR in `docs/adr/` for architectural decisions.

## Commits and PRs

- Sign off commits (`git commit -s`) — we use the Developer Certificate of Origin.
- Describe *why* in the PR body; include test output.
- One logical change per PR.

## Adding a provider / integration / tool

- AI provider: add to `packages/ai/src/catalog.ts` (auth kind, models, pricing) and, if it is not OpenAI-compatible, an adapter in `packages/ai/src/adapters/`. Add a contract test in `adapters.test.ts` using the HTTP stub.
- Integration: add a definition in `packages/integrations/src/providers/` with `status: "implemented" | "framework"` honestly set; implement actions through the framework so credentials never reach tools directly.
- Tool: register in `packages/tools`, declare `risk` and required integration, and cover with a unit test.
