# Existing staging/deployment discovery

Checked: 22 October 2026. This is a read-only discovery; no login, database connection, data change, deployment, or load test was performed. No credentials or database URLs are included.

## Decision

**C — EXISTING DEPLOYMENT NEEDS RECONFIGURATION.** Reuse is preferable to rebuilding from scratch: a Render-hosted frontend is currently serving HTTPS, and its deployed client bundle identifies a separate Render API service. However, the frontend is an older build, the API health request timed out, the Render service settings and database identity are not visible in this repository, and there is no evidence that the backend is using an isolated staging database. Treat the existing services as a **partially configured / stale staging candidate**, not as confirmed isolated staging and not as safe for load tests. The hostname labels contain “staging,” but labels alone do not prove isolation.

## Existing frontend

| Item | Finding |
|---|---|
| Provider | Render-hosted frontend, with Cloudflare visible as the responding edge proxy |
| URL | `https://clinic-staging-web.onrender.com/` |
| Current status | Read-only HTTPS `HEAD` returned HTTP 200 on 22 October 2026; public HTML shell is online |
| DNS/TLS | DNS resolution and certificate-chain/hostname validation succeeded as part of curl’s normal HTTPS verification at the time of the request |
| Deployment branch | Not recorded in repository; must inspect Render service settings |
| Build command | Current frontend build command is `npm run build`; actual deployed service build settings are not exposed in repo |
| Current build age | Response `Last-Modified` was 18 September 2026, before this branch’s recent remediation work; deployed asset hashes differ from current repository build evidence |
| API configuration | Deployed HTML loads 15 JavaScript assets. Its API-client bundle contains the separate host `clinic-staging-api.onrender.com`; that string is an endpoint hostname, not a credential |
| Same-origin API fallback | Requests to frontend `/api/health/live`, `/api/health/ready`, and `/api/health` returned the same HTML shell/ETag as `/`, so those paths did not verify backend health at that origin |

Actual frontend response headers included `Strict-Transport-Security: max-age=315360000; includeSubDomains; preload`, `X-Content-Type-Options: nosniff`, Cloudflare edge headers, and `Cache-Control: public, max-age=0, s-maxage=300`. The captured response did not include `Content-Security-Policy`, `Referrer-Policy`, or an explicit frame-protection header. This is a finding about the response observed from this URL, not a claim about every response or a future deploy. Recheck actual headers after any configuration change. The HTML’s shared-cache `s-maxage=300` must be reviewed against the intended shell update policy.

## Existing backend

| Item | Finding |
|---|---|
| Provider | Render hostname embedded in deployed frontend bundle |
| URL | `https://clinic-staging-api.onrender.com` (backend identity derived from the deployed public API-client bundle) |
| Service name | Render service name/settings are not available in Git; inferred hostname stem is `clinic-staging-api` |
| Start command | Current repository’s normal backend container command is `node src/server.js`; actual Render start command is not visible |
| Deployment branch | Not visible in repository; must inspect Render service settings |
| Current status | Direct read-only request to `/api/health/live` timed out with no HTTP response during the check. No retry loop was run. Availability is therefore unresolved; this does not prove the service has been deleted or permanently unhealthy |
| TLS/DNS | No successful API response was obtained, so a valid API certificate/response cannot be reported. The frontend bundle reference alone is not a DNS/TLS check |
| Instances/scaling | Render plan, instance count and horizontal-scaling support are not documented in repo and were not accessible from this read-only check |

Because the backend did not return health, its deployed version, database target, role, migration state and configuration cannot be established from HTTP. No authentication endpoint was used.

## Database identity and separation

The repository’s current local `backend/.env` was inspected by parsing its URLs in memory and emitting only non-secret descriptors: it targets Neon PostgreSQL database `neondb`; the runtime URL is a pooled candidate and the revocation listener URL is direct/session-capable. This is the current local environment configuration and is **not evidence of the deployed Render backend’s environment**. The production config in the current branch validates Neon target conventions.

The pre-Neon Render database’s provider was Render PostgreSQL according to the prior migration context and documentation. The Render-to-Neon assessment report’s recorded inventory attempt failed at connect and yielded no tables or identity. There is no evidence here that the old Render database remains active, is isolated, or is still attached to this service.

