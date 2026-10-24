# Managed staging database role verification

Historical Pass 2/3 status: **Managed roles not created or tested during those passes.** Pass 2 verified a role model on local disposable PostgreSQL only; provider default grants and pooler behavior are unknown.

| Identity | Intended privileges | Managed result |
|---|---|---|
| Migration role | Connect to staging DB; own/alter only target application schema/objects as needed by reviewed migrations; no superuser, CREATEDB or CREATEROLE | Not provisioned |
| Runtime role | CONNECT, schema USAGE, required table DML, sequence USAGE/SELECT; no schema CREATE, ownership or role/database administration | Not provisioned |
| Direct listener role | Only if LISTEN/NOTIFY requires a direct session; CONNECT and minimum schema access; no limiter/application DML | Need not established |

Pass 2 local negative checks showed the runtime identity could not create schema objects and lacked database/role administrative flags; the listener lacked limiter-table DML. The application’s actual grants must be derived from migration and runtime query behavior, then reproduced on staging. Test negative capabilities explicitly: create database/role, alter unrelated schema, create table, change ownership, and unauthorized table writes must fail; required app reads/writes and sequence use must succeed. Verify migrations succeed only under migrator and fail under runtime. Check grants on default privileges/future objects, PUBLIC, sequences and functions. Do not grant superuser to make a migration work.

Use pooled connectivity for ordinary runtime queries when supported and explicitly bounded per backend instance. Use direct session connectivity only for features that require session semantics (for example LISTEN/NOTIFY); isolate it behind a narrower identity where feasible. Record provider pool mode, transaction/session semantics, server and per-role connection caps, and observed max connections. No managed grant, pooling or connection limit is verified by this report.


## Explicit managed-provider readiness policy — 24 October 2026

Set `DATABASE_PROVIDER=neon` explicitly on the isolated Neon staging API. The omitted value defaults to `self-managed`; unknown values are rejected at startup. Selecting Neon also requires the existing validated Neon pooled runtime hostname and direct listener hostname. This setting is not inferred from a hostname or a role attribute.

For every production provider, readiness still requires database `neondb`, schema `public`, exact equality of `current_user` and `RUNTIME_DATABASE_ROLE`, a non-superuser runtime role, all four SELECT/INSERT/UPDATE/DELETE privileges on `RateLimitBucket`, and a ready socket-revocation dependency. TLS, bounded connection pool settings, MFA policy, and authentication checks are unchanged. Self-managed PostgreSQL additionally requires both `rolcreaterole=false` and `rolcreatedb=false`; unknown capability values fail closed under that policy. Self-managed endpoints retain the same database/schema/TLS/pool requirements without Neon-specific DNS requirements.

Observed staging evidence supplied for this change has the expected `clinic_runtime` identity, non-superuser status and limiter access, but reports CREATEDB/CREATEROLE flags as true. Attempts by the managed owner to clear those attributes returned SQLSTATE 42501. Under the explicit Neon policy, those two attributes are diagnostic information rather than unconditional readiness failures. The API emits `health.neon_managed_role_capabilities` at INFO with only runtime role and those two booleans when either flag is true. This exception does not assert that all role/database administration is unavailable or replace object-grant review. Verify provider permissions and object-level restrictions separately; do not grant extra privileges to satisfy readiness.

Keep connection identities separate:

- `DATABASE_URL`: pooled connection using `clinic_runtime`; only this connection supplies the readiness identity and normal Prisma runtime queries.
- `DIRECT_URL`: direct connection using the migration/owner identity, supplied privately for Prisma migrations. Never substitute it for the runtime URL.
- `SOCKET_REVOCATION_DATABASE_URL`: direct session-capable listener connection with the reviewed listener privileges; separate from migration authority where supported.

The public response remains only `{"status":"healthy"}` or the existing generic unhealthy response. Role capabilities, connection strings, hostnames, and credentials are never included in the health response. Rejection WARN logs retain only the eight safe identity/privilege fields already introduced. No deployed service or managed database was contacted or modified by this code change.

The privilege query checks each CRUD privilege separately with AND. A comma-separated PostgreSQL privilege list means any listed privilege, so it is not sufficient here. Local regression tests remove each grant individually and require the limiter access result to become false.

Local verification for this policy change: 53/53 targeted tests passed across six readiness/configuration files, including real privilege checks on disposable local PostgreSQL. Prisma schema validation, changed JavaScript syntax checks, and `git diff --check` passed. No managed Neon connection or deployment was used for verification.
