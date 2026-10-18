# CMS deployment guide

This is the authoritative guide for shared deployment, configuration, authentication, and recovery behavior at this repository revision. The [LAN runbook](deploy/lan/README.md) adds site-specific roles, TLS, bootstrap, signed backup, disposable restore, and acceptance instructions. [Operations](OPERATIONS.md), the [production checklist](PRODUCTION_CHECKLIST.md), and [staging acceptance](STAGING_QA_CHECKLIST.md) supplement this guide.

Commands below are operator instructions inspected against source, **not procedures executed or certified by this documentation update**. Replace placeholders outside Git, confirm the target environment, and complete the relevant acceptance/restore drills before using clinical data. No real credentials belong in these documents.

## Deployment modes and prerequisites

| Mode | Repository support | Boundaries |
| --- | --- | --- |
| Local development | Node/Express, React/Vite, PostgreSQL; tracked [backend](backend/.env.example) and [frontend](frontend/.env.example) examples | Separate local databases and uploads; development verification must never be exposed as production. |
| General Docker reference | [docker-compose.yml](docker-compose.yml), [backend Dockerfile](backend/Dockerfile), [frontend Dockerfile](frontend/Dockerfile) | PostgreSQL 16 and persistent uploads; requires an external HTTPS edge and a reviewed network/privilege configuration. Not a turnkey hardened production installation. |
| Offline LAN test bench | [compose.lan.yml](compose.lan.yml), [LAN runbook](deploy/lan/README.md), [LAN example](deploy/lan/env.example) | HTTPS-only port 443, private API/database networks, explicit installation profiles. Clinical operation and fresh offline installation retain the runbook's acceptance gates. |
| Hosted/custom infrastructure | The same backend and compiled frontend can be adapted to a managed PostgreSQL service and HTTPS proxy | No Render Blueprint or automatic hosted deployment procedure is supplied. Configure the actual upstream, persistent uploads, secrets, migrations, and direct revocation connection explicitly. Existing platform settings were not inspected. |

