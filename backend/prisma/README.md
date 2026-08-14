# Database migration notes

The active provider is PostgreSQL. `prisma/migrations` contains a clean PostgreSQL baseline for
new empty databases. The former SQLite history is preserved unchanged under
`prisma/sqlite-migrations` for audit purposes and must never be passed to `prisma migrate deploy`.

Staging is intentionally a fresh PostgreSQL database; this repository does not migrate SQLite
rows. Never point development or tests at Render. Tests require `TEST_DATABASE_URL` targeting a
localhost database whose name contains `test`; each run creates a unique schema.

Never run `prisma migrate reset` against development, staging, or production. Apply migrations
with `prisma migrate deploy`, verify status, then run application-level acceptance tests.
