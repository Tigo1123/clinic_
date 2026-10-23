# Production readiness pass 2 — staging verification

Date: 22 October 2026. This pass used only disposable loopback PostgreSQL databases and synthetic fixtures. No Neon or Render production service was contacted. No real patient data was used. No production schema/data writes, commit or push occurred.

## Verdict

**A — NOT READY FOR PRODUCTION.** The database migrations and local synthetic restore have strong verification evidence. Application-level multi-instance deployment, production-equivalent edge, staged weak-network and k6 capacity evidence are still absent. The maximum demonstrated concurrent-user load is **0 VUs**; 1000 VUs were not tested. The restore timing is a local snapshot-copy result, not a provider recovery RTO.

## What was verified

| Area | Evidence | Status |
|---|---|---|
| Isolated PostgreSQL | PostgreSQL 18.6 on loopback, `shifa_stage/public`, `clinic_test`, and a separate `shifa_restore`; dedicated local credentials/roles; 100 connection server limit. Staging runtime role connection limit 40 and listener limit 5. No pooler was used. | Complete for local rehearsal only |
| Full migration replay | All 27 repository migrations applied to fresh `shifa_stage/public`, including `20261022120000_shared_rate_limit_buckets`; Prisma status up to date; schema diff empty; applied history 27/27 with matching checksums, no failed or rolled-back entries. | Verified locally |
| Synthetic dataset | Deterministic disposable fixture: 25 users, 20 doctors, 5,000 patients, 20,000 appointments, 8,000 records/prescriptions/prescribed drugs, 2,000 lab orders/items, 15,000 invoices/items, 12,000 payments, 1,500 refunds, 100 formulary items, 200 inventory batches, plus 18 states, 4 payment methods and 5 specialties. No external messaging. | Local only |
| Rate-limit store | Independent Node workers against the PostgreSQL adapter produced atomic count 100 from concurrent 50+50 increments; another worker after restart observed 101; expiry reset a bucket; persisted rows remained bounded at 2. This verifies the adapter’s cross-process counter, not full HTTP limit behavior across server instances. | Partially verified |
| Staff MFA | With required policy, each of ADMIN, DOCTOR, RECEPTION, PHARMACY and LAB received an enrollment-only credential; ordinary protected API denied it; TOTP enrollment issued recovery codes; old enrollment credential was revoked; challenge login, invalid TOTP rejection and logout revocation worked. | Core flow verified; lifecycle gaps below |
| Query plans | 12 representative EXPLAIN ANALYZE queries on the synthetic dataset; see `database-query-plan-results.md`. No index was added from one local warm run. | Measured locally, not under load |
| Restore | Custom-format snapshot 1,267,491 bytes; dump 247 ms; restore into separate disposable DB 605 ms. 27 migration histories/checksums, 421 constraints, zero unvalidated constraints, row checksums, financial aggregates and selected timestamps matched. Restored clone passed Prisma status/diff and app readiness returned HTTP 200 in 951 ms using a read-only health request. | Successful local drill |
| Least privilege | Local staging runtime role is not superuser/role creator/database creator and cannot CREATE in public; DML and required sequence access verified. Listener has only connect/schema usage and no limiter-table DML. Migrator owns schema/tables. | Verified for local roles only |

## Pass 2 implementation and test-harness changes

- Added guarded synthetic staging seed/clean, query-plan, restore reconciliation, restored-app readiness, and isolated test-schema cleanup scripts under `tests/production-readiness/`.
- Fixed the lab billing read path to select `serviceId`, which the subsequent invoice validation already required; focused integration regression and the final full suite passed.
- Made test PostgreSQL port configurable but restricted it to the explicit loopback `clinic_test` target; added opt-in cleanup restricted to generated test namespaces. The final suite ran serially with cleanup because the disposable database has a disk quota.
- Updated PostgreSQL 18-aware RESTRICT error assertions and the test inventory contract. Test-only rate-limiter key reset prevents state leakage between integration cases; production limiter configuration and thresholds are unchanged.
- Corrected Prisma declarations for existing SQL defaults/generated expression so the replayed database and Prisma datamodel diff cleanly.
- No new Prisma migration beyond the already-prepared `20261022120000_shared_rate_limit_buckets` was created in Pass 2; no migration was applied outside the disposable local cluster.

