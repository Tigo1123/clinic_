# Intermittent Admin Pricing Save investigation

## Finding

**The historical failure was not reproduced. No new race fix is claimed.** Current Pricing already has a synchronous per-category/entity Save lock, request-generation checks, AbortControllers, invalidation before and after successful saves, and deferred workflow revalidation. These protections were retained.

Before instrumentation, the existing three Pricing tests and five new controlled timing scenarios all passed. The new scenarios deliberately ignore cancellation, including response bodies that finish parsing after an abort. The observed timing overlap is real; the destructive overwrite was prevented by the existing generation checks.

The application change adds temporary, opt-in diagnostics around Admin Pricing only. It does not replace the concurrency algorithm or change the price/status payload.

## Exact sequence exercised

1. Load the current price, **100 / INACTIVE**.
2. Start and hold an old pricing GET. Ignore its abort signal in the test transport.
3. Leave and re-enter Pricing; a newer GET supplies editable rows while the old request remains held.
4. Edit the price to **875 / ACTIVE** and click Save repeatedly.
5. Exactly one PATCH sends `{ priceSdg: 875, status: 'ACTIVE' }` and returns HTTP 200 with the saved row.
6. Release the old GET containing **100 / INACTIVE** after Save succeeds.
7. The old GET is recorded as `olderGetCompletedAfterSave: true`, `applied: false`, `aborted: true`, `wouldOverwriteSavedRows: ['medicines:medicine']`, and `overwroteNewerState: false`.
8. After every held request settles, the rendered input is **875**, status is **ACTIVE**, the Save button is enabled, and pending request/Save counts are zero.

The saved browser trace records the old GET starting at sequence 8, a newer GET at sequence 10, Save click at 12, PATCH at 15, successful application at 32, stale GET completion at 36, and final settled UI at 37. No failing sequence was found in these experiments; this sequence must not be represented as a reproduced production failure.

## Instrumentation

Every Save handler invocation gets a generated action ID and UTC timestamp, with pricing kind, service category where applicable, entity ID, effective draft and current row price/status. Blocked duplicate, invalid and cancelled actions are recorded too. Each issued Pricing GET/PATCH has its own generated request ID, sent as `X-Request-ID` only when diagnostics are enabled. The existing backend accepts this header as its request ID, allowing server-log correlation without a backend change.

The trace records:

- Click, logical Save start/end, sanitized outgoing payload, PATCH application and outcome.
- GET/PATCH start/end, elapsed time, HTTP status, bounded response summary and safe error class/code.
- Read generations, invalidation and abort requests.
- Refresh requests and whether they were deferred; whether a GET began while Save was pending; reads already running when Save began.
- Older GET completion after a successful Save, whether the candidate would restore older values, and whether it was actually applied.
- Committed UI state for touched rows: current state, remaining draft, loading/saving flags, rendered input/status and button disabled state. A settled snapshot is emitted after tracked requests and saves finish and React commits the final UI.
- Component instance IDs and mount/unmount events, to distinguish multiple Pricing owners or late completions after navigation.

The in-memory buffer retains the latest **500 events** and tracks the latest **50 touched rows** per component. It is not persisted or uploaded. Raw request/response headers, authorization tokens, passwords, user/doctor names, full responses and arbitrary backend/error text are excluded. Response summaries whitelist IDs, prices, statuses, category counts and known error codes. The public trace API returns detached snapshots and supports clearing the buffer.

## Enable, capture and disable

Diagnostics require both an allowed build and explicit opt-in. Allowed builds are Vite development or a staging build made with `npm run build -- --mode staging`. The normal production build ignores the flag; the production browser check confirmed no trace API or diagnostic headers even with the flag set.

In the affected development/staging browser tab, run:

```js
sessionStorage.setItem('shifa_pricing_diagnostics', '1');
location.reload();
```

Reproduce the issue in Admin Pricing, wait for requests to finish where possible, then export from DevTools Console:

```js
copy(JSON.stringify(window.__SHIFA_PRICING_DIAGNOSTICS__.getEvents(), null, 2));
```

To inspect without copying:

```js
window.__SHIFA_PRICING_DIAGNOSTICS__.getEvents();
```

To clear captured events, use `.clear()`. To disable tracing, export first, then:

```js
sessionStorage.removeItem('shifa_pricing_diagnostics');
location.reload();
```

The opt-in is per browser tab/session and is sampled when the Admin component is created; reload after changing it. Enabled diagnostics add a correlation header and a committed-state snapshot render when network work drains, so they can slightly perturb timing. Disabled diagnostics send no extra headers and schedule no diagnostic renders. No user-facing controls or external telemetry service were introduced.

## Likely causes checked

