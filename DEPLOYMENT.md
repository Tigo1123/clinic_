# Deployment guide

## Supported initial topology

The recommended first deployment is one backend instance using SQLite on an encrypted,
persistent attached volume, with uploads on a second persistent path. This keeps the tested
Prisma migration history and avoids an untested database conversion. It is suitable only for
a modest clinic workload and a single writer. PostgreSQL is the target before horizontal
scaling or materially higher concurrency.

Traffic flow: Internet → HTTPS load balancer/reverse proxy → frontend Nginx → `/api` and
`/socket.io` proxy to backend. TLS terminates at the platform or edge proxy. The application
enables HSTS only in production; do not expose the backend directly to the Internet.

## Production environment

Required: `NODE_ENV=production`, `DATABASE_URL`, `JWT_SECRET`, `MEDICAL_ENCRYPTION_KEY`,
`CLINIC_TIME_ZONE`, `CORS_ALLOWED_ORIGINS`, `VERIFICATION_PROVIDER`, `UPLOAD_DIR`. The clinic
timezone must be a valid IANA name such as `Africa/Khartoum`. Generate independent secrets
with at least 32 random characters and store them in the deployment secret manager.

For email verification, set `VERIFICATION_PROVIDER=email`, `SMTP_HOST`, `SMTP_PORT`,
`SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM`. `NOTIFICATIONS_DISABLED` must be
false. SMS is not implemented. `VERIFICATION_PROVIDER=disabled` makes registration fail safe.

Optional operational settings: `PORT`, `TRUST_PROXY`, `PHONE_DEFAULT_COUNTRY`,
`DEFAULT_STATE_ID`, `PATIENT_CANCELLATION_CUTOFF_HOURS`, `SMTP_CONNECTION_TIMEOUT_MS`,
`UPLOAD_MAX_BYTES`, `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_LOGIN_MAX`,
`RATE_LIMIT_REGISTRATION_MAX`, `RATE_LIMIT_VERIFICATION_MAX`, and `RATE_LIMIT_CLAIM_MAX`.

Frontend production variables are baked at build time: `VITE_API_BASE_URL`,
`VITE_STAFF_SOCKET_URL`, and `VITE_CLINIC_TIME_ZONE`. The frontend timezone must match
`CLINIC_TIME_ZONE`. Leave the two origin variables blank for the supplied same-origin Nginx configuration.
`VITE_PROXY_TARGET` is development-only.

Environment separation:

| Environment | Database | Verification | Origins/secrets |
| --- | --- | --- | --- |
| development | ignored `dev.db` | `development` code exposure | localhost and local-only secrets |
| test | disposable `test.db` | `development`, notifications disabled | injected by `test/run-tests.js` |
| qa | ignored `qa.db` | development/test provider only | isolated QA env file and QA origin |
| production | persistent `/data/clinic.db` | `email` or fail-safe `disabled` | secret manager and exact HTTPS origins |

The server rejects missing/weak production secrets, wildcard/non-HTTPS CORS, invalid database
URLs, an absent/invalid production clinic timezone, development verification, and incomplete SMTP configuration without printing values.

## Authentication posture

JWTs expire after `JWT_EXPIRES_IN` (default eight hours). Every authenticated HTTP request and
Socket.IO handshake rechecks account status and role, so disabled staff sessions stop working.
The frontend currently stores bearer tokens in `localStorage`; migration to secure HttpOnly,
SameSite cookies requires coordinated CSRF/session changes and is deferred rather than
half-migrated. Logout clears the local token but there is no token denylist, so secret custody,
short expiry, HTTPS, and account deactivation remain important.

Password hashing defaults to bcrypt cost 12. Login invalid-user and invalid-password responses
are generic; inactive accounts are deliberately reported as deactivated. MFA fields exist but
MFA enforcement is not implemented and must not be represented as active.

## Release procedure

1. Deploy the exact tested commit to staging using non-real patient data.
2. Verify persistent database and upload mounts, SMTP test-inbox delivery, HTTPS, WebSocket
   upgrade, health endpoints, backups, and restore drill.
3. Back up the production database and uploads before applying migrations.
4. Run `npx prisma migrate deploy`; never use `migrate reset` or `db push` in production.
5. For a deployment containing the Patient MRN migration, immediately grant
   sequence `USAGE` to that environment's runtime role:

   ```sh
   MIGRATION_DATABASE_URL='<migration connection>' \
   RUNTIME_DATABASE_ROLE='<environment runtime role>' \
   npm run db:grant:patient-mrn-sequence
   ```

   Verify an existing-backend Patient insert through the runtime connection
   before deploying the new backend. If migration and grant cannot run
   adjacently, temporarily prevent Patient-creation traffic during that brief
   interval.
6. Start the backend and frontend immutable images; do not run the seed script in production.
7. Execute `PRODUCTION_CHECKLIST.md` and the non-destructive smoke tests.

Production and normal staging startup run migrations and start the server only. They never seed:
`npm run start:container` or `npm run start:staging`. If a brand-new non-production staging
database deliberately needs demo fixtures, run `DEPLOYMENT_ENV=staging ALLOW_STAGING_SEED=true
npm run seed:staging` once as a separate manual job, then remove `ALLOW_STAGING_SEED`. Never put
that flag in a persistent Render environment group. Create the first production administrator
through a separately reviewed one-time bootstrap procedure using a secret supplied at execution
time, then disable the procedure and rotate the initial password; the repository seed is not a
production bootstrap mechanism.

## Render SQLite staging checklist

While SQLite is retained, attach one persistent disk to the single backend service at `/data`.
Use `DATABASE_URL=file:/data/clinic.db` and `UPLOAD_DIR=/data/uploads` so both mutable stores are
beneath that mount. Create `/data/uploads` with write permission for the runtime user. Do not
scale beyond one backend instance and do not run overlapping deploys/writers.

Before accepting a deployment, verify in the Render dashboard and with a controlled staging
record that the disk is attached at `/data`, both paths are writable, and the record plus upload
survive a process restart and a redeploy. Schedule SQLite online backups and upload snapshots to
encrypted off-instance storage; alert on failure/missed runs and disk capacity. Restore a backup
and its matching uploads into an isolated service, run integrity/foreign-key checks and health,
and record the drill date. Instance replacement without the correctly attached disk loses local
data; deploy only after a verified backup and avoid changing the disk mount path.

The compose file is a deployment reference and requires secrets through the environment. Its
named volumes persist SQLite and uploads. Production should pin image digests and put an HTTPS
proxy in front of port 8080.

## PostgreSQL staging migration plan

Do not change the provider in place. Freeze writes, take verified database/upload backups,
create a PostgreSQL-specific Prisma schema and migration history on a branch, export and
transform a copy of SQLite data, import in dependency order, validate row counts and foreign
keys, run all authorization/workflow tests, then perform a timed staging cutover and rollback
drill. Production cutover requires explicit approval and retained SQLite backups.

## Release version

Use semantic versions beginning with `v1.0.0` only after staging acceptance. Tagging and
publishing are manual approval steps and are not part of this configuration.
