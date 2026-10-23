# OWASP ASVS 5.0-oriented matrix

Status is source evidence only: **Observed** means control is visible in code/config; **Partial** means present with material gaps; **Unverified** means deployment/integration or adversarial behavior was not tested. This is not an ASVS certification.

| Area / ASVS concept | Status | Evidence / gap |
|---|---|---|
| V2 Authentication | Partial | Password policy/hash, login throttles, MFA capability/challenges; MFA not mandatory for privileged roles; end-to-end reset/verification integration not tested. |
| V3 Session management | Partial | 30m bearer JWT, DB status/authVersion revalidation, logout/revoke. Token/user live in sessionStorage; XSS can exfiltrate. Socket stale-session/multi-node revocation not fully tested. |
| V4 Access control | Partial | Role guards, `requireOwnedPatient`, doctor self-queue restrictions and clinical access helpers found. Full route-role/BOLA matrix absent. |
| V5 Validation / business logic | Observed/Partial | Strict Zod validation in sensitive routes, appointment transaction/slot controls and database uniqueness; every route and replay/idempotency case not tested. |
| V6 Stored cryptography | Partial | bcrypt, JWT signing secret, medical/MFA encryption keys configured via env. Runtime key handling, rotation, backup and algorithm policy not independently verified. |
| V7 Error handling / logging | Partial | Central middleware/logger and event audit. `console.error` remains in route handlers; sensitive-value redaction/retention coverage not verified. |
| V8 Data protection / privacy | Partial | Patient ownership and result release checks; sensitive APIs are auth-protected. SessionStorage bearer; overbroad Patient relation projection; cache and privacy retention controls not deployment-tested. |
| V9 Communications | Partial | CORS allowlist, Helmet, CSP/Nginx headers; production TLS/HSTS and edge config not in general Compose. |
| V10 Malicious code / files | Partial | File signature/type and 10MB limit; in-memory upload, no evidenced malware scanning/quotas. |
| V11 Business logic | Unverified | Appointment collision safeguards and payment retry logic reviewed, but concurrency, idempotency, refund race and external timeout tests not run. |
| V12 Files/resources | Partial | Search limits and some pagination; unbounded queue, history and billing analytics routes remain. Upload memory consumption risk. |
| V13 API / web services | Partial | Auth, role checks, strict schema in many routes, CORS and request IDs. Rate limit store is process-local; excessive projection and endpoint paging gaps. |
| V14 Configuration | Unverified | Example configs and CI inspected; live env, TLS, host, HSTS, role grants, secret manager, backup and provider console settings not inspected. |
| V16 Secure architecture | Partial | Modular route/service layers, Prisma parameterization, direct revocation listener. Multi-instance Socket.IO/rate-limit coordination and HA topology unprovided. |
| V17 Security testing | Unverified | CI has functional tests and build/lint; no evidenced DAST, SAST, SCA gate, load test, restore drill or complete role matrix. npm audit currently reports High findings. |

**Launch gate:** require deployment evidence for TLS/HSTS, DB least privilege, secret handling, MFA policy, sanitized logs, access matrix, restore, dependency remediation/acceptance and monitoring. No control status here implies regulatory certification.
