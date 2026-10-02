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
architecture requires coordinated durability for Postgres, Temporal, artifact bytes and master-key versions.

## 2. What must be backed up

1. **PostgreSQL** — the source of truth for every tenant, including encrypted credentials. Without it nothing else matters.
2. **The master-key ring** (`STEWARD_MASTER_KEY` and required `STEWARD_PREVIOUS_MASTER_KEYS`) — **stored separately from the backups**. A dump may contain credentials encrypted under several key versions; recovering only the current key is insufficient for older envelopes.
3. **Artifact storage** — the `ARTIFACT_DIR` volume (or object storage). Metadata rows reference storage keys; losing the bytes loses the files.
4. **Temporal persistence** — this repository's Compose deployment uses PostgreSQL databases
   `temporal` and `temporal_visibility`, created by `infra/postgres/init/01-temporal.sh`; include both in
   a coordinated recovery plan. A separately configured Temporal CLI dev server may use SQLite
   (`--db-filename`), but that is not the Compose persistence layout. Temporal Cloud recovery is managed
   by the vendor and needs its own confirmed namespace retention/recovery contract. Postgres run rows
   do not reconstruct workflow history; inspect recorded side effects before restarting lost workflows.
5. **Deployment environment** — the `.env` file (which contains the key). Keep it in a password manager, not in the repository.

## 3. Taking a backup

```bash
# Database (compressed custom format is easier to restore partially)
# Use the configured POSTGRES_USER/POSTGRES_DB when they differ from these defaults.
# Custom format already compresses; -T prevents a terminal from corrupting the binary archive.
# set -o pipefail if you add a compressor or upload pipeline.
umask 077
docker compose exec -T postgres pg_dump -U steward -Fc steward > steward-$(date +%F).dump

# Self-hosted Compose Temporal persistence (not a production recovery proof by itself).
# For a cold snapshot, stop API, workers and Temporal services while taking all three dumps.
# Independent live dumps are not one atomic cross-database checkpoint; provider snapshots/PITR
# need a coordinated cutoff and a tested reconciliation plan.
docker compose exec -T postgres pg_dump -U steward -Fc temporal > temporal-$(date +%F).dump
docker compose exec -T postgres pg_dump -U steward -Fc temporal_visibility > temporal-visibility-$(date +%F).dump

# Artifacts: Compose mounts a named volume, not ./data/artifacts on the host.
# Select the actual configured volume and refuse an absent one, rather than backing up an empty mount.
ARTIFACT_VOLUME=steward_artifacts
docker volume inspect "$ARTIFACT_VOLUME" >/dev/null
docker run --rm --network none --mount type=volume,source="$ARTIFACT_VOLUME",target=/source,readonly \
  alpine:3.20 tar -czf - -C /source . > artifacts-$(date +%F).tar.gz
# A non-Compose operator must archive its actual ARTIFACT_DIR or configured object store instead.

# If using a separate SQLite-backed Temporal CLI dev server, stop it first and back up
# its actual configured --db-filename. Compose does not produce temporal-dev.db.
```

Encrypt backups at rest (the target storage's own encryption is acceptable), restrict access to the operator
who took them, and never store a backup and the master key in the same place — that combination turns one
compromise into full credential exposure.

## 4. Restoring

```bash
# 1. Restore into a scratch database first, never straight over production
# SCRATCH_URL must point at a newly created, empty database; never use the live DATABASE_URL.
# For a managed provider, provision it through that provider's normal process.
pg_restore --exit-on-error -d "$SCRATCH_URL" --no-owner steward-2026-10-02.dump

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
6. Record the date, the backup used, the time taken and scope of the drill, and any surprises in this file.
   A scratch database import time is not full service RTO: include artifacts, key recovery, Temporal,
   application boot, integrations and hosted validation before reporting a service recovery time.

An RTO you have never measured is a guess. Update the target row in section 1 if the measurement disagrees.

### Recorded drill — 2026-10-02 (local fixture environment only)

A custom-format dump of the local Compose application database was restored with `--exit-on-error`
into a newly created `steward_restore_drill_*` database. All 70 public table row counts matched the
source snapshot. Applying migrations completed successfully and all eight migration-invariant checks
passed against the restored copy, including cross-organization rejection and preserved suppression rows.
The scratch database and dump were removed after verification. The successful database drill took 6 seconds.
An initial attempt stopped at a package-manager mismatch before validation; the successful retry used
this repository's pinned pnpm version.

This did not restore production, Temporal persistence, artifact bytes or an operator-held master key,
and did not exercise a real provider credential, application login or hosted recovery. Production backup
existence, encryption, retention, recoverability, RPO and full service RTO remain **UNVERIFIED**.

## 6. Deletion and backups

Deleting an account or organization removes records from production immediately. Because backups are rolling,
under this policy those records can persist in a backup for up to 30 days. Actual provider retention must be verified. There is **no per-customer backup surgery**: we do not
rewrite old backups to remove a single tenant, because that would damage the integrity of the whole set. This
is disclosed in the Retention Policy so customers are not surprised.

## 7. Disaster scenarios

| Scenario | Response |
| --- | --- |
| Database host lost | Restore the newest backup into a new instance, run migrations, repoint `DATABASE_URL`, accept up to 24h of loss |
| Artifact volume lost | Restore from the artifact archive; artifacts created after the last archive are gone; metadata rows remain but cannot supply the missing bytes |
| Master key lost | **Unrecoverable.** Stored credentials cannot be decrypted. Each integration and provider key must be re-entered by customers; API keys must be reissued |
| Temporal namespace lost | Running workflows stop. Completed runs and their audit trail are intact in Postgres; interrupted runs need to be restarted manually |
| Region outage | Restore into another region and update DNS/`APP_URL`. Expect the full RTO |
| Ransomware / destructive intrusion | Treat as a security incident first (see `INCIDENT_RESPONSE.md` §4-5), then restore from a backup taken before the intrusion |

## 8. What this policy does not promise

No geographic redundancy, no continuous replication, no point-in-time recovery, no SLA, and no guarantee of
zero data loss. The hosted service is best-effort; the numbers in section 1 are targets we work to and test
against, not contractual commitments.
