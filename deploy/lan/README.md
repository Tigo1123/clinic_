# Offline LAN deployment — HTTPS same-origin frontend, API, and Socket.IO

This directory contains a reversible, test-bench-only foundation for running
the clinic frontend, Express API, Socket.IO, and PostgreSQL on one local server.
It is **not approved for clinical operation**. In particular, Phase 1A.1 uses
HTTPS :443 is the only LAN application transport. Nginx's loopback-only
container health listener on :8080 is not published and is not an application
transport. TLS client trust and operational activation remain gated.
WAN-disconnected clinical acceptance testing.

## Architecture

```text
Clinic browser
      |
      +-- https://clinic-server.local:443 (target origin)
      |      |-- /            -> React static frontend
      |      |-- /api/...     -> Nginx -> backend:5000
      |      `-- /socket.io/  -> Nginx -> backend:5000 (WebSocket/long polling)
      `-- (Nginx loopback :8080 /healthz only; not LAN-facing)
                                      |
                                      `-> postgres:5432
```

Nginx publishes only host port `443` (TLS). `backend:5000` and `postgres:5432` are
Docker-private and must never be entered into a workstation browser. `lan-edge`
carries the frontend's published HTTP listener; `lan-app` and `lan-data` are
internal networks for frontend-to-API and API-to-database traffic respectively.
PostgreSQL data and uploads use separate named volumes.

`lan-postgres-data` and `lan-uploads-data` survive normal container replacement
and `docker compose down` without volume removal. **Never run `docker compose
down -v` on a clinic installation**: `-v` destroys these persistent volumes.

## Files

- `../../compose.lan.yml`: isolated LAN Compose definition.
- `env.example`: non-secret configuration contract with unusable placeholders.
- `nginx.conf`: transitional HTTP/TLS static server and same-origin reverse proxy.
- `../../backend/test/lan-deployment-foundation.test.js`: Phase 1A.1 static
  safety checks.
- `../../backend/test/lan-same-origin.test.js`: Phase 1A.2 browser-origin,
  proxy, CORS, health, and upload-link checks.

The existing root `docker-compose.yml` is intentionally unchanged.

## Prerequisites

- Docker Engine with the Compose v2 plugin.
- Locally available build dependencies/images when testing without WAN.
- A separately created environment file outside Git. Never use this example as
  a real secret file and never commit its replacement.

No stack should be started during Phase 1A.1 review. Starting PostgreSQL would
initialize a new local data directory, while database role/bootstrap design is
reserved for a later approved step.

## Safe static validation

These commands parse configuration and run static tests; they do not create or
start containers and do not connect to a database:

```sh
docker compose --env-file deploy/lan/env.example -f compose.lan.yml config
node --test backend/test/lan-deployment-foundation.test.js
node --test backend/test/lan-same-origin.test.js
```

## Same-origin frontend configuration

The application already defaults `VITE_API_BASE_URL` and
`VITE_STAFF_API_URL` to relative API paths, and `VITE_STAFF_SOCKET_URL` to the
browser origin, when they are empty. The LAN frontend image therefore does not
embed a cloud endpoint. Nginx forwards both paths to the private backend
service.

The LAN build leaves all three URL overrides empty. Normal browser traffic uses
only the page origin: React requests relative `/api/...` URLs and Socket.IO uses
the current browser origin with its standard `/socket.io/` path. Docker service
names occur only in server-side Compose and Nginx configuration. No Render
endpoint or public Internet connection is required for these normal paths.

## CORS and forwarded headers

`CORS_ALLOWED_ORIGINS` must equal the single origin used by workstations,
including its scheme and non-default port. The example uses
`https://clinic-server.example.internal`; wildcard CORS is not allowed. The
HTTPS origin is the only staff/browser application origin.

Nginx forwards `Host`, `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Host`, and
`X-Forwarded-Proto`. The LAN Compose file sets `TRUST_PROXY=true`, which the
existing Express configuration interprets as one trusted proxy hop. The
application's CORS checks and Socket.IO access-token authentication remain
unchanged.

## Same-origin health and uploads

Reviewers can address readiness through the single origin at
`GET /api/health/ready`; direct access to backend port 5000 is neither required
nor published. Upload creation and patient attachment responses use relative
`/api/upload/...` links, so authenticated download requests also pass through
Nginx without embedding a backend hostname.

## Trusted LAN TLS foundation

