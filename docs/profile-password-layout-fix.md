# Patient Profile password layout — 30 October 2026

Fixed locally; nothing committed, pushed, or deployed.

## Root cause

The shared `PasswordField` already specifies a 50px `.MuiOutlinedInput-root`, 12px inline padding, vertically centered content, and a 44×44px eye button. Those styles were healthy.

Patient workspace CSS applied `.patient-card fieldset { margin: 1rem 0 }` to every fieldset, including MUI's decorative `.MuiOutlinedInput-notchedOutline`. On the reproduced Profile route, the root font size was 15px, so this added 15px above and below the absolutely positioned outline: **50 − 15 − 15 = 20px** of visible border. The outer input control still measured 50px, while its border appeared as a thin horizontal bar. All three password fields reproduced this defect.

The input itself measured 23px high with 23.2px line-height and was centered inside the 50px flex control; the icon button was already 44px and centered. Neither inherited input padding nor the Profile grid was shrinking the control. Increasing `PasswordField`'s height or adding more `!important` overrides would not address this border collision.

A second issue affected label spacing on a direct Profile visit: `.shifa-password-field` and `.shifa-password-label` base rules lived in the lazily loaded authentication stylesheet. Profile could render before that stylesheet was ever loaded, leaving its label inline rather than block-level with the intended 5px gap.

## Exact files changed

- `frontend/src/layouts/patient.css`: apply native fieldset/legend spacing only to non-decorative fieldsets (`:not([aria-hidden="true"])`). MUI's hidden outline fieldset retains its own zero margins. Native form-group spacing remains intact.
- `frontend/src/components/ui/ui.css`: move the two existing shared PasswordField wrapper/label rules into the UI stylesheet loaded by `main.jsx` on every route.
- `frontend/src/features/patient-auth/patientAuth.css`: remove those duplicate shared rules; keep authentication-specific spacing and label colors.
- `frontend/scripts/verify-password-field-layout.mjs`: add the reproducible browser regression/comparison matrix, including a baseline mode.
- This report and `qa-evidence/profile-password-layout/`.

`PasswordField.jsx`, its `sx` overrides, password visibility logic, API calls, and Profile component markup are unchanged. The unrelated pre-existing backend test modification is outside this fix.

## Verification

- `node test/passwordField.test.js`: **10 passed, 0 failed**. Existing visibility, independent toggles, masking, labels, language/theme rendering, and native-prop protections pass.
- `node scripts/verify-password-field-layout.mjs`: **457 checks passed, 0 failed, 0 uncaught browser exceptions**; **48 screenshots**.
- Browser coverage: Arabic/English × light/dark × 1366px desktop/390px mobile, comparing actual Profile, staff login, patient login, reset-password routes, and the real MFA/password-change dialog components.
- Every measured control and outline is now **50px**; every eye button is **44×44px**, within browser subpixel rounding. Input/button centers align, labels have at least 5px separation, helper text does not overlap, reveal/remask preserves geometry, and there is no horizontal overflow. RTL adornment placement and LTR password entry are preserved.
- Native fieldset spacing remains intact, while MUI outline margins are zero.
- `npm run build`, browser script syntax check, and `git diff --check`: passed. Existing large-bundle warning remains. No full `npm test` was run.

Evidence: `qa-evidence/profile-password-layout/browser-report.json`, test/build logs, and screenshots. The `before/` directory records the original 20px borders and expected baseline failures. API requests, including reset-flow submissions, are intercepted fixtures; no backend is contacted by the browser matrix.

## Scope

The border correction applies to MUI outlined controls inside patient cards, which is where the bad selector lived. It does not change the healthy dimensions of login, reset, or staff security fields. Shared label/wrapper rules now load consistently on all routes; authentication-specific appearance remains intact. This is a CSS correction at the source of the collision, with no Profile-only height override.
