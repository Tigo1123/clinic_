# Patient dashboard polish

Implemented on 2026-10-22. Existing work in the working tree was preserved. No backend files, database data, authentication rules, migrations, seeds, or production accounts were changed by this dashboard task. Nothing was committed or pushed.

## Changes

- Compact greeting with smaller typography, restrained accent surface, and a concise primary booking action.
- Four summary cards: upcoming appointments, released lab results, prescriptions, and medical records. Counts use existing authenticated APIs; failed requests show unavailable rather than a misleading zero.
- Soft category accents, consistent icon containers, shared radii, subtle borders/elevation, normalized padding, and responsive card grids.
- Upcoming appointment panel with a date tile, doctor/specialty, readable time, existing localized status, and a working details link. The dashboard now selects the earliest date/time without mutating the API list; the API returns dates descending.
- Compact quick actions to doctors, records, and profile. Summary cards also link to appointments, labs, prescriptions, and records.
- Recent activity combines existing records and released lab orders, sorts by date, and shows at most three entries. No clinical data or notifications are invented. Pending-request reminders still derive from actual appointments and retain bounded polling.
- Empty states explain what will appear later. When no doctors exist, booking is disabled with an associated explanation and reception guidance. No fake records or dead booking links are added.
- Existing compact 208px sidebar and responsive bottom navigation are retained.

This checkout did not previously include MUI. The dashboard now uses MUI Card, Paper, Stack, Grid, Typography, Chip, and Button. Its theme adapter aliases existing Shifa CSS tokens and follows the existing theme context. No second color palette or global CSS reset was introduced. Emotion caches and the RTL plugin support language switching.

## First-name greeting

`patientFirstName` prefers the language-appropriate structured first name, then the other structured first name, then localized full-name fallbacks. It returns only the first visible token. Whitespace and invisible direction/control characters are handled safely, and invalid/non-string values are ignored. The profile is never modified.

Examples: `مساء الخير، تاج` and `Good evening, Tag`. Missing names produce a generic localized greeting without a trailing comma. Exceptionally long first names are limited to two visible heading lines. Full names remain available on the profile page.

## Files changed in this task

- `frontend/package.json`, `frontend/package-lock.json`: MUI, Emotion, Stylis, and RTL support.
- `frontend/src/features/patient-dashboard/PatientPages.jsx`: dashboard components, existing-data activity, booking availability, nearest appointment.
- `frontend/src/layouts/patient.css`: scoped dashboard styling and responsive refinements.
- `frontend/src/i18n.js`: Arabic and English dashboard labels and guidance.
- `frontend/src/utils/patientGreeting.js`: safe first-name selection and localized greetings.
- `frontend/src/utils/patientMuiTheme.js`: MUI adapter to existing tokens and direction-aware style caches.
- `frontend/test/patientGreeting.test.js`: focused greeting regressions.
- `frontend/test/patientPortalInteractions.test.js`: mounted dashboard regressions and existing test-loader integration.
- `frontend/scripts/audit-patient-portal.mjs`: dashboard matrix and edge-case browser checks, extending the existing audit script.
- `docs/patient-dashboard-polish.md`: this report.

Some files were already modified or untracked before this task; their earlier changes were retained.

## Validation

- Full frontend suite: **289 passed, 0 failed, 0 skipped**. All original 275 tests remain passing. Added coverage includes Arabic/English structured first names, localized fallbacks, missing/invalid names, invisible characters, immutability, no-doctor booking, existing-data activity with partial failure, and nearest appointment selection.
- Final dashboard browser matrix: **78 captures, 411 checks passed**. Normal, empty, and long full-name fixtures at **360, 390, 768, 1024, 1366, and 1600px**, in every Arabic/English and light/dark combination. Additional loading, API error, and partial-error captures.
- Name/browser edge cases: **24 captures, 45 checks passed**. Structured first names, missing names, and extremely long single-token names at 360/1366px, both languages/themes; booking/lab links and visible keyboard focus.
- Existing patient browser interactions: **51 checks passed**, including navigation, booking, theme/language persistence, dialogs, validation, records, account actions, logout, and protected routes.
- No horizontal overflow, unhandled browser exceptions, or unmatched API requests in these browser runs. All `/api/*` requests were intercepted and answered with fixtures, including mutation exercises. No backend or Neon requests were made by the browser checks.
- Enabled primary booking buttons met the browser check for at least 4.5:1 text contrast. Semantic headings, section names, existing status text, decorative icon hiding, visible focus, and 44px minimum button height are retained.
- Production build passed; syntax checks passed for the new utilities, tests, and browser script; `git diff --check` passed.
- Lint passed with no errors and six pre-existing warnings: four duplicate translation keys, theme-context export style, and an onboarding regex warning.

Browser artifacts:

- `/tmp/shifa-dashboard-polish-final/report.json` and PNG captures.
- `/tmp/shifa-dashboard-edges/report.json` and PNG captures.
- `/tmp/shifa-dashboard-functional/report.json` and dialog captures.
- `/tmp/shifa-dashboard-tests.log`, `/tmp/shifa-dashboard-build.log`, `/tmp/shifa-dashboard-lint.log`.

## Remaining limitations

No visual defects were observed in the tested Chrome matrix. Safari, Firefox, physical mobile devices, and assistive-technology sessions were not tested. MUI's native CSS color support requires modern browsers. Browser runs used fixtures rather than real patient data or live registration.

The build retains its large-chunk advisory. Dependency audit reports two pre-existing high-severity findings (`vite` 8.1.4 and `source-map-js` 1.2.1); their versions were already present before this task and were not upgraded as part of the dashboard change.

Implementation references: [MUI theming](https://mui.com/material-ui/customization/theming/), [RTL setup](https://mui.com/material-ui/customization/right-to-left/), and [CSS variable color aliases](https://mui.com/material-ui/customization/css-theme-variables/native-color/).
