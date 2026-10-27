# UI/UX audit resumed — 27 October 2026

The working tree was inspected with `git status --short`, `git diff --stat`, and `git diff` before editing. The inherited patch and status were saved to `/tmp/clinic-ui-audit-inherited.patch` and `/tmp/clinic-ui-audit-inherited-status.txt`. Existing changes, screenshots, the backend pricing test, and the pre-existing `.staff-login-584-PasswordField.mjs` were retained. No commit, push, database reset, or live clinic mutation was performed.

## Classification before changes

GOOD means no issue reproduced in the checked state. PARTIAL means implemented with defects or incomplete verification. BROKEN identifies a reproduced defective state. NOT IMPLEMENTED identifies an absent flow. These are scoped audit judgments, not production certification.

| Area | Before changes | Evidence and scope |
| --- | --- | --- |
| Staff login | PARTIAL | Existing submission locking, password masking and MFA guards; shared error handling needed verification; raw role codes in authenticated headers. |
| Patient login | PARTIAL | Implemented password/Google entry, pending verification, error and loading states; live identity-provider verification remains outstanding. |
| Registration/create account | PARTIAL | Seven-step bilingual flow, address validation, password rules and verification implemented; browser checks cover initial registration screens, targeted tests cover step validation. |
| Forgot/reset/change password | PARTIAL | Patient recovery used backend success text; recovery email was labelled optional despite being required. Wrong-current-password/reuse errors lacked specific translated guidance. |
| MFA/security | PARTIAL | Enrollment, proof, recovery codes and password change implemented; keyboard modal containment was BROKEN. |
| Admin | PARTIAL | Pricing, staff, schedule and specialty regressions checked; browser screenshots cover the initial facility profile, not populated production analytics. |
| Reception | PARTIAL | Queue, search, walk-in and billing regressions checked; cancellation error feedback has an open gap. |
| Doctor | PARTIAL | Clinical-read gates and selection races implemented; inherited localization lost the missing-existing-record explanation. |
| Pharmacy | PARTIAL | Inventory/review/presentation implemented; historical-read failures can masquerade as empty history. |
| Lab — special focus | PARTIAL | Payment/sample/result/release guards implemented. Read-failure presentation and dark surfaces were BROKEN; result input labels and busy guards were incomplete. |
| Patient portal | PARTIAL | Dashboard and clinical lists implemented; list errors localized in inherited patch; pagination/interaction test injection needed repair. |
| Staff self-service forgot-password | NOT IMPLEMENTED | Staff recovery is administrator-mediated; no self-service recovery screen/link in staff login. Do not confuse this with implemented patient recovery. |

All areas remain PARTIAL at full-system scope until the live-service checks listed below are completed. The specific defects fixed below have passing scoped regression evidence.

## Findings, root causes and changes