Staging metadata: PostgreSQL **18.6**; `shifa_stage/public` is the synthetic performance database, `shifa_restore/public` is its independent recovery target, and `clinic_test` is reserved for test-runner schemas. Server `max_connections=100`; staging runtime role cap 40, listener cap 5. The rehearsal used direct localhost connections with **no pooler**, so it does not model Neon pooled connectivity. Credentials are separate random local credentials in a mode-0600 file and are intentionally omitted here.

Minimum role model evidenced locally: (1) migration role owns the target schema/migration objects and has DDL needed for approved migrations, without superuser/CREATEDB/CREATEROLE; (2) runtime role gets database CONNECT, schema USAGE, only required table DML including the shared limiter table, and sequence USAGE/SELECT, with no schema CREATE or ownership; (3) listener role gets CONNECT and schema USAGE for direct `LISTEN/NOTIFY`, no application-table DML. On managed staging, verify default grants for future migration-created objects and revoke unintended `PUBLIC` privileges before treating this as production-ready. This role model has not been confirmed against a managed provider.

Cleanup: run `node tests/production-readiness/seed-staging-data.mjs clean` to remove only the script’s `stg-` synthetic operational rows; run `node tests/production-readiness/cleanup-test-schemas.mjs` to drop only generated `test_*`/`schedule_workflow_*` schemas from the guarded `clinic_test` database. The disposable cluster can be stopped with `pg_ctl` on its `/tmp` data directory and removed after retaining any approved reports. These cleanup steps do not target Neon or Render.

## Not demonstrated

- The final serialized full backend suite completed: **62/62 files, 689/689 tests passed, 0 failed, 0 skipped**, in approximately 4m32s from log creation to completion. Focused `integration.test.js` also passed 235/235 after the lab-order projection fix. Earlier incomplete attempts are invalid and superseded by this final run.
- Frontend test suite: **50/50 passed**. Vite production build passed; emitted entry JS is 354.61 KB raw / 112.13 KB gzip, largest AdminDashboard chunk 491.70 KB raw / 141.52 KB gzip and lazy-loaded. Oxlint exits 0 with six existing warnings (duplicate translation keys, control-character regex, fast-refresh export).
- Prisma validation passed; syntax checks on changed backend/runtime and Pass 2 harness files passed; `git diff --check` passed.
- No two actual backend server instances were run. Socket.IO revocation/broadcast across instances is unverified; sockets remain process-local without a shared adapter.
- No rate-limit HTTP burst matrix for login, OTP, password reset, MFA, admin reset or registration was completed.
- No k6 stage ran (10/50/100/250/500/1000); k6 is unavailable and no staging deployment/personas/monitoring environment exists. Capacity is not demonstrated.
- No weak-network browser test reached a deployed staging edge; Pass 1 localhost numbers remain the only measurements.
- No deployed TLS/HSTS/CSP/CORS/compression/cache-control response was observed. PHI cache headers at a deployed edge are unverified.
- Restored clone app startup/readiness passed with a local test-mode server and a read-only readiness request. Failure/SMTP/Google/socket/disconnect chaos tests were not comprehensively completed.
- MFA disabled-account, password-change, admin-reset, recovery-code consumption and stale websocket cases were not all exercised under required production policy.
- No managed provider pooler, provider connection caps, DB CPU/query telemetry, event-loop lag or staging resource metrics were available.

## Token/session review

