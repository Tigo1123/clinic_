# Observability plan

Instrument the managed edge, Node service and PostgreSQL with one request/trace identifier. Never emit passwords, JWTs, MFA/recovery codes, full medical record values, patient phone/national ID, request bodies or uploaded file content. Prefer pseudonymous user IDs and route templates over raw path parameters.

| Signal | Alert / initial threshold | Notes |
|---|---|---|
| External uptime and readiness | page if 2 regions fail 3 checks in 5 minutes; recovery alert when stable | Liveness must remain separate from DB-dependent readiness. |
| API latency | investigate p95 >500ms for common reads or >1s workflow reads for 10m; page p95 >2s sustained | Tag by route template/role, exclude health and avoid PHI labels. Track p50/p95/p99. |
| HTTP errors | page sustained 5xx >2% over 5m; alert 4xx surge >2× baseline | Break down 401/403/429/422 without usernames/phone values. |
| Node resources | CPU >80% 10m, memory >75% limit 10m or >85% immediate; restart count >2/hour | Include event-loop lag; warn >100ms p95, page >500ms sustained. |
| PostgreSQL | connections >70% plan limit warn, >85% page; p95 query >200ms warn, >1s page; slow-query count trend | Capture pool wait, transaction duration, locks, DB CPU/storage. Alert on auth/listener disconnect. |
| Realtime | socket connection count, rejected connections, disconnect/reconnect rate, queue propagation delay | Track per instance and total; verify cross-node delivery before replica count >1. |
| Security | auth failure/credential stuffing, limiter triggers, MFA failure and account status changes | Threshold on aggregated IP/account-safe dimensions; avoid logging supplied secrets. |
| Integrations | SMTP/verification/Google failure rate and queue/retry age | Alert by provider and operation, redact addresses/tokens. |
| Backups | latest successful backup age, PITR retention and restore-drill age | Alert before policy RPO is breached. |

Current application has health endpoints, request IDs, security audit events, logger redaction and graceful shutdown; it does not itself provide full metrics/traces, event-loop lag, DB query histograms, websocket count dashboards or alert routing. Route-level `console.error` remains and needs redaction review. Use OpenTelemetry-compatible instrumentation or managed platform metrics; keep clinical values out of logs and traces. Retention/access to audit logs must be role-limited and separately backed up.
