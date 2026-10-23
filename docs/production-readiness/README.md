# Shifa production-readiness audit

The original audit was read-only; remediation pass 1 then changed application and test code as documented in [remediation-pass-1.md](remediation-pass-1.md). No production database was contacted or written. Measurements from local production builds are separated from staging/production evidence throughout.

| Report | Purpose |
|---|---|
| [Executive summary](executive-summary.md) | Verdict and decision points |
| [Architecture](architecture.md) | Repository topology and request paths |
| [Frontend performance](frontend-performance.md) | Build artifacts, code splitting and browser baseline |
| [Weak network](weak-network-audit.md) | Cold/warm throttling results |
| [Low-end device](low-end-device-audit.md) | CPU, viewport and rendering evidence |
| [API performance](api-performance.md) | Endpoint inventory and measurement limits |
| [Database performance](database-performance.md) | Query, index and pool risks |
| [Load test plan](load-test-plan.md) | Safe staged k6 suite and run gates |
| [Security audit](security-audit.md) | Defensive findings by domain |
| [OWASP ASVS matrix](owasp-asvs-matrix.md) | Control-level evidence/status matrix |
| [Dependency audit](dependency-audit.md) | Lockfile vulnerability results |
| [Secret scan](secret-scan-summary.md) | Redacted working-tree/history scan summary |
| [Production architecture](production-architecture.md) | Recommended hosting topology |
| [Observability](observability-plan.md) | Metrics, logs and alert thresholds |
| [Backup/recovery](backup-recovery.md) | RPO/RTO targets and restore drill |
| [Risk register](risk-register.md) | Ranked, reproducible findings |
| [Remediation roadmap](remediation-roadmap.md) | Launch sequence and pilot gates |
| [Remediation pass 1](remediation-pass-1.md) | Implemented changes, evidence, residual risks and staging gates |
| [Remediation pass 2](remediation-pass-2.md) | Staging-only migration, synthetic database and restore evidence; explicit unmeasured deployment/load gates |
| [Remediation pass 3](remediation-pass-3.md) | Managed staging gate; no managed target was configured, so deployment/load testing stopped safely |
| [Existing staging discovery](existing-staging-discovery.md) | Read-only discovery of the previously deployed Render frontend/API and reuse safety |
| [Managed staging architecture](managed-staging-architecture.md) | Exact isolated topology and provisioning requirements |
| [Edge security verification](edge-security-verification.md) | Actual deployed TLS/header/cache checks (not yet run) |
| [Managed load results](managed-load-results.md) | VU stages and measured outcomes (all not run) |
| [Auth burst results](auth-burst-results.md) | Multi-instance authentication bursts (not run) |
| [Booking contention results](booking-contention-results.md) | Synthetic slot contention (not run) |
| [Managed restore results](managed-restore-results.md) | Managed provider restore drill (not run) |
| [Managed database role verification](managed-database-role-verification.md) | Intended grants and provider verification status |
| [Staging weak-network results](staging-weak-network-results.md) | Profile B/C staging browser measurements (not run) |
| [Migration replay results](migration-replay-results.md) | Fresh-schema replay and drift verification |
| [Database query plans](database-query-plan-results.md) | Synthetic local EXPLAIN ANALYZE evidence |
| [Staging load results](staging-load-results.md) | Concurrency table with unrun stages marked N/A |
| [Restore drill results](restore-drill-results.md) | Local logical backup/restore reconciliation |

Browser evidence and the audit-only harness are in [`evidence/`](evidence/) and [`../../tests/production-readiness/`](../../tests/production-readiness/). Authenticated/API and load testing require isolated staging, disposable identities and explicit operational safeguards; they were not run against production.

See [pre-commit blocker fixes](precommit-blocker-fixes.md) for current pagination behavior and the required staging tooling confirmations.

## Commands and checks

- Original `cd frontend && npm run build` — passed with an entry chunk >500 KB; after pass 1 the entry chunk is 354.6 KB raw and the largest emitted JS chunk is 491.7 KB.
- `cd frontend && npm test` — passed, 50 tests.
- Original `cd frontend && npm run lint` — exit 0 with warnings; after pass 1 it exits 0 with six remaining warnings (fast-refresh export, control-character regex, duplicate translation keys).
- `cd backend && npx prisma validate` — passed (schema-only validation; no DB connection).
- `node --check` on both audit harnesses and `git diff --check` — passed.
- Original `npm audit --json` — frontend 2 High and backend 3 High; after pass 1 fresh registry audits report zero advisories in both lockfiles.
- Chromium CDP local production-preview profiles A/B/C and viewport captures at 360/390/768/1024/1366px — completed. No authenticated roles or API calls in this browser setup.
- Remediation pass 1: frontend tests 50/50; production build and Prisma validation passed; frontend/backend lockfile audits report zero advisories. Readiness-poll captures are in `evidence/remediation-profile-b-readiness.json` and `evidence/remediation-profile-c-readiness.json`. Backend integration tests/migration replay were not run because no isolated PostgreSQL test database was available.
- Pass 1 had no isolated PostgreSQL. Pass 2 replayed all 27 migrations and ran the complete backend suite on disposable local PostgreSQL; frontend suite/build/lint, local EXPLAIN ANALYZE, local role checks and a synthetic logical restore drill also ran. Staging HTTP/API benchmarks, k6 stages, deployed edge headers/TLS, provider DB role/pool verification and provider recovery objectives remain unmeasured; no production systems were contacted.
- Pass 3 found no managed staging endpoint, managed DB target, staging secret configuration, DNS or monitoring target. It stopped before deployment probes, load testing, auth, migration, or data writes. Managed capacity remains 0 demonstrated VUs; all cloud edge/pool/recovery checks remain unverified. See [remediation-pass-3.md](remediation-pass-3.md) for the exact provisioning gate.
# Pass 2 status

See [remediation-pass-2.md](remediation-pass-2.md) for the evidence-based staging verification summary. Local migration replay and synthetic restore succeeded; no production service was accessed. No staged HTTP, k6 load, deployed-edge, or provider-recovery result is claimed. Verdict remains **A — NOT READY FOR PRODUCTION** until the listed infrastructure and security gates are verified.
