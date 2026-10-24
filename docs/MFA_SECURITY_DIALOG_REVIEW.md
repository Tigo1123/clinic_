# MFA/security dialog investigation — 24 October 2026

Branch: `feat/next-improvements`. No commit, push, staging/production write, MFA policy change, schema change or migration was performed. The pre-existing untracked `qa-evidence/auth-mobile-fields/` was left untouched.

## Confirmed root causes and limits

1. **Duplicate current-password label:** `ProofFields` rendered an external `label` while `PasswordField` rendered its own label with the same input ID. The pre-change browser reproduction found two native associated labels. The redundant outer label is removed.
2. **Misleading disable error:** `submitManagement` mapped every HTTP error with a status to `mfaReauthFailed`. Thus 403 required-policy rejection, 422 malformed input, 429 throttling and 500 configuration/database failures all appeared to be an incorrect password/code. The frontend now maps these safe categories separately, without showing raw server details or revealing which credential failed.
3. **Production disable prohibition:** `staffMfaRequired()` is true when `NODE_ENV=production` or `STAFF_MFA_POLICY=required`. The existing backend intentionally returns 403 `MFA_REQUIRED_POLICY` before verifying disable credentials. This policy is preserved. Public configuration now includes only a non-sensitive `staffMfaRequired` boolean; the dialog disables the action and explains required policy. The backend still independently enforces it. A stale/older UI receiving a policy rejection now gets the correct safe explanation.
4. **Current codes can already be consumed:** login and enrollment update `lastTotpStep`. Management rejects a code from an already accepted step even while Google Authenticator still displays it. This is existing replay protection, not a clock-window bug. The dialog now instructs the user to wait for a fresh, unused code where needed. The actual staging response/status and runtime policy were not supplied, so a particular staging failure cannot be assigned conclusively to policy versus replay from the old generic message alone.
5. **Non-atomic management proof consumption:** disable and recovery regeneration consumed the TOTP/recovery code before their security-change transaction. If the following write/audit failed, the proof remained consumed and a retry failed authentication. Proof verification/consumption now occurs inside the same locked user transaction as the configuration change and audit. Tests force audit failures and verify rollback preserves both proof and configuration, then a retry succeeds.
6. **Reported staging plaintext display:** this was **not reproduced on the current revision**. The pre-change browser showed native `type=password`, computed password masking `disc`, eye `aria-pressed=false`, before and after typing. Do not treat this as a confirmed staging-bundle fix. Inspection did identify a shared-component escape hatch: MUI native `inputProps.type` could override the parent type independently of visibility state. The native type is now explicitly bound after those props, with an override regression. The current dialog does not pass such an override. Confirm the deployed revision/cache/browser behavior separately if plaintext persists on staging; no user password or live MFA factor was requested or recorded.

## Changes

- `frontend/src/components/PasswordField.jsx`: native input type remains owned by visibility state; default masking and independent toggles preserved.
- `frontend/src/components/StaffSecurityDialog.jsx`: one current-password label; safe management/enrollment error mapping; required-policy information and disabled disable action; fresh-code guidance; pending submission guard.
- `frontend/src/services/staffMfa.js`: safe error-category mapping; existing DELETE payload contract unchanged.
- `frontend/src/i18n.js`: Arabic/English policy, malformed-request, availability, state-change and fresh-code messages.
- `backend/src/server.js`: expose the non-sensitive policy boolean in the existing safe public configuration.
- `backend/src/routes/mfa.js`: recheck current credential generation under the user lock; consume proof and mutate MFA configuration atomically for disable/regeneration. Invalid credentials retain the same generic response. Recovery hash generation occurs only after valid proof.
- `backend/src/services/mfa.js`: proof-consumption helpers accept a transaction client; other callers retain their existing default Prisma behavior.
- `backend/scripts/test-clinic-readiness.js`: include the new management regressions, MFA unit tests and public-config HTTP checks in the existing isolated readiness suite.
- Tests: `backend/test/mfa-management.test.js`, `backend/test/scheduling.test.js`, `frontend/test/passwordField.test.js`, `frontend/test/staffMfa.test.js`, `frontend/test/staffSecurityDialog.test.js`.
- Browser harness: `frontend/scripts/verify-mfa-security-dialog.mjs`.
- This report and `qa-evidence/mfa-security-dialog/` evidence.