Use Node.js 22 with the committed npm lockfiles for local builds, Docker with Compose v2 for container deployment, and PostgreSQL 16 (the supplied images' version). A release host needs access to the required images/dependencies or an independently prepared offline bundle. Migration/grant/backup jobs additionally need the appropriate PostgreSQL client tools; the backend image installs OpenSSL but **does not install `psql`, `pg_dump`, or `pg_restore`**. LAN bootstrap/backup images supply those tools.

The active Prisma provider is **PostgreSQL**, including local development and automated tests. [schema.prisma](backend/prisma/schema.prisma) and `backend/prisma/migrations/` define the supported history. `backend/prisma/sqlite-migrations/` and `backend/scripts/sqlite-archive/` are historical artifacts, not a current deployment mode. There is no supported SQLite data-conversion command or `backup:sqlite` npm script.

## PostgreSQL installation and initial administrator

### Roles, migrations, and reference data

Provision separate runtime, migration/schema-owner, and backup responsibilities. Runtime needs application-table DML, schema access, and `USAGE` on `patient_file_number_seq`; it must not own schema objects or have migration/role-administration privileges. A migration login must create objects as the intended owner so that owner-specific default table privileges apply. Review new sequences individually rather than granting blanket sequence `UPDATE` or ownership. See [migration notes](backend/prisma/README.md) and the LAN runbook's six-role model.

For LAN, prepare a private environment file from the tracked example, start only PostgreSQL, then run the explicit bootstrap profile before starting the application:

```sh
# From the repository root, after operator target/secret review:
docker compose --env-file /secure/path/clinic-lan.env -f compose.lan.yml up -d postgres
docker compose --env-file /secure/path/clinic-lan.env -f compose.lan.yml \
  --profile database-bootstrap run --rm database-bootstrap
```

The LAN bootstrap verifies the local/container target and identities, creates/verifies the roles/database, applies migrations, grants runtime table/MRN privileges, and verifies least privilege. It does not seed. Preserve the detailed guards and role settings in the LAN guide.

For an independently provisioned database, run this release step from `backend/` in a dedicated job with **migration credentials injected as `DATABASE_URL`**, not the application's runtime credentials:

```sh
npm ci
npx prisma generate
npm run db:migrate:deploy
```

Then apply/verify the MRN grant from a job with `psql`, using privately injected `MIGRATION_DATABASE_URL`, `RUNTIME_DATABASE_ROLE`, and optional `DATABASE_SCHEMA` (default `public`):

```sh
npm run db:grant:patient-mrn-sequence
```

Keep migrations and grants adjacent; prevent Patient-creation traffic during any privilege gap. Verify runtime sequence `USAGE`, absence of sequence `UPDATE`/ownership, table permissions, and owner identity before application rollout. Never use `migrate reset`, `db push`, the QA reset, or the development seed as an installation/upgrade shortcut.

Reference data is a separate reviewed step, not startup behavior. `npm run bootstrap:reference` requires `REFERENCE_BOOTSTRAP_DATABASE_URL`, `REFERENCE_BOOTSTRAP_ENABLED=true`, `REFERENCE_BOOTSTRAP_ENVIRONMENT`, `REFERENCE_BOOTSTRAP_EXPECTED_DATABASE`, `REFERENCE_BOOTSTRAP_MANIFEST`, and an explicit dry-run/write choice via `REFERENCE_BOOTSTRAP_DRY_RUN`. Production additionally requires its confirmation guard; inspect [referenceBootstrap.js](backend/src/services/referenceBootstrap.js). Start with a dry run. The [state manifest](backend/reference-data/sudan-states.json) supplies States only; it does not configure services, prices, doctors, or schedules. See [reference-data notes](backend/reference-data/README.md). No default clinical catalogue is installed automatically.

### First administrator

The repository **does** provide [provision-first-admin.js](backend/scripts/provision-first-admin.js); resetting a pre-existing account is a different operation. For LAN, use the explicit `first-admin` profile after database bootstrap. Create the unique password through an approved local secret-handling process in a regular, non-symlink, single-line file outside Git, mode `0600`. Set `FIRST_ADMIN_USERNAME` to the real administrator identity, `FIRST_ADMIN_PREFERRED_LANGUAGE` to `en` or `ar`, and `FIRST_ADMIN_PASSWORD_SOURCE_FILE` to that file in the private Compose environment.

```sh
# From the repository root, only for an approved new installation:
docker compose --env-file /secure/path/clinic-lan.env -f compose.lan.yml \
  --profile first-admin run --rm first-admin
```

The profile mounts the file as `FIRST_ADMIN_PASSWORD_FILE` and supplies `LAN_DATABASE_NAME`, `CONFIRM_FIRST_ADMIN_DATABASE`, and `RUNTIME_LOGIN_ROLE`. The script verifies the connected database and both login/effective role identities, rejects the documented placeholder username, refuses if any ADMIN already exists, applies password policy, and writes an audit record. Remove the temporary password file securely after successful provisioning/login and enroll staff MFA.

For non-LAN infrastructure, the same script can be invoked as `node scripts/provision-first-admin.js` from `backend/` only after supplying those same identity guards (their names remain LAN-prefixed), the runtime `DATABASE_URL`, and the protected file. Adapt and review the installation procedure; no generic hosted bootstrap automation is supplied. `npm run admin:reset-password` targets an already existing fixed account and is not a first-admin creator.

## Backend runtime configuration

Supply secrets through an approved secret manager or protected environment injection. The illustrative values below are placeholders, not usable credentials:

```dotenv
NODE_ENV=production
PORT=5000
DATABASE_URL=postgresql://<runtime-login>:<URL-encoded-runtime-password>@<postgres-host>:5432/<clinic-database>
SOCKET_REVOCATION_DATABASE_URL=postgresql://<runtime-login>:<URL-encoded-runtime-password>@<direct-postgres-host>:5432/<clinic-database>
JWT_SECRET=<unique-random-signing-secret-at-least-32-characters>
MEDICAL_ENCRYPTION_KEY=<independent-random-medical-key-at-least-32-characters>
MFA_ENCRYPTION_KEY=<independent-random-mfa-key-at-least-32-characters>
CLINIC_TIME_ZONE=Africa/Khartoum
CORS_ALLOWED_ORIGINS=https://<clinic-hostname>
VERIFICATION_PROVIDER=disabled
PHONE_VERIFICATION_PROVIDER=disabled
NOTIFICATIONS_DISABLED=true
UPLOAD_DIR=/app/uploads
TRUST_PROXY=true
```

[config.js](backend/src/config.js) validates PostgreSQL URL shape, clinic timezone, secrets, origins, and production verification configuration at startup. Production requires all three distinct secrets of at least 32 characters, an explicit revocation URL, exact canonical HTTPS origins, an explicit valid timezone, and `VERIFICATION_PROVIDER=email` or `disabled`. Known example secrets are rejected. URL validation is not proof of database identity, TLS, privileges, or the pooler's actual mode; verify those independently.

`SOCKET_REVOCATION_DATABASE_URL` must reach the **same application accounts/database/schema** as `DATABASE_URL`, using a direct/session-capable PostgreSQL connection that supports `LISTEN/NOTIFY`. Do not use transaction pooling for it. Non-production falls back to `DATABASE_URL` when this variable is absent; production does not. Each backend process needs this listener connection. Configure database transport encryption/CA verification according to the actual PostgreSQL service; HTTPS for browsers does not secure the database link.

| Runtime variable | Code default / purpose |
| --- | --- |
| `JWT_EXPIRES_IN` | `30m` when absent; access-token lifetime. Tracked backend/LAN examples specify `8h`. See the session section before choosing a policy. |
| `JWT_ISSUER`, `JWT_AUDIENCE` | `clinic-api`, `clinic-application`; keep consistent across token issuers/verifiers. |
| `MFA_TOTP_ISSUER` | `Clinic Management System`; authenticator label, not a replacement for `MFA_ENCRYPTION_KEY`. |
| `SOCKET_REVOCATION_RECONCILE_MS` | `10000`; account-state reconciliation interval. |
| `SOCKET_REVOCATION_UNHEALTHY_GRACE_MS` | `15000`; listener outage grace before existing sockets are disconnected. Both timing values must be positive integers. |
| `PORT`, `UPLOAD_DIR`, `UPLOAD_MAX_BYTES` | `5000`, backend `./uploads`, `10485760` bytes respectively; containers map uploads to `/app/uploads`. Make uploads writable by the runtime user and durable. |
| `TRUST_PROXY` | Only the literal `true` enables Express's one-hop trust setting. Match the actual trusted proxy topology. |
| `BCRYPT_ROUNDS` | `12` in authentication paths; the first-admin script requires an integer from 10 through 15. |
| `PHONE_DEFAULT_COUNTRY`, `DEFAULT_STATE_ID` | `RW` and `1` in code; LAN example/Compose choose `SD`. State 1 must actually exist where used. |
| `PATIENT_CANCELLATION_CUTOFF_HOURS` | `2`; business time uses `CLINIC_TIME_ZONE`, not the host's `TZ`. |
| `RATE_LIMIT_WINDOW_MS` | `900000`. |
| `RATE_LIMIT_LOGIN_MAX`, `RATE_LIMIT_REGISTRATION_MAX`, `RATE_LIMIT_VERIFICATION_MAX`, `RATE_LIMIT_CLAIM_MAX`, `RATE_LIMIT_ADMIN_RESET_MAX` | `10` normally; code uses `100` in test mode unless explicitly configured. In-memory limits are not a distributed global limiter. |
| `GOOGLE_CLIENT_ID` | Optional Google web client ID; no default. Client ID is public configuration, not a credential. See limitations. |

Email mode additionally requires `NOTIFICATIONS_DISABLED=false`, `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM_EMAIL` (preferred) or legacy fallback `SMTP_FROM`. `SMTP_PORT` defaults to `587`, `SMTP_SECURE` is true only for literal `true`, `SMTP_FROM_NAME` defaults to `Al-Shifa Medical Clinic`, and `SMTP_CONNECTION_TIMEOUT_MS` to `10000`. The SMTP parser trims values and rejects control characters and surrounding quote characters in credential/sender values; provide actual values through the environment, not literal quotes copied into platform fields. Validate delivery to an approved inbox separately.

### Compose forwarding and example-file gaps

A variable in a host environment/example is **not automatically passed into a container**. The service's `environment`/build arguments decide what reaches the application. In the supplied files:

- Neither Compose backend forwards `JWT_EXPIRES_IN`; the examples' `8h` does not make the containers use eight-hour tokens. They use the code fallback unless a separately reviewed deployment override supplies the variable. LAN forwards JWT issuer/audience and revocation timings; the general reference does not forward all optional settings.
- General Compose forwards the SMTP connection fields and legacy `SMTP_FROM`, but not `SMTP_FROM_EMAIL`, Google configuration, or phone-provider selection. LAN's backend does **not** forward SMTP fields or Google configuration, even though the LAN example describes optional mail settings. Merely editing that file cannot enable mail/Google in those containers.
- `compose.lan.yml` and its example default `NODE_ENV=development`. This is a test-bench setting, not production-mode configuration validation. A production-mode review must explicitly select `production` and satisfy its stricter requirements.
- General Compose uses a shared database account for initialization/runtime, publishes backend port 5000, and does not run migrations or install an administrator. Review least privilege and remove/restrict direct API exposure before clinical deployment.
- The backend example's test URL/comment predates the current runner. Automated tests now require **clinic-test-db at localhost:5433/clinic_test**, with per-file isolated schemas; never use clinic_dev or an application database. See [runner](backend/test/helpers/testRunner.js). Test setup is not an operational installation recipe.

These are documented configuration gaps; this change does not alter Compose files or environment examples.

## Frontend build configuration

The frontend is compiled static content. `VITE_*` values are public build inputs, never secret storage. Runtime changes to the Nginx container environment do not rewrite the compiled JavaScript.

| Build variable | Actual consumer / default |
| --- | --- |
| `VITE_API_BASE_URL` | Shared API client; empty means same-origin `/api/...`. |
| `VITE_STAFF_API_URL` | Staff API/logout override, otherwise `VITE_API_BASE_URL`, otherwise same origin. Recognized by code although absent from the frontend example. |
| `VITE_STAFF_SOCKET_URL` | Staff socket origin; production defaults to browser origin, development to `http://localhost:5000`. Keep standard `/socket.io/` routing. |
| `VITE_CLINIC_TIME_ZONE` | Fallback clinic timezone, default `Africa/Khartoum`; the frontend also loads `/api/public-config`. Keep build/runtime timezones aligned. |
| `VITE_GOOGLE_CLIENT_ID` | Patient Google button; blank means unavailable. Must match the backend web client ID when enabled. |
| `VITE_PROXY_TARGET` | Vite development API proxy target, default `http://127.0.0.1:5000`; not a deployed API URL. The dev proxy covers `/api`, not Socket.IO. |

[frontend/Dockerfile](frontend/Dockerfile) declares **only `VITE_CLINIC_TIME_ZONE`** as a build argument. Both Compose builds pass only that argument. General Compose derives it from `CLINIC_TIME_ZONE`; LAN uses its separate `VITE_CLINIC_TIME_ZONE` value/default. `.dockerignore` excludes environment files. To enable other public build variables, a reviewed build pipeline/image adaptation is required; `docker compose --env-file` or a container runtime variable alone cannot enable them. The shipped Nginx proxies to `backend:5000`; hosted upstreams need their own reviewed routing.

## Authentication, MFA, and sessions

Sources: [accessTokens.js](backend/src/services/accessTokens.js), [auth middleware](backend/src/middleware/auth.js), [auth routes](backend/src/routes/auth.js), [MFA routes](backend/src/routes/mfa.js), [authStorage.js](frontend/src/services/authStorage.js), [apiClient.js](frontend/src/services/apiClient.js), and [logout.js](frontend/src/services/logout.js).

| Concept | Implemented behavior |
| --- | --- |
| Access-token expiry | HS256 JWT, issuer/audience/subject/type checked; lifetime is `JWT_EXPIRES_IN` or `30m` from issuance. Requests/activity do not extend it. Changing the variable affects newly issued tokens, not existing `exp` claims. |
| Idle timeout | No application activity/idle timer was found. Thirty minutes is the code's absolute token lifetime fallback, not a verified idle timeout. |
| Refresh | No refresh-token issuance, automatic renewal, or refresh endpoint was found. Reloading a page restores stored state, not token validity; expired tokens require login again. |
| Browser persistence | Staff and patient user/token pairs are stored separately in `sessionStorage`. They survive reload in the same tab/page session, are normally cleared when that tab session ends, and are JavaScript-readable bearer credentials, not HttpOnly cookies. Browser tab duplication/session restoration may copy/restore page-session storage; tab closure is not server revocation. `localStorage` is used for preferences such as theme, not these auth pairs. |
| HTTP rejection | Protected HTTP requests recheck current user status, role, and `authVersion`. The API client clears the relevant local session on terminal 401 codes and redirects to login; a temporary 503 is not treated as credential expiry. A stale dashboard can remain visible until a request/revocation event occurs. |
| Logout/revocation | Successful `/api/auth/logout` increments the account authentication generation, invalidating that account's other tokens too. Password/security/account changes and administrative revoke operations also advance/check generations. Frontend cleanup occurs even if logout cannot reach the server; offline cleanup does not prove server-side revocation succeeded. |
| Socket lifecycle | JWT/account validity is checked at handshake/reconnect. PostgreSQL notifications and periodic account reconciliation disconnect stale generations/status/roles. The current reconciliation does **not** check JWT `exp` or install an expiry timer for established sockets; do not promise an exact JWT-lifetime disconnect for an already open connection. |

Both eight-hour and thirty-minute claims need this context: examples explicitly choose `8h`, code defaults to `30m`, and shipped Compose omits the override. Do not infer the effective policy of an existing deployment without privately inspecting its injected settings and a newly issued token's expiry. No live deployment values were inspected here.

MFA is implemented for enrolled staff: six-digit TOTP and single-use hashed recovery codes, a five-minute login challenge, ten-minute pending enrollment, and authenticated security-management routes. Password login with active enrollment requires the second factor before a normal access token is issued; inconsistent enrollment state is rejected. This is **not blanket enrollment enforcement for every staff account** and is not patient MFA. The staff UI exposes a Security enrollment flow. Enroll the first administrator explicitly and protect recovery material outside the repository. Keep server/authenticator clocks synchronized. Preserve `MFA_ENCRYPTION_KEY` across redeploys/restores; changing the issuer label does not rotate encrypted secrets.

Revocation requires a healthy dedicated listener on every backend. Default reconciliation is 10 seconds; listener loss makes readiness fail and rejects new socket handshakes, with existing sockets disconnected after the default 15-second grace if health does not recover. HTTP verification fails closed when its account lookup is unavailable. Reconnect backoff is bounded; these intervals are not session lifetime settings. See [socketRevocation.js](backend/src/services/socketRevocation.js).

## HTTPS, proxy, and CORS

Serve the browser through HTTPS, proxy both `/api/` and `/socket.io/`, preserve API paths, and support WebSocket upgrades. Set forwarded host/protocol/client headers correctly and expose Express only through the trusted proxy; `TRUST_PROXY=true` trusts one hop, not an arbitrary public chain. General Compose publishes HTTP 8080 and backend 5000 and has no TLS terminator. Its Nginx sends its own `$scheme` as the forwarded protocol; an additional upstream TLS edge needs a reviewed forwarding arrangement.

LAN terminates TLS in [its Nginx configuration](deploy/lan/nginx.conf), publishes only 443, and sends one-year HSTS at that TLS edge, including static responses. Express explicitly disables HSTS; the general frontend Nginx does not add it. For other topologies configure HSTS at the actual trusted HTTPS termination point after certificate/recovery review. Preserve the LAN guide's CA trust/device onboarding and private-key handling.

Production CORS requires explicit canonical HTTPS origins (scheme, hostname, and non-default port where applicable), no wildcard, path, query, or fragment. Separate multiple origins with commas. CORS is not authentication or a firewall: requests without an Origin header can reach the API and still need authorization. Keep API, uploads, UI, and Socket.IO same-origin where possible. Supplied frontend CSP allows scripts/connections from self only; custom cross-origin APIs/Google need a reviewed CSP as well as CORS and routing. Do not broadly disable CSP to make a feature work.

## Docker startup and health

For general Compose, prepare a protected environment file with the required Compose interpolation variables, including `POSTGRES_PASSWORD`, all three application secrets, timezone, and exact HTTPS origins. Provision/migrate the database and administrator explicitly as above. From the repository root, the reference startup commands are:

```sh
docker compose --env-file /secure/path/clinic-compose.env -f docker-compose.yml up -d postgres
# Complete the separately reviewed migration/grant/bootstrap jobs before proceeding.
docker compose --env-file /secure/path/clinic-compose.env -f docker-compose.yml up -d --build backend frontend
```

For LAN, use its separate file and installation profiles, then:

```sh
docker compose --env-file /secure/path/clinic-lan.env -f compose.lan.yml up -d --build backend frontend
```

Normal backend image startup is **`node src/server.js`**, with Node as PID 1 for signal handling. `npm start`, `start:container`, and `start:staging` are package aliases to that server and do not migrate/seed. `start:staging:migrate` explicitly runs `prisma migrate deploy && npm run start:staging`; it is an existing staging-only convenience and needs migration authority. Do not run it with a least-privilege production runtime login or silently give runtime ownership. For hosted staging, choose an explicit migration job where roles are separated; platform start-command/branch settings require independent verification. No deployment branch convention is enforced by these scripts.

| Endpoint / check | Meaning |
| --- | --- |
| `/api/health/live` | Process liveness, `{ "status": "alive" }`; not database readiness. |
| `/api/health/ready`, compatibility `/api/health` | Database ping **and** revocation listener ready; 200 with `healthy`, otherwise 503 with `unhealthy`, without dependency details. |
| LAN container `http://127.0.0.1:8080/healthz` | Nginx loopback-only health listener; other paths on that listener are 404. Not a public application endpoint. |

General Compose checks PostgreSQL with `pg_isready` and backend `/api/health`; LAN additionally checks frontend health and gates startup on backend readiness. Health does not prove migrations, grants, upload durability, mail delivery, certificate trust, or acceptance. SIGTERM/SIGINT close listener, Socket.IO, HTTP, and Prisma; allow sufficient orchestrator grace and verify graceful shutdown on the actual platform.

### Troubleshooting

- **Startup rejected:** check variable names and secret independence without printing values; ensure production timezone/CORS/verification policy is explicit. Check the container's forwarded environment, not just the host example file.
- **Liveness works, readiness is 503:** inspect private logs for DB connectivity/grants and the direct revocation listener. A transaction-pool endpoint can allow ordinary queries but break `LISTEN`; do not disable readiness/revocation to pass health checks.
- **Unexpected sign-out:** distinguish absolute JWT expiry, terminal 401, account generation changes, socket security outage/disconnect, and browser page-session loss. MFA challenge expiry is separate. Verify time synchronization and actual container injection of `JWT_EXPIRES_IN`.
- **Patient inserts fail after migration:** inspect runtime table grants and `patient_file_number_seq` `USAGE`; do not grant sequence ownership or blanket `UPDATE`.
- **Uploads missing/permission denied:** verify the durable mount and runtime `node` user's write access; container recreation without the correct volume cannot be repaired by application health.
- **HTTP works but sockets/CORS fail:** verify the browser origin, exact allowlist, upstream service name, WebSocket upgrades, proxy trust, listener health, and frontend's compiled API/socket values.
- **Mail/Google unavailable:** check the limitations below and Compose/build forwarding before assuming the example enabled the feature. Test real delivery only under a separately approved procedure.

## Backups, restore, upgrades, and rollback

Back up PostgreSQL, uploads, and separately escrowed application/MFA/backup keys and configuration. A database dump alone cannot restore uploaded attachments or decrypt clinical/MFA content. General Compose persists `postgres-data` and `uploads-data`; LAN persists `lan-postgres-data` and `lan-uploads-data`. Never remove/prune these volumes as an upgrade or rollback step.

The basic `npm run backup:postgres` executes [backup-postgres.sh](backend/scripts/backup-postgres.sh): custom-format `pg_dump`, `pg_restore --list` inspection, restrictive file creation, and age pruning (`BACKUP_DIR=./backups`, `BACKUP_RETENTION_DAYS=30` defaults). Run from a dedicated tools host/job with a reviewed backup login, not the backend runtime image. It does **not** encrypt/sign, include uploads/keys, schedule jobs, copy off-host, or perform a restore drill. Listing a dump is not a successful restore.

LAN provides a stronger, distinct workflow: signed/encrypted database-and-upload backup sets, dedicated read-only backup identity, exact signer verification, off-server copying, count retention (dry-run by default), and a strictly guarded **disposable-only** restore. Follow its [backup and restore instructions](deploy/lan/README.md#phase-1a5-encrypted-backup-and-disposable-restore). Database/upload snapshots are not inherently atomic. No bundled write-pause/drain wrapper exists; `BACKUP_QUIESCE_CONFIRMED=true` is an operator assertion, not a mechanism. LAN scheduler templates remain blocked until that consistency wrapper and monitoring are approved. No guaranteed RPO/RTO or general production-restore automation is supplied.

For non-LAN recovery, design and approve a site-specific restore into a new isolated PostgreSQL database and matching upload storage, verify owner/runtime grants and migration state, supply the matching encryption keys, and exercise readiness and read-only/authorized synthetic workflows before a controlled cutover. The LAN restore script deliberately refuses operational targets; do not relax its guards to restore a running clinic. Database TLS, encryption at rest, PITR, replication, retention/legal hold, and disaster-recovery objectives need infrastructure/governance decisions.

Upgrade sequence: accept the exact release in staging; record immutable image digests/configuration; take a verified database/upload recovery point; assess migration compatibility and maintenance needs; run migrations and grants with the migration identity; deploy backend/frontend with aligned public build/runtime settings; verify health, authentication/MFA/revocation, uploads, and authorized synthetic workflows. Never seed an operating clinic during upgrade.

Keep previous images and the pre-upgrade database/uploads/keys. Prisma history supplies forward migrations, not automatic down migrations. Reverting Git/images after a schema change is safe only if compatibility has been demonstrated; otherwise recovery requires an approved coordinated data/upload restore and may lose writes since that recovery point. Changing an encryption key without re-encryption is not rollback. No blanket zero-downtime or lossless rollback guarantee is made.

## Current feature and operational limitations

- **Google patient login:** GIS button, backend credential validation, provider-subject linking, explicit account link/unlink, and new-patient onboarding exist. This is not staff Google login and does not silently match/link an account by email. It needs a matching public web client ID in frontend/backend, approved Google web origins, and external Google access. The shipped self-only CSP blocks the external GIS script/frames/connections, and supplied Docker builds/Compose do not forward Google settings. Google cannot be claimed operational in that deployment merely because code exists; a reviewed build/CSP/configuration change and browser acceptance remain required. It is unavailable offline. See [Google button](frontend/src/features/patient-auth/GoogleIdentityButton.jsx), [verifier](backend/src/services/googleIdentity.js), and [patient identity](backend/src/services/googlePatientIdentity.js).
- **SMTP and verification:** authenticated SMTP sending exists; receipt/delivery still needs an approved mail service and staging inbox verification. `VERIFICATION_PROVIDER=email` enables email-based registration challenges; missing email/delivery failures fail safely. `disabled` rejects online registration/verification operations rather than fabricating successful delivery. Staff-assisted offline activation of eligible pending patients is a separate authorized workflow, not an SMS bypass. Google onboarding has its own verified-email/finalization path and eligibility rules. Optional appointment email does not guarantee delivery or gate every booking. LAN mail settings are not wired through Compose, as noted above. No production phone OTP vendor exists.
- **SMS:** `sendSMS` returns false (and records FAILED when notifications are enabled). Phone verification supports only non-production development delivery or disabled mode; there is no production SMS provider/credential integration. WhatsApp links are optional user-clicked external actions, not an automatic SMS channel. See [phoneVerification.js](backend/src/services/phoneVerification.js) and [notifications.js](backend/src/utils/notifications.js).
- **Encryption/key rotation:** clinical fields use AES-256-GCM with a key derived from `MEDICAL_ENCRYPTION_KEY`; MFA secrets use a separate AES-256-GCM key with user-bound authenticated data from `MFA_ENCRYPTION_KEY`. This is not whole-database/upload encryption. There is no automatic rotation, clinical key-version/key-ring migration, or supplied bulk re-encryption tool. MFA's `v1` ciphertext format is not a multi-key rotation facility. Preserve matching keys separately for every retained recovery point. Rotation requires an approved maintenance/re-encryption or MFA re-enrollment plan and a verified restore drill. Replacing `JWT_SECRET` invalidates tokens on subsequent verification; there is no overlapping signing-key rollout facility. See [clinical crypto](backend/src/utils/encryption.js) and [MFA crypto](backend/src/services/mfaCrypto.js).
- **Scaling and storage:** PostgreSQL removes the old SQLite single-writer constraint, but there is no bundled shared-upload/object-storage migration or Socket.IO multi-node broadcast adapter. Rate limits are per process. Horizontal scaling needs its own design and acceptance.
- **Operational acceptance:** no automatic certificate renewal, approved offline release supply chain, enabled consistent-backup scheduler, proven recovery objective, or general clinical approval is implied by this repository. Preserve the LAN acceptance gates, independent device checks, and power-recovery limitations.
