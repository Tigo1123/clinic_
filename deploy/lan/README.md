# Offline Phase 1A.1 — LAN deployment foundation

This directory contains a reversible, test-bench-only foundation for running
the clinic frontend, Express API, Socket.IO, and PostgreSQL on one local server.
It is **not approved for clinical operation**. In particular, Phase 1A.1 uses
plain HTTP and has not implemented secure database bootstrap, TLS, backups, or
WAN-disconnected clinical acceptance testing.

## Architecture

```text
Clinic browser -> http://<LAN host>:8080 -> frontend Nginx
                                         |-> /api -> backend:5000
                                         `-> /socket.io -> backend:5000
                                                               |
                                                               `-> postgres:5432
```

Only Nginx publishes a host port. Express and PostgreSQL are reachable only on
Docker networks. `lan-edge` carries the frontend's published HTTP listener;
`lan-app` and `lan-data` are internal networks for frontend-to-API and
API-to-database traffic respectively. PostgreSQL data and uploads use separate
named volumes.

## Files

- `../../compose.lan.yml`: isolated LAN Compose definition.
- `env.example`: non-secret configuration contract with unusable placeholders.
- `nginx.conf`: HTTP test-bench static server and same-origin reverse proxy.
- `../../backend/test/lan-deployment-foundation.test.js`: static safety checks.

The existing root `docker-compose.yml` is intentionally unchanged.

## Prerequisites

- Docker Engine with the Compose v2 plugin.
- Locally available build dependencies/images when testing without WAN.
- A separately created environment file outside Git. Never use this example as
  a real secret file and never commit its replacement.

No stack should be started during Phase 1A.1 review. Starting PostgreSQL would
initialize a new local data directory, while database role/bootstrap design is
reserved for a later approved step.

## Safe static validation

These commands parse configuration and run static tests; they do not create or
start containers and do not connect to a database:

```sh
docker compose --env-file deploy/lan/env.example -f compose.lan.yml config
node --test backend/test/lan-deployment-foundation.test.js
```

## Same-origin frontend configuration

The application already defaults `VITE_API_BASE_URL` and
`VITE_STAFF_API_URL` to relative API paths, and `VITE_STAFF_SOCKET_URL` to the
browser origin, when they are empty. The LAN frontend image therefore does not
embed a cloud endpoint. Nginx forwards both paths to the private backend
service.

## Intentionally not implemented

- TLS certificates or approval for clinical traffic.
- Database roles, users, permissions, migrations, or reference-data bootstrap.
- Real credentials or secret storage.
- Backup, restore, retention, or disaster recovery.
- Bundled fonts or other runtime Internet-dependency removal.
- Cloud synchronization, replication, multi-site support, PWA, Service Worker,
  IndexedDB, or browser-side clinical storage.
- Deployment to Render, Staging, Production, or a clinic server.

The next phase must not treat this HTTP foundation as ready for patient data.