Compose binds HTTPS using `LAN_BIND_IP` and mounts only the externally supplied
server certificate and private key (`LAN_TLS_CERT_FILE` and `LAN_TLS_KEY_FILE`)
read-only into Nginx. The CA private key is never mounted into any container and
must remain outside the repository. The certificate should contain SANs for the
approved clinic IPv4 address and clinic-local names such as `clinic-server` and
`clinic-server.local`. Install the clinic Root CA trust only on approved clinic
devices; `clinic-server.local` DNS is not assumed, so the stable LAN IPv4 is an
accepted fallback. Restrict firewall exposure to the clinic LAN, never WAN.

The internal loopback `:8080/healthz` endpoint exists only for Docker's frontend
healthcheck; all other paths return 404 and it is not host-published. Do not use
it as a browser or staff endpoint. Do not enable HSTS until the remaining
operational recovery gates are approved.

## WAN-disconnected behavior

The LAN environment sets `NOTIFICATIONS_DISABLED=true` and
`VERIFICATION_PROVIDER=disabled`. Disabled delivery makes no SMTP connection and
is reported as not delivered; it is never treated as a successful send. Core
appointment and status workflows continue without waiting for an SMTP timeout.

Local services expected to remain available without WAN, subject to the later
clinical acceptance gates, are:

- the locally served UI, API, and Socket.IO connection;
- local staff authentication and MFA;
- Reception, Doctor, Laboratory, Pharmacy, and Billing/payment workflows; and
- Patient File access through the local application and database.

WAN-dependent or deliberately degraded features are:

- outbound email and email-delivered visit summaries;
- patient email verification, email changes, and email password recovery;
- optional WhatsApp `wa.me` actions, which open only after a user clicks them;
  the application does not simulate or claim WhatsApp delivery; and
- any future cloud synchronization or cloud backup, neither of which exists in
  this phase.

The frontend uses local system font stacks, including Tahoma/Arial fallbacks for
Arabic, and performs no automatic Google Fonts request. Production and Staging
email behavior is unchanged unless their operators explicitly set the existing
`NOTIFICATIONS_DISABLED` variable.

## Phase 1A.4 database roles and bootstrap

The LAN database uses four parameterized responsibilities:

- `SCHEMA_OWNER_ROLE`: NOLOGIN owner of the application schema, Prisma tables,
  and sequences.
- `MIGRATION_LOGIN_ROLE`: NOINHERIT login used only for installation and
  migration. A database-specific default `SET ROLE` makes the schema owner the
  effective object creator on every new migration connection.
- `RUNTIME_DATABASE_ROLE`: NOLOGIN privilege role with database `CONNECT`,
  schema `USAGE`, application-table `SELECT`, `INSERT`, `UPDATE`, and `DELETE`,
  and `USAGE` only on `patient_file_number_seq`.
- `RUNTIME_LOGIN_ROLE`: inheriting login used by both runtime database URLs. It
  is not a member of the owner or migration roles.

The bootstrap revokes database `CONNECT` and schema `CREATE` from `PUBLIC` and
does not grant runtime schema creation, role administration, database creation,
object ownership, or `ALL PRIVILEGES`. Runtime cannot read or modify
`_prisma_migrations`. Table default privileges are configured specifically for
the effective schema-owner role. Sequence default privileges are deliberately
not granted: each future sequence must be reviewed, and the existing MRN script
grants only the required `USAGE` on `patient_file_number_seq`.

### Explicit installation lifecycle

Create a private environment file outside Git from `env.example`, replace every
placeholder with unique local values, and make the four role names distinct.
`POSTGRES_ADMIN_CONNECTION`, migration credentials, role passwords, and the
confirmation value are bootstrap-only and are not passed to the long-running
backend. `DATABASE_URL` and `SOCKET_REVOCATION_DATABASE_URL` must both use the
runtime login.

After PostgreSQL is healthy, explicitly run the one-shot profile:

```sh
docker compose --env-file /secure/path/clinic-lan.env \
  -f compose.lan.yml --profile database-bootstrap \
  run --rm database-bootstrap
```

The command refuses non-local/container database hosts, mismatched database or
login identities, invalid identifiers, duplicate role names, missing values,
or a confirmation value that does not exactly equal `LAN_DATABASE_NAME`. It
then prints only non-secret database/session identity, creates or verifies the
roles and database, installs owner-specific defaults, verifies migration
identity, runs the complete existing `prisma migrate deploy` chain, grants
runtime table permissions, invokes the existing MRN sequence provisioner, and
performs non-mutating least-privilege checks. It never runs `migrate dev`,
`db push`, the development seed, or migrations from the normal backend start.

