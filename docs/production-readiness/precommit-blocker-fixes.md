# Pre-commit blocker fixes

This pass preserves bounded API requests and existing JSON array response shapes. Staff queues and staff administration expose “Load more” controls, with 50 rows per request. Refresh re-fetches the pages the operator has already opened, and stale responses cannot replace a newer request. Laboratory result versions retain monotonic reconciliation. Doctor configuration uses explicit 12-row server pages with server-side search/status filtering and an `X-Total-Count` header. Schedule selection loads additional doctor choices on demand; a directly selected doctor is fetched by ID. Patient medical history also exposes its later pages.

Pagination response headers (`X-Page`, `X-Page-Size`, `X-Has-More`, and optional `X-Total-Count`) are exposed through CORS for separate frontend/API origins. Queue DTOs retain laboratory MRNs. Emergency priority is part of the PostgreSQL page-membership query, followed by status, appointment time, and unique ID. Lab results order by order date descending and ID descending. Billing analytics returns every doctor workload entry, while appointment counts and financial aggregates remain in PostgreSQL.

Rate-limit cleanup runs in the background at most once a minute per process. Failure does not bypass enforcement or fail otherwise valid requests. A non-sensitive `rate_limit.cleanup_failed` warning occurs at most once per five minutes per process; monitor this event and the bucket table size.

## Destructive local staging tools

These scripts remain restricted to the existing disposable loopback databases on port 55439. They cannot target Neon or a remote database. Obtain the connection URL privately; do not put it in a command history or report.

After privately setting `STAGING_MIGRATION_URL` or `TEST_DATABASE_URL`, explicitly confirm the action:

```sh
export STAGING_TOOL_ENV=isolated-local-staging
export CONFIRM_STAGING_DESTRUCTIVE_ACTION=I_CONFIRM_DISPOSABLE_STAGING_DATA
node tests/production-readiness/seed-staging-data.mjs seed
# OR remove only synthetic stg-* records:
node tests/production-readiness/seed-staging-data.mjs clean
# OR drop only test_* / schedule_workflow_* schemas in loopback clinic_test:
node tests/production-readiness/cleanup-test-schemas.mjs
```

Missing/wrong confirmation, production NODE_ENV, unexpected host/database/port, and connection-string overrides are refused before connection. Read-only query-plan and restore verification commands do not require destructive confirmation.

## Load target safety

No managed target is approved by this document. First verify database isolation, sandbox outbound effects, and configure an independent non-secret identity marker on the disposable backend:

```sh
DEPLOYMENT_ENV=staging
LOAD_TEST_TARGET_ID=disposable_staging_review_2026
```

The backend serves that marker at `/api/health/load-test-target` only when explicitly configured for local/staging. This is an operator-attested isolation marker, not proof of provider topology. Never configure it on production. The workload verifies the returned environment and marker before any VUs start. Redirects are disabled. Origins containing credentials, paths, queries, known production names, or hosts in the mandatory operator production denylist are refused. Staging requires HTTPS, an exact expected hostname, explicit environment, and separate load confirmation. A hostname containing “staging” is insufficient.

Set all actual production API/frontend hosts in `LOAD_TEST_PRODUCTION_HOSTS`; the placeholder below is illustrative. Supply disposable persona tokens privately through `LOAD_TEST_PERSONAS_JSON`.

```sh
export LOAD_TEST_ENV=staging
export BASE_URL=https://isolated.example.test
export EXPECTED_STAGING_HOST=isolated.example.test
export LOAD_TEST_PRODUCTION_HOSTS=live.example.test
export EXPECTED_LOAD_TEST_TARGET_ID=disposable_staging_review_2026
export CONFIRM_LOAD_TEST=I_CONFIRM_ISOLATED_STAGING_LOAD
export LOAD_STAGE=smoke
k6 run tests/production-readiness/k6-clinic-reads.js
```

Read-only bearer-token smoke tests need no write confirmation. Optional login scenarios mutate authentication/audit metadata and additionally require:

```sh
export CONFIRM_LOAD_TEST_WRITES=I_CONFIRM_DISPOSABLE_LOAD_TEST_WRITES
```

Future write scenarios must call `assertLoadTarget(env, { writes: true })` before making writes. None are added in this pass.

Local testing requires a separate intentional mode and the matching server marker:

```sh
# Local disposable backend: DEPLOYMENT_ENV=local, LOAD_TEST_TARGET_ID set as above.
export LOAD_TEST_ENV=local
export ENABLE_LOCAL_LOAD_TEST=true
export BASE_URL=http://127.0.0.1:5000
export CONFIRM_LOAD_TEST=I_CONFIRM_LOCAL_LOAD
# Keep EXPECTED_LOAD_TEST_TARGET_ID matching the local server.
k6 run tests/production-readiness/k6-clinic-reads.js
```

Normal backend tests use loopback `clinic_test` on port 5433 by default, or an explicitly configured `TEST_DATABASE_PORT`. They do not use production connection settings.

## Verification — 23 October 2026

- Full backend suite: **696/696 tests**, 63/63 files, zero failures/skips. All 27 migrations replayed on fresh isolated schemas in a new disposable loopback PostgreSQL 18.6 cluster. Passing schemas were cleaned by the guarded test runner. The new regression file passed all seven tests.
- Full frontend suite: **51/51 files**, zero failures (the original 50 files plus the new pagination regression file). Rendered component tests reach appointment 51, schedule doctor 51, configuration doctor 61, and patient medical history beyond its first page. Shared-controller regression cases cover reception, doctor, laboratory, pharmacy, administration, and schedule selection through record 101.
- Prisma schema validation and production frontend build passed. Frontend lint exits successfully with the same six pre-existing warnings; no new warnings. Backend has no lint script.
- Fresh frontend and backend npm registry audits report zero vulnerabilities.
- Changed JS/MJS syntax checks and `git diff --check` passed. Working-tree secret checks found no real credentials, private keys, or patient data; fixtures and examples are synthetic/placeholders.
- Removed only the failed prior review PostgreSQL cluster and four inactive temporary browser audit profiles, recovering approximately 770 MiB. No repository files, user documents, other databases, or Docker volumes were removed.
- No Neon connection, deployment, commit, push, managed load test, or production change was performed. Managed deployment isolation and edge/provider configuration remain deployment checks, not evidence supplied by these local tests.
