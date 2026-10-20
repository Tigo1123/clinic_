# Shifa | Healthcare Facility Management System

Shifa is a bilingual healthcare facility management product. Set optional `FACILITY_NAME_AR`
and `FACILITY_NAME_EN` deployment variables to show the institution's name prominently; each
language falls back to the Shifa product name when its facility name is unset. No facility name
is assumed or supplied by this repository.

The repository contains an Express/Prisma backend and React/Vite frontend. The active database
provider is PostgreSQL. Development, test, staging, and production must use separate databases
or tightly isolated schemas; uploads use independent durable storage.

See [DEPLOYMENT.md](DEPLOYMENT.md) for deployment prerequisites and [OPERATIONS.md](OPERATIONS.md)
for backup, restore, monitoring, rollback, and incident procedures. Never commit `.env` files,
database files, backups, or uploaded clinical attachments.

## Local validation

```sh
cd backend && npm ci && npm test
cd frontend && npm ci && npm run lint && npm run build
cd backend && npx prisma validate && npx prisma migrate status
```

Copy the example environment files for local development and replace placeholders locally.
Production must use a secret manager or platform-injected environment variables.
