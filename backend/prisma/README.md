# Database migration notes

Development and the current preserved dataset use SQLite. Never run `prisma migrate reset`
against `dev.db` or a deployed clinic database.

The `20260813000000_security_integrity` migration reconciles schema changes that had
previously been applied to the development database with `db push`. On the preserved
database, the already-present columns/table were verified and the migration was baselined;
only the appointment indexes were created. Fresh databases run the full migration normally.

## Future PostgreSQL migration

PostgreSQL remains the recommended production target, but changing Prisma providers is a
planned data migration, not an in-place configuration toggle. The safe path is: back up and
freeze writes, create a PostgreSQL-specific schema/migration history, transform and import a
copy, compare row counts and foreign keys, run workflow/authorization tests, then cut over.
Retain the SQLite backup until the production acceptance window is complete.