Do not start the backend until this command succeeds. The example environment
file contains placeholders and is suitable for Compose rendering only, not an
actual installation.

### Reference data and first administrator

Reference data is not automatic. The existing `bootstrap-reference` command is
manifest-driven, validates the target environment/database, supports dry-run,
and uses the separate required `REFERENCE_BOOTSTRAP_DATABASE_URL`. A reviewed
clinic manifest and an approved invocation procedure are still required before
using it on a LAN installation; never substitute `prisma/seed.js`.

No secure first-administrator creator currently exists. The password-reset
script requires an already existing fixed administrator account, so it cannot
bootstrap a new installation. Phase 1A.4 does not create a default account or
credential; first-administrator provisioning remains an activation blocker.

### Safety and rollback

The Phase 1A.4 disposable database test procedure is **not** a command to reset
an operating clinic database. Never point bootstrap or verification variables
at Production, Staging, Render, or an existing clinical database. Development
source changes can be reverted with Git, and a positively identified disposable
test database may be deleted. Resetting an operational clinic database is never
a rollback procedure.

## Phase 1A.5 encrypted backup and disposable restore

Phase 1A.5 adds an explicit one-shot backup tool, not cloud sync or automated
disaster recovery. A completed set is a mode-restricted directory named
`clinic-lan-backup-YYYYMMDDTHHMMSSZ` containing an OpenPGP-encrypted
`<set-id>.tar.gpg`, its detached `<set-id>.tar.gpg.sig`, and a `COMPLETE`
marker. The marker is written only after the database dump, upload archive,
hashes, encryption, signing, and exact-fingerprint signature verification have
succeeded.

Controlled decryption reveals a custom-format `database.dump`, PAX
`uploads.tar`, `SHA256SUMS`, and `manifest.json`. The manifest records format
version, ID/time, non-secret database name, PostgreSQL tool version, optional
Git revision, filenames, sizes, and hashes. It contains no URL, password,
application secret, TLS private key, or private backup identity. The database
dump includes application data and `_prisma_migrations`; backup runs no
migration. Upload symlinks are refused, while nested paths and empty files are
preserved.

### Keys, credentials, and backup command

The backup image uses GnuPG recipient encryption plus a separate signing
identity. Generate and separately escrow both the decryption private key and
signing private key outside Git, outside the server backup disk, and outside the
backup set. Backup receives the encryption public key and the signing private
key through separate read-only runtime mounts. Restore and retention receive
only the signer public key. They use machine-readable `VALIDSIG` status and
require the exact configured signer fingerprint; signer names and the GnuPG
trust database are not authorization. A wrong key, altered ciphertext,
missing/corrupt signature, or unexpected signer fails before database mutation.
GnuPG, PostgreSQL 16 client tools, GNU tar, coreutils, and findutils
must be installed or the image built and cached through an approved offline
software process; running backup requires no Internet.

A dedicated reviewed read-only backup login is preferable. Until one is
approved, the Phase 1A.4 migration login may be supplied only to this one-shot
job because runtime intentionally cannot read `_prisma_migrations`. Backup
credentials are not passed to Express.

Database and upload snapshots are not inherently atomic. Quiesce application
writes in an approved maintenance window and only then set
`BACKUP_QUIESCE_CONFIRMED=true`; the script otherwise refuses to run. With a
private environment file and an existing protected output directory, invoke:

```sh
docker compose --env-file /secure/path/clinic-lan.env \
  -f compose.lan.yml --profile backup run --rm backup
```

The uploads volume is read-only in this job. Plaintext exists only in a
mode-0700 incomplete directory; `pg_restore --list`, SHA-256 verification, and
encryption precede completion. Copy completed encrypted sets daily to separate
offline media. Monitor exit status, completion age, free space, size trends,
and media health.

Database recovery also requires separately escrowed
`MEDICAL_ENCRYPTION_KEY`, `MFA_ENCRYPTION_KEY`, operational/JWT secrets, future
TLS identity/configuration, and the backup private key. Never store those in
Git or in the backup set they protect.

### Retention, scheduling, and recovery objectives

