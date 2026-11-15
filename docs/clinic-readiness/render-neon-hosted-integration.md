# Render + Neon connection and clinical go-live checklist

**Status: preparation only.** This PR does not connect Render to Neon, run migrations, seed data, change secrets, or deploy production.

## Architecture and current issue

- React/Vite frontend: Render Static Site. The main production UI follows redesign, whereas production-web-test follows main.
- NestJS backend: clinic-production-api Render Docker service on main.
- Selected Neon project: database neondb / schema public, subject to positive identity and migration checks.
- Last failed backend deploy looked up an obsolete dpg-... PostgreSQL hostname; Prisma and the PostgreSQL LISTEN-based socket revocation listener could not connect.
- Only the NestJS backend should connect to Neon. No Neon credentials belong in the browser, frontend build variables, repository, or logs.

## Safe production connection steps

1. Confirm the exact Neon project, database and branch and verify rows, schema and migration history against the latest main commit. The user-visible Neon migrations count appears higher than the historical October release report; never assume migration drift is safe.
2. Capture an encrypted restorable PostgreSQL backup and conduct a separate isolated restore test. Back up file uploads separately. Never run prisma migrate reset, prisma db push or general seed on the live database.
3. Use a dedicated, least-privilege Neon runtime role. In Neon Connect, prepare the verified TLS PostgreSQL URL for the approved branch and database. For DATABASE_URL, review Prisma pooling compatibility. SOCKET_REVOCATION_DATABASE_URL must use a direct Neon endpoint (not a transaction pooler) because PostgreSQL LISTEN requires persistent sessions. Verify both URLs point to the same database.
4. Set the connection URLs privately in Render's Environment for clinic-production-api. Keep and protect existing JWT_SECRET, MEDICAL_ENCRYPTION_KEY, MFA_ENCRYPTION_KEY, verification delivery and other keys. Rotating medical encryption keys without a separate procedure risks permanent loss of access to encrypted records.
5. Set NODE_ENV=production, CLINIC_TIME_ZONE and exact HTTPS CORS_ALLOWED_ORIGINS to match the intended browser site. Never turn on development OTP/verification for public production traffic.
6. Only deploy backend after read-only migration status checks and a successful backup/restore. Confirm /api/health/ready succeeds, as well as a healthy socket.revocation_listener_ready event. A passing GitHub build does not prove database readiness.
7. On Render frontend Static Site, set public build-time variables VITE_API_BASE_URL, VITE_STAFF_API_URL and VITE_STAFF_SOCKET_URL to https://clinic-production-api.onrender.com, with VITE_CLINIC_TIME_ZONE matching the backend, then rebuild the frontend. These variables must never contain secrets. If a same-origin reverse proxy is used, align its routes instead.
8. Review any deployed frontend Content-Security-Policy (CSP) connect-src and exact backend CORS/Socket.IO permissions for cross-origin HTTPS connections; do not disable CSP globally.
9. Run real browser smoke tests with synthetic identities in an isolated environment: patient register/login, doctor schedule, reception, billing, lab, pharmacy, websocket session revocation, roles and authentication, medical attachments through restart/redeploy, and Arabic/English accessibility.
10. Approve promotion to production only after disaster recovery, monitoring, security and privacy reviews are complete. Leave production unchanged until approval.

## Source fix in this pull request

- frontend/src/utils/clinicTime.js now fetches public configuration using VITE_API_BASE_URL rather than assuming same-origin /api/public-config.
- A five-second timeout avoids indefinitely blocking React startup when the API is unavailable.
- frontend/test/clinicTime.test.js now covers cross-origin resolution, timeout-signal presence and a failed API response fallback.

## Critical open items

- Neon app connection details and production Render env settings have not been read or changed by this PR.
- Successful backup plus restore, schema drift check, privilege check, permanent uploads, delivery/MFA and live end-to-end acceptance are pending.
- No actual live-clinical go-live claim is made until all of these are satisfied.