| Finding | Root cause | Resolution |
| --- | --- | --- |
| Lab white panels with pale text in dark mode | Legacy `--card-bg` and `--bg-color` names had no compatibility aliases; CSS fell back to light colors. | Added aliases to the existing theme tokens. This also corrects consumers in Reception/Pharmacy; Doctor retains its local override. |
| Lab completed workflow markers nearly invisible; small blue labels need stronger contrast | Undefined `--success` token; changing the foreground alone in the inherited patch did not fix the missing background. Active labels used the decorative primary color. | Added `--success` alias and stronger themed text accents. Browser checks compute marker, panel and current-step contrast in both themes. |
| Lab history/review/catalog outages looked empty | Non-OK responses, malformed payloads and catches all produced empty arrays. | Explicit loading/error/retry states; retain last successful snapshot; disable service linking when catalog state is unavailable. |
| Late Lab history/review/catalog responses could overwrite newer reads | Independent reads lacked request-generation checks. | Per-resource request versions and cleanup invalidation. |
| Lab saves, sample collection, reviews and release could repeat while pending | No synchronous mutation guard or consistent disabled state. | A shared in-flight ref plus disabled/pending UI; result drafts survive failures. |
| Reversed Lab reference bounds could be sent | No client validation before mutation. | Reject reversed/non-finite bounds and preserve the draft; keep qualitative result values supported. |
| Finalized Lab conflict retained a draft internally but hid it | Completed/read-only rendering had no visible draft-review state. | Display retained unsaved value alongside the authoritative read-only result. |
| Lab fields/tabs/feedback lacked complete accessibility | Placeholder-only result/name fields, incomplete tab behavior and unannounced result messages. | Accessible names, RTL/LTR input directions, roving keyboard tabs and linked panel, alert/status roles, logical warning border. |
| MFA dialog let Tab leave the dialog | Modal ARIA without focus management. | Initial focus, Tab/Shift+Tab containment, Escape subject to pending/recovery restrictions, trigger focus and scroll restoration. Clear password drafts on mode reset. |
| Password recovery leaked backend success English | `data.message` rendered directly; optional-email label reused for a required field. | Translation-owned confirmation in request/reset steps, status announcement, required email label, translated language-group name. |
| Null API error body crashed; uncoded 429/503 lost useful guidance | `typeof null === 'object'` dereference; generic REQUEST_FAILED mapping preceded HTTP status handling. | Null guards; status-specific messages before generic fallback; translated current-password, password-reuse and inactive-account messages. |
| Raw role enum in Arabic header | `{user.role}` rendered directly. | Translated role labels; isolate account identifier with `bdi`. |
| Raw visit-summary HTML/parser details could appear | Unexpected response content interpolated into an Error and displayed. | Localized unreadable-summary messages for non-JSON and malformed JSON; print/email gating retained. |
| Existing-record warning became generic in Doctor | Inherited catch replaced a locally constructed message with generic API fallback. | Explicit local error code and translated explanation that the visit was not opened for editing. |
| Some inherited tests did not exercise their intended transport | Generic clinical stub replaced Doctor transport; Patient import signature changed; whitespace-sensitive/source expectations were stale. | Corrected test injection and relevant assertions; added behavioral Lab, API and modal regressions. |

## Exact files changed in this resumed session

Application files:

- `frontend/src/App.jsx`
- `frontend/src/components/StaffSecurityDialog.jsx`
- `frontend/src/features/clinical/ClinicalModals.jsx`
- `frontend/src/features/doctor/DoctorDashboard.jsx`
- `frontend/src/features/laboratory/LaboratoryDashboard.jsx`
- `frontend/src/features/laboratory/laboratoryDashboard.css`
- `frontend/src/features/patient-auth/PatientAuthPages.jsx`
- `frontend/src/i18n.js`
- `frontend/src/services/apiClient.js`
- `frontend/src/styles/tokens.css`

Tests, audit tooling and documentation:

- `frontend/test/apiClient.test.js`
- `frontend/test/clinicalDataUnavailable.test.js`
- `frontend/test/clinicalReadViews.runtime.test.js`
- `frontend/test/labResultConcurrency.test.js`
- `frontend/test/patientPortalInteractions.test.js`
- `frontend/test/staffSecurityDialog.test.js`
- `frontend/test/laboratoryStates.runtime.test.js` (new)
- `frontend/scripts/run-ui-audit-tests.mjs` (new)
- `frontend/scripts/verify-ui-audit.mjs` (new)
- `docs/ui-ux-audit-resume-2026-10-27.md` (new)
- Generated evidence under `qa-evidence/ui-audit-resume/`; its manifests list exact test logs and screenshot names. All other inherited modified/untracked files were left in place.

## Targeted verification

No monolithic `npm test` was run. Each listed file runs in its own process, sequentially, with `--max-old-space-size=512`; the runner itself uses 128 MB. Commands from `frontend/`:

```sh
node --max-old-space-size=128 scripts/run-ui-audit-tests.mjs shared auth
node --max-old-space-size=128 scripts/run-ui-audit-tests.mjs admin reception
node --max-old-space-size=128 scripts/run-ui-audit-tests.mjs doctor lab patient
node --max-old-space-size=128 scripts/run-ui-audit-tests.mjs pharmacy
```

Per-file names and TAP logs are in [the test evidence directory](../qa-evidence/ui-audit-resume/tests/). Count final results from the newest result for each file; earlier reports may describe failures that were subsequently corrected. An early `node --test` probe reported only file-level results in this environment and was not used for final case counts.

Final results: **340 passed, 0 failed, 0 skipped across 42 test files**. [The final per-file manifest](../qa-evidence/ui-audit-resume/tests/report-final.json) supersedes intermediate attempts.

