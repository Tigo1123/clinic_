# Safe load-test plan

`tests/production-readiness/k6-clinic-reads.js` was added as an audit test artifact only. It defines smoke 10 VUs, normal 50, busy 100, high 250, stress 500 and upper 1000 stages in that order. It exercises health, patient dashboard/doctor/history reads, doctor queue, pharmacy formulary/pending prescription reads, lab pending queue and receptionist pending/search reads. Thresholds: HTTP failures <1%; p95 auth <1s; common reads <500ms; heavier reads <1s; summaries include p90/p95/p99. It was not run: `k6` binary and isolated staging role accounts were unavailable. No concurrency is demonstrated.

## Safety and run gates

- Follow the exact confirmation, host pin, production denylist, and independent server-marker gates in [pre-commit blocker fixes](precommit-blocker-fixes.md#load-target-safety). Local mode requires separate opt-in. Never set production as a test target.
- Prefer preissued short-lived staging bearer tokens. Optional login workload requires one unique disposable account per planned VU; its login attempts and security/audit metadata can change in staging. Store credentials/tokens in a mode-0600 file or CI secret; do not place them in shell history, report artifacts or logs.
- No booking, dispensing, payments, records, file upload or other clinical mutation is included. Responses and credentials should not be written to k6 verbose output. Use synthetic patient/test identities only.
- Progressively run `smoke`, `normal`, `busy`, `high`, `stress`, then `upper`; never skip ahead. Require operator review of prior reports, DB CPU/connection headroom, alert silence, error rates, rollback window and capacity owner before each increase. 250/500/1000 are design targets only, not recommendations to run without explicit staging capacity approval.
- A staging-like volume distribution is needed; empty tables produce misleadingly fast plans. Seed synthetic non-production records in isolated DB with reproducible cleanup, not production data.

Example (environment variables injected securely; placeholders only):

```sh
LOAD_TEST_ENV=staging BASE_URL="$STAGING_URL" \
EXPECTED_STAGING_HOST="$STAGING_HOST" LOAD_STAGE=smoke \
LOAD_TEST_PRODUCTION_HOSTS="$PRODUCTION_HOST_DENYLIST" \
EXPECTED_LOAD_TEST_TARGET_ID="$STAGING_PUBLIC_TARGET_MARKER" \
CONFIRM_LOAD_TEST=I_CONFIRM_ISOLATED_STAGING_LOAD \
LOAD_TEST_PERSONAS_JSON="$DISPOSABLE_PERSONAS_JSON" \
k6 run tests/production-readiness/k6-clinic-reads.js
```

Capture timestamp, build commit, environment, stage, VUs, RPS, endpoint p50/p95/p99, bytes, status distribution, timeouts, pool wait, DB CPU/query latency, Node CPU/heap/event-loop delay and websocket counts. No run was performed, so no status rate or p95 claim is made.

## Pass 2 result

No staging edge, k6 executable, workload identities or monitoring collector was available. The load stages remain unrun; see `staging-load-results.md`. The maximum demonstrated concurrent-user load remains **0 VUs**. The local multi-process rate-limit counter experiment is not an HTTP load test. Do not jump to 1000 VUs; first provision staging and execute smoke, 50 and 100 only with live DB/Node headroom evidence.
