# Patient portal quality pass

## Scope and safety

The running repository frontend was inspected in an isolated Chrome profile at
`http://127.0.0.1:5187`. Every `/api/` request, including mutations, was fulfilled
by the browser audit with synthetic responses. No backend or Neon endpoint was
contacted by those requests. No authentication/authorization checks were changed.
No backend files were changed for this quality pass; earlier backend work and
unrelated working-tree files were preserved. No seeds, migrations, database
resets, live accounts, commits, or pushes were performed.

## Route-by-route findings and changes

| Page / route | Findings | Changes / verification |
| --- | --- | --- |
| Home `/patient` | Large promotional hero and illustration, oversized greeting, duplicate navigation emphasis, stats pushed below the fold; errors could look like zero counts; English specialty on Arabic home | Compact clinical banner without illustration; smaller wrapping greeting; summary counts moved directly below it; clearer upcoming visit; localized specialty; independent appointment loading/error/retry; unavailable counts distinct from zero; record-claim recovery retained for legacy unlinked sessions |
| Doctors `/patient/doctors` | Large colored search banner, oversized avatars, inconsistent card actions, specialty selection lacked an announced selected state | Compact search surface; smaller avatars; consistent fees/actions and cards; `aria-pressed` filters; responsive directory; working search, no-match state, error retry |
| Doctor `/patient/doctors/:id` | Oversized portrait, weak return navigation | Compact profile, consistent action, deterministic back link to directory; desktop/tablet/mobile, loading/error presentations inspected |
| Booking `/patient/book/:doctorId` | Previous availability could remain visible; slow old requests could replace a newer date; no availability loading state; dates omitted month | Clear previous slots and selection, ignore obsolete responses, announce loading and errors, prevent confirmation until a valid current slot is selected; month and full accessible date label; localized day numbers; mocked pending-review success verified |
| Appointments `/patient/appointments` | Sparse hierarchy, mobile action sizing inconsistent, group buttons did not announce selection | Compact rows/actions, meaningful selected filters, retry, isolated date/time direction, retained pending-only bounded polling; empty/history/cancelled groups reachable |
| Appointment `/patient/appointments/:id` | No predictable return link; cancellation autofocus interfered with restoring focus | Back to list; consistent actions and date order; cancellation confirmation, Escape, restored focus, and mocked cancellation status verified |
| Reschedule `/patient/appointments/:id/reschedule` | Stale slots and stale selected times; no slot loading; old appointment could remain when route changed | Clear route data/availability, ignore late requests, announce slot loading/errors, selected-slot state, disable stale submission; mocked successful reschedule verified |
| Medical records `/patient/records` | Inconsistent list/button hierarchy; no collection retry | Consistent record cards, readable dates and mixed text, retry and empty state; all layout variants inspected |
| Record detail dialog | A late response could reopen a closed dialog; zero-valued vitals/results/range bounds could become dashes; vital labels exposed raw English keys in Arabic | Request generation invalidation; preserved zero values; localized known vital labels; isolated numeric range direction; long clinical text wraps; loading, Escape, keyboard containment and opener focus verified |
| Lab results `/patient/lab-results` | Raw service category enum shown; zero result could be unavailable; RTL numeric bounds could appear reversed | Localized report label, zero-safe results, isolated range direction, shared list/error/loading styles; normal/released report inspected |
| Prescriptions `/patient/prescriptions` | Custom medicine without a formulary object could crash the page | Safe custom-name fallback; shared cards, empty/loading/error/retry and responsive layout |
| Profile `/patient/profile` | Full-width single-column form/security stack; unlabeled password fields; long email/phone wrapping and bidi issues; clinical appointment status labels used for contact verification | Two columns where space permits, one on smaller widths; visible password labels, proper required fields, isolated contact/file-number strings and LTR blood types; localized Verified/Not verified and Connected/Not connected badges |
| Profile account security | Email/phone/Google messages not consistently announced; telephone field lacked tel semantics | Accessible alerts/status messages, tel input and numeric OTP semantics, existing reauthentication and sign-in-again behavior preserved; mocked email/phone request and confirmation, Google unlink refusal/success and connect UI inspected |
| Login `/patient-login` | Google button could retain previous language; weak control/primary-action contrast; verification code was an unconstrained text entry | Locale-specific SDK refresh, replace old rendered button, block interactions while loading; semantic action/control/link contrast and larger targets; numeric six-digit code entry; unverified login recovery inspected |
| Registration `/register` | Error text not associated with fields; keyboard focus did not follow step transitions; Google locale mismatch; dark auth palette diverged from workspace | Field IDs/descriptions, first-invalid focus, step-heading focus, numeric OTP, phone label, shared semantic auth tokens; all seven steps, validation, review, mocked email verification/success and resend cooldown exercised |
| Recovery `/forgot-password` | Code field lacked numeric constraints; default link/controls differed from portal | Numeric six-digit OTP, LTR numeric entry, shared auth contrast and targets; mocked request and code/password form inspected |
| Claim `/patient/claim` | Required inspecting the actual unlinked state rather than a linked-user redirect | Unlinked-account fixtures inspected in Arabic/English at all sizes; protected clinical routes still redirect to claim; existing instructions/validation retained |
| Shared header, sidebar, mobile navigation | Wide sidebar, crowded brand descriptor, malformed oversized appointments icon, inert bell, no portal theme switch | 208px sidebar (previously 244px); unified bottom navigation below 900px; compact identity lockup; working updates dialog linking existing appointment/lab pages; theme switch, localized language control, skip link and back links |

