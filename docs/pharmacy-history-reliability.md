# Pharmacy history reliability — 30 October 2026

Changes are local. No commit, push, deployment, backend write, migration, or new endpoint was made.

## Root cause and audit findings

The earlier Pharmacy initialization patch already removed the prescription-history `catch(() => [])` pattern and guarded its empty message with `status === 'success'`. That protection was present at the start of this task. This investigation found the remaining problems below; it does not attribute already-fixed code to the current checkout.

1. **History lifecycle was inconsistent.** Prescription history started eagerly and continued after leaving its tab. Batch and movement history used separate arrays, loading flags, error strings, and a shared detail-request counter. Their counters were not invalidated on inventory-component unmount, and those reads had no AbortSignal. A language change could also leave an old-language error string on screen.
2. **Last successful history was hidden or discarded.** Batch/movement rendering used `loading ? ... : error ? ... : table`, hiding the retained rows during both refresh and failure. Closing a dialog explicitly ran `setBatches([]); setMovements([])`, discarding both snapshots. Pagination retry used the last successful page rather than remembering a failed requested page.
3. **History validation was too shallow.** Generic page validation checked collection shape and IDs but not the dates, nested display fields, quantities, or history pagination actually consumed by rendering. The remaining `data.items || []` history assignments obscured the contract. In particular, the baseline accepted `{ items: [], pagination: { page: 1, total: 10, totalPages: 1 } }` and rendered it as empty history despite the positive server count; the patched reader explicitly rejects it. `metadata-root-cause.json` records the baseline-versus-patch validator result. Invalid nested data could reach rendering rather than produce the history error state.
4. **History selection used the active queue's data contract.** The history endpoint returns historical drug labels without inventory IDs. Selecting a historical prescription could request `/api/pharmacy/formulary/undefined` and display “Checking stock.” Active-queue refreshes could also clear a selected historical prescription because selection reconciliation searched only the pending queue.
5. **A payment refresh error could be hidden.** If the last valid payment-state response had `invoice: null`, the early no-invoice render branch did not display the error from a later refresh. A real failed read therefore looked like the previous successful billing-pending response without exposing the failure.

The remaining generic `jsonRequest` JSON fallback for mutation/detail calls is not a successful empty-history path: malformed GET detail payloads are explicitly rejected by validation. Historical collections now bypass that helper entirely. Presentation defaults such as `batchResource.data?.items ?? []` represent an unread snapshot only; empty copy is separately gated on successful completion, never on that default alone.

## Existing API contracts reused

| Read path | Role in history | Result handling |
|---|---|---|
| `GET /api/records/prescriptions/history` | Completed/terminal prescriptions, dispensed quantities, persisted medication-review outcomes | Existing bounded array contract; validates renderable names, dates, drugs and numeric quantities. No new history endpoint. |
| `GET /api/pharmacy/formulary/:id/movements?page=N&pageSize=50` | Stock ledger, including dispensing movements | Existing `{ items, pagination }` contract; validates row fields and requested page. |
| `GET /api/pharmacy/formulary/:id/batches?page=N&pageSize=50` | Existing stock-batch records | Same paged snapshot lifecycle and validation; stock/batch behavior retained. |
| `GET /api/pharmacy/prescriptions/:id/payment-state` | Existing invoice/payment aggregate, not a payment-transaction history list | Preserve the valid invoice/billing-pending snapshot and expose later refresh errors in both branches. |
| `GET /api/records/medication-reviews/pending` | Pending review queue, not a completed-review history endpoint | Audited: existing typed success/error states and successful-empty guard remain. Completed review outcomes are already carried on historical prescribed-drug records. |

There is no separate dispensed-medication, medication-review-history, or payment-transaction-history read in the current Pharmacy UI. None was invented. The payment POST, dispensing POST, review decisions, pricing authority, and their request bodies were not changed. Historical selection no longer requests current stock/payment state or presents active review actions.

## Resulting behavior

History readers have explicit idle, pending, success, error, and retryable-error states. Collections are committed only after the full successful response is parsed and validated. Failure records a localized error and leaves the last successful snapshot unchanged. Only successful empty collections display the true-empty message. Paged history with empty items but a positive total, or contradictory total/page counts, is an explicit invalid-data error.

Prescription history fetches when its tab is visible. Batch/movement history fetches when its dialog is open. Leaving the tab, closing the dialog, changing medicine, or unmounting aborts/obsoletes prior work. The request generation is advanced before retry; fetch and body cancellation are covered. A late response cannot overwrite newer data or clear its loading state. `finally` clears loading only for the current request.

