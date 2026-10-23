# API performance baseline

No backend/API timing was measured. The local browser preview had no API origin or test DB; production and staging were intentionally not contacted. Therefore p50/p95/p99, RPS, status distribution, payload sizes and endpoint error rates are **not available**, not zero. The k6 harness in `tests/production-readiness/k6-clinic-reads.js` is prepared for disposable local/isolated staging data; it was not run because k6 and an isolated role dataset were unavailable.

| Workflow | Source route(s) | Access / data considerations |
|---|---|---|
| Liveness/readiness | `GET /api/health/live`, `/api/health/ready`, `/api/health` | Ready checks DB and revocation listener; no clinic payload |
| Staff/patient login | `POST /api/auth/login`; patient auth routes under `/api/patient-auth` | Login is rate-limited; role identities and MFA affect route |
| Doctors/services | `GET /api/patient/doctors`, `/api/patient/specialties`, `/api/billing/services` | Public/reference lists; doctor directory currently unpaginated |
| Slots/booking | `GET /api/appointments/slots`; patient `POST /api/patient/appointments`; public OTP booking `/api/appointments/book` | Slot availability reads schedules/exceptions/bookings; booking has locking/uniqueness, mutation not included in read-only suite |
| Patient dashboard/history | `/api/patient/me`, `/api/patient/appointments`, `/api/patient/medical-records`, `/api/patient/prescriptions`, `/api/patient/lab-results` | Auth + ownership; several history queries unbounded |
| Admin users/catalogs | `/api/auth/users`, `/api/admin/doctors`, `/api/admin/catalog/services`, `/api/billing/analytics` | Admin-only; users/doctors list and analytics aggregation need bounded queries |
| Doctor queue | `GET /api/appointments/queue/:doctorId` | doctor self-queue enforced; queue includes patient relation and billing state; no take/pagination |
| Reception | `GET /api/appointments/pending`, `GET /api/patients/search` | Pending queue returns full patient and doctor relations; unbounded pending list |
| Pharmacy | `GET /api/pharmacy/formulary?page=1&pageSize=20`, `/api/records/prescriptions/pending` | Formulary paginated; pending queue requires size confirmation |
| Lab | `GET /api/records/lab-orders/pending`, `/api/records/lab-orders/history` | role-gated; history uses a cap in inspected route, pending should be bounded/confirmed |
| Billing | `/api/billing/...` invoice/payment/refund routes | Writes excluded; retry/idempotency review required before production traffic |

## API baselining procedure

Use an isolated staging DB cloned from synthetic fixtures, test identities scoped to each role, and read-only API scenarios first. Record endpoint-tagged RPS, p50/p95/p99, error/timeout/status counts, response bytes, DB pool occupancy, query time and event-loop lag at 10/50/100 VUs, only progressing after no data leakage, saturation or threshold failure. Mutating booking/payment scenarios require disposable data, idempotency keys or deterministic cleanup on the isolated DB only. Never point the harness at production. Suggested initial gates: <1% HTTP failures; p95 common reads <500ms and heavier workflow reads <1s; investigate any p99 >2s or sustained 5xx.

## Slow dependency and retry behavior (source review)

- Readiness (`/api/health/ready`) pings PostgreSQL and also requires the revocation LISTEN service to be ready; it returns 503 on failure. Liveness is separate and DB-free. Graceful shutdown stops the listener, closes Socket.IO/server and disconnects Prisma.
- SMTP connection timeout defaults to 10 seconds. `sendBookingConfirmation` is awaited after booking commits; SMTP failure is caught/logged, but a slow provider can delay the client response after the appointment has already been stored. A client retry may then face the already-taken slot; no end-to-end idempotency replay test was run.
- SMS defaults to disabled unless an application transport is supplied; the public OTP route is unavailable in production, and authenticated patient booking is intended. Provider delivery behavior and retries were not exercised.
- Google credential verification depends on Google's key/discovery availability and maps network-style errors to 503; no explicit application-level timeout/load test was found.
- Payment/refund paths contain database transaction timeouts and compare-and-claim conflict checks. Double-click, mid-response disconnect and replay of identical payment intent were not tested; do not assume generic HTTP retry is idempotent.
- Socket.IO client has reconnect behavior; server auth/revocation is checked, but cross-instance broadcasts and stale-session disconnect during network partitions were not validated.

## Pass 2 status — 22 October 2026

No deployed staging API was available, so endpoint p50/p95/p99, RPS, status distribution, payload transfer and error rate remain **not measured**. Do not use local query-plan execution times as API response latency. No 10/50/100+ VU stage ran. The focused integration suite had 235/235 passing tests after the lab billing projection correction; the complete suite is pending the final serialized run.

Required before capacity claims: run a workload mix through a staging edge with controlled synthetic accounts, capture route-template request metrics, Node event-loop/CPU/memory, Prisma/pool waits and DB CPU/connection telemetry, then report per-route percentiles.

## Pass 3 managed API status

No managed staging API endpoint was configured or contacted. Login, MFA, doctors, slots, booking, patient dashboard/history, doctor/lab/pharmacy queues, invoices and analytics p50/p95/p99, payload sizes and status/error rates remain **not measured**. Do not infer deployed latency from local query plans or localhost browser timings. After staging is provisioned, capture unloaded per-route baselines and payload sizes before k6; use only synthetic identities and keep analytics at realistic low frequency. See [managed-load-results.md](managed-load-results.md).
