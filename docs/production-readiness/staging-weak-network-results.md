# Managed staging weak-network results

Status: **Not run — no staging frontend/API/HTTPS edge is configured.** No deployment endpoint was probed and no synthetic login was performed.

| Profile | Patient login | Staff login | Dashboard/data arrival | Transfer/requests/errors |
|---|---|---|---|---|
| B: 750 Kbps down / 250 Kbps up / 250 ms, cold cache | N/A | N/A | N/A | N/A |
| C: 300 Kbps down / 100 Kbps up / 500 ms / 6x CPU, cold cache | N/A | N/A | N/A | N/A |

Local Pass 1 reference only: Profile B patient ~4.68 s and staff ~5.60 s; Profile C patient ~10.20 s and staff ~13.45 s. These local preview numbers do not include staging DNS/TLS/CDN/backend/database latency and are not a comparison result. Repeat with fresh browser contexts, empty storage, disabled cache, identical viewport/device profile and the same readiness criteria. Capture usable control time, first API-backed content, transfer bytes, request count, failures/retries, and separate browser/network/API timing where trace data supports it. Use synthetic identities only. No measurement is inferred here.