**Deployed backend database: unknown.** The Render dashboard’s injected environment is not available from this repo or the public frontend. Do not assume it points at either the old Render database or Neon. It is **not safe for synthetic data or load testing** until an operator verifies privately that its configured database is a dedicated staging database, confirms database/schema/role and host category, and confirms it is not the Neon production database. Never paste or report the URL; share only provider, hostname category, safe database name, and pooled/direct classification.

## Classification and reuse

The observable environment is best classified as **D — partially configured / stale**, with a deployed frontend and a referenced backend that did not answer health. It is not proven to be true isolated staging (A), old production-like deployment (B), or production (C); those distinctions require Render service/database settings. The “staging” subdomain and prior staging branch/tag history do not establish target isolation.

Reuse is plausible and preferred. The minimum likely work is to inspect/restore the existing backend service, point it only at a new isolated staging PostgreSQL database, inject staging-only configuration, deploy this branch through an explicitly controlled staging deployment, and add monitoring/test identities. Do not create a duplicate frontend/backend stack unless Render confirms these services are retired or cannot support the required branch/runtime. A **new isolated database only** may be sufficient for database isolation if existing services are retained and the backend can safely be configured for the current code; this cannot be confirmed until service configuration and health are inspected.

The current branch has a new rate-limit migration, mandatory production staff MFA, PostgreSQL-backed rate limits, pagination/DTO changes, DB-side billing aggregation, lazy-loaded frontend, modified Nginx policies, runtime DB target checks, and observability. Before running this branch in the existing services:

1. Verify the Render service IDs, deployment branch, last deployed commit, plan/instance settings, build/start commands, environment-variable *names*, health-check path, and auto-deploy policy in the Render dashboard.
2. Verify the injected DB target privately. If it is Neon production, stop and do not deploy or test against it. Provision/select a separate staging DB and use distinct runtime, migration and direct listener identities.
3. Confirm staging host/config is accepted by the branch’s DB target guard. Current production-mode validation is Neon-specific; do not disable or bypass it. If the old host is Render PG, a reviewed staging-only configuration path may be needed before the branch can boot against it.
4. Apply the new migration only to an empty isolated staging DB using migration credentials; deploy two backend instances only after resolving the process-local Socket.IO adapter gap if cross-instance revocation/broadcast is under test.
5. Deploy the static frontend with its API base configured to the staging API; check actual edge headers/cache policy. Seed only deterministic synthetic data after all outbound notification/payment/verification integrations are sandboxed or disabled.

## CI/CD and branch trigger behavior

`.github/workflows/ci-cd.yml` runs on pushes only to `main`, `redesign`, and `fix/audit-issues`. Pull requests trigger it only when targeting `main` or `redesign`. A direct push to `feat/next-improvements` therefore triggers **no GitHub Actions workflow from this file**. Opening/updating a PR from this branch to `main` or `redesign` runs test/build CI; the image jobs currently use `push: false` and do not deploy. No Render deploy hook, Render Blueprint, provider workflow, or automatic deploy configuration is tracked.

Whether Render auto-deploys on a push to its configured branch is an external dashboard setting. It cannot be determined from Git. Do not push this branch to test that setting. Inspect the service’s selected branch and auto-deploy toggle before any later push; the current CI behavior is not proof of Render deployment behavior.

## Multi-instance and edge

The observed frontend is served behind Cloudflare and Render infrastructure and is already a realistic public HTTPS/network path for the frontend. The response confirms the frontend service is reachable, not that API routing/health is working or that production-equivalent cache/security rules are correct. Backend two-instance support is not established. The current repository does not configure a shared Socket.IO adapter, so cross-instance broadcast/revocation remains a known limitation. If Render cannot scale two instances, retain it for single-instance edge/API and weak-network checks, and use a separate isolated staging host for two-instance behavior; do not call the single-instance result horizontal-scale evidence.

## Exact safe next step

An operator with Render dashboard access should privately verify (1) both service IDs and their selected branches/commit, (2) backend health and start/build configuration, and (3) backend database provider, safe database name, host category, connection mode and role identity. Do not disclose secret values. If the backend target is Neon production or cannot be proven isolated, make no deployment or data change; provision a separate staging database and prepare a reviewed staging-only connection configuration. After identity is confirmed, restore backend health and run one read-only health check. Only then prepare a staging deployment approval and staged test data plan. No migrations, seeds, synthetic-data writes, deployments or load tests are authorized by this discovery.
