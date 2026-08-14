# Clinic / Hospital Management System

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
