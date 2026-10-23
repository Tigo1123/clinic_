# Security audit

Defensive source review using OWASP Top 10 / ASVS 5.0 concepts. No penetration test, authenticated role-matrix test, production host/header inspection, secret-manager review or provider configuration review was performed. “Implemented” below means visible in repository source, not independently verified in deployment.

| Domain | Evidence and status | Risk / required check |
|---|---|---|
| Authentication | Password policy enforces 10+ characters, upper/lowercase/digit; bcrypt hashing, short-lived HS256 JWTs, authVersion/status check in DB on protected requests. Staff MFA is supported and challenged when enabled. | MFA is optional; enforce for admin and privileged staff before launch. Verify password reset/temporary-password email and rate limits with production provider. No evidence of account enumeration review for every patient recovery branch. |
| Brute force / throttles | express-rate-limit is used on login/recovery/MFA/OTP routes and IP keying accounts for proxy configuration. | Default in-memory store is per process; with multiple replicas limits multiply and can be bypassed by routing. Configure trusted proxy correctly and shared store when scaling. |
| Authorization | Auth and role middleware; patient ownership checks; doctor queue checks doctor self-ID; doctor/patient clinical access is separately guarded and documented; admin management routes are admin-only. | Need systematic role x endpoint BOLA/IDOR integration matrix with paired patient/doctor records. Inspected access controls are not a full proof. Queue data projection is overly broad. |
| Sessions | Bearer JWT stored in `sessionStorage`, 30m default; no cookie auth so CSRF exposure is limited; authVersion DB check and account-wide logout/revocation exist; patient/staff logout clears client state. | Any script injection can read bearer tokens (XSS impact). SessionStorage is not HttpOnly. Verify forced revoke across active Socket.IO session and multi-instance workers. |
| Input / injection | Many sensitive API schemas use strict Zod; Prisma query parameters avoid string-built SQL in reviewed paths; upload signature verification and size cap exist. | Audit every route for non-strict schemas, unvalidated filters and reflected/stored content. No automated DAST was run. |
| XSS / HTML | React escapes rendered text; Nginx CSP excludes arbitrary scripts and frames app out; Helmet supplies backend headers. | CSP `style-src 'unsafe-inline'` is present; review any HTML rendering/editor/upload path. Verify final headers at production edge (CSP on API/errors as desired). No browser XSS test. |
| CORS / transport | Exact allowed origins configured; backend disables X-Powered-By and uses Helmet. Nginx sets nosniff, frame denial, referrer and permissions policy. | TLS/HSTS are outside repo’s production topology; general Compose exposes HTTP ports directly. Verify HTTPS redirect, HSTS, proxy headers and no wildcard origins in deployed config. |
| Sensitive medical data | Patient ownership and release filtering exist for records/results; authenticated patient APIs; frontend does not intentionally persist clinical data in local/session storage except auth/user and Google onboarding token. | `include: {patient:true}` in appointment pending/doctor queues returns all Patient columns to staff UI where names/basic identifiers may suffice. Minimize projection. Prevent shared browser caching/screenshots operationally; ensure no-store headers on authenticated clinical API at edge. |
| Logging / audit | Security events and audit logs exist; logger sanitizes common secret-like field names; request IDs and audit details are recorded. | Several routes call `console.error` with error objects/messages. Review all production error logging for query/PHI leakage and standardize structured redaction. Clinical access audit completeness/retention was not proven. |
| Uploads | 10 MB memory limit, single file, MIME/signature checking for allowed formats, random server paths; access routes authenticated. | Memory buffer allows concurrent upload memory exhaustion; antivirus/content disarm and per-user quotas were not found. Review public file serving/path authorization and malware handling. |
| Dependencies | `npm audit` reports 2 High frontend and 3 High backend findings (see dependency report). | Treat Vite/source-map as build pipeline exposure; backend findings are dev-only in current container build, but CI/developer dev server remain affected. Update lockfiles in a separate tested change. |
| DB / secrets | Env examples are templates; migration and runtime configs separate some direct listener responsibilities. | Runtime DB role/privileges not inspected. Compose uses one credential for runtime and DB service. Secrets-manager access, backup access, credential rotation and Git secret scan cannot be exhaustively proven from repo. |
| Idempotency / retries | Appointment booking has transactional checks/locking and uniqueness protections. Billing paths contain retries/locking. | Client network retry/double-click and duplicate payment/booking fault tests were not run. Confirm idempotency keys/unique business references and safe response replay. |