## Shared design and accessibility

- Uses existing semantic colors, spacing/radius/shadow tokens and ThemeToggle,
  Dialog, Skeleton, ErrorState and StatusBadge styling. No new dependency or token
  palette was introduced.
- Consolidated the competing patient workspace/mobile CSS blocks. Cards, forms,
  buttons and icons have consistent sizes and spacing. Hero minimum height is
  148px on desktop, down from 270px; mobile is content-driven rather than the old
  330px minimum. The normal fixture is approximately 224px at 390px width.
- Navigation/actions remain usable at 360/390px; the sidebar becomes bottom
  navigation, cards collapse intentionally, and long names/emails wrap safely.
- Arabic and English language choices persist across refresh. Back-arrow direction
  is intentional, numeric ranges and identifiers are isolated, and mixed text does
  not force page overflow.
- Added visible password labels, field-error associations, skip-to-main, loading
  status semantics, filter selection semantics, full date labels, and consistent
  error/status announcements. Dialog keyboard handling and focus restoration were
  verified. Shared semantic token contrast tests and actual auth button/input
  contrast checks cover light and dark modes.
- The bell presents links to existing appointment updates and released results.
  There is no server notification feed or invented unread count.
- Google SDK localization uses both the library `hl` parameter and button locale,
  as described in the [official GIS reference](https://developers.google.com/identity/gsi/web/reference/js-reference#locale).
  Only one managed SDK script exists at a time; changing theme replaces the
  rendered button, and changing language refreshes the locale-specific SDK while
  retaining the existing single initialization and credential dispatcher.

## Files changed in this pass

| File | Purpose |
| --- | --- |
| `frontend/src/layouts/PatientLayout.jsx` | Navigation, updates, theme/language, skip/back links, logout state |
| `frontend/src/layouts/patient.css` | Consolidated responsive patient workspace styles |
| `frontend/src/features/patient-dashboard/PatientPages.jsx` | Compact dashboard, safer availability/record loading, zero/custom medicine handling, profile labels and bidi behavior |
| `frontend/src/features/appointments/RescheduleAppointment.jsx` | Availability lifecycle and loading/disabled behavior |
| `frontend/src/features/patient-auth/PatientAuthPages.jsx` | Step focus, input/error association, numeric verification controls |
| `frontend/src/features/patient-auth/patientAuth.css` | Semantic auth palette, patient-only contrast and touch targets |
| `frontend/src/features/patient-auth/GoogleIdentityButton.jsx` | SDK/button locale lifecycle and loading behavior |
| `frontend/src/components/feedback/States.jsx` | Localized loading/error/retry semantics |
| `frontend/src/i18n.js` | New patient translations and persisted language preference |
| `frontend/test/patientPortalInteractions.test.js` | Five mounted React regressions for races, custom medicines and zero values |
| `frontend/test/googleIdentityButton.test.js` | SDK locale refresh and duplicate-button regression |
| `frontend/test/patientBookingStatus.test.js` | Retained pending-review/polling contracts with updated formatting |
| `frontend/test/patientGoogleLinking.test.js` | Connected-state label contract instead of appointment-status labels |
| `frontend/scripts/audit-patient-portal.mjs` | Repeatable API-isolated browser audit and functional checks |
| `docs/patient-portal-audit.md` | Findings, changes, verification, safety boundaries and limitations |

## Browser evidence and regression runner

`frontend/scripts/audit-patient-portal.mjs` runs against localhost only and
intercepts all application API traffic. It uses Chrome DevTools Protocol and
Node's existing WebSocket support; no browser dependency was installed.

```sh
# From frontend/, in separate terminals:
npm run dev -- --host 127.0.0.1 --port 5187
google-chrome --headless --no-sandbox --disable-gpu --disable-dev-shm-usage --remote-debugging-port=9337 --user-data-dir=/tmp/shifa-patient-portal-audit-chrome about:blank
node scripts/audit-patient-portal.mjs
```

Optional `--functional` runs just interactions. `--revisit` checks the pages
changed in the final RTL review; add `--auth-only` for authentication screens.
`--failures` covers detail-page loading/404 errors and action-failure recovery.
`PORTAL_AUDIT_OUTPUT`, `PORTAL_AUDIT_ORIGIN` and `PORTAL_AUDIT_CDP` configure local
output and endpoints. The full report and screenshots are written under `/tmp`.
The browser profile contains only synthetic authentication state.

The full matrix covers 15 routes at 360×800, 390×844, 768×1024, 1024×768,
1366×900 and 1600×1000, alternating Arabic/English and light/dark modes. Every
route is covered in both languages and themes, including Arabic dark mode.
Additional captures cover empty/error/loading data, long names/emails, partial
API failures, detail dialogs, account-change panels, registration steps and
verification states. The functional checks use mocked mutations only.

Evidence locations:

- `/tmp/shifa-patient-portal-audit/`: original `before-*.png` captures (later
  intermediate reports also use this folder; original image names are retained).
- `/tmp/shifa-patient-portal-final/`: full 138-capture final matrix, functional
  screenshots, and `report.json` (55 functional/layout checks passed).
- `/tmp/shifa-patient-portal-revisit/`: six-size review of numeric RTL corrections
  and Google localization (30 captures, 13 checks passed).
- `/tmp/shifa-patient-portal-auth-final/`: final patient-only auth contrast and
  touch-target review, including Google language assertions (24 captures, 61
  checks passed).
- `/tmp/shifa-patient-portal-interactions-final/`: final interaction and dialog
  screenshots after the numeric/vital-label localization review (51 checks passed).
- `/tmp/shifa-patient-portal-failures/`: detail-page loading/404/error and action
  failure recovery (18 captures, 23 checks passed).

## Validation

- Full frontend suite: 275 tests passed, no failures or skips. Includes existing
  patient/onboarding/navigation/security/theme checks, five new mounted React
  interaction regressions, and Google SDK lifecycle/locale regression coverage.
- Browser full matrix: 138 route/state captures, 55 checks passed, no horizontal
  overflow, no unlabeled visible inputs, no unhandled exceptions and no unmatched
  application API requests. The final localized SDK review added explicit checks
  that the actual rendered Google button matches the selected language.
- `npm run build`: passed. Vite reports its large-chunk advisory for the main
  application bundle; chunking/performance tuning was not expanded into this UI
  task.
- `npm run lint`: passed with six existing warnings: duplicate `newPassword` and
  `selectDoctor` translation keys in both locales, the ThemeContext fast-refresh
  export warning, and the intentional control-character regex in onboarding.
- `node --check` for the audit and new interaction tests, JSX compilation through
  Vite, and `git diff --check`: passed.
- Backend tests were not run: no backend changes were made for this task.

## Limits and remaining issues

Real Google consent/sign-in, real Brevo email delivery, backend mutations, clinical
attachments and authorization against real accounts were intentionally not
exercised. The API fixtures verify the frontend paths and presentation, not live
provider availability or clinical-data correctness. Google linking's current-
password UI and unlink behavior were checked; live linking still requires real
provider consent and server verification. The UI was inspected in desktop Chrome
with device viewport emulation, not on physical iOS/Android hardware or with a
full screen-reader session. There is no dedicated notification API/settings route;
account settings remain within Profile and medical-record details remain a dialog.
Clinical free text and server-provided error details are preserved verbatim;
interface labels, error headings and recovery actions are localized.
