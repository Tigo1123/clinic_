# Pharmacy initialization investigation — 30 October 2026

All patch changes are local. Nothing was committed, pushed, or deployed. The user confirmed the affected app is https://clinic-staging-web.onrender.com/ and that the staff header remains visible while Pharmacy is loading.

## Confirmed loading mechanism and remaining uncertainty

The visible staff header establishes that React startup, the staff App import, session restoration, and role selection have completed. The remaining loader belongs to `DashboardContainer`'s `Suspense` boundary around the lazy `PharmacyDashboard` import. Pharmacy API effects cannot run until that module and its dependencies have loaded and the component mounts.

**Exact request/state in the controlled deployed reproduction:** holding `https://clinic-staging-web.onrender.com/assets/PharmacyDashboard-D54PVxsT.js` leaves the import promise pending, keeps the staff header visible, and leaves the deployed page on `Loading…`. There are **zero Pharmacy API reads** in that state. This was reproduced using the deployed code in a fresh Chrome tab with synthetic staff browser storage and intercepted API fixtures; no real authenticated backend requests or patient data were accessed.

This confirms a code defect: Pharmacy's import/loading state has no recovery controls, and a pending import can park that role in Suspense indefinitely. It does **not** prove which individual asset stalled in the user's original browser. That historical network trace was unavailable. A CSS preload or another module dependency can hold the same import promise. The exact phrase `Loading page...` is absent from the current source and downloaded deployed assets; the deployed reproducer displays `Loading…`.

In a normal read-only asset check, the current Pharmacy JS and CSS returned HTTP 200 with correct MIME types; 46 JavaScript assets returned 200. The deployed Pharmacy opens when its API calls receive successful fixtures. There is no evidence of a consistently missing current Pharmacy asset.

Secondary observations: deployed `/api/public-config` on the frontend origin returns SPA HTML, while the separate API initially returned no response within a 30-second diagnostic window and later returned HTTP 200 in 1.09 seconds. These are deployment/configuration concerns, not proof of the header-visible loader's cause. Shared startup/config loading was left unchanged after the header-visible symptom was confirmed.

## Lifecycle audit

