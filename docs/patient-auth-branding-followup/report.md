The reported old patient header came from a stale staging entry document, not a missing replacement in the current source. The shared patient AuthShell already renders ShifaLogo at frontend/src/features/patient-auth/PatientAuthPages.jsx:842, including all four language/theme combinations. No second logo implementation or application/layout change was introduced.

The initial GET /patient-login loaded index-Dm3vU5yE.js, which imports PatientAuthPages-DgSgNPYG.js. That chunk contains the old blue-icon/span/small-descriptor header. A contemporaneous GET /staff loaded index-DjS2KVYR.js. Its patient-auth chunk, PatientAuthPages-SL0DMMC_.js, imports ShifaLogo-DH7lHofd.js and renders the shared component in the header. A subsequent patient request reported CF-Cache-Status: EXPIRED and served the new entry; a normal patient request then returned the same new entry with Age: 0. The observed document policy is public, max-age=0, s-maxage=300. This is evidence of a temporary mixed-release staging window consistent with per-route shared caching. See [captured version/cache evidence](staging-shell-comparison.json).

All 16 live staging browser cases now pass: direct /patient-login and /staff → Patient portal → /patient-login, each in English/Arabic, light/dark, and 390px/1440px viewports. The existing full-document Patient portal link and home navigation are preserved. These checks loaded actual staging application/brand assets; public config and Google button rendering used controlled fixtures, and no credentials or forms were submitted. Every case uses the current index-DjS2KVYR.js. [Live browser report](staging/report.json).

The regression verifier now explicitly requires exactly one shared, localized logo inside the auth header, verifies full/compact approved asset paths, and rejects the old icon/descriptor/SVG markup there. The previous general image check could accept the form logo without independently proving the header was updated. The new transition scenario clicks the real Patient portal link separately at mobile, tablet, and desktop widths, rather than resizing only after navigation.

Local production-preview verification passed 180 layout cases, 36 exact portal transitions, 60 additional 320px reflow checks, and 56 automated accessibility scans with zero violations, across Chrome, Firefox and WebKit. This covers direct patient login, the staff-to-patient transition, registration, forgot password, and the reset-password step. Both login entry methods also passed live language/theme switching without a reload. [Local browser report](local/browser-report.json).

The shared header is used by /patient-login (including its verification state), /register (including onboarding/verification states), /forgot-password (request and reset steps), and /patient/claim (claim/offline activation). There is no separate /reset-password route in this router. Registration, recovery and reset were browser-tested locally; the additional verification/claim branches were traced to the same AuthShell in source. The remaining patient-auth-brand-mark CSS is still used for staff MFA shield icons and was retained.

Build passed. Five targeted test files passed: loginScreens, shifaBrandAssets, shifaLogo.runtime, patientOnboarding and staffLoginSubmission. Lint passed with 11 existing warnings in unchanged files; Vite retains its large Admin chunk warning. [Build](build.log), [tests](targeted-tests.log), [lint](lint.log), [diff checks](diff-check.log). All 13 approved/reference PNG checksums are unchanged; see [integrity evidence](asset-integrity.json).

Only QA/regression code and this evidence were changed. Exact files are listed in [changed-files.txt](changed-files.txt). Existing reception-cancellation and previous branding evidence were left untouched. No files were staged, committed, pushed, or deployed; no hosting settings or application navigation were changed.

Safe to commit the scoped regression/evidence changes. No further UI replacement is needed in the current application. To prevent the same transient stale-header symptom on future deployments, the hosting release process should invalidate old SPA entry documents or ensure they revalidate across /staff, /patient-login, /register, /forgot-password and /patient/claim. Hashed assets can retain their existing immutable caching. This operational follow-up was not applied to hosting during this task.

Representative staging screenshots:

| Entry | English/light desktop | Arabic/dark mobile |
|---|---|---|
| Direct | [Screenshot](staging/staging-direct-en-light-1440.png) | [Screenshot](staging/staging-direct-ar-dark-390.png) |
| Staff → Patient portal | [Screenshot](staging/staging-staff-portal-en-light-1440.png) | [Screenshot](staging/staging-staff-portal-ar-dark-390.png) |

Reproduce local checks after building and starting a production preview on port 5197:

```bash
QA_FRONTEND_URL=http://127.0.0.1:5197 \
QA_PLAYWRIGHT_MODULE=/tmp/shifa-brand-qa/node_modules/playwright/index.mjs \
QA_AXE_PATH=/tmp/shifa-brand-qa/node_modules/axe-core/axe.min.js \
PLAYWRIGHT_BROWSERS_PATH=/tmp/shifa-brand-qa/browsers \
QA_SCENARIOS=patient-login,patient-login-via-staff,registration,forgot-password,reset-password \
QA_OUTPUT=../docs/patient-auth-branding-followup/local \
node scripts/verify-shifa-branding.mjs
```

From frontend/, rerun the read-only staging check with:

```bash
QA_PLAYWRIGHT_MODULE=/tmp/shifa-brand-qa/node_modules/playwright/index.mjs \
node scripts/verify-patient-auth-staging.mjs
```

The verification scripts expect externally installed Playwright/axe-core and available browser runtime dependencies. No project dependency files were changed.
