# Low-end device audit

## Measurements

Chromium CPU throttling was 4x for profiles A/B and 6x for profile C, at 390×844. Additional unauthenticated login viewport captures ran at 360, 768, 1024 and 1366px. `scrollWidth` matched viewport width at all tested sizes (no horizontal overflow); the 360px and 390px captures showed login controls. Concurrent browser captures caused some 600ms sample points at 768/1024/1366 to occur before controls were available, so those runs establish overflow only, not usable-ready timing. Public pages only; no authenticated clinical dashboard, table, chart, patient history, or API-backed form could be loaded. DOM elements: landing 788; patient login 86–87; registration 100; staff loading fallback 36. At profile A, landing had 50ms and 68ms long tasks; patient login had a 264ms long task. Profile B/C patient login had a 220ms long task; staff had isolated 51–82ms long tasks when the fallback had loaded. Full JSON measurements live in `evidence/`.

This does **not** verify authenticated clinical workflows or real low-end hardware. CPU throttling is a browser approximation, not device GPU/memory behavior. There are no authenticated account fixtures available in this audit environment, so clinical workflows cannot be visually or interactively checked. Evidence files: `evidence/viewport-360.json`, `viewport-768.json`, `viewport-1024.json`, `viewport-1366.json`, plus 390px network profiles.

## Source findings and likely limits

- Patient appointments, history, prescriptions and records are not virtualized in frontend code observed for this review. Backend patient appointments, prescriptions, records and lab results use unbounded `findMany` routes. Long-lived accounts can therefore grow DOM and payload size.
- Reception pending queue and doctor queue use unbounded `findMany`; queue DOM can grow during a busy clinic. Pharmacy/lab queue queries often use bounded filters/takes, but verify all operational list ceilings during staging review.
- Dashboard charts use Recharts. 4x/6x CPU timing indicates some 200ms+ JS tasks even on simple auth pages; chart-heavy dashboard interaction should be measured on real low-spec Android and Windows devices.
- Large global JS chunks and font subsets increase parse and font decode cost. No service worker means no offline startup; warm HTTP cache helps only when assets remain cached and network is available.

## Required follow-up

Before pilot, run a device matrix at 360/390px and desktop widths with genuine role test accounts, collecting interaction-ready time, long tasks, DOM counts, overflow, form completion and browser console errors. Include a low-memory Android device and an older office laptop. Virtualize or paginate high-growth lists only if measurements support it; keep explicit page size server-side.