| Stage / request | Existing behavior and failure path | Final behavior / outcome |
|---|---|---|
| Pre-React `/api/public-config` | `main.jsx` waits for `loadClinicTimeZone().finally(...)`; rejection/body-parse errors are swallowed into existing fallback. A truly pending transport can delay mounting. Deployed same-origin request returns HTML. | Unchanged; already completed in the reported header-visible state. This secondary shared issue is not disguised as the Pharmacy cause. |
| Staff session / role | Staff session is read synchronously from sessionStorage in App's mount effect. No separate awaited session-readiness request. Invalid/incomplete session returns to login; valid `PHARMACIST` selects Pharmacy. | Unchanged. Patient AuthContext does not gate staff Pharmacy. |
| Pharmacy module / dependency graph | Lazy import awaited by Suspense; pending asset has no recovery action. | Explicit success, error, and pending states. Errors are localized and offer Retry. Pending imports offer Cancel; late completion cannot override cancellation. Retry reloads the document to discard a failed/pending cached module graph. |
| Pending prescriptions `/api/records/prescriptions/pending?page=…&pageSize=50` | Shared list finishes on rejection but request has no cancellation; malformed nested rows can reach rendering. | Independent paged read, payload validation, explicit localized error/Retry, abort on supersession/unmount, Cancel while pending, `finally` clears current loading. Empty copy appears only after success. |
| Reviews / custom requests `/api/records/medication-reviews/pending?page=…&pageSize=50` | Same shared-list transport behavior. | Independent paged read with the same terminal/error/cancellation rules; existing review decisions and payloads retained. |
| Catalog `/api/records/drugs` | Initial HTTP/network/shape failures become `[]`; initial failure is indistinguishable from a genuinely empty catalog. | Success or explicit localized error/Retry; pending is cancellable. Successful data is retained during failed refreshes. |
| Alerts `/api/pharmacy/formulary?page=…&pageSize=100` | Separate sequential pagination; missing `items` can become empty alerts; no abort on stale work. | Validates each page; all pages must succeed before publishing alerts. Failed page produces the alerts error, not false “no alerts.” Independent from the other panels. |
| Prescription history `/api/records/prescriptions/history` | HTTP/network/malformed responses become `[]`. Its promise is awaited by the workflow refresh barrier. | Independent success/error/pending state, localized Retry, cancellable transport/body read, no false empty history after failure. |
| Inventory tab `/api/pharmacy/formulary?page=…&pageSize=20` | On demand, not initial dashboard bootstrap. Already has a guarded `finally`, but malformed bodies can become empty data. | Validates payload, exposes localized error/Retry and Cancel, aborts superseded/unmounted requests, preserves latest-response guards and inventory actions/prices. |
| Selected medicine `/api/pharmacy/formulary/:id` | On selection. `Promise.all` makes one failed item clear every successful stock result. | Per-item independent publication; one failure does not erase the other successful stock reads. Selection cleanup aborts stale reads; visible errors have Retry. Does not block the dashboard. |
| Selected prescription `/api/pharmacy/prescriptions/:id/payment-state` | On selection. Loading already clears in `finally`, but initial errors are hidden by the earlier `!state?.invoice` return, producing misleading billing-pending copy. | Initial failures show localized error/Retry; malformed payment data is rejected; pending initial reads can be cancelled. Existing billing-review 409 states, payment/idempotency and dispensing logic are retained. |
| Batch / movement history | On-demand dialog reads, not initial page requests. Existing request-generation guards and `finally` are present. Invalid JSON could become empty history. | Successful read shapes are validated before publication. Errors remain explicit; closing the dialog invalidates stale results. A pending dialog read remains confined to that closable dialog. |
| Notifications / staff socket | Independent shared feed/socket lifecycle, not awaited by Pharmacy's import or data initialization. | Unchanged; notifications remain in the staff header. Browser fixtures block sockets rather than connect a synthetic identity to the deployed backend. |

The old workflow refresh awaited `Promise.all([prescriptions, reviews, history])` before refreshing catalog/inventory. A pending history request could hold `subscribeWorkflowRefresh` in its running state and postpone later refreshes. These reads now start independently; inventory/catalog refresh is no longer behind that barrier. No initial `Promise.allSettled` was found. There was no page-wide data-loading flag to clear with an added `finally`.

No effect dependency/remount loop was found. Development StrictMode intentionally starts and cleans up initial effects twice; superseded reads now abort. Browser checks confirm initial request counts stabilize. Existing focus-refresh deduplication and latest-response protection continue to pass.

## Status and API-client handling

Shared `apiClient`, `staffApi`, socket, auth/session storage, and the Admin/Doctor/Lab/Reception role branches were not changed by this patch. Recent API-client changes localize errors and preserve AbortError; they do not create the Pharmacy Suspense gate. The client's 401 clone/body read can itself remain pending; Pharmacy read cancellation covers the complete fetch/body operation.

Pharmacy read outcomes are explicit:

- Valid response: success, including a genuinely empty list.
- 401: existing shared session invalidation/redirect is preserved; Pharmacy never treats it as an empty successful result.
- 403/404: explicit localized error with a retry action; no session-clearing change.
- 409/429/5xx and network rejection: retryable error. Existing payment-specific administrative-review 409 responses retain their supported behavior.
- Malformed JSON or expected payload shape: explicit invalid-data error; no fabricated empty state.
- Superseded/unmounted request: aborted and ignored; cannot overwrite a newer read.
- Actual pending transport: remains honestly pending with recovery controls. **No automatic deadline is introduced.** Cancel terminates the visible loading state; Retry starts a new API read or reloads the module graph. This does not claim that a server which never responds will autonomously settle without cancellation or a deadline.

