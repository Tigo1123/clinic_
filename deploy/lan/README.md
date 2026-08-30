# Offline Phase 1A.2 — same-origin LAN frontend, API, and Socket.IO

This directory contains a reversible, test-bench-only foundation for running
the clinic frontend, Express API, Socket.IO, and PostgreSQL on one local server.
It is **not approved for clinical operation**. In particular, Phase 1A.1 uses
plain HTTP and has not implemented secure database bootstrap, TLS, backups, or
WAN-disconnected clinical acceptance testing.

## Architecture

```text
Clinic browser
      |
      v
http://clinic-server.example.internal:8080  (one browser origin)
      |-- /            -> React static frontend
      |-- /api/...     -> Nginx -> backend:5000
      `-- /socket.io/  -> Nginx -> backend:5000 (WebSocket/long polling)
                                      |
                                      `-> postgres:5432
```

Only Nginx publishes host port `8080`. `backend:5000` and `postgres:5432` are
Docker-private and must never be entered into a workstation browser. `lan-edge`
carries the frontend's published HTTP listener; `lan-app` and `lan-data` are
internal networks for frontend-to-API and API-to-database traffic respectively.
PostgreSQL data and uploads use separate named volumes.

## Files

- `../../compose.lan.yml`: isolated LAN Compose definition.
- `env.example`: non-secret configuration contract with unusable placeholders.
- `nginx.conf`: HTTP test-bench static server and same-origin reverse proxy.
- `../../backend/test/lan-deployment-foundation.test.js`: Phase 1A.1 static
  safety checks.
- `../../backend/test/lan-same-origin.test.js`: Phase 1A.2 browser-origin,
  proxy, CORS, health, and upload-link checks.

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
node --test backend/test/lan-same-origin.test.js
```

## Same-origin frontend configuration

The application already defaults `VITE_API_BASE_URL` and
`VITE_STAFF_API_URL` to relative API paths, and `VITE_STAFF_SOCKET_URL` to the
browser origin, when they are empty. The LAN frontend image therefore does not
embed a cloud endpoint. Nginx forwards both paths to the private backend
service.

The LAN build leaves all three URL overrides empty. Normal browser traffic uses
only the page origin: React requests relative `/api/...` URLs and Socket.IO uses
the current browser origin with its standard `/socket.io/` path. Docker service
names occur only in server-side Compose and Nginx configuration. No Render
endpoint or public Internet connection is required for these normal paths.

## CORS and forwarded headers

`CORS_ALLOWED_ORIGINS` must equal the single origin used by workstations,
including its scheme and non-default port. The example uses
`http://clinic-server.example.internal:8080`; wildcard CORS is not allowed.
This explicit HTTP origin is for Phase 1A.2 test-bench validation only.

Nginx forwards `Host`, `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Host`, and
`X-Forwarded-Proto`. The LAN Compose file sets `TRUST_PROXY=true`, which the
existing Express configuration interprets as one trusted proxy hop. The
application's CORS checks and Socket.IO access-token authentication remain
unchanged.

## Same-origin health and uploads

Reviewers can address readiness through the single origin at
`GET /api/health/ready`; direct access to backend port 5000 is neither required
nor published. Upload creation and patient attachment responses use relative
`/api/upload/...` links, so authenticated download requests also pass through
Nginx without embedding a backend hostname.

The HTTP origin in this phase is **not approved for clinical operation**.
Locally trusted TLS and certificate lifecycle controls remain a later mandatory
gate.

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
