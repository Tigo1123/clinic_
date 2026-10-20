# Audit issue #8: complete discovery and CI coverage

Branch: `fix/audit-issues`, starting commit `c27adf8`. No commits or pushes. Scheduling production code and its activation policy are unchanged. The protected theme script and `qa-theme-evidence/` are untouched.

## Inventory and execution evidence

The checked-out commit has **41 top-level backend test files, no nested test files, and 22 literal paths in the old runner**, leaving **19 omitted files**. This differs from the requested 23/18 tally; it was verified directly against `git show c27adf8:backend/test/run-tests.js`, not inferred from the new runner. All 19 omitted files are accounted for below.

| Previously omitted file |
| --- |
| `test/admin-doctor-management.test.js` |
| `test/browser-security.test.js` |
| `test/external-identity-foundation.test.js` |
| `test/first-admin-provision.test.js` |
| `test/google-identity.test.js` |
| `test/google-patient-link.test.js` |
| `test/google-patient-onboarding.test.js` |
| `test/google-patient-verify.test.js` |
| `test/lan-backup-restore.test.js` |
| `test/lan-database-bootstrap.test.js` |
| `test/lan-deployment-foundation.test.js` |
| `test/lan-full-acceptance.test.js` |
| `test/lan-recovery-resilience.test.js` |
| `test/lan-runtime-independence.test.js` |
| `test/lan-same-origin.test.js` |
| `test/phone-verification.test.js` |
| `test/schedule-workflow.test.js` |
| `test/specialty-delete.test.js` |
| `test/staging-demo-staff.test.js` |

Two new regression files bring the final inventory to **43 files: 42 top-level and 1 nested**. `test/test-runner.test.js` tests discovery and execution; `test/isolation/database.test.js` demonstrates nested discovery and actual database isolation. The machine-readable [results](audit-issue-8-results.json) contain the original inventory, exact selected/discovered file manifest, per-file schema/setup/result/counts, and aggregate counts. This is file and test-case coverage evidence, not line/branch instrumentation.

The first complete run executed all 41 original files: **562 individual tests, 558 passed, 4 failed, 0 skipped, 0 cancelled**. No test was skipped to resolve a failure.

The corrected complete backend run executed **43/43 files**, with **572 passed, 0 failed, 0 skipped, 0 cancelled, 0 todo** individual tests. Every file has a positive test count and passed status, and the executed manifest exactly matches the discovered manifest.

Frontend `npm test` passed **239 individual tests across all 39 test files**, with **0 failed, skipped, or cancelled**. Frontend lint completed with the six existing warnings (duplicate translation keys, onboarding control regex, ThemeContext export); build passed. Targeted lint for all changed backend JavaScript passed with no warnings, and `git diff --check` passed.

Focused entry points were also executed separately: `npm test -- test/isolation/database.test.js` ran **1/1 file and 1 passing test**; `npm run test:schedule-workflow` ran **2/2 files and 10 passing tests**, with seeding disabled for both files. An actual missing-file CLI invocation returned exit 1 before database setup. Nine executable runner regressions cover recursive/empty discovery, focused paths, symlink escape rejection, database target validation, real child failure/signals/spawn errors, generation/seed failure propagation, sequential execution after a test failure, and count parsing. Workflow YAML was parsed locally and its triggers/frontend test step verified.

## Runner behavior and setup

- Discovery recursively walks `backend/test/**/*.test.js` in deterministic order and fails clearly when empty. Helpers and non-test files are not selected. Symlink test files/directories are refused rather than allowed to escape discovery's root.
- Focused runs still work (`npm test -- test/name.test.js`, including nested paths). Every request must resolve to an existing discovered test file inside the real test directory. Missing files, directories, non-test files, traversal outside the directory, and symlink escapes fail before generation, migration, or seed work.
- Each file gets a fresh schema, migrated sequentially. Existing API/auth/catalogue tests require the existing seed's staff, doctors, States, services, and opening stock ledger; the seed runs only in that file's isolated test schema. This also prevents tests that edit seeded accounts/catalogues from contaminating later files.
- `schedule-workflow.test.js` creates its own fixtures and requires a clean `schedule_workflow_*` schema; the default runner supplies that schema without seeding. It is now actually selected by discovery. Its six tests run alongside every other file.
- The standalone `npm run test:schedule-workflow` delegates to the same runner with both scheduling and clinic-time tests and disables seeding, preserving its previous no-seed setup.
- Prisma generation, migrations, and seed failures stop the run and return nonzero. Individual test failures remain failures while later files still execute, so the full file inventory is accounted for. Child launch errors, signals, missing TAP results, and timeout failures also return nonzero. Execution is sequential, with `--test-concurrency=1` explicitly supplied for every file.
- A JSON manifest is written incrementally (default path printed by the runner; `TEST_REPORT_PATH` can select an artifact path). It records discovered/selected/completed file counts separately from test/pass/fail/skip/cancelled/todo counts.

