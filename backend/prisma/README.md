# Database migration notes

The active provider is PostgreSQL. `prisma/migrations` contains a clean PostgreSQL baseline for
new empty databases. The former SQLite history is preserved unchanged under
`prisma/sqlite-migrations` for audit purposes and must never be passed to `prisma migrate deploy`.

Staging is intentionally a fresh PostgreSQL database; this repository does not migrate SQLite
rows. Never point development or tests at Render. Tests require `TEST_DATABASE_URL` targeting a
localhost database whose name contains `test`; each run creates a unique schema.

Never run `prisma migrate reset` against development, staging, or production. Apply migrations
with `prisma migrate deploy`, verify status, then run application-level acceptance tests.

## Production migration ownership

Application runtime and migration deployment use separate PostgreSQL login roles. The runtime
`DATABASE_URL` must authenticate as `clinic_app_user`. A migration job must instead receive a
`DATABASE_URL` that authenticates as `clinic_migration_user`; never place either URL in source.

Membership in `clinic_schema_owner` alone is insufficient because PostgreSQL normally assigns a
new object to the role that executes its `CREATE` statement. The database administrator must set
this database-specific login default once:

```sql
ALTER ROLE clinic_migration_user IN DATABASE clinic_staging
  SET role TO 'clinic_schema_owner';
```

`clinic_migration_user` must be allowed to `SET ROLE` to `clinic_schema_owner`. The setting takes
effect only on new connections. Before every migration, open a new connection with the migration
credentials and require both checks below to return true:

```sql
SELECT session_user = 'clinic_migration_user' AS authenticated_as_migration_user,
       current_user = 'clinic_schema_owner' AS effective_schema_owner;
```

Then run `npm run db:migrate:deploy` as an explicit pre-deploy job. Do not run it from an
application start command. Because each new migration connection starts with
`clinic_schema_owner` as `current_user`, newly created objects (including Prisma's
`_prisma_migrations` table on a new database) are owned by `clinic_schema_owner`, and that role's
default privileges apply.

After deployment, verify that all application relations and `_prisma_migrations` in `public` are
owned by `clinic_schema_owner`. Stop the release if the effective-role preflight or ownership
verification fails; do not start the new application version until the migration is confirmed.