| Suspected cause | Result |
| --- | --- |
| Stale closure / stale draft map | Tested queued row edits, a subsequent Save with a newer draft, and cross-category saves. Payloads matched the intended drafts. Click/draft/current/rendered trace fields support further comparison if it recurs. |
| Async event target usage | Existing controls already snapshot primitive values before deferred functional state updates. The regression for restored select targets and queued edits passed. |
| Duplicate clicks | Rapid repeated handler calls issued one PATCH per row. Duplicate attempts were traced; other categories remained independently saveable. |
| Concurrent GET/PATCH / old GET overwrite | Reproduced overlapping timing, including GET response bodies finishing after Save. All stale candidates were discarded. |
| AbortController misuse | Tests ignore aborts on purpose. Version checks still protected state; stale read failures did not replace current errors. |
| Revalidation race | Refresh events during Save were coalesced/deferred. The follow-up GET started after Save ended and retained the persisted value. Tab navigation also started a GET while saves were pending; late results were ignored. |
| Saving flag early/late reset | A delayed response body kept Save disabled. HTTP failure restored the button and preserved the draft. Finishing one category did not release another category's lock. |
| Backend succeeds, frontend restores an old snapshot | Synthetic successful responses stayed authoritative after old GET completion. No live backend/persistence failure was reproduced or excluded. |
| Multiple components sharing pricing state | The three pricing tables use one Admin-owned state/draft map keyed by kind and entity ID. No new shared pricing store was added. Instance IDs identify separate mounts; diagnostics isolation was tested. Separate browser tabs or remounts still need real-incident traces. |

There is no category-switch control on the current Pricing page: all three kinds are rendered together. Category coverage therefore uses different doctor/service/medicine rows, including identical IDs across kinds, plus leaving and returning to Pricing during pending saves.

## Exact files changed

- `frontend/src/features/admin/AdminDashboard.jsx` — Pricing-only lifecycle instrumentation and nonvisual row identifiers.
- `frontend/src/features/admin/pricingDiagnostics.js` — new gated, bounded, sanitized trace helper.
- `frontend/test/adminPricingDiagnostics.runtime.test.js` — new deterministic timing and trace assertions.
- `frontend/test/pricingDiagnostics.test.js` — new gating/privacy/buffering/lifecycle/detection tests.
- `frontend/test/adminPricing.runtime.test.js` — resolve the new helper import in existing component tests; existing behavioral checks retained.
- `frontend/test/pricingSecurity.test.js` — adapt the confirmation source assertion to the logging block; confirmation requirements retained.
- `frontend/scripts/verify-pricing-diagnostics.mjs` — new single-tab synthetic browser check, including production opt-in rejection.
- `docs/pricing-workflow-diagnostics.md` — this report.
- Generated evidence under `qa-evidence/pricing-diagnostics/`; no inherited modifications were discarded, committed or pushed.

## Verification

**21 targeted tests passed, 0 failed**, in four sequential processes with heap limits. No monolithic `npm test` was run.

| File | Passed | Failed |
| --- | ---: | ---: |
| `adminPricing.runtime.test.js` | 3 | 0 |
| `adminPricingDiagnostics.runtime.test.js` | 7 | 0 |
| `pricingDiagnostics.test.js` | 6 | 0 |
| `pricingSecurity.test.js` | 5 | 0 |

The **13 new tests** cover the requested old-GET-after-Save sequence for all three kinds, rapid repeated/cross-category saves and navigation, deferred refresh, delayed/failing bodies, invalid/cancelled actions, safe gating/redaction, bounded export, separate instances, unmount safety, and detection of an applied versus discarded stale candidate.

Browser checks: **19 development checks and 7 production checks passed, 0 failed, no uncaught exceptions**. One headless browser/tab was used sequentially, with synthetic API responses and no live clinic writes. The production build and scoped lint passed; the existing >500 kB Admin chunk warning remains.

- [Deterministic test results](../qa-evidence/pricing-diagnostics/tests.json)
- [Development browser checks](../qa-evidence/pricing-diagnostics/browser-report.json)
- [Captured sanitized timing trace](../qa-evidence/pricing-diagnostics/browser-trace.json)
- [Production diagnostic gate checks](../qa-evidence/pricing-diagnostics/browser-report-production.json)
- [Saved UI after the stale GET](../qa-evidence/pricing-diagnostics/saved-after-late-get.png)

## Commit assessment and remaining uncertainty

The **diagnostic patch is suitable to commit after normal review**: it is off by default, production gating was browser-verified, redaction tests pass, and the existing concurrency protections remain in place. This is not a claim that the intermittent Save failure is fixed. Its live root cause remains unconfirmed until an affected-tab trace and matching server request IDs capture it. Actual staging deployment, database/network failures, proxies, multiple browser tabs and server-side concurrent edits were not exercised end to end. Remove the helper/hooks and instrumentation-specific assertions after diagnosis, while retaining the behavioral race regressions.
