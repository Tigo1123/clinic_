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

## Patient MRN sequence privilege

The patient file-number migration creates `patient_file_number_seq` and the database default
uses `nextval()` to generate each `SHF-...` value. PostgreSQL table `INSERT` permission does not
grant sequence access. Before starting an application version that can create Patients, verify
that the runtime role has `USAGE` on this sequence. Prefer provisioning this through
`ALTER DEFAULT PRIVILEGES` for the actual role that creates the sequence; an explicit
`GRANT USAGE ON SEQUENCE` after migration is an acceptable fallback. Do not grant sequence
ownership or privileges to `PUBLIC`, and verify the privilege before backend deployment.

For each environment, provision the default before running migrations, using the actual
effective object-creator role (the `current_user` after the migration login's role setup):

```sql
ALTER DEFAULT PRIVILEGES FOR ROLE <migration-object-creator>
IN SCHEMA public
GRANT USAGE ON SEQUENCES TO <runtime-application-role>;
```

This affects only future sequences. If `patient_file_number_seq` already exists, apply the
one-time equivalent explicitly before the backend rollout:

```sql
GRANT USAGE ON SEQUENCE public.patient_file_number_seq TO <runtime-application-role>;
```

The repository provides a parameterized operational command for this exact
one-time grant. Run it with migration credentials after `prisma migrate
deploy`; never substitute the runtime connection for
`MIGRATION_DATABASE_URL`:

```sh
MIGRATION_DATABASE_URL='<migration connection>' \
RUNTIME_DATABASE_ROLE='<environment runtime role>' \
npm run db:grant:patient-mrn-sequence
```

Set `DATABASE_SCHEMA` only when the deployment does not use `public`. The
script quotes both identifiers, grants only `USAGE`, and fails if the runtime
role can update or owns the sequence. It deliberately does not install default
privileges: those must be configured separately for the actual effective
object-creator role before migrations, as described above.

The deployment sequence is: (1) apply the Prisma migration with the migration role, (2) grant
sequence `USAGE` to the runtime privilege-bearing role when default privileges did not already
provide it, (3) verify privileges and database readiness, (4) deploy the backend, and (5) run an
authorized Patient-creation smoke test. Previous-backend compatibility begins after step 2;
table `SELECT`/`INSERT`/`UPDATE`/`DELETE` alone is insufficient.

Use safe, non-destructive verification queries with environment-specific role placeholders:

```sql
SELECT has_sequence_privilege(
  '<runtime-application-role>',
  'public.patient_file_number_seq',
  'USAGE'
) AS can_generate_mrn,
has_sequence_privilege(
  '<runtime-application-role>',
  'public.patient_file_number_seq',
  'UPDATE'
) AS can_update_sequence;
```

Expected results are `can_generate_mrn = true` and `can_update_sequence = false`.
Confirm the runtime role is not the sequence owner separately through the catalog before
starting application traffic. Never substitute a table grant, sequence ownership, `UPDATE`, or
a `PUBLIC` grant for this requirement.
