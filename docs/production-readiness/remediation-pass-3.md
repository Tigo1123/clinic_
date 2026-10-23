# Production readiness pass 3 — managed staging gate

Date: 22 October 2026. **Verdict remains A — NOT READY FOR PRODUCTION.** The initial Pass 3 repository inspection did not identify managed staging configuration, a database target, staging credentials, monitoring account, or deployment endpoint. Follow-up discovery made only lightweight read-only HTTPS requests to the public frontend/API health routes documented in [existing-staging-discovery.md](existing-staging-discovery.md); no database, authentication, browser workflow, load test, or restore was contacted or run. No production database was accessed. No data, code, schema, or dependencies were changed; only readiness documentation was added/updated.

Follow-up read-only discovery found the previously deployed Render frontend and its separate API hostname; see [existing-staging-discovery.md](existing-staging-discovery.md). The frontend serves HTTPS, while the backend health check timed out. This establishes a reusable staging candidate, not an isolated or healthy staging environment. The backend database identity remains unknown, so all Pass 3 deployment/load safety gates remain closed.

## Evidence and disposition

| Gate | Existing evidence | Pass 3 result |
|---|---|---|
| Empty PostgreSQL migration replay | Pass 2 replayed all 27 migrations on disposable PostgreSQL 18.6; checksums/status/schema diff were clean. | Local rehearsal only; managed replay not run. |
| Test baseline | Pass 2 backend 689/689 and frontend 50/50 passed; production build and Prisma validation passed. | Historical local evidence; not repeated because this pass did not change runtime code. |
| Shared rate limits | Atomic shared PostgreSQL adapter tested across independent Node workers, restart and expiry. | Actual HTTP limits across two deployed backend instances remain unverified. |
| Staff MFA | Required-policy enrollment/challenge core tested locally for five staff roles. | Full live lifecycle and recovery/revocation matrix remains unverified. |
| Database roles/pooling | Least-privilege roles tested on local PG; no pooler. | Managed grants, connection limits, pool behavior and direct listener identity unverified. |
| TLS/edge/cache | Repository configs inspected in previous passes. | Actual HTTPS responses, TLS, HSTS, CSP, CORS, compression, cache headers and PHI no-store remain unverified. |
| API/weak network/load | Pass 1 localhost throttling only; Pass 2 no k6 or staging HTTP. | No new measurements. Max demonstrated concurrency remains 0 VUs. |
| Backup/recovery | Pass 2 disposable local snapshot restored and reconciled. | Managed-provider backup/PITR and restore RTO/RPO unknown. |

The Pass 2 loopback PostgreSQL rehearsal is not a managed staging environment. Its local timing, roles, synthetic dataset, and 100-connection server cap cannot establish managed provider behavior. The repository’s production configuration currently pins production runtime connectivity to Neon pooled/direct target conventions. Staging on another provider would require a separately reviewed staging target configuration; do not relax production target guards to make staging boot.

## Required staging topology and provisioning packet

Provision a dedicated staging environment in a non-production cloud account/project, or a separately isolated staging project with separate billing/network boundaries and credentials. Select and record provider/region before provisioning; none is approved or configured in this repository. Requirements are listed in [managed-staging-architecture.md](managed-staging-architecture.md). Provide only secret-manager references to operators; never put values in reports or shell transcripts.

Minimum resources: an empty managed PostgreSQL instance at the intended production major version with TLS, isolated credentials, connection telemetry, separate runtime/migrator/listener roles and restore-to-separate-database support; two identical Node 22 backend instances behind the intended HTTPS edge; a static frontend deployment on staging-only DNS; safe metrics/logging; synthetic-only identities and data; and sink/disabled integrations. Before two-instance socket/revocation tests, implement or configure a supported shared Socket.IO adapter and verify it in staging. Pass 2 established that sockets remain process-local without one.

The current production-mode database config is Neon-specific. If staging uses a different provider, first prepare a staging-only explicit host/database/schema/TLS allowlist and test it without broadening or bypassing production checks. If staging uses Neon, provision a distinct project/database and credentials, pin its exact target, and verify it cannot resolve to production. Do not infer staging identity from a variable name.

## Safe execution order after infrastructure exists

1. Independently verify project/account, region, DNS, database identity, schema, TLS, credentials’ role identities and empty state. Confirm all endpoints are staging-only.
2. Create separate roles. Prove runtime and listener negative privileges before application deployment.
3. Replay the repository’s 27 migrations from an empty database using the migration identity; capture Prisma status, checksums, schema diff, indexes and constraints.
4. Load the deterministic synthetic dataset only after notification/payment/verification egress is disabled or sandboxed. Extend it to the requested Pass 3 scale and reconcile counts.
5. Deploy two backend instances, static frontend and monitoring. Verify edge headers and authenticated PHI no-store responses from actual HTTP responses.
6. Exercise synthetic account login, forced change, staff MFA, patient auth, logout, disabled/revoked sessions, and websocket reconnect. Then verify shared rate limits and cross-instance invalidation.
7. Capture unloaded API percentiles/payloads and browser Profiles B/C on cold contexts.
8. Run the revised k6 workload sequentially at 10, 50, 100, 250 and 500 VUs, stopping at first threshold failure. Attempt 1000 only if 500 satisfies all gates. Run auth bursts and booking contention only against isolated disposable identities/slots.
9. Run the managed backup/restore drill into a different disposable database, reconcile known counts/checksums and verify app readiness and critical relationships.
10. Archive redacted metrics/log evidence and update every Pass 3 report before any production decision.

No load test may precede the availability of staging ownership, isolated target proof, test-only credentials, and live Node/DB monitoring. No production command or migration is authorized by this report.

## Current answers

- Maximum stable concurrency demonstrated: **0 VUs**. First degraded level: **not observed**. 1000 VUs: **not attempted**.
- p95/error rate by stage: **not measured** at every stage.
- Managed database connections, Node CPU/RAM, edge/TLS/headers, PHI cache behavior, live MFA, two-instance limiter/session behavior, contention and managed restore: **not verified**.
- Managed staging RTO/RPO: **unknown**. Local Pass 2 restore measurements are not transferable.
- SessionStorage bearer tokens remain a **High launch risk** because same-origin XSS can read them; no evidence supports temporary acceptance.
- Remaining launch blockers include session token exposure or explicit approved risk acceptance, unverified deployed TLS/headers and PHI caching, unverified managed DB least privilege/pooling, unverified managed recovery, incomplete cross-instance socket behavior, and absent staging reliability/performance evidence.

## Exact next action

Provision the isolated staging resources and provide non-secret endpoint/identity metadata plus secret-manager variable names (not values). Then complete the staging-only target validation and role setup packet before deploying or running any test. See [managed-staging-architecture.md](managed-staging-architecture.md). Until then, retain verdict A and do not run load tests.
