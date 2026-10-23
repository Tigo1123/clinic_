# Migration replay results

Environment: disposable loopback PostgreSQL 18.6, database `shifa_stage`, schema `public`. Fresh database; no operational or external data. All connection credentials remain in a mode-0600 local file and are not recorded here.

- All **27/27** Prisma migrations applied from an empty schema, including `20261022120000_shared_rate_limit_buckets`.
- `prisma migrate status`: **Database schema is up to date!**
- Applied history: 27 entries; no missing, extra, unfinished, failed or rolled-back migration; local SQL checksums equal recorded checksums.
- `prisma migrate diff --from-url <isolated-db> --to-schema-datamodel prisma/schema.prisma --exit-code`: **No difference detected.** Same result against the restored clone.
- Post-migration catalog: 43 public tables (42 Prisma application models plus `_prisma_migrations`), 106 indexes, 421 constraints. Restore reports 0 unvalidated constraints.
- No migration was applied to Neon or Render. No production schema was read or written.

The repeat replay was successful after a prior local test-run collision had dropped a temporary test schema. The disposable database was rebuilt independently; no repository migration file was altered to make replay pass.
