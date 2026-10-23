# Managed staging architecture and provisioning requirements

## Current state

The repository does not configure the hosted topology or its database/monitoring settings. Read-only discovery found an online Render frontend (`clinic-staging-web.onrender.com`) and a separate API hostname (`clinic-staging-api.onrender.com`) embedded in its public bundle. The frontend answers HTTPS; the backend health request timed out. The API's database target, deployment branch, instance count and provider settings remain unknown. See [existing-staging-discovery.md](existing-staging-discovery.md). Reuse these services if Render dashboard verification confirms they are staging-only and they can run the current branch safely.

Pass 2 also used disposable PostgreSQL 18.6 on loopback (`shifa_stage` and `shifa_restore`), direct connections, no pooler, and synthetic local fixtures. These resources are not managed staging and do not provide managed DB behavior or provider telemetry. A separate managed staging database may be all that is needed if the existing backend/frontend are healthy and safely reconfigurable; this is not yet confirmed. No credentials or database URLs are recorded here.

## Required isolated topology

```text
Synthetic browser clients
        |
        v
Staging-only DNS + HTTPS edge/CDN (single HSTS owner)
        |                              |
        | static hashed assets         +--> static frontend hosting
        v
Staging load balancer / reverse proxy
        |
        +--> Node 22 backend instance A ----+
        +--> Node 22 backend instance B ----+--> managed staging PostgreSQL
        |                                    |     pooled runtime connection
        +--> metrics/log shipping             +--> direct, narrow LISTEN role if required
                                                   separate migration role
```

All services must use a dedicated staging project/account, staging-only DNS, distinct service identities and secrets, and outbound egress controls. There must be no route or credential reuse to Render/Neon production. Choose the production-equivalent provider and region and record their identifiers after provisioning. PostgreSQL major version must match the intended production major; Pass 2 tested 18.6 locally, while the production target major is not established by that rehearsal.

## Resource and configuration requirements

- Managed PostgreSQL: empty staging database, dedicated schema, TLS certificate validation, documented server/role connection limits, pooled runtime URL and direct session URL if needed, connection/query/lock telemetry, automated backups/PITR configuration, and restore to a separate disposable database. Confirm provider’s pooler transaction/session behavior and that listener traffic uses a direct session connection.
- Backend: two identical Node 22 instances behind one staging entry point, health/readiness probes, graceful shutdown, bounded DB pool per instance, same staging secrets, no sticky-session dependency. Socket revocation across instances requires a shared Socket.IO adapter; Pass 2 found the current socket state process-local, so do not claim multi-instance socket support before resolving and testing this.
- Frontend: production build on staging-only host and origin. No production API base URL, OAuth callback, SMS/email destination, or payment endpoint.
- Edge: TLS termination at one declared owner; HTTP redirect; HSTS only on staging HTTPS domain; CSP, X-Content-Type-Options, Referrer-Policy and frame protections; restricted CORS; gzip/Brotli; immutable caching for hashed assets; revalidation for HTML; authenticated/PHI responses `private, no-store` with CDN bypass.
- Monitoring: request latency/status, Node CPU/RAM/event-loop lag/restarts, process uptime, DB active/idle/waiting connections and query/lock latency, limiter events, auth failures, socket counts/reconnects, and external integration failures. Redact credentials, bearer tokens, MFA secrets and clinical payloads.
- Integrations: use a mail sink and verification-provider sandbox or disable egress with explicit staging-safe settings. Disable SMS and real payment processing. Synthetic values must not route to real recipients.
- Synthetic users: dedicated fake ADMIN, DOCTOR, RECEPTION, PHARMACY, LAB and PATIENT identities. Passwords generated for test use and held in secret storage; no production identities.

## Environment variables (names only)

Use staging secret manager entries for `DATABASE_URL`, `DIRECT_URL`/direct listener URL as required, `RUNTIME_DATABASE_ROLE`, `JWT_SECRET`, MFA/encryption keys, and test account credentials. Configure staging-only `NODE_ENV`, `FRONTEND_ORIGIN`/CORS allowlist, `STAFF_MFA_POLICY=required`, shared PostgreSQL rate-limit store, proxy trust hop count, logging/metrics exporter and provider-specific pool limits. Disable real notification/payment integrations and select a safe verification sandbox. The exact variable names must be reconciled against the deployed config before provisioning; do not copy production secret values.

The current production config pins database hosts and identity to Neon conventions. A different managed staging provider requires a separately reviewed staging allowlist/configuration path that keeps production target validation strict. A Neon staging database must be in a distinct project/database with independent credentials and target pins. This report does not authorize either choice or any production connection.

## Provisioning gates

1. Record provider, account/project ID, region, DNS names, database name/schema, PostgreSQL version and resource tier using non-secret metadata.
2. Confirm network isolation, egress restrictions, secret separation and no production integrations.
3. Confirm pooled and direct connection modes, TLS verification, role identity, connection limits, backup retention and restore destination.
4. Create roles per [managed-database-role-verification.md](managed-database-role-verification.md); prove negative grants.
5. Only then replay migrations and seed synthetic data. The migration and synthetic seed steps remain staging-only and require a separate operational run record.

## Cleanup

Use provider-supported deletion of the staging project/database and staging app resources after exporting approved redacted reports. Before cleanup, verify account/project/database identifiers from the provider console/API and ensure the target is the disposable staging resource. Revoke staging credentials and remove staging DNS. Never use a production endpoint or shared account cleanup command. Cleanup was not performed because no managed staging resource exists.
