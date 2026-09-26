# Backup and Disaster Recovery Policy

Self-hosted operators own this entirely; the hosted instance follows this document. Targets are deliberately
modest because the project is run on a best-effort basis and saying otherwise would be a lie.

## 1. Targets

| Objective | Target | What it means in practice |
| --- | --- | --- |
| RPO (data loss) | ≤ 24 hours for the hosted instance | A disaster can cost up to a day of agent activity |
| RTO (service restored) | ≤ 24 hours for the hosted instance | Service may be unavailable for a day while restoring |
| Backup retention | Rolling 30 days | Older backups are destroyed; this is the window a deleted record can survive in |
| Restore verification | Quarterly | An unverified backup is a hypothesis, not a backup |

If you need better than this, self-host with your own replication and point-in-time recovery. The
architecture supports it — Postgres plus a Temporal namespace is all that must be durable.

## 2. What must be backed up

1. **PostgreSQL** — the source of truth for every tenant, including encrypted credentials. Without it nothing else matters.
2. **The master key** (`STEWARD_MASTER_KEY`) — **stored separately from the backups**. Restoring the database without the key leaves every stored credential undecryptable.
3. **Artifact storage** — the `ARTIFACT_DIR` volume (or object storage). Metadata rows reference storage keys; losing the bytes loses the files.
4. **Temporal persistence** — for the dev-server setup the state lives in its own SQLite file (`--db-filename`); on Temporal Cloud it is the vendor's responsibility. In-flight workflows are recoverable from Postgres run rows plus a restart, but history is not perfectly reconstructible, so back it up if you rely on long-running workflows.
5. **Deployment environment** — the `.env` file (which contains the key). Keep it in a password manager, not in the repository.

## 3. Taking a backup

```bash
# Database (compressed custom format is easier to restore partially)
docker compose exec postgres pg_dump -U steward -Fc steward | gzip > steward-$(date +%F).dump.gz

# Artifacts
tar -czf artifacts-$(date +%F).tar.gz -C ./data artifacts/

# Temporal dev-server state (local/dev only)
cp ./temporal-dev.db temporal-$(date +%F).db
```

Encrypt backups at rest (the target storage's own encryption is acceptable), restrict access to the operator
who took them, and never store a backup and the master key in the same place — that combination turns one
compromise into full credential exposure.

## 4. Restoring

```bash
# 1. Restore into a scratch database first, never straight over production
createdb steward_restore
gunzip -c steward-2026-09-25.dump.gz | pg_restore -d "$SCRATCH_URL" --no-owner

# 2. Apply any migrations newer than the dump, so the schema matches the code you run
DATABASE_URL="$SCRATCH_URL" pnpm --filter @steward/db migrate

# 3. Verify before promoting: tenant isolation, row counts, and that a known credential still decrypts
psql "$SCRATCH_URL" -c "select count(*) from companies;"
psql "$SCRATCH_URL" -c "select count(*) from sessions where expires_at > now();"
```

A credential row that fails to decrypt means the master key does not match the data — stop and fix that
before promoting the restore, because the app will fail on the first provider call.

## 5. Restore test (quarterly)

1. Restore the most recent backup into a scratch database.
2. Run migrations.
3. Start the API against it with `RUN_MIGRATIONS_ON_START=false` and sign in with a known account.
4. Open one company, one conversation, and one run detail page; confirm the audit trail renders.
5. Try one provider call with a restored credential to prove the master key matches.
6. Record the date, the backup used, the time taken (that is your real RTO), and any surprises in this file.

An RTO you have never measured is a guess. Update the target row in section 1 if the measurement disagrees.

## 6. Deletion and backups

Deleting an account or organization removes records from production immediately. Because backups are rolling,
those records can persist in a backup for up to 30 days. There is **no per-customer backup surgery**: we do not
rewrite old backups to remove a single tenant, because that would damage the integrity of the whole set. This
is disclosed in the Retention Policy so customers are not surprised.

## 7. Disaster scenarios

| Scenario | Response |
| --- | --- |
| Database host lost | Restore the newest backup into a new instance, run migrations, repoint `DATABASE_URL`, accept up to 24h of loss |
| Artifact volume lost | Restore from the artifact archive; artifacts created after the last archive are gone (metadata rows remain and are marked missing) |
| Master key lost | **Unrecoverable.** Stored credentials cannot be decrypted. Each integration and provider key must be re-entered by customers; API keys must be reissued |
| Temporal namespace lost | Running workflows stop. Completed runs and their audit trail are intact in Postgres; interrupted runs need to be restarted manually |
| Region outage | Restore into another region and update DNS/`APP_URL`. Expect the full RTO |
| Ransomware / destructive intrusion | Treat as a security incident first (see `INCIDENT_RESPONSE.md` §4-5), then restore from a backup taken before the intrusion |

## 8. What this policy does not promise

No geographic redundancy, no continuous replication, no point-in-time recovery, no SLA, and no guarantee of
zero data loss. The hosted service is best-effort; the numbers in section 1 are targets we work to and test
against, not contractual commitments.
