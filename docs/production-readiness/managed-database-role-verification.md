# Managed staging database role verification

Status: **Managed roles not created or tested.** Pass 2 verified a role model on local disposable PostgreSQL only; provider default grants and pooler behavior are unknown.

| Identity | Intended privileges | Managed result |
|---|---|---|
| Migration role | Connect to staging DB; own/alter only target application schema/objects as needed by reviewed migrations; no superuser, CREATEDB or CREATEROLE | Not provisioned |
| Runtime role | CONNECT, schema USAGE, required table DML, sequence USAGE/SELECT; no schema CREATE, ownership or role/database administration | Not provisioned |
| Direct listener role | Only if LISTEN/NOTIFY requires a direct session; CONNECT and minimum schema access; no limiter/application DML | Need not established |

Pass 2 local negative checks showed the runtime identity could not create schema objects and lacked database/role administrative flags; the listener lacked limiter-table DML. The application’s actual grants must be derived from migration and runtime query behavior, then reproduced on staging. Test negative capabilities explicitly: create database/role, alter unrelated schema, create table, change ownership, and unauthorized table writes must fail; required app reads/writes and sequence use must succeed. Verify migrations succeed only under migrator and fail under runtime. Check grants on default privileges/future objects, PUBLIC, sequences and functions. Do not grant superuser to make a migration work.

Use pooled connectivity for ordinary runtime queries when supported and explicitly bounded per backend instance. Use direct session connectivity only for features that require session semantics (for example LISTEN/NOTIFY); isolate it behind a narrower identity where feasible. Record provider pool mode, transaction/session semantics, server and per-role connection caps, and observed max connections. No managed grant, pooling or connection limit is verified by this report.
