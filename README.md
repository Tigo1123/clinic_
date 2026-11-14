# Shifa | Healthcare Facility Management System

Shifa is a bilingual healthcare facility management product. Set optional `FACILITY_NAME_AR`
and `FACILITY_NAME_EN` deployment variables to show the institution's name prominently; each
language falls back to the Shifa product name when its facility name is unset. No facility name
is assumed or supplied by this repository.

The repository contains a Node.js/Prisma backend (an Express server and a NestJS server at parity, ahead of the NestJS cutover) and React/Vite frontend. The active database
provider is PostgreSQL. Development, test, staging, and production must use separate databases
or tightly isolated schemas; uploads use independent durable storage.

See [DEPLOYMENT.md](DEPLOYMENT.md) for deployment prerequisites and [OPERATIONS.md](OPERATIONS.md)
for backup, restore, monitoring, rollback, and incident procedures. Never commit `.env` files,
database files, backups, or uploaded clinical attachments.

## System architecture

The backend has two server entry points during the NestJS dual-run. The Express server
(`backend/src/server.js`) is still the production entry point and the one the backend image starts.
The NestJS application (`backend/src/main.ts`) is built to `backend/dist/` and is being prepared for
cutover. Both servers use the same domain services, utilities, and middleware, and the parity tests in
`backend/test/nestjs-*.test.js` compare their HTTP and Socket.io behavior. Nothing in the code selects
between them at runtime. The entry file that is started decides which server runs.

```mermaid
flowchart LR
  patient["Patient browser"]
  staff["Staff browser"]

  subgraph web["frontend container (nginx :8080)"]
    spa["Static React SPA"]
    proxy["Reverse proxy<br/>/api/ and /socket.io/"]
  end

  subgraph api["backend container (Node.js :5000)"]
    express["Express server (src/server.js)<br/>REST API and Socket.io"]
    nest["NestJS server (dist/main.js)<br/>REST API and Socket.io gateway"]
    services["Shared services, utils, middleware"]
  end

  db[("PostgreSQL 16<br/>via Prisma")]
  uploads[("Uploads volume")]
  google["Google Identity"]
  smtp["SMTP provider"]

  patient --> spa
  staff --> spa
  patient --> proxy
  staff --> proxy
  proxy -->|"current container entry"| express
  proxy -.->|"after cutover"| nest
  express --> services
  nest --> services
  services --> db
  services --> uploads
  services --> google
  services --> smtp
```

### Components

| Component | Location | Responsibility |
| --- | --- | --- |
| Frontend SPA | [frontend/src](frontend/src) | React 19 + Vite app with a public landing page, a patient portal, and the staff workspace. Uses MUI, i18next (Arabic and English), and Socket.io client. |
| Frontend proxy | [frontend/nginx.conf](frontend/nginx.conf) | Serves the built SPA and forwards `/api/` and `/socket.io/` to the backend. Sets the Content-Security-Policy and other security headers. |
| Express server | [backend/src/server.js](backend/src/server.js) | Current production entry point (`node src/server.js`). Express app with security headers, CORS, request IDs, the Socket.io server, and REST routes mounted under `/api`. |
| NestJS server | [backend/src/main.ts](backend/src/main.ts) | Nest bootstrap. [AppModule](backend/src/app.module.ts) imports the feature modules in [backend/src/modules](backend/src/modules). Sets a global `/api` prefix and the same security headers and CORS middleware as Express. Built with `npm run build:nest`; not yet the container entry point. |
| Realtime gateway (NestJS) | [backend/src/modules/realtime](backend/src/modules/realtime) | Socket.io gateway with the same handshake authentication, readiness gate, and rooms as `server.js`. |
| Shared backend code | [backend/src/services](backend/src/services), [backend/src/utils](backend/src/utils), [backend/src/middleware](backend/src/middleware) | Domain logic, utilities, and Express middleware. Nest modules call these directly, so both servers share one implementation. |
| Nest common layer | [backend/src/common](backend/src/common) and [backend/src/database](backend/src/database) | Global guards, exception filter, Zod pipe, decorators, request ID middleware, and the Prisma module. |
| Database | [backend/prisma/schema.prisma](backend/prisma/schema.prisma) | PostgreSQL schema with migrations in `backend/prisma/migrations/`. |
| Uploads | `UPLOAD_DIR` (`/app/uploads` in Docker) | Attachments stored on a separate durable volume, not in the database. |

### Backend layers

Requests move through these layers. The Express stack serves production today. The NestJS stack sits
on the same services.

Express stack:

1. **Routes** ([backend/src/routes](backend/src/routes)): one module per area, such as `auth`, `patients`, `appointments`, `records`, `billing`, `pharmacy`, `admin*`, `patientAuth`, `mfa`, and `specialties`.
2. **Middleware** ([backend/src/middleware](backend/src/middleware)): authentication, role and policy checks, and request validation with Zod.
3. **Services** ([backend/src/services](backend/src/services)): business logic for MFA, access tokens, verification (email or phone), Google identity, patient registration, payments, pharmacy invoices, doctor scheduling, and socket revocation.
4. **Utilities** ([backend/src/utils](backend/src/utils)): clinic time zone handling, money arithmetic, scheduling rules, encryption of clinical data, notifications, and public DTOs that strip internal fields.
5. **Data access**: Prisma Client against PostgreSQL.

NestJS stack:

