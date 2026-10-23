# Weak-network audit

## Method and limits

Used Chromium CDP against the local Vite production preview, with HTTP cache disabled/cleared for cold loads; warm loads reused browser-cached assets. The harness clears local/session storage on each document (including warm runs), so “warm” isolates asset-cache benefit and is not a fully persisted returning-user state. Browser viewport 390×844. Profiles matched target throughput/RTT and CPU factors. C = 6x CPU, A/B = 4x. These are lab simulations, not a Sudan carrier test; CDP does not add packet loss, jitter, carrier DNS/TLS behavior, or backend/DB latency. No API is configured in preview, so API-backed timings, retry/timeout behavior and clinical screens remain unmeasured.

## Results

| Profile | Route | Cold navigation | Cold transfer / requests | Paint / UI result | Warm nav / bytes |
|---|---|---:|---:|---|---:|
| A: 2 Mbps / 750 Kbps, 100 ms, 4x | Patient login | 2.02 s | 283 KB / 30 | usable form, no failures | 1.37 s / 93 KB |
| A | Staff login | 2.02 s | 336 KB / 35 | FCP 1.54 s; 7 usable controls | 1.24 s / 5.5 KB |
| B: 750 / 250 Kbps, 250 ms, 4x | Patient login | 4.52 s | 296 KB / 38 | usable form, no failures | 3.08 s / 93 KB |
| B | Staff login | interactive by 9.49 s | 410 KB / 35 | FCP 4.76 s, LCP 6.73 s; 7 usable controls, no failures | interactive by 6.62 s / 5.4 KB |
| C: 300 / 100 Kbps, 500 ms, 6x | Patient login | 10.00 s | 296 KB / 37 | usable form, no failures | 5.95 s / 93 KB |
| C | Staff login | interactive by 15.28 s | 320 KB / 35 | 7 usable controls by capture; no FCP/LCP observer entry, no failures | interactive by 9.34 s / 95 KB |

Evidence: [`browser-local-baseline.json`](evidence/browser-local-baseline.json), [`browser-profile-b.json`](evidence/browser-profile-b.json), [`browser-profile-c.json`](evidence/browser-profile-c.json), and longer-settle staff captures [`browser-staff-profile-b-settled.json`](evidence/browser-staff-profile-b-settled.json) / [`browser-staff-profile-c-settled.json`](evidence/browser-staff-profile-c-settled.json). Initial 600ms post-load captures showed the Suspense loading message at 4.79/11.46s. A second run waited at least 5 seconds after `load` and found the staff form interactive by 9.49/15.28s. Those are upper bounds to observed readiness, not exact first-interactive timestamps. No failed requests or overflow were recorded. Patient routes lacked an FCP/LCP observer entry despite visible/usable controls; use direct usable-control observations, not those nulls.

## Findings

- Weak mobile timing is dominated by transfer + parse/execute of 283–410 KB across initial and lazy route chunks plus multiple round trips. At C, staff login was interactive no later than 15.3s. At least one 220–264ms long task appeared in patient login on A/B/C; one 200ms+ task can make input feel delayed on low-end hardware.
- No app-level retry button/error can be assessed without a failing backend. Loading and empty-state quality for authenticated roles is unmeasured. Disabled state/double-submit and timeout semantics need controlled API/browser tests.
- Poor connectivity should be expected to make staff login materially slower than patient login due lazy/shared runtime dependencies. A first-load 300 KB compressed body is ~8 seconds of raw transfer at 300 Kbps before RTT, TLS, server wait and CPU; observed end-to-end browser navigation is higher and shows that effect.

No packet-loss behavior was simulated. Do not infer that offline or reconnect works from successful local asset loading.

## Pass 2 staging-edge status — 22 October 2026

The requested Profile B and C were **not rerun against staging** because no staging frontend/API deployment or TLS edge existed. The figures above remain Pass 1 localhost-only measurements; they are not repeated as staging results. Dashboard/API arrival, retry and timeout behavior remain unmeasured. First provision the production build and backend behind the intended edge, then repeat cold-cache Profile B (750/250 Kbps, 250 ms) and Profile C (300/100 Kbps, 500 ms, 6x CPU) with synthetic identities and request capture.

## Pass 3 status

Managed staging still does not exist in repository/environment evidence. Profile B and C were not run; no staging login/dashboard usable time, transfer, request count or error/retry result exists. Pass 1 localhost baselines remain the only measurements (Profile B patient ~4.68s, staff ~5.60s; Profile C patient ~10.20s, staff ~13.45s as recorded in the Pass 1 readiness report). They cannot quantify network, edge or API contributions for deployment. Stop until a staging-only frontend/backend and TLS edge with synthetic accounts are provisioned. See [staging-weak-network-results.md](staging-weak-network-results.md).