## Security policy and accounting of secrets

- A current password and exactly one allowed proof remain required. Password checking still uses bcrypt; it does not trim or alter the password.
- TOTP remains an ASCII six-digit string throughout the request path; leading zeroes are preserved. Existing OTPAuth SHA1, 6 digits, 30 seconds, **±1 step** and monotonic single-use checks are unchanged. Independent RFC 6238/window unit tests pass.
- Unused recovery codes remain supported under the existing policy. Invalid and previously used recovery codes share the combined credential failure; exposing which factor failed would introduce an oracle. There is no recovery-code expiry field in the existing model, so no expiry policy was invented.
- No MFA rate limits were changed. Public policy metadata does not authorize a disable operation.
- No submitted passwords, codes, recovery codes or MFA secrets were added to application logs. Browser fixture reporting records only booleans/lengths and uses synthetic data. Submitted synthetic proof values were cleared before final screenshots.
- Successful disable removes encrypted configuration, recovery-code records and outstanding challenges; increments `authVersion`; revokes previous HTTP/socket access under the existing policy. The response contains only `{state: 'DISABLED'}`. Regeneration retains its existing one-time recovery-code delivery behavior.
- Transaction timeout allows bounded bcrypt/recovery work; it does not change the accepted TOTP window, replay rules or request limits.

## Verification

The existing isolated approach was used: fresh `test_*` schemas in temporary loopback PostgreSQL `clinic_test` at port 55471, guarded operational fixtures, no general/demo seed, no production/staging tests.

- Focused MFA/backend integration run: **253 tests passed across four files**.
- Broader readiness run: 22 files; the only initial failure was the exact public-config allowlist expecting the old fields. Its expectation was updated to include the policy boolean and rerun in a fresh schema. **Final per-file result: 377 passed, 0 failed across 22 files**, recorded in `qa-evidence/mfa-security-dialog/verification.json`; the entire 71-file backend suite was not run.
- Frontend: **all 58 test files passed**, including the actual dialog with the real shared password field, both languages, label count, masking/toggles, leading-zero payload and server-error classification.
- Styled browser matrix: **169 checks passed, 16 captures**, mobile 360px/desktop 1366px, Arabic/English, light/dark. Verified hidden/reveal/remask state, one accessible label, intact leading-zero string submissions, safe 401/403/422/429/500 messages, required policy and viewport fit.
- Lint and production build passed. The six existing lint warnings and bundle-size advisory remain. Backend/script syntax and `git diff --check` passed.
- Tests cover valid password/fresh TOTP, wrong password, invalid and replayed TOTP, valid/reused recovery, malformed requests, mandatory policy, corrupt configuration, failed-audit rollback for both factors, concurrent disable, no sensitive response data, configuration removal and session invalidation.

## Manual review

1. Open Security as an MFA-enabled staff member. In required-policy environments, verify that Disable is unavailable and the policy is explained. Regeneration remains available under its existing rules.
2. In an isolated environment where policy already permits disabling, open Disable. Verify one current-password label, masked typing, correct eye action and preserved input when toggling in Arabic/English.
3. Use a fresh authenticator code not already used to log in or enable MFA; verify successful disable and required sign-in afterward. Repeat on a separate isolated account using an unused recovery code.
4. Wrong password, wrong TOTP and reused recovery code must keep the same generic authentication failure. Malformed input, throttling, required policy and server failures must have distinct safe messages.
5. If the staging plaintext issue persists, inspect only input type, toggle state, associated-label count, deployed revision and computed masking. Do not capture or share a real password, secret, recovery code or live authenticator code.

## Commit assessment

Safe to commit **for review**, subject to the explicit staging-reproduction limit above. The code preserves mandatory MFA and proof/replay/rate-limit controls, fixes the confirmed dialog/error/atomicity defects, and has no migration. No claim is made that an unreproduced staging plaintext symptom has been conclusively diagnosed. No commit or push was performed.
