# Admin shell scrolling repair

The existing Admin shell was classified **BROKEN** for desktop scroll ownership before editing. The working-tree status and existing diff were inspected first; inherited uncommitted changes were retained. No commit or push was performed.

## Root causes

- `.app-layout` provided only a minimum viewport height. Its flex descendants could grow to the height of long content.
- Shared dashboard CSS set `min-height: calc(100dvh - 68px)` and `overflow: visible`. The workspace's `overflow-y: auto` had no bounded height, so the document became the scroll owner. The sidebar relied on a hard-coded 68px header offset, although the measured desktop header is about 76px and can vary with language/width.
- The schedule stylesheet explicitly enabled document scrolling and `overflow: visible` on the Admin workspace.
- The intermediate 761–900px breakpoint changed navigation to a horizontal row while retaining a desktop sidebar height.
- Absolutely positioned Reports accessibility content could extend the document because the workspace did not establish a containing block. Making the scroll owner `position: relative` contains these descendants as part of the workspace.

## Layout strategy

At widths above 900px, the authenticated Admin shell is a `100dvh` flex column. The header has intrinsic height and cannot shrink. The main flex child and Admin dashboard use `min-height: 0`, `min-width: 0` and bounded overflow. The sidebar and workspace are siblings with independent `overflow-y: auto`; the sidebar retains its existing 260px **width**, with no fixed pixel **height**. The workspace has a stable scrollbar gutter and is a positioning context. Overscroll containment keeps wheel scrolling at either region's boundary from propagating to the document.

The header stays outside the scrolling workspace. Its stable position comes from the shell structure; no measured header height or fixed pixel offset is used. Both scrolling regions are named and focusable so keyboard users can reach them. Existing menu state, routes, RTL ordering, active styles and theme tokens are retained.

At 900px and below, the viewport lock is absent. Admin keeps its existing horizontally scrollable navigation row and document flow. The sidebar is explicitly reset to automatic height and static positioning; navigation overflow stays inside the menu. Desktop sizing is restricted to `@media screen`, leaving print flow outside the viewport lock.

All new desktop selectors require `.app-layout--admin`, which is applied only to an authenticated Admin dashboard without a forced password change. Other role dashboards and authentication screens keep their existing shell behavior. The removed schedule rules targeted Admin only.

## Exact files changed

- `frontend/src/App.jsx` — add the Admin-only shell class and import its stylesheet.
- `frontend/src/features/admin/adminShell.css` — new scoped desktop shell and scroll ownership rules.
- `frontend/src/features/admin/AdminDashboard.jsx` — name and focus the two scroll regions.
- `frontend/src/features/admin/clinicSetup.css` — correct narrow-screen navigation height and overflow ownership.
- `frontend/src/features/admin/adminSchedule.css` — remove document-scroll overrides.
- `frontend/scripts/verify-admin-shell.mjs` — new sequential browser regression using synthetic populated APIs.
- `docs/admin-shell-layout.md` — this report.
- Generated evidence: `qa-evidence/admin-shell/` (browser manifest, screenshots, targeted-test logs and build log).

## Browser verification

The browser script uses one headless Chrome instance and one audit tab at a time. It performs no live clinic writes. It tests populated Pricing (45 doctors, 45 services and 45 medicines), doctor management, clinical services, laboratory catalog, loaded weekly schedules, populated reports, staff management and 25 audit-log rows.

The primary matrix is 1366×768 desktop, 768×1024 tablet and 390×844 mobile, each in Arabic RTL/English LTR and light/dark themes. Additional Arabic dark checks cover 1366×480, 1366×1366, 1024×768, 901×700, 900×1024 and 320×740.

Checks record header/sidebar bounding boxes before and after deep content scrolling, document dimensions and scroll positions, independent sidebar scrolling, wheel scroll containment, keyboard PageDown, schedule save-bar reachability and horizontal overflow. A control case removes the new shell class from populated Pricing and reproduces the unbounded document height, then restores the fixed shell. Other-role smoke checks verify Reception, Doctor, Lab and Pharmacy never receive the Admin shell class.

Final result: **578 browser checks passed, 0 failed; 37 screenshots; 0 uncaught exceptions and 0 console errors**. The menu stays reachable in a short viewport and the schedule save bar remains reachable inside the new workspace scrollport. All four other-role smoke checks passed.

Examples from the recorded layout measurements:

| Scenario | Workspace scrollTop after deep scroll | Document scrollTop | Header Y before/after | Sidebar Y before/after |
| --- | ---: | ---: | --- | --- |
| Pricing, 1366×768, English dark | 10,349px | 0 | 0 / 0 | 76.078 / 76.078 |
| Reports, 1366×768, Arabic light | 921px | 0 | 0 / 0 | 76.078 / 76.078 |
| Pricing, 1366×480, Arabic dark | 11,527px | 0 | 0 / 0 | 76.078 / 76.078 |
| Pricing, 1366×1366, Arabic dark | 10,641px | 0 | 0 / 0 | 76.078 / 76.078 |

At 1366×480 the sidebar additionally scrolled **163px internally**, with no workspace or document movement. On desktop the document height exactly matched the tested viewport height. No tested layout had horizontal document overflow. Screenshots were visually inspected for deep desktop Pricing, the short-height sidebar, tablet Pricing and mobile schedules.

Targeted Admin regressions: **91 passed, 0 failed, 0 skipped across 7 files**, run sequentially with a 512 MB heap limit per test process. The production build, scoped JavaScript lint and `git diff --check` passed. The build retains the existing warning for the >500 kB Admin JavaScript chunk.

Evidence and reproducible commands:

- [Browser checks and full before/after geometry](../qa-evidence/admin-shell/report.json)
- [Combined verification summary](../qa-evidence/admin-shell/summary.json)
- [Per-file targeted test results](../qa-evidence/admin-shell/tests/report-admin.json)
- [Deep desktop Pricing, English dark](../qa-evidence/admin-shell/pricing-deep-1366-768-en-dark.png)
- [Short viewport with independent sidebar scrolling](../qa-evidence/admin-shell/edge-1366-480.png)
- [1366×1366 desktop](../qa-evidence/admin-shell/edge-1366-1366.png)
- [Mobile schedules, Arabic dark](../qa-evidence/admin-shell/schedules-deep-390-844-ar-dark.png)

From `frontend/`, with the local frontend server and one Chrome instance exposing CDP on port 9337:

```sh
node --max-old-space-size=384 scripts/verify-admin-shell.mjs
CLINIC_TEST_OUTPUT=../qa-evidence/admin-shell/tests node --max-old-space-size=128 scripts/run-ui-audit-tests.mjs admin
npm run build
```

The temporary browser was closed after verification. No other role's shell rules were changed, and no navigation or authentication behavior was changed.

## Limits

The browser fixtures verify layout and navigation with populated data; they do not validate live backend persistence. No monolithic frontend test run is used. Existing unrelated changes are outside this focused patch. The host temporary filesystem is quota-limited, so the single browser uses an ignored on-disk profile under `frontend/node_modules/.cache/` and necessary local checks run with approved escalation.
