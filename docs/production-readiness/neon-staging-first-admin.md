# Neon staging first administrator

`FIRST_ADMIN_TARGET_MODE=neon-staging` is a separate one-shot path in `backend/scripts/provision-first-admin.js`. It requires `NODE_ENV=production` even though the database is staging. It does not change the production verifier, production fingerprint `c9f8bb593c61b80e`, or `NEON_PRODUCTION` confirmation.

The staging direct hostname supplied for review on 2026-10-24 is `ep-muddy-unit-b4hvj7be.c-6.us-east-2.aws.neon.tech`. The separately pinned staging fingerprint is `36b1790f3b5c2037`, computed offline as the first 16 hex characters of SHA-256 of `<direct-host>//neondb/public`. Staging explicitly rejects the production fingerprint. No environment variable can replace either pin. Changing the staging endpoint requires a reviewed source change.

## Required staging environment

Supply configuration from a protected staging-only environment file or the approved secret injection mechanism. The following is a template, not a file to commit or paste with real credentials into shell history. `<reviewed-staging-direct-host>` must be the exact hostname pinned above, in lowercase.

```sh
NODE_ENV=production
FIRST_ADMIN_TARGET_MODE=neon-staging
FIRST_ADMIN_EXPECTED_DATABASE=neondb
FIRST_ADMIN_EXPECTED_SCHEMA=public
FIRST_ADMIN_EXPECTED_NEON_HOST='<reviewed-staging-direct-host>'
CONFIRM_FIRST_ADMIN_TARGET='NEON_STAGING:<reviewed-staging-direct-host>/neondb/public'
RUNTIME_LOGIN_ROLE='<staging-runtime-login>'
DATABASE_URL='postgresql://<staging-runtime-login>:<URL-encoded-staging-database-password>@<reviewed-staging-direct-host>/neondb?schema=public&sslmode=verify-full'
FIRST_ADMIN_USERNAME='<named-staging-administrator-email>'
FIRST_ADMIN_PASSWORD_FILE='<absolute-protected-password-file-outside-repository>'
```

Optional: `FIRST_ADMIN_PREFERRED_LANGUAGE=en` or `ar` (default `en`), and `BCRYPT_ROUNDS` from 10 through 15 (default 12). Leave `LAN_DATABASE_NAME` unset. `DIRECT_URL` and a configured fingerprint are not inputs to this provisioner.

The password file must already have been populated through the approved secret-handling process: a regular non-symlink file outside the repository, mode `0600`, containing one password line meeting application policy. The administrator password belongs only in that file, never in a command argument or environment variable. The database URL uses independent staging credentials and the exact same direct host; pooled hosts containing `-pooler` are refused. Explicit `schema=public` is recommended; the existing default schema behavior also accepts an omitted schema parameter as public. Repeated schema/TLS/options parameters are rejected in staging.

## Later operator sequence — not executed during implementation

Prepare both protected files outside the repository; do not print their contents. From a dedicated shell:

```sh
set +x
set -eu
umask 077
chmod 0600 '<protected-staging-environment-file>' '<protected-staging-administrator-password-file>'
cd '<repository-root>/backend'
unset LAN_DATABASE_NAME
set -a
. '<protected-staging-environment-file>'
set +a
node scripts/provision-first-admin.js --preflight
```

Preflight connects to the database, checks its identity/role and exact repository migration checksums, takes the transaction-scoped advisory lock, checks for an existing ADMIN or duplicate username, and exercises password hashing without inserting rows. Stop on any refusal. Review the successful result and confirm the exact target/account before the separately approved write:

```sh
set +x
cd '<repository-root>/backend'
node scripts/provision-first-admin.js --execute
```

Run the second block only in the same dedicated shell with the same reviewed environment after successful preflight. Execute repeats the checks and creates one ADMIN plus its audit row in a serializable transaction. If an ADMIN appears after preflight, execute refuses. Do not retry blindly after an ambiguous connection failure; inspect ADMIN and audit state read-only first. After success, enroll administrator MFA and securely remove the temporary password file using the approved secret-handling process. Do not run the application seed script for this operation.

## Implementation verification

Only fake database clients and synthetic password-file fixtures are used by `backend/test/first-admin-provision.test.js`. The CLI rejection cases stop at configuration checks before connecting. No Neon connection, real administrator creation, migrations, commit, push, or deployment is part of this change. The reviewed host identifies the intended target; actual isolation, credentials, privileges, migration state and absence of an ADMIN must still pass the later live preflight.
