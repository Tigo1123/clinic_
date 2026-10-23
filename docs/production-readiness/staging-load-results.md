# Staging load results

No staging HTTP deployment or k6 load stage was available during Pass 2. These are **not measured values**:

| VUs | p50 | p95 | p99 | Error % | RPS | DB conns | CPU | RAM | Result |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 10 | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | Not run |
| 50 | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | Not run |
| 100 | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | Not run |
| 250 | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | Not run |
| 500 | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | Not run |
| 1000 | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | Not attempted |

Maximum stable concurrent users demonstrated: **0**. First failed concurrency level: **none; no stage executed**. p95 degradation threshold: **not measured**. No concurrency claim is supported. k6 is not installed in the environment; an isolated staged backend/frontend, synthetic credentials, and live DB/Node monitoring are also missing. The test suite artifact remains read-only clinic-workload requests; booking/mutation and login-burst cases require a separate disposable workload design with safe unique staging identities.

The local PostgreSQL query plans and cross-process rate-limit adapter experiment do not represent HTTP user concurrency or a managed pooler. Do not extrapolate their timing to production. The existing k6 script currently covers login (when disposable credentials are supplied), health, patient dashboard/doctor/history reads, doctor queue, pharmacy formulary/prescriptions, lab queue, reception pending/search. It does **not yet** cover slot lookup/booking contention, invoice/payment reads, billing analytics, OTP/MFA/reset bursts, websocket populations, or safe disposable mutations. Extend and review those scenarios before treating it as the requested full clinic workload.