Arabic errors are authored Arabic copy; English errors are authored English copy. Raw backend exception messages are not used for the new read error states.

## Files in this patch

Production:

- `frontend/src/App.jsx`
- `frontend/src/features/pharmacy/PharmacyPage.jsx` (new)
- `frontend/src/features/pharmacy/PharmacyDashboard.jsx`
- `frontend/src/features/pharmacy/PharmacyReadFeedback.jsx` (new)
- `frontend/src/features/pharmacy/usePharmacyRead.js` (new)
- `frontend/src/services/pharmacyReads.js` (new)
- `frontend/src/features/pharmacy/PharmacyManagement.jsx`
- `frontend/src/features/pharmacy/PharmacyPayment.jsx`
- `frontend/src/utils/pharmacyManagement.js`

Verification:

- `frontend/test/pharmacyInitialization.test.js` (new)
- `frontend/test/pharmacyPage.runtime.test.js` (new)
- `frontend/test/pharmacyManagement.test.js` (updates stale-cleanup expectation to include abort)
- `frontend/test/pharmacyRefresh.runtime.test.js` (resolves the new read-helper import in its runtime harness)
- `frontend/scripts/verify-pharmacy-initialization.mjs` (new)
- This report and `qa-evidence/pharmacy-initialization/`.

Other pre-existing dirty files in this workspace were preserved and are not part of this patch. `main.jsx`, `clinicTime.js`, i18n, shared API clients, backend source, and other role components have no changes from this investigation.

## Verification and evidence

Targeted files were executed individually, avoiding the full `npm test` suite and parallel test workers:

| Command, from `frontend/` | Pass | Fail |
|---|---:|---:|
| `node test/pharmacyInitialization.test.js` | 17 | 0 |
| `node test/pharmacyPage.runtime.test.js` | 10 | 0 |
| `node test/pharmacyManagement.test.js` | 31 | 0 |
| `node test/pharmacyRefresh.runtime.test.js` | 1 | 0 |
| **Total targeted tests** | **59** | **0** |

The browser script runs the real staff route, not an isolated dashboard mount, with deterministic HTTP fixtures. Its full matrix covers successful reads, 401/403/500, all failed reads, one failed panel, malformed data, slow history, cancellation, stale work, retry, read-only prices, and a held Pharmacy module with no pre-mount Pharmacy API reads. All four Arabic/English × dark/light combinations are included. Results: **113 checks passed, 0 failed, 0 uncaught exceptions, 40 screenshots**. A separate final module-screen check has **17 passed, 0 failed**, including page reload recovery. It does not count as 17 additional unique scenarios.

`npm run build` passes. Targeted oxlint and `git diff --check` pass. The existing large Admin bundle warning is unchanged. No full frontend/backend suite was run, and other roles were not browser-tested under the Pharmacy-only verification scope.

Evidence is in `qa-evidence/pharmacy-initialization/`: `browser-report.json`, `module-recovery-report.json`, per-file test logs, build log, deployment observations, and screenshots. `pharmacy-deployed-held-import.png/json` show the old deployed loader; `held-module-*.png` and `module-error-*.png` show the patched recovery states.

## Commit assessment

The listed Pharmacy patch is ready for review/commit based on the focused checks. It preserves notification integration, inventory/review mutations, pricing authority, billing-review handling, payment idempotency, and dispensing rules. Shared startup/auth/client behavior and other role branches are unchanged. Include only this patch's files, not unrelated existing worktree changes.

The historical network/CDN/cache trigger in the user's affected tab remains unobserved. The patch repairs the reproduced unrecoverable loader and the independently verified panel error-state defects; it is not evidence that an external asset-delivery incident has been repaired. Recheck the affected deployed browser after a separately authorized deployment. No commit, push, deployment, migration, seed, or production write was performed.
