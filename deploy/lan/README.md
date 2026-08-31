# Offline Phase 1A.2 — same-origin LAN frontend, API, and Socket.IO

This directory contains a reversible, test-bench-only foundation for running
the clinic frontend, Express API, Socket.IO, and PostgreSQL on one local server.
It is **not approved for clinical operation**. In particular, Phase 1A.1 uses
plain HTTP and has not implemented secure database bootstrap, TLS, backups, or
WAN-disconnected clinical acceptance testing.

## Architecture

```text
Clinic browser
      |
      v
http://clinic-server.example.internal:8080  (one browser origin)
      |-- /            -> React static frontend
      |-- /api/...     -> Nginx -> backend:5000
      `-- /socket.io/  -> Nginx -> backend:5000 (WebSocket/long polling)
                                      |
                                      `-> postgres:5432
```

Only Nginx publishes host port `8080`. `backend:5000` and `postgres:5432` are
Docker-private and must never be entered into a workstation browser. `lan-edge`
carries the frontend's published HTTP listener; `lan-app` and `lan-data` are
internal networks for frontend-to-API and API-to-database traffic respectively.
PostgreSQL data and uploads use separate named volumes.

## Files

- `../../compose.lan.yml`: isolated LAN Compose definition.
- `env.example`: non-secret configuration contract with unusable placeholders.
- `nginx.conf`: HTTP test-bench static server and same-origin reverse proxy.
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
`http://clinic-server.example.internal:8080`; wildcard CORS is not allowed.
This explicit HTTP origin is for Phase 1A.2 test-bench validation only.

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

The HTTP origin in this phase is **not approved for clinical operation**.
Locally trusted TLS and certificate lifecycle controls remain a later mandatory
gate.

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

## Intentionally not implemented

- TLS certificates or approval for clinical traffic.
- Database roles, users, permissions, migrations, or reference-data bootstrap.
- Real credentials or secret storage.
- Backup, restore, retention, or disaster recovery.
- Bundled fonts or other runtime Internet-dependency removal.
- Cloud synchronization, replication, multi-site support, PWA, Service Worker,
  IndexedDB, or browser-side clinical storage.
- Deployment to Render, Staging, Production, or a clinic server.

The next phase must not treat this HTTP foundation as ready for patient data.