Staff (`cms_staff_token`), patient (`cms_patient_token`) and Google onboarding (`cms_google_onboarding_token`) bearer credentials are written/read/removed through `frontend/src/services/authStorage.js` and `frontend/src/features/patient-auth/googleOnboardingStorage.js`; `apiClient.js`, `logout.js`, `staffLogin.js` and `staffSocket.js` consume them for HTTP/socket auth. No auth token is stored in `localStorage`; other localStorage keys are language/theme preferences. `sessionStorage` is scoped to the browsing tab/session, not durable application storage, though browser session-restore behavior can restore a tab. Any same-origin XSS can read and replay these credentials while valid. **PR-05 remains High and launch-blocking unless a documented risk acceptance/compensating controls are approved.** No partial cookie migration was attempted.

The safe migration design remains: opaque server-side revocable sessions in `Secure; HttpOnly; SameSite=Lax` cookies; strict Origin/Referer checks plus CSRF token for state-changing requests; short-lived access/session rotation with auth-version revocation; Google/patient/staff/MFA flows migrated together; logout and disabled-user revocation verified; Socket.IO authenticated through the same cookie or a short-lived single-use socket ticket; then remove browser-readable bearer persistence only after cross-flow staging tests. CSP and edge policy must be verified on actual deployed responses before this migration is considered protective.

## Residual High blockers

SessionStorage bearer exposure; production TLS/proxy/headers and PHI cache policy unverified; provider runtime/migration/listener privileges and pooled connectivity unverified; no production-equivalent weak-network or load evidence; no provider backup/PITR or measured disaster-recovery objective; no shared Socket.IO adapter for multiple instances. The repository backend suite passed against isolated PostgreSQL but does not substitute for staging deployment evidence. See `risk-register.md` for ownership and remediation.

## Recommended next action

Provision a dedicated staging deployment with an isolated managed PostgreSQL project and least-privilege roles, controlled synthetic accounts, production-equivalent frontend build and TLS edge, metrics, and disposable k6 operator credentials. Then verify deployed response headers and run weak-network profiles. Run k6 progressively from smoke, 50 and 100 only after DB/Node observability is live. Do not target Neon or Render production.

## Final answers

1. Maximum tested stable concurrent users: **0 VUs**; no load stage was run.
2. 1000 VUs: **not tested**.
3. p95 degradation load: **unknown**; no staged API latency samples exist.
4. First bottleneck: **not observed under concurrent load**. Local evidence points to sequential scans in billing aggregates and large candidate work in reception/lab queries, but that is not a capacity finding.
5. Shared rate limiting: atomic bucket state was shared across independent Node worker processes and survived a worker restart; route-by-route enforcement across two full backend instances remains unverified.
6. Migrations: **27/27 replayed cleanly**, status up to date, no schema diff/checksum mismatch.
7. Restore: **succeeded** locally; table checksums, financial sums, timestamp bounds, migrations and constraints reconciled.
8. Measured RTO: local dump 247 ms + restore 605 ms + restored app readiness 951 ms in this drill; **provider/incident RTO remains unknown**.
9. Measured RPO: no loss relative to the captured logical snapshot; **failure-time/provider RPO remains unknown**.
10. PHI responses non-cacheable at deployed edge: **not verified**.
11. TLS/HSTS at deployed edge: **not verified**.
12. Database least privilege: verified for disposable local staging roles only; **provider roles are not verified**.
13. SessionStorage remains High: **yes**, due same-origin XSS token exposure.
14. High blockers remain: session token exposure/acceptance, edge/TLS and PHI caching, provider DB grants/pool behavior, MFA operational recovery/rollout, production-equivalent performance and backup recovery evidence.
15. Before the first real patient: deploy a controlled staging equivalent, verify TLS/headers and PHI no-store behavior, verify managed DB roles/pool configuration and restore objective, complete MFA recovery/revocation tests, and obtain acceptable weak-network and staged load evidence. Keep production data off until those gates are reviewed.
