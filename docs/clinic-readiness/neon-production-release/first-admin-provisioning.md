# Neon first-administrator procedure

This is a guarded one-time operation. It is not part of migrations, deployment startup, or reference-data bootstrap. The preflight command performs target, role, migration, password-file, password-policy, username, and existing-administrator checks without creating rows. Provisioning requires a separate `--execute` flag and separate operator approval after the preflight succeeds.

The Neon mode accepts only `NODE_ENV=production`, an exact direct hostname under `.neon.tech` (pooler endpoints are refused), database `neondb`, schema `public`, `sslmode=verify-full`, and the target fingerprint pinned from the reviewed Neon release. A host change therefore requires a source review and a deliberate fingerprint update. The connection's `current_database()`, `current_schema()`, `session_user`, and `current_user` must match the confirmed settings. It also requires a non-superuser runtime login, verifies the insert permissions needed on User and TenantAuditLog, checks exact complete Prisma migration history with repository checksums, and refuses if an ADMIN already exists. The operation creates one `User` with role `ADMIN` and one `FIRST_ADMIN_PROVISIONED` audit row in a serializable transaction. The advisory lock prevents concurrent first-admin invocations. No other model is written.

## Required inputs

Provide these values only through the reviewed production secret/configuration injection path:

- `FIRST_ADMIN_TARGET_MODE=neon-production`
- `NODE_ENV=production`
- `FIRST_ADMIN_EXPECTED_NEON_HOST=<exact-direct-neon-hostname>` from the approved release configuration; this cannot be a `-pooler.` host and must match the provisioner's reviewed target fingerprint.
- `FIRST_ADMIN_EXPECTED_DATABASE=neondb`
- `FIRST_ADMIN_EXPECTED_SCHEMA=public`
- `RUNTIME_LOGIN_ROLE=<reviewed-runtime-login>`
- `CONFIRM_FIRST_ADMIN_TARGET=NEON_PRODUCTION:<exact-direct-neon-hostname>/neondb/public`
- `DATABASE_URL=postgresql://<runtime-login>:<URL-encoded-password>@<exact-direct-neon-hostname>/neondb?schema=public&sslmode=verify-full`
- `FIRST_ADMIN_USERNAME=<real, explicitly selected administrator email>`
- `FIRST_ADMIN_PREFERRED_LANGUAGE=en` or `ar`
- `FIRST_ADMIN_PASSWORD_FILE=<protected path outside the repository>`
- Optional `BCRYPT_ROUNDS`, integer 10–15; defaults to 12.

Do not use `DIRECT_URL`, a pooler URL, or the old LAN confirmation variable for this one-shot. The target hostname in `DATABASE_URL`, `FIRST_ADMIN_EXPECTED_NEON_HOST`, and the confirmation value must be identical. Keep shell tracing disabled. The environment file or secret injection must not be printed, committed, or copied into application logs. Use a direct runtime login whose identity matches `RUNTIME_LOGIN_ROLE`; it must not be a PostgreSQL superuser.

Create the password through an approved secret-handling process in a regular, non-symlink file outside Git, owned by the operator and mode `0600`. It must contain one line, meet the application password policy (10–200 characters with uppercase, lowercase, and a number), and must never be placed in an environment variable or command argument.

## Production preflight

From `backend/`, with the required environment injected from the protected source and shell tracing disabled:

```sh
set +x
set -a
. /secure/path/shifa-neon-first-admin.env
set +a
node scripts/provision-first-admin.js --preflight
```

The environment file contains the variables listed above. The password itself is only in `FIRST_ADMIN_PASSWORD_FILE`. Preflight output contains only the mode, database/schema, migration count, and pass/fail status; it does not print the hostname, username, connection URL, or password.

Stop if preflight fails or any inspected value differs from the approved target. Preflight does not reserve the target indefinitely, so execute soon after the review and rely on the provisioner's in-transaction target/migration/admin rechecks and lock.

## Separately approved one-time execution

After reviewing the successful preflight result and approving the exact target and named account, inject the same protected environment and run:

```sh
set +x
set -a
. /secure/path/shifa-neon-first-admin.env
set +a
node scripts/provision-first-admin.js --execute
```

The second invocation repeats all guards before the transaction. It refuses if an ADMIN already exists, the username is taken, the migration history differs, or target identity changes. On success, sign in as the named administrator, enroll MFA, and securely remove the temporary password file. Do not run `prisma/seed.js`, reset/promote another account, or retry blindly after an ambiguous failure; inspect the ADMIN and audit-event counts read-only first.

The LAN compose profile remains separate and uses `FIRST_ADMIN_TARGET_MODE=lan` plus its existing confirmed database/runtime-role guards. The Neon procedure must not be used for local, test, staging, Render, or LAN databases.