`retention.sh` keeps a configured count of completed, correctly named sets whose
detached signature verifies against the configured signer fingerprint. An
unsigned or corrupt newer directory is not counted and cannot cause an older
valid backup to be deleted. It defaults to dry-run, always retains at least the
newest cryptographically valid set, and deletes only individually revalidated
directories. Review dry-run output before using
`BACKUP_RETENTION_DRY_RUN=false`; never test retention on an existing user
backup directory.

The systemd service/timer examples are installation templates and are not
enabled. The timer proposes a 20-minute cadence, but activation requires a
site-approved wrapper that safely quiesces and resumes writes plus monitoring.
Until that exists, the actual RPO is manual with no guaranteed upper bound.
RTO is also unproven and depends on data size, hardware, and key availability.
Perform and time regular offline-media restore drills before clinical use.

### Disposable restore drill only

`restore.sh` accepts only an explicit completed set, external private key,
exact confirmation, a local/container-only PostgreSQL host, a newly created
empty database matching `clinic_lan_phase1a5_restore_[A-Za-z0-9_]+`, and an
empty upload directory within a matching disposable path. It never defaults to
`DATABASE_URL`, creates/drops no database, and refuses a nonempty target.

Before `pg_restore`, it proves that `session_user` is the Phase 1A.4 migration
login and `current_user` is the NOLOGIN schema owner. It verifies the detached
signature and exact signer fingerprint before decrypting OpenPGP, allows
exactly the expected outer members, rejects
absolute/parent/backslash archive paths, validates manifest ID and SHA-256
hashes, inspects the dump, and validates upload paths/member types. Uploads are
extracted without archived ownership or permission restoration. Because
`pg_restore --no-owner` runs with schema-owner authority, restored objects keep
the Phase 1A.4 ownership model. Runtime grants and MRN sequence `USAGE` are
reapplied with the existing Phase 1A.4 mechanisms and least privilege is
reverified before destroying only the re-proven disposable resources.

This procedure is **not a command to reset an operating clinic database** and
must never target a running clinic. Source rollback before adoption is a Git
revert. Disabling the new scheduler/process does not justify deleting verified
backup sets, and resetting an operational database is never rollback.

## Phase 1A.6 startup and power-recovery operations

The long-running PostgreSQL, backend, and frontend services use
`restart: unless-stopped`; the bootstrap and backup profiles remain explicit
one-shot jobs with `restart: "no"`. PostgreSQL health gates backend creation,
and backend readiness gates frontend creation. Readiness is healthy only when
both Prisma database authority and the dedicated Socket.IO revocation listener
are connected. The revocation listener treats PostgreSQL error/end events as
unhealthy, fails existing sockets closed after its configured grace period, and
reconnects with bounded exponential backoff. Prisma reconnects on subsequent
queries after PostgreSQL returns.

Expected host recovery chain:

```text
Power restored -> Fedora boots -> Docker starts -> Compose services recover
 -> PostgreSQL healthy -> backend DB + revocation ready -> frontend healthy
 -> operator verification -> clinic work resumes
```

Docker must be enabled at boot. Inspect it without changing host state:

```sh
systemctl is-enabled docker
systemctl is-active docker
```

If it is not enabled, host installation remains blocked until an authorized
administrator reviews and runs `sudo systemctl enable docker`; this repository
does not run that command. `systemd/clinic-lan.service.example` is an
installation template only. Review paths, service account, protected
environment permissions, shutdown ordering, and host policy before installing
or enabling it. Phase 1A.6 does not modify host systemd configuration.

### Post-power operator verification

After Docker and the stack have had time to recover, run the non-destructive
verification using the protected environment file and canonical LAN origin:

```sh
COMPOSE_ENV_FILE=/secure/path/clinic-lan.env \
RECOVERY_ORIGIN=https://clinic-server.example.internal \
  deploy/lan/verify-recovery.sh
```

It requires all three containers and healthchecks to be healthy, checks the
frontend and same-origin `/api/health/ready`, proves backend/PostgreSQL have no
published ports, and confirms both persistent volume mounts. It prints no
secrets and performs no database writes.

For diagnosis, use bounded output rather than creating custom log files:

```sh
docker compose --env-file /secure/path/clinic-lan.env -f compose.lan.yml ps
docker compose --env-file /secure/path/clinic-lan.env -f compose.lan.yml logs --tail=200 postgres backend frontend
curl --fail https://clinic-server.example.internal/api/health/ready
```