Retry replaces the snapshot instead of appending. History IDs are deduplicated. A failed next-page Retry requests that same page, retaining the previous successful page until the new one succeeds. The same medicine's snapshot is retained when its dialog closes and reopens; snapshots are not persisted across logout/full component destruction or mixed between different medicines.

Error text is produced from localized frontend copy, not backend diagnostic messages. Changing Arabic/English re-localizes the typed history error without dropping the snapshot. A history-only error leaves pending prescriptions, inventory, and navigation usable. Authentication-ending 401 responses retain the shared client's logout/redirect behavior; they are never represented as an empty successful history.

## Exact files changed

Production:

- `frontend/src/services/pharmacyReads.js` — history-specific validation, snapshot reader and suspension lifecycle.
- `frontend/src/features/pharmacy/usePharmacyHistory.js` — new visibility-aware history hook.
- `frontend/src/features/pharmacy/PharmacyDashboard.jsx` — prescription history lifecycle, cached-snapshot notice, correct historical selection/dispensed display.
- `frontend/src/features/pharmacy/PharmacyManagement.jsx` — batch/movement readers, preserved snapshots, distinct loading/error/empty states, cleanup.
- `frontend/src/features/pharmacy/PharmacyPayment.jsx` — visible refresh loading/errors with the last valid invoice or billing-pending snapshot.

Verification:

- `frontend/test/pharmacyHistory.test.js` — new reader/contract/error/race tests.
- `frontend/test/pharmacyHistory.runtime.test.js` — new rendered UI lifecycle and snapshot tests.
- `frontend/test/pharmacyPage.runtime.test.js` — adds invoice/no-invoice refresh preservation cases in both languages.
- `frontend/test/pharmacyManagement.test.js` — adapts existing assertions for effect-owned history loading and read-only history actions.
- `frontend/test/pharmacyRefresh.runtime.test.js` — isolates the new history hook in the existing inventory-only refresh harness.
- `frontend/scripts/verify-pharmacy-history.mjs` — new real-route browser matrix with intercepted API fixtures.
- This report and `qa-evidence/pharmacy-history/`.

No backend, shared auth/client, global style, or other role component changed.

## Sequential verification

Each file ran in its own small, sequential Node invocation, without the full frontend suite or concurrent test workers.

| Command from `frontend/` | Pass | Fail |
|---|---:|---:|
| `node test/pharmacyHistory.test.js` | 36 | 0 |
| `node test/pharmacyHistory.runtime.test.js` | 37 | 0 |
| `node test/pharmacyInitialization.test.js` | 17 | 0 |
| `node test/pharmacyManagement.test.js` | 31 | 0 |
| `node test/pharmacyPage.runtime.test.js` | 14 | 0 |
| `node test/pharmacyRefresh.runtime.test.js` | 1 | 0 |
| **Total** | **136** | **0** |

The new tests cover valid data, true empty, initial and refresh failures, 401/403/404/500, malformed JSON and nested payloads, network rejection, slow fetch/body, old response finishing after newer success, cancel/unmount/tab cleanup, retry, deduplication, failed-page retry, retained snapshots, re-localization, and historical label-only DTOs. Four payment refresh tests were added; the other ten payment/page tests remain intact.

The browser matrix uses the real `/staff` route and actual dialog components with all API reads intercepted. It runs sequentially in one Chrome tab across Arabic/English × light/dark × 1366px desktop/390px mobile. It checks all three collection sources, payment snapshot refresh, true empty versus failure, Retry, slow and obsolete reads, partial failure, viewport fit, read-only history selection, and real shared-client 401 login redirects. No backend mutation is allowed by the harness.

Build, focused oxlint, browser-script syntax check, and `git diff --check` pass. The existing large Admin bundle warning remains. No full `npm test` or live-backend data test was run.

**Browser results: 810 main matrix checks passed, 0 failed, 0 uncaught exceptions, 56 screenshots. A final focused contradictory-metadata check passed 50/50 across all eight layouts; the isolated auth follow-up passed 10/10.**

Browser counts and screenshots are recorded in `qa-evidence/pharmacy-history/browser-report.json` and the verification summary. Screenshots include `preserved-error-prescriptions-390-ar-dark.png`, `preserved-error-movements-390-en-light.png`, and `slow-*.png`. The initial harness encountered an execution-context transition during the final 401 redirect; its navigation wait was corrected and authentication checks rerun separately before the final clean matrix.

## Commit assessment

Safe to commit the listed Pharmacy patch based on the focused verification and unchanged backend contracts. Last successful history is preserved during refresh errors and same-reader reopening. A history-only failure leaves the rest of Pharmacy usable. Cache retention is scoped to the reader/medicine identity; session-ending 401s still return to login. Nothing was committed or pushed.
