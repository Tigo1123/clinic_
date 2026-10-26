# Staff login submission investigation — 26 October 2026

Branch: `feat/next-improvements`. No commit, push, deployment, migration or production/staging data write was performed. The existing untracked `qa-evidence/auth-mobile-fields/` was left untouched.

## Confirmed cause

The current password form already used `withLoginSubmissionLock` and `submitInFlight`. A single DOM submit and immediate repeated submissions while the request was pending already produced one POST. There was no submit-button `onClick`, custom Enter login handler, effect-driven login call, or API-client retry. `patientMuiTheme` only creates/caches theme styles; a generated bundle's Network initiator name does not identify an extra login caller. StrictMode does not itself replay these event handlers.

**The reproduced defect is the lock's lifecycle boundary:** the helper releases its request lock after the password response is handled, but `setMfaChallenge`/navigation commit asynchronously. The password handler only checked its captured React `submitting` state. A queued/stale password handler could therefore run after lock release and call login again, even after the flow had moved to MFA or authenticated. The pre-fix component regression produced **two login requests** in both those cases; the same tests now produce one. Tests run with StrictMode and the actual staff login service/API client.

This explains how a queued interaction can create two challenges and leave the UI using an invalidated challenge. No staging event trace or deployed-build inspection was provided, so the exact physical browser event that queued the second staging invocation is not asserted. A single isolated submit was not found to emit two requests by itself on this revision.

## Backend semantics preserved

`createMfaChallenge` locks the user and marks older unused challenges with the same purpose as used before inserting the new challenge. For LOGIN, the newer challenge intentionally invalidates the older one. Verification retains challenge purpose, expiry, attempt limit, one-time use, active-account, `authVersion`, active-MFA and single-use TOTP checks.

No production backend authentication code, challenge invalidation, replay protection, expiry, TOTP configuration, authVersion behavior or rate limit was changed. The frontend transport still issues one fetch per operation and has no automatic POST retry.

## Fix

- Added a synchronous flow ref to `LoginView` alongside the existing request lock. Password submission is allowed only in the password phase; MFA/enrollment/authenticated transitions block stale password handlers before React commits.
- Store the exact accepted challenge object in the synchronous flow state and use it for verification. The rendering state mirrors that object rather than selecting a token from competing responses.
- Apply the existing synchronous lock to TOTP/recovery verification, preventing repeated verification submissions while pending and after success.
- Track attempt generation and mounted state so late responses after unmount/expiry cannot finalize an obsolete flow. Cancel, terminal challenge error, expiry and successful verification clear the challenge reference and rendered state.
- Keep the submit buttons disabled while pending and expose `aria-busy` on both forms. Genuine request failure releases the guard for a deliberate retry. Non-MFA and required-enrollment paths remain supported.
- Added component, HTTP/database and real-browser regressions. No shared patient login helper or API retry behavior was changed.

## Exact changed files

1. `frontend/src/App.jsx` — production login/MFA flow guards.
2. `frontend/test/loginScreens.test.js` — existing structural assertion follows the guarded finalization callback.
3. `frontend/test/staffLoginSubmission.test.js` — ten behavioral regressions against the real component/services/client.
4. `backend/test/staff-login-flow.test.js` — role-specific HTTP/MFA/session/replay tests, newer-challenge invalidation test, and opt-in real-browser sequence.
5. `backend/scripts/test-staff-login.js` — existing guarded isolated runner/operational-fixture approach for focused auth/MFA checks.
6. `backend/scripts/verify-staff-login-browser.js` — real application browser driver forwarding API requests to the isolated test server.
7. This report.
8. `qa-evidence/staff-login-submission/` — sanitized per-role counts/dashboard screenshots and verification results.

## Results

- Pre-fix reproduction: 4 component tests passed, 2 failed because queued submissions issued a second login POST. The completed regression file now has **10 passing tests**: one submit, rapid click/submit/Enter, pending disabled state, post-response stale handler, exact challenge use, one MFA completion, cancel/terminal cleanup, rerenders/unmount, HTTP/network failure retry, no automatic retry and non-MFA compatibility.
- **All 59 frontend test files passed.**
- **257 backend tests passed across four focused auth/MFA/integration files**, including the real-browser scenario. The complete 72-file backend suite was not run.
- Real browser at 390px, actual application and real isolated backend: **ADMIN, PHARMACIST and RECEPTIONIST each produced exactly one password login POST, one MFA verification POST, one challenge-creation audit, a stored access session and a loaded role dashboard.** Rapid native Enter presses, an additional submit event and a click during the held request did not create another login. Challenge state was absent after completion. Evidence contains counts/booleans only.
- The browser uses CDP to forward `/api` calls to the temporary test server; response bodies come from the actual backend, not synthetic login responses. Socket.IO is blocked so the test session cannot connect to an unrelated development socket server; this does not claim a new live Socket.IO test. Existing backend session/replay tests remain included.
- Tests use fresh `test_*` schemas in temporary loopback PostgreSQL `clinic_test` at port 55471, guarded operational fixtures and no general/demo seed. No staging or production data was used.
- Lint and production build passed. Six existing lint warnings and the existing bundle-size advisory remain; no new lint warnings remain.
- Backend script syntax checks and `git diff --check` passed. No migration was created.

## Reproduce

Frontend: `cd frontend && npm test && npm run lint && npm run build`.

Backend: privately set a loopback `TEST_DATABASE_URL` for the dedicated `clinic_test` database and its `TEST_DATABASE_PORT`, then run `node scripts/test-staff-login.js` from `backend/`. Each file gets a fresh isolated schema. No general seed is invoked.

For the optional real UI check, also run the local frontend at `127.0.0.1:5187` and a temporary Chrome CDP endpoint at `127.0.0.1:9337`, then set `STAFF_LOGIN_BROWSER_QA=true` for that runner. Origins can be overridden with `STAFF_LOGIN_FRONTEND_ORIGIN` and `STAFF_LOGIN_CDP_ORIGIN`; only loopback hosts are accepted. Without that flag, the browser case is explicitly skipped while HTTP/API regressions still run.

## Commit assessment

**Safe to commit for review.** Duplicate login is eliminated in the reproduced post-response race and all tested submission patterns; the real MFA → role dashboard sequence passes for the three reported roles. This is local verification, not a staging deployment claim. No sensitive credentials, challenge tokens, TOTP/recovery codes or JWTs were added to application logging or evidence. Nothing was committed or pushed.