## Newly exposed failures and resolutions

1. **Google unavailable-configuration test: expected 503, got 401.** The endpoint was correctly rejecting the fake credential because local Google configuration was present. The test now explicitly clears `GOOGLE_CLIENT_ID` for the missing-configuration case and restores it afterward. It retains the exact 503/code/sanitization assertions; no production behavior changed.
2. **LAN HSTS test expected no HSTS.** Commit `b2950cf` deliberately added one-year HSTS at Nginx TLS termination, including static-location headers. The test now asserts both configured headers and their exact max-age, rather than demanding the removed behavior. The contradictory old LAN README sentence was corrected to describe the committed behavior. Nginx configuration was not changed.
3. **LAN readiness test expected internal dependency fields.** Commit `f7bd805` intentionally sanitized public health responses. The source regex was replaced by executable requests that assert 503/unhealthy when revocation is down or the DB ping fails, and 200/healthy when both are ready, with exact minimal bodies. The server response was not changed.
4. **Verification delivery test expected obsolete inline throw/deletion code.** Delivery handling is centralized in `createVerificationChallenge` and marks undelivered challenges used. Executable tests now exercise disabled email and a throwing SMTP transport, require the original 503 error/code, verify all undelivered challenges are invalidated, and verify the account remains unchanged. SMTP is mocked; no real messages are sent. Existing record-delivery and production-config assertions remain. No production verification code changed.

The real defects fixed by this issue are incomplete discovery/CI and insufficient runner isolation. No evidence justified changing scheduling activation policy or weakening domain validation.

## Database isolation audit

- Only explicit PostgreSQL URLs for **localhost/127.0.0.1:5433/clinic_test** are accepted. Other databases (including clinic_dev), application-container hosts, other ports, non-PostgreSQL schemes, and malformed URLs are rejected before setup. Local credentials are obtained internally from the existing `clinic-test-db` container without printing them.
- Every file receives equal `DATABASE_URL` and `SOCKET_REVOCATION_DATABASE_URL`, pointing to its generated schema. Existing URL query options are replaced; Prisma receives `schema`, and raw `pg` receives `options=-c search_path=<same schema>`. This closes the Prisma-only schema gap for raw connections.
- The nested isolation test creates a Prisma sentinel, reads it through raw `pg` using the revocation URL, then reads it in a separate inherited-environment Node/pg subprocess. It asserts the actual database, actual schema, and sentinel identity/count.
- Socket server forks inherit the isolated URL pair. Their intentional listener-outage override points to closed loopback port 1 and performs no writes. The staging-demo subprocess explicitly receives the current isolated URL via `DEMO_STAFF_DATABASE_URL`, with matching database confirmation. Seed subprocesses inherit the same isolated environment.
- Medicine migration and reference bootstrap tests create their own `medicine_migration_*` / `reference_bootstrap_*` schemas on that same connection and explicitly set search_path; specialty migration tests use a separate `specialty_migration_*` schema inside a rolled-back transaction. Their cleanup affects only those disposable schemas.
- Other `DATABASE_URL` overrides use `.invalid` hosts for configuration/policy rejection tests; those paths validate/refuse before database work and restore their environments. None redirects a writer to clinic_dev or the Docker application database.
- No qa:reset, development/application seed, database reset, or application service shutdown was run. Per-file schemas are retained for inspection; existing tests only clean up their own disposable fixtures/schemas.

## CI changes and limits

Push checks now include `fix/audit-issues`, retaining main/redesign and the existing pull-request triggers. The job supplies a dedicated `clinic-test-db` PostgreSQL service on 5433 and runs backend discovery. Frontend `npm test` now runs alongside lint/build. An always-run artifact step uploads the backend manifest/results, including on test failure.

All verification reported here is **local**. No commit, push, GitHub Actions run, Docker image build, or deployment was performed. Syntax/configuration inspection and local command execution do not claim a real Actions result. The frontend sandboxed runner initially reported file-level results without reliable child output; the test command was rerun outside that restriction to obtain the real individual counts.

## Changed files

- `.github/workflows/ci-cd.yml`
- `backend/test/run-tests.js`
- `backend/test/helpers/testRunner.js`
- `backend/scripts/test-schedule-workflow.js`
- `backend/test/test-runner.test.js`
- `backend/test/isolation/database.test.js`
- `backend/test/google-patient-verify.test.js`
- `backend/test/lan-deployment-foundation.test.js`
- `backend/test/lan-recovery-resilience.test.js`
- `backend/test/lan-runtime-independence.test.js`
- `deploy/lan/README.md`
- This report and its JSON evidence.