| Targeted batch | Passed | Failed |
| --- | ---: | ---: |
| Shared API/auth storage/password/date picker/session utilities | 48 | 0 |
| Login, registration, MFA/security | 70 | 0 |
| Admin | 91 | 0 |
| Reception/billing | 14 | 0 |
| Doctor/clinical read and malformed summary states | 39 | 0 |
| Lab | 22 | 0 |
| Pharmacy | 32 | 0 |
| Patient portal | 24 | 0 |

The final production build passed; its existing >500 kB Admin chunk warning remains. Scoped lint completed with **0 errors and 4 existing duplicate-key warnings** (`newPassword` and `selectDoctor` in both translation objects). New Lab cleanup lint warnings were resolved. `git diff --check` passed.

Browser verification used one headless Chrome instance, one audit target at a time, with intercepted synthetic APIs. The broad report has **316 passed / 0 failed**, and the final focused Lab report has **148 passed / 0 failed**: **464 checks total, no uncaught exceptions, 90 screenshots**. Lab was checked at 390, 768 and 1366 px in Arabic/English and light/dark mode. Other areas used Arabic dark mobile, English light desktop, Arabic light tablet and English dark mobile. Sampled Lab marker, panel-heading and active-step contrast ratios were all at least **5.34:1**; this is a selected contrast check, not whole-page certification.

- [Combined evidence summary and exact screenshot inventory](../qa-evidence/ui-audit-resume/summary.json)
- [Broad browser assertions](../qa-evidence/ui-audit-resume/report.json)
- [Focused Lab assertions and measured contrast samples](../qa-evidence/ui-audit-resume/lab-detail/report.json)
- [Lab dark desktop](../qa-evidence/ui-audit-resume/lab-detail/lab-1366-en-dark.png)
- [Lab Arabic dark mobile result entry](../qa-evidence/ui-audit-resume/lab-detail/lab-entry-390-ar-dark.png)
- [Lab English light mobile result entry](../qa-evidence/ui-audit-resume/lab-detail/lab-entry-390-en-light.png)
- [MFA/security mobile dialog](../qa-evidence/ui-audit-resume/security-390-ar-dark.png)
- [Patient password reset mobile](../qa-evidence/ui-audit-resume/reset-password-390-en-dark.png)

Screenshots were visually inspected for staff login/registration, security, reset password, Lab queue/result entry/released history, Admin, Reception, Pharmacy and patient results. Initial harness readiness/JavaScript and color-parser errors were corrected before final result counts; the final manifests contain the passing runs. The temporary Chrome instance was closed after checks.

## Remaining findings and verification limits

- Pharmacy `fetchPrescriptionHistory` still converts failed reads to `[]`; history needs its own loading/error/retry state and stale-response coverage.
- Reception `handleCancelAppointment` handles network exceptions but does not show feedback on a non-OK HTTP response. Its native browser confirmation is outside the app's theme styling.
- Patient pagination still needs a dedicated delayed-load-more versus reload/navigation race review; this pass verified existing interaction scenarios, not every concurrent sequence.
- Some Lab reference-range placeholders truncate on narrow screens. The inputs have accessible names, but persistent visible field labels would improve discoverability.
- Browser fixtures cover both languages/directions/themes and desktop/tablet/mobile, with a full 3 × 2 × 2 size/language/theme matrix for Lab. Other areas use four representative combinations, not every possible combination. Not every dialog/menu or registration step received a fresh screenshot.
- Browser checks use intercepted synthetic APIs. Live credentials, Google, email delivery, real MFA enrollment/recovery, password reset completion, billing/dispensing and actual Lab publication to a patient's account were not exercised end to end.
- No backend/database tests were run. In particular, the inherited change to `backend/test/medicine-pricing.test.js` is outside this resumed frontend validation.
- Keyboard checks and selected computed contrast assertions are not a complete screen-reader or WCAG audit. Zoom, virtual keyboards, real touch devices and a broad browser matrix remain unverified.
- Build chunk-size warnings and the prior host memory-pressure incident remain operational concerns. The browser used one headless instance and one reused audit tab; test processes were sequential. Filesystem sandbox startup later failed with a quota error, so necessary local checks ran through approved escalation. No user browser was terminated.

## Commit assessment

The focused frontend changes passed the stated checks and are suitable to commit after normal review. **Do not treat the entire mixed working tree as approved for one commit**: it includes inherited backend work and unrelated evidence that this session did not fully validate. Keep the known open issues and live-service limits in the review. Nothing was committed or pushed.
