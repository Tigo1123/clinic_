The Shifa branding patch is ready for a scoped review and commit. No commit or push was made, and the index is empty.

All 11 expected application assets resolve over HTTP, decode in Chrome, Firefox and WebKit, and match the approved source bytes in both the built output and served responses. All 14 supplied asset/reference files retain their starting SHA-256 checksums; see [asset integrity](approved-asset-integrity.json). README.md and the two PWA source PNGs have no application references or observed runtime requests.

Full, language/theme-aware logos now appear above Staff Login, Patient Login, Forgot Password, Reset Password, registration, patient verification, staff MFA, MFA recovery, required MFA enrollment, and required staff password change. They use object-fit: contain in a reserved 272px × 128px maximum box; narrow layouts keep the full form logo while navigation uses the approved compact mark. Responsive logos retain a localized accessible name when the full lockup is hidden. Live language and theme changes update the asset without reloading.

| Engine | Version | Layout cases passed | Additional 320px reflow cases |
|---|---|---:|---:|
| chromium | 156.0.8078.47 | 156 | 52 |
| firefox | 157.0 | 156 | 52 |
| webkit | 27.2 | 156 | 52 |

The matrix covers English/Arabic × light/dark × mobile 390×844, tablet 768×1024 and desktop 1440×1000 on 13 surfaces: public page; both login pages; forgot/reset password; registration; staff MFA, recovery and enrollment; patient verification; Admin profile with global header and Admin sidebar; patient appointments with header/navigation; and required staff password change. The public page includes header, footer and preview sidebar. The patient header logo moves with the existing sidebar/mobile navigation layout.

There are **468 passing layout cases, 156 passing 320px reflow cases, zero runtime/loading/layout errors, and zero violations in 120 automated WCAG A/AA scans**, including mobile/desktop scans on all 13 Chrome surfaces and both login pages in Firefox/WebKit. Keyboard checks confirm visible login focus and public mobile-menu Escape/focus restoration. Manual screenshot inspection covered representative English/Arabic login, Admin and recovery states. The final focused rerun verifies public, verification and reset screens after correcting footer targets and success-notice colors; its 108 cases replace those entries in the consolidated report. See [browser report](browser-report.json), [focused rerun](focused-rerun.json), and browser logs.

Responsive/accessibility fixes include English hero text reflow, compact marks at the actual header/sidebar breakpoints, dark-mode link/navigation contrast, readable public preview text, registration dividers, success/error notices, and 44px footer links. Approved images were not edited or filtered.

Full-logo dimensions are EN light 610×240, EN dark 270×110, AR light 445×240, and AR dark 270×105. The compact mark is 180×210. Favicon sizes are 16/32/64px; Apple touch icon is 180px; manifest icons are 192/512px. The HTML references the approved 16/32/180px icons and /manifest.webmanifest. Manifest size declarations match decoded images. Chrome parsed the manifest with no errors; the declared theme/background are #0F766E and #F8FAFC. This verifies manifest/icon references; offline installation behavior is outside this patch.

Build passed; 11 targeted test files passed, including branding, logo switching, login single-flight/MFA, password controls and onboarding. Lint passed with 11 warnings in unchanged files. Vite reports its existing large Admin chunk warning. [Build](build.log), [tests](targeted-tests.log), [lint](lint.log), [diff check](diff-check.log), and [reference scan](source-reference-scan.log) are saved here. Dependencies for the verification harness were installed under /tmp; package manifests and lockfiles were not changed.

Exact pending application/asset/test files: [changed-files.txt](changed-files.txt) (41 paths). Exact generated evidence files: [evidence-files.txt](evidence-files.txt). The supplied asset/reference files are listed because they are untracked additions in the existing patch; their contents are unchanged. The unrelated pre-existing docs/reception-cancellation-evidence/ files remain untouched and must be excluded from a branding commit. HEAD remains 38e283e691409ff6e43f1625d825a2c4d0a2ebb6.

