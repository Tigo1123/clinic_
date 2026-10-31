The public and patient headers now share a localized, capability-driven PWA install action beside the existing ShifaLogo. No approved images, favicon files, manifest entries, dependencies, or staff dashboard components changed. Nothing was staged, committed, or pushed.

The exact 15 implementation, test, and QA files are listed in [implementation-files.txt](implementation-files.txt). [changed-files.txt](changed-files.txt) also lists every evidence file created for this task; unrelated existing evidence directories are excluded.

| File | Change |
| --- | --- |
| `frontend/src/main.jsx` | Start one install-event controller before configuration loading and React mounting; clean up on hot reload. |
| `frontend/src/app/pwa/pwaInstallStore.js` | Shared deferred prompt, single-use handling, choice/error/race handling, installed and standalone detection, iOS fallback state. |
| `frontend/src/app/pwa/usePwaInstall.js` | Subscribe React components to the shared controller. |
| `frontend/src/components/pwa/PwaInstallButton.jsx` | Shared accessible install control and localized iOS instruction dialog. |
| `frontend/src/components/pwa/pwaInstall.css` | Theme tokens, focus outlines, 44px targets, compact presentation. |
| `frontend/src/i18n.js` | Arabic/English labels, installation status, and iOS instructions. |
| `frontend/src/features/public/components/LandingHeader.jsx` | Place control beside the logo, outside the logo link. |
| `frontend/src/features/public/public.css` | Align the logo/control group. |
| `frontend/src/features/patient-auth/PatientAuthPages.jsx` | Integrate once in the shared patient AuthShell header. |
| `frontend/src/features/patient-auth/patientAuth.css` | Align the patient-auth logo/control group responsively. |
| `frontend/src/layouts/PatientLayout.jsx` | Integrate the compact control beside the signed-in patient logo. |
| `frontend/src/layouts/patient.css` | Preserve the sidebar-aligned desktop header and mobile header fit. |
| `frontend/test/pwaInstall.test.js` | 11 controller tests covering capability, lifecycle, races, retries, cleanup, and fallback. |
| `frontend/scripts/verify-pwa-install.mjs` | Production browser UI, layout, keyboard, state, and accessibility matrix. |
| `frontend/scripts/verify-native-pwa-install.mjs` | Native Chrome offer, installation, standalone launch, and installed-tab verification in an isolated profile. |

The root integration point is `main.jsx`: the event listener starts before the initial public-config request. An install offer therefore survives configuration loading, lazy route mounting, and SPA navigation. Each header uses the same PwaInstallButton/usePwaInstall/controller; it does not register its own install listeners. Patient login, registration, recovery/reset steps and applicable verification/claim states inherit the action through AuthShell. Staff headers do not render it.

| Platform/state | Behavior |
| --- | --- |
| Any browser delivering a valid `beforeinstallprompt` event | Show Install app / ثبّت التطبيق. Invoke its `prompt()` synchronously from the user gesture. No browser-name allowlist. This includes compatible Chrome, Samsung Internet, and other Android implementations. |
| Dismissal or prompt error | Discard the consumed event; hide the action until a fresh browser offer. Announce localized status. |
| Accepted choice | Hide the control and announce acceptance; do not claim completed installation until `appinstalled`. |
| `appinstalled` | Immediately clear the saved offer and hide the action, including installation initiated through browser UI. |
| Standalone display mode or iOS `navigator.standalone` | Hide the action; also react to live display-mode changes. |
| iPhone/iPad without a direct offer | Show a button opening localized Share → Add to Home Screen instructions. Keyboard focus is trapped and restored; Escape closes the dialog. |
| Other browsers without an actual offer | Hide the control. No inactive install button or confusing settings link. |