1. **Modules** ([backend/src/modules](backend/src/modules)): one folder per area, typically with a `*.module.ts`, `*.controller.ts`, and `*.service.ts`.
2. **Global guards and filters** ([backend/src/common](backend/src/common)): `JwtAuthGuard`, then `MustChangePasswordGuard`, then `RolesGuard`, registered in `AppModule`. Routes marked `@Public()` skip the auth guard. `ApiExceptionFilter` returns the same error envelope as the Express error handler. `RequestIdMiddleware` assigns request IDs.
3. **Validation**: `ZodValidationPipe` ([backend/src/common/pipes](backend/src/common/pipes)) validates request bodies in controllers.
4. **Services**: module services call the shared services and utilities listed above.
5. **Data access**: `PrismaModule` and `PrismaService` in [backend/src/database](backend/src/database).

### Frontend structure

- [frontend/src/app/router/AppRouter.jsx](frontend/src/app/router/AppRouter.jsx) defines the routes. `/` is the public landing page. `/patient-login`, `/register`, `/forgot-password`, and `/patient/claim` are patient auth pages. `/patient/*` is the patient portal behind `PatientRoute`, and `/staff/*` serves the staff workspace.
- Feature folders in [frontend/src/features](frontend/src/features) are grouped by audience. `public` holds the landing page, `patient` holds `auth` and `portal`, and `staff` holds `admin`, `clinical`, `doctor`, `laboratory`, `pharmacy`, `reception`, and shared `components`.
- Shared services in [frontend/src/services](frontend/src/services) include the API client (`apiClient.js`), token storage (`authStorage.js`), and logout. [frontend/src/services/staff](frontend/src/services/staff) holds the staff API, login, MFA, and Socket.io connection.

### Domain model

The Prisma schema covers these areas:

- **Identity and access:** `User`, `UserExternalIdentity`, `PendingExternalAuth`, `MfaConfiguration`, `MfaRecoveryCode`, `MfaChallenge`, `VerificationChallenge`, and `TenantAuditLog`.
- **Patients:** `Patient`, `PatientRegistration`, `PatientClaimCode`, `Consent`, and `MedicalRecord`.
- **Scheduling:** `Doctor`, `DoctorSchedule` with its periods, breaks, and exceptions, `Specialty`, `Appointment`, and `EmergencyOverride`.
- **Clinical:** `Prescription`, `PrescribedDrug`, `DrugFormulary`, `ClinicalService`, `LabOrder`, and `LabOrderItem`.
- **Pharmacy:** `InventoryBatch` and `StockMovement`.
- **Billing:** `Invoice`, `InvoiceItem`, `Payment`, `PaymentMethod`, `PaymentOperation`, `Refund`, `InsuranceCompany`, and `InsuranceClaim`.
- **Notifications:** `Notification` and `NotificationLog`.

### Security and realtime

- Staff roles are `ADMIN`, `RECEPTIONIST`, `DOCTOR`, `LAB_TECH`, and `PHARMACIST`. Patients use a separate login path.
- Staff accounts support multi-factor authentication. Recovery codes are stored hashed.
- Clinical data is encrypted with `MEDICAL_ENCRYPTION_KEY`. MFA secrets use `MFA_ENCRYPTION_KEY`.
- Socket.io connections authenticate with the same access token as the REST API. Both servers use the same socket authentication and revocation logic. When a user's auth version changes, their sockets from the stale auth generation are disconnected.
- Socket clients join rooms by user, role, and doctor (`user_<id>`, `role_<ROLE>`, `doctor_<id>`), so updates reach only the relevant staff. The NestJS gateway joins the same rooms.
- `/api/health`, `/api/health/live`, and `/api/health/ready` are served by both servers. Readiness also requires the socket revocation listener to be ready.
- Phone or email verification is controlled by `VERIFICATION_PROVIDER` (`email`, `disabled`, or `development` outside production). Production accepts only `email` or `disabled`.

### Deployment topology

- **Docker Compose** ([docker-compose.yml](docker-compose.yml)) runs three services: `postgres` (PostgreSQL 16), `backend` (Node 22), and `frontend` (nginx). The backend starts only after the database health check passes. The backend image is built from [backend/Dockerfile](backend/Dockerfile). Its runner stage starts Express (`node src/server.js`) and copies the compiled NestJS output to `dist/` without starting it. The Dockerfile notes that the `CMD` changes to `["node", "dist/main.js"]` at cutover. The compose file does not override the command.
- **LAN profile** ([compose.lan.yml](compose.lan.yml)) runs the app on an internal network. The database and app networks are internal and not reachable from outside. It adds one-time bootstrap, first-admin, and backup services, with scripts in [deploy/lan](deploy/lan). It builds the same backend image.
- **Running locally:** `npm start`, `npm run dev`, and `npm run start:staging` run Express. `npm run build:nest` followed by `npm run start:nest` runs the compiled NestJS app, and `npm run dev:nest` runs it in watch mode.
- **CI/CD** ([.github/workflows/ci-cd.yml](.github/workflows/ci-cd.yml)) builds the NestJS app, runs backend tests (including the NestJS parity tests), frontend tests, lint, and build, then builds the Docker images.

## Local validation

```sh
cd backend && npm ci && npm test
cd frontend && npm ci && npm run lint && npm run build
cd backend && npx prisma validate && npx prisma migrate status
```

Copy the example environment files for local development and replace placeholders locally.
Production must use a secret manager or platform-injected environment variables.