The browser run uses the production build with synthetic API/session/Google-button fixtures and emulated viewport sizes. It does not validate live credentials, email/OTP delivery, OAuth allowlisting, backend MFA execution, physical devices, or a full screen-reader audit. Shared palette tokens affect other staff workspaces; their complete clinical workflows were not exercised. No known blockers remain within the verified branding scope.

Representative login screenshots (light: desktop; dark: mobile):

| Screen | Chrome | Firefox | WebKit |
|---|---|---|---|
| staff-login · en · light | [chromium](chromium-staff-login-en-light-desktop.png) | [firefox](firefox-staff-login-en-light-desktop.png) | [webkit](webkit-staff-login-en-light-desktop.png) |
| staff-login · en · dark | [chromium](chromium-staff-login-en-dark-mobile.png) | [firefox](firefox-staff-login-en-dark-mobile.png) | [webkit](webkit-staff-login-en-dark-mobile.png) |
| staff-login · ar · light | [chromium](chromium-staff-login-ar-light-desktop.png) | [firefox](firefox-staff-login-ar-light-desktop.png) | [webkit](webkit-staff-login-ar-light-desktop.png) |
| staff-login · ar · dark | [chromium](chromium-staff-login-ar-dark-mobile.png) | [firefox](firefox-staff-login-ar-dark-mobile.png) | [webkit](webkit-staff-login-ar-dark-mobile.png) |
| patient-login · en · light | [chromium](chromium-patient-login-en-light-desktop.png) | [firefox](firefox-patient-login-en-light-desktop.png) | [webkit](webkit-patient-login-en-light-desktop.png) |
| patient-login · en · dark | [chromium](chromium-patient-login-en-dark-mobile.png) | [firefox](firefox-patient-login-en-dark-mobile.png) | [webkit](webkit-patient-login-en-dark-mobile.png) |
| patient-login · ar · light | [chromium](chromium-patient-login-ar-light-desktop.png) | [firefox](firefox-patient-login-ar-light-desktop.png) | [webkit](webkit-patient-login-ar-light-desktop.png) |
| patient-login · ar · dark | [chromium](chromium-patient-login-ar-dark-mobile.png) | [firefox](firefox-patient-login-ar-dark-mobile.png) | [webkit](webkit-patient-login-ar-dark-mobile.png) |

Additional screenshots: [chromium-admin-ar-dark-tablet](chromium-admin-ar-dark-tablet.png), [chromium-patient-layout-ar-dark-tablet](chromium-patient-layout-ar-dark-tablet.png), [chromium-public-ar-dark-tablet](chromium-public-ar-dark-tablet.png), [chromium-public-footer-en-light-desktop](chromium-public-footer-en-light-desktop.png), [chromium-registration-ar-dark-tablet](chromium-registration-ar-dark-tablet.png), [chromium-reset-password-ar-dark-tablet](chromium-reset-password-ar-dark-tablet.png), [chromium-staff-enrollment-ar-dark-tablet](chromium-staff-enrollment-ar-dark-tablet.png), [chromium-staff-mfa-ar-dark-tablet](chromium-staff-mfa-ar-dark-tablet.png), [firefox-public-footer-en-light-desktop](firefox-public-footer-en-light-desktop.png), [webkit-public-footer-en-light-desktop](webkit-public-footer-en-light-desktop.png).

Reproduce against a local production preview with Playwright and axe-core available:

```bash
QA_PLAYWRIGHT_MODULE=/tmp/shifa-brand-qa/node_modules/playwright/index.mjs \
QA_AXE_PATH=/tmp/shifa-brand-qa/node_modules/axe-core/axe.min.js \
PLAYWRIGHT_BROWSERS_PATH=/tmp/shifa-brand-qa/browsers \
node frontend/scripts/verify-shifa-branding.mjs
```

The default preview URL is http://127.0.0.1:5196. Override QA_FRONTEND_URL, QA_CHROME, QA_BROWSERS or QA_OUTPUT as needed. Browser runtime libraries are environment-specific; no system packages were installed during this task.
