# Production architecture recommendation

Hosting the entire clinic system on one developer PC is **not acceptable** for real patient care. Power/ISP outages, residential IP changes, NAT/firewall issues, disk loss, physical compromise, no failover, uncontrolled updates and no on-call monitoring can make records and booking unavailable or expose sensitive data. A workstation is suitable for development only.

## Proportionate managed topology

1. **Frontend:** build static assets in CI; serve from a CDN or managed static host with TLS, immutable caching for fingerprinted assets, short/no-cache HTML, gzip/Brotli and security headers. Never cache authenticated API/medical responses publicly.
2. **Edge:** managed TLS endpoint/reverse proxy with HTTPS redirect, HSTS ownership, request/body/time limits, canonical host, WAF/rate protections, health checks and Socket.IO upgrade support. Ensure `trust proxy` reflects the actual hop count.
3. **Backend:** managed Node 22 container/service with health probes, graceful rollout, restart policy, resource limits, private env/secret injection and structured telemetry. Start with one appropriately sized instance only if clinic owner explicitly accepts short maintenance/restart downtime; for availability use at least two after adding a shared Socket.IO adapter and distributed rate limiter. HTTP API is stateless except for PostgreSQL auth state; uploaded files require durable private storage.
4. **Database:** managed PostgreSQL (Neon is current target per prior release decisions) with measured pooled runtime connections, separate migration identity and direct/session-capable LISTEN role, TLS verification, least privilege, backups/PITR and query/connection monitoring. Do not expose DB to the public internet or frontend.
5. **Uploads:** move from local container volume to private object storage with scoped access, retention, backup and malware scanning if clinical documents are uploaded. Signed short-lived access only after authorization.
6. **Monitoring/backup:** central metrics/logs/traces with redaction, uptime checks, alert routing, documented backup retention and quarterly restore drill.

Redis is not required merely for fashion. It becomes justified if multiple backend instances need Socket.IO cross-node delivery, globally shared rate limiting, or other measured shared ephemeral state. Until then, one instance avoids those coordination gaps but remains a single process failure point. Horizontal scaling without those shared controls is not safe for current realtime/security semantics.

## Availability and capacity

Set a pilot service objective (e.g. 99.5% monthly excluding agreed maintenance) and owner before choosing provider tiers. Multi-zone backend and database failover, offsite backup, incident contacts, DNS/domain ownership and recovery drills matter more than a speculative 1000-VU target. No production latency or capacity has been proven by this audit.