## Top security concerns

1. Privileged staff can sign in without MFA unless each account enrolls (High policy risk).
2. XSS can steal sessionStorage JWTs and user payloads (High impact if injection exists; no XSS exploit found in this source-only review).
3. Staff appointment queue includes full Patient objects (Medium data minimization issue).
4. In-memory rate limit is not global across replicas (Medium, High for credential attack resilience under scale).
5. Production TLS, least-privilege DB identity, secret storage and edge headers are not evidenced by this repo (High deployment-verification gap).
6. High npm advisories in lockfiles require resolution/acceptance before release.
7. Uploads buffer 10 MB in memory and have no evidenced malware scanner (Medium availability/content safety).
8. Clinical access auditing/redaction completeness is unverified (High compliance/incident response gap).
9. No restore drill/operational incident runbook is evidenced (High continuity risk).
10. API role/IDOR matrix and retry/idempotency behavior have not been exercised in isolated staging.

## Security test boundary

No production or Neon access, scanning, credential attempts, destructive testing, payment attempt or clinical record operation was performed. No active exploitability claim is made for untested attack classes. See [ASVS mapping](owasp-asvs-matrix.md).

## Pass 2 verification addendum — 22 October 2026

No production system was accessed. The local required-MFA-policy exercise covered ADMIN, DOCTOR, RECEPTION, PHARMACY and LAB: password-only first login received a short-lived restricted enrollment credential; normal protected API access was denied; TOTP enrollment and subsequent challenge worked; invalid MFA was rejected; logout revocation was verified. Recovery codes were issued, but recovery-code consumption and the full disabled-account/password-reset/password-change/stale-websocket matrix were not all exercised with production-required policy.

Bearer credentials remain in `sessionStorage`, so same-origin XSS can read/replay them. Pass 2 did not change that architecture. CSP was inspected in source but not observed from a deployed edge. This remains High until a complete cookie/session design is implemented and verified or a formal risk acceptance with compensating controls is made.

Local database roles were checked on disposable PostgreSQL: runtime had no superuser, createdb, createrole, or public-schema CREATE privilege; listener had no limiter DML; migrator owned schema objects. These are local role checks only and do not establish least privilege on a managed provider. No deployed TLS/HSTS, CORS, PHI cache-control, session cookie or cross-instance socket behavior is verified.

Source-level CSP in `frontend/nginx.conf` denies framing/objects, limits scripts to same-origin plus Google Identity, and allows `'unsafe-inline'` for styles (needed by current MUI styling). The API Helmet policy is stricter for scripts but is not the HTML document policy. Neither policy was tested over a deployed TLS edge. Sensitive API handlers set `Cache-Control: no-store` where `markSensitiveResponse` is applied; comprehensive route coverage and actual intermediary/proxy behavior were not verified.

## Pass 3 managed verification status — 22 October 2026

No staging edge or managed staging credentials were configured, so no live TLS/header/CORS/cache, synthetic MFA, or two-instance authentication test was attempted. Production remains blocked pending actual response evidence for TLS/HSTS, CSP, frame protections, CORS and authenticated PHI no-store through the deployed edge. Pass 2 local role tests do not prove managed least privilege. PostgreSQL rate-limit counters were cross-worker tested locally, but route-by-route enforcement across two backend instances remains unverified. Staff MFA core was locally exercised for the five privileged roles; recovery/reset/disabled-account/stale-socket lifecycle coverage still needs staging verification. Bearer tokens in `sessionStorage` remain a High risk because same-origin XSS can read/replay them; no temporary acceptance is supported by Pass 3 evidence. See [edge-security-verification.md](edge-security-verification.md) and [auth-burst-results.md](auth-burst-results.md).