The Compose file bounds the default `json-file` logs to five 10 MiB files per
long-running service. The Docker daemon's site-wide logging and disk policy
must still be reviewed and monitored.

If PostgreSQL remains unhealthy, stop clinical writes and inspect storage,
free space, permissions, and bounded logs. If backend remains unhealthy after
PostgreSQL recovery, check that readiness reports both database and revocation
authority and inspect backend logs. If frontend alone is unhealthy, inspect
Nginx health/configuration and backend readiness. Before any invasive repair,
confirm the newest independently stored signed backup and follow the Phase
1A.5 disposable restore-drill procedure. Never improvise a restore over the
operating database.

Never use `docker compose down -v`, delete the named volumes, prune Docker
storage, reset PostgreSQL, or remove verified backup sets during recovery.
Normal restart/recreation must retain `lan-postgres-data` and
`lan-uploads-data`.

**Physical power-loss/host-reboot acceptance remains unproven.** No physical
reboot or Docker-daemon restart was performed; that requires a controlled
Phase 1A.7 test on a dedicated machine.

## Phase 1A.7 acceptance gate

This remains a LAN test bench, not an authorization for clinical operation.
The first administrator is created exactly once with the explicit
`first-admin` profile after database bootstrap. Create a unique password in a
temporary file outside this repository, restrict it to the operator, and run:

```sh
chmod 600 /secure/path/first-admin-password
docker compose --env-file /secure/path/clinic-lan.env -f compose.lan.yml \
  --profile first-admin run --rm first-admin
```

`FIRST_ADMIN_USERNAME` and `FIRST_ADMIN_PASSWORD_SOURCE_FILE` must be set in
the protected environment file. The command refuses when any administrator
already exists, applies the normal password policy, stores only a bcrypt hash,
and creates an audit record. Securely remove the temporary password file after
the first login and complete MFA enrollment. It is not a password-recovery
backdoor and is not passed to the normal backend service.

Acceptance before go-live requires all of the following to be performed and
recorded on the dedicated clinic hardware:

- install from a reviewed, pre-cached release bundle without Internet access;
- provision unique runtime, migration, application-encryption, JWT, backup
  encryption, and backup-signing identities with separate offline escrow;
- activate and monitor the reviewed backup scheduler and off-server media;
- establish a clinic-local hostname and locally trusted TLS identity on every
  staff device;
- run the full role-based synthetic patient journey and signed restore drill;
- test login, patient lookup, a harmless read, and Socket.IO from a second
  laptop and phone on the real clinic LAN;
- perform a controlled host power-loss/reboot drill, then run
  `verify-recovery.sh` and inspect the latest signed backup.

The actual second device was not tested automatically. A future manual client
should browse `http(s)://<clinic-server-lan-address>:<port>`, confirm the page
and `/api/health/ready`, log in with a disposable acceptance account, navigate
the patient lookup, perform one harmless read, and confirm Socket.IO reconnects.
Do not alter host firewall or routing during this repository exercise.

**CLINICAL TLS ACCEPTANCE = MANUAL ACCEPTANCE PASSED; operational gates remain.**
HTTPS uses a stable clinic-local identity, a clinic-controlled trusted CA,
protected private keys, documented device trust onboarding, and the same origin
for UI, API, uploads, and Socket.IO. An ad-hoc self-signed bypass is not
acceptance.

**OFFLINE FRESH-INSTALL ACCEPTANCE = BLOCKED.** Runtime operation is designed
to be WAN-independent, but a new disconnected server still needs an
independently prepared release containing source, locked npm dependencies or
built images, PostgreSQL, Nginx, Node build/runtime images, GnuPG/backup tools,
checksums, signatures, and installation instructions. Runtime offline success
must not be confused with offline supply-chain readiness.

## Intentionally not implemented

    - automated certificate provisioning or renewal.
- Real credentials or secret storage.
- Automatic operational restore/disaster recovery, enabled scheduling, or
  approved key escrow.
- Bundled fonts or other runtime Internet-dependency removal.
- Cloud synchronization, replication, multi-site support, PWA, Service Worker,
  IndexedDB, or browser-side clinical storage.
- Deployment to Render, Staging, Production, or a clinic server.

The HTTPS transport acceptance does not by itself constitute clinical readiness;
remaining recovery, backup, WAN, and user-acceptance gates still apply.