Platform detection is used only for iOS manual instructions. A usable prompt event takes precedence. iPad desktop mode is recognized through the Mac platform plus touch capability. Instructions follow [Apple's Add to Home Screen guidance](https://support.apple.com/en-lb/guide/iphone/iphea86e5236/27/ios/27), including the optional Open as Web App setting. Browser offer timing and eligibility remain under the browser's control, as described in [the PWA installation prompt guidance](https://web.dev/learn/pwa/installation-prompt).

There is no portable installed-app inventory API. In particular, an ordinary Safari tab cannot reliably determine that a separate Home Screen installation already exists. Standalone launches and installation events hide the action; other iOS browser tabs can still offer the manual hint. No persistent local-storage guess is used to suppress valid installation opportunities.

[verification-summary.json](verification-summary.json) merges reruns by case identifier, using the final result. It contains **232 distinct layout/interaction cases with zero functional errors** and **124 accessibility scans**. Languages are Arabic/English, themes light/dark, viewports mobile/tablet/desktop. Main widths are 390/1440px, with 320/768px supplemental coverage and public-header breakpoint checks at 520, 620, 900, 1050, 1051, 1100, 1180, 1200 and 1280px.

| Browser/profile | Distinct cases | Result |
| --- | ---: | --- |
| Desktop Chromium, including narrow/tablet and additional auth routes | 64 | Functional checks pass. |
| Android Chromium emulation | 24 | Gesture-driven prompting, dismissal, fresh-offer retry, acceptance and installation-state updates pass. |
| Samsung capability/UA emulation | 24 | Same event-driven behavior; identity does not gate prompting. |
| Firefox without a prompt | 24 | Control hidden; layout intact. |
| Desktop WebKit without a prompt | 24 | Control hidden; layout intact. |
| iPhone WebKit emulation | 24 | Localized hint, dialog contrast, keyboard/focus, and installation-state updates pass. |
| iPad desktop-mode WebKit emulation | 12 | Hint detection and dialog behavior pass. |
| Chromium standalone fixture | 24 | Hidden initially and during live display-mode changes; cleared offers do not reappear. |
| iOS installed/standalone fixture | 12 | Hidden despite later install offers. |

The browser matrix uses real production JS/CSS with synthetic prompt/choice/display-mode events and API/Google-sign-in fixtures. It verifies keyboard and touch activation, no automatic prompting, preservation of transient user activation, pending-button disabling, one-shot prompt handling, live locale/theme changes, correct RTL/LTR placement, 44px targets, and no overlap or horizontal page overflow. It is not an authentication/backend integration test. Eight cases additionally verify both direct patient-login navigation and `/staff` → Patient portal → `/patient-login`, with the install action absent from the staff header. Registration and password recovery have eight cases each.

No accessibility violation involves the install control or its hint dialog. The 320px English landing page has one existing `scrollable-region-focusable` finding on an `<aside>` in each theme. Both reproduce **before any install offer/control**; the before/after evidence is in [narrow-final/browser-report.json](narrow-final/browser-report.json). These two page findings make the raw narrow accessibility runs exit 1 and remain outside this change. The main matrix, final iOS dialog run, and auth-entry run have zero accessibility findings. These automated checks do not replace a full manual assistive-technology audit.

[native-browser-report.json](native-browser-report.json) records desktop Google Chrome 156.0.8078.47 emitting a real trusted `beforeinstallprompt`, displaying the control, and reporting zero manifest/installability errors. Actual installation and standalone launch succeeded in an isolated profile. The real standalone window hid the action, and a fresh ordinary tab after installation received no offer and hid the action. The test installation was removed.

Native installation used DevTools `PWA.install`, which bypasses the browser chooser and did not emit `appinstalled` into the original tab. Real chooser acceptance/dismissal and a real `appinstalled` event are therefore not claimed by this native run; those paths pass the controlled UI/state tests. Android/Samsung and iPhone/iPad results use emulation, not physical devices or an actual Samsung Internet binary. Physical-device acceptance remains a release confirmation step.

Representative captures:

- [English/light desktop public header](chromium-public-en-light-1440.png)
- [Arabic/dark Android-emulated patient login](android-chromium-patient-login-ar-dark-390.png)
- [English/light signed-in patient header](chromium-patient-layout-en-light-1440.png)
- [Final Arabic/dark iOS installation instructions](ios-final/ios-webkit-public-ar-dark-390-instructions.png)
- [Native Chrome install offer](native-chrome-install-offer.png)
- [Actual installed standalone window](native-chrome-installed-standalone.png)

Validation completed:

- `node test/pwaInstall.test.js`: 11/11 pass; [log](pwa-state-tests.log).
- Targeted Node tests for PWA install, login screens, patient onboarding, ShifaLogo runtime, and approved assets: all five files pass; [log](targeted-tests.log).
- `npm run build`: passes; existing large-chunk advisory remains; [log](build.log).
- `npm run lint`: passes with 11 existing warnings, none in the new PWA modules/test/scripts; [log](lint.log).
- Tracked and new-file whitespace checks: no findings; new-file diff exit 1 is the normal difference status, recorded in [diff-check.log](diff-check.log).
- All 13 tracked brand assets match HEAD byte for byte; manifest and index also match HEAD. [Asset checksums](asset-integrity.json). The application does not reference the source/reference README or PWA source PNGs.
- Index is unchanged; HEAD remains `c9fbcda` (`fix: improve Shifa PWA icon rendering`).

Reproduction uses a local production preview (`npm run preview -- --host 127.0.0.1 --port 5199 --strictPort`). The QA scripts accept `QA_PLAYWRIGHT_MODULE`, `PLAYWRIGHT_BROWSERS_PATH`, `QA_AXE_PATH`, and `QA_FRONTEND_URL` for externally installed browser tooling. The UI runner supports `QA_PROFILES`, `QA_WIDTHS`, `QA_ROUTES`, and `QA_OUTPUT` for focused runs. The native runner requires a graphical Chrome environment and installs/uninstalls only the local preview in its temporary profile.

The patch is safe for a scoped commit of the 15 listed implementation/test/QA files and the desired evidence. Existing unrelated untracked work is excluded from the file manifest. Physical-device installation confirmation and the existing landing-page accessibility findings remain explicit limitations. No commit or push was performed.
