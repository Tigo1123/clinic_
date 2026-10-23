# Remediation roadmap

## Gate 0 — Before first real patient

1. Confirm production hosting has managed TLS/redirect/HSTS, trusted proxy hops, CSP/security headers, static compression/cache policy and no public backend/DB ports.
2. Verify actual runtime, migration and PostgreSQL LISTEN identities/privileges; prove least-privilege runtime role and pooler/direct connection topology without exposing credentials.
3. Enforce MFA for admin and privileged staff; test login, reset, disable/revoke and recovery with isolated accounts.
4. Resolve or explicitly accept the High dependency advisories; rebuild production images, run tests/lint and image/lockfile scans.
5. Minimize appointment patient projections and ensure no-store caching on all authenticated medical APIs at the edge. Add role-specific response/ownership regression checks.
6. Bound/paginate patient history, pending/doctor queues and admin listing endpoints. Replace billing analytics full-table in-memory aggregation with bounded SQL aggregation/time filters.
7. Configure sanitized metrics/alerts, external uptime and backup freshness. Assign a human on-call and incident contact.
8. Confirm SMTP/verification/Google provider behavior, secrets injection, domain ownership and account recovery path.
9. Restore a production-like backup into isolated environment, verify FK/migration/files and measure RPO/RTO; publish tested runbook.
10. Run role-isolated functional browser matrix and k6 staged smoke → 50 → 100 VUs using synthetic data only; no progression if p95/errors/pool/CPU thresholds fail.

## Gate 1 — Controlled pilot

Limit staff/patient group and daily appointment volume; one clinic/site; staffed support window; daily review of 5xx, p95, queue lag, DB pool, audit events and backup status. Document paper/offline fallback, downtime communication and manual reconciliation for appointments/payments. Do not claim support for >100 concurrent users from this audit. Validate weak Android and older laptop in clinic networks.

## Gate 2 — Growth

Only after load trend and high availability targets require it: add backend replicas with Socket.IO adapter and shared distributed limiter, verify sticky WebSocket/load balancer behavior and cross-instance auth revocation. Add Redis only if these capabilities are not met by an existing managed shared store. Increase DB capacity/pool based on observed wait and query plans; keep a staged 250/500/1000 campaign with a stop gate at every step.

## Safe-to-defer after pilot

Formal multi-region failover, 1000-VU capacity, Redis for unneeded features, advanced distributed tracing, and broad cosmetic bundle optimization can wait if single-clinic measured SLOs hold. Mandatory safeguards—TLS, access controls, backups/restore, dependency review, patient data minimization and monitoring—cannot.
