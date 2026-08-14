# Operations runbook

## Financial reversals

Refunds are append-only `Refund` ledger rows associated with their invoice and operator.
Never delete or rewrite historical `Payment` or `Refund` rows. `PARTIALLY_REFUNDED` means some
received funds were reversed; `REFUNDED` means all received funds were reversed. External
refund references are unique, and each reversal also creates an audit entry.

## Clinic time

Set `CLINIC_TIME_ZONE` to the clinic IANA timezone on every backend instance and
`VITE_CLINIC_TIME_ZONE` to the same value at frontend build time. Container/server `TZ` does
not define business time. Appointment date/time strings are clinic-local calendar values;
`createdAt` and other event timestamps remain UTC. Cancellation is blocked exactly at the
configured cutoff and thereafter.

## Known development-data exceptions

The pre-deployment audit found two historical invoice/payment inconsistencies in `dev.db`.
They are intentionally not auto-reconciled because rewriting financial history requires an
approved data-correction procedure. Staging must start from fresh non-real data, so these two
development-only rows are not staging blockers.

## Health and shutdown

`GET /api/health/live` reports process liveness. `GET /api/health/ready` (and compatibility
route `/api/health`) queries the database and returns 503/500-class failure without connection
details or stack traces. Route monitoring to readiness; use liveness only for process restart.
SIGTERM and SIGINT stop accepting HTTP requests, close Socket.IO and HTTP, disconnect Prisma,
and exit. The platform termination grace period should be at least 30 seconds.

## SQLite storage and backups

Mount the directory containing `DATABASE_URL=file:/data/clinic.db` persistently. Do not place
it on an ephemeral container layer or network filesystem with unsafe locking. Run one backend
writer. SQLite WAL may improve read/write overlap, but enable it only after a staging workload,
backup, and restart test; the current migration history does not force journal mode.

Run `DATABASE_URL=file:/data/clinic.db BACKUP_DIR=/backups npm run backup:sqlite` from a host or
job that has `sqlite3` and both persistent mounts. The script uses SQLite's online backup API,
runs integrity and foreign-key checks, creates mode-0600 files, and deletes backups older than
`BACKUP_RETENTION_DAYS` (default 30). Store `/backups` encrypted, off-host, and access-controlled.
Back up `UPLOAD_DIR` in the same recovery point. Encryption-at-rest and retention must follow
clinic policy; no legal retention period is assumed here.

Restore drill: stop writers, copy the selected backup and uploads into an isolated staging
volume, run `PRAGMA integrity_check` and `PRAGMA foreign_key_check`, point a staging backend at
the restored file, apply only forward migrations after taking another copy, and verify health
plus read-only workflows. Never overwrite production during a drill.

For future PostgreSQL use daily encrypted `pg_dump --format=custom`, verify with `pg_restore
--list`, and regularly restore into isolated staging. Retention and point-in-time recovery are
provider/policy decisions.

## Uploads

`UPLOAD_DIR` must be persistent and included with backups. Files are limited by
`UPLOAD_MAX_BYTES`, signature/MIME checked, randomly named, path-normalized, authorization
checked, and served with `nosniff`. Malware scanning is not implemented. Multiple backend
instances require shared object storage and a separately tested migration.

## Verification delivery

Production registration supports authenticated SMTP email verification only. It requires a
real patient email; delivery failures return a safe 503 and the partial registration is removed.
Development codes are generated randomly, hashed at rest, rate-limited, and exposed only when
the explicit development provider is selected outside production.

**NOT PRODUCTION READY FOR SMS DELIVERY.** No SMS provider exists. SMS calls record FAILED and
never claim delivery. Appointment email is sent only to a real stored email; fabricated local
patient addresses were removed. SMTP tests must use a controlled staging inbox, never a real
patient or an external recipient during automated tests.

## Logs and monitoring

Application logs are JSON with INFO, WARN, ERROR, and SECURITY-capable levels and correlation
IDs. Do not collect request bodies. Delivery logs omit message bodies and credentials. Protect
logs as sensitive operational data and define retention with the privacy/security owner.

External monitoring is not bundled. Configure alerts for readiness failure, 5xx rate,
database errors, login/rate-limit spikes, process restarts, database/upload/backup disk usage,
backup job failure or missing-success heartbeat, SMTP failures, and certificate expiry. The
backup scheduler must emit success to the monitoring service; nonzero exit or a missed daily
heartbeat must page the operator.

## Medical encryption key

Keep `MEDICAL_ENCRYPTION_KEY` in the secret manager, backed up separately under dual control.
Losing it loses access to encrypted clinical content. Rotation is an explicit maintenance job:
freeze writes → snapshot database → decrypt each field with the old key → encrypt with the new
key → verify every record and counts → atomically replace on a copy → cut over → retain the old
key under controlled rollback custody. No automatic rotation currently exists.

## Rollback

Retain the previous immutable frontend/backend image digests, environment version, verified
database backup, and matching upload backup. Stop writes; if no migration ran, redeploy previous
images. If a migration ran, assess backward compatibility: restore the pre-deployment database
and uploads together before starting previous images. Verify readiness and smoke tests. Git
rollback alone is insufficient.

## Retention decisions

Application logs, audit logs, notification logs, uploads, and backups currently have no
automatic policy-driven deletion except configurable backup-file pruning. Clinic governance
must set retention, legal hold, access, and secure deletion policies before production.
