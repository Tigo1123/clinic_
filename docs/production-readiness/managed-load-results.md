# Managed staging load results

Status: **No managed staging exists; no load stage was run.** This is an explicit safety stop, not a passing result. No API host was targeted and no test data was written.

| VUs | RPS | p50 | p95 | p99 | Error % | CPU | RAM | DB connections | Result |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 10 | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | Not run |
| 50 | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | Not run |
| 100 | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | Not run |
| 250 | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | Not run |
| 500 | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | Not run |
| 1000 | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | Not attempted |

Maximum stable concurrency demonstrated remains **0 VUs**. First degraded stage, p95 and error rate are unknown. The existing repository workload is incomplete for Pass 3: before execution extend it with disposable booking/contention and auth-burst scenarios, slots, invoices/payments and appropriately low-frequency analytics, and the requested staff role reads. Do not route these tests to production. Run one stage at a time and stop if HTTP failures reach 1%, common-read p95 exceeds 500 ms, heavier-operation p95 exceeds 1 s, pool exhaustion occurs, or sustained CPU/event-loop/memory saturation appears. Preserve these thresholds; do not tune them to pass.

Collect k6 summary plus timestamp-correlated backend and database telemetry for each stage. Include status/timeout distribution, p50/p95/p99, RPS, active DB connections/pool waits, Node CPU/RAM/event-loop lag/restarts, query latency/locks, limiter writes and socket count. No capacity estimate is substituted for measurements.
