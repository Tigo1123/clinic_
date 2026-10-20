# Doctor scheduling workflow fix

Branch: `fix/audit-issues`. No commit or staging performed. No `AGENTS.md` exists in this repository or its ancestor directories. Existing issue #4 work was preserved and extended; its original four files were copied to `/tmp/clinic-schedule-before/` before editing. The protected theme script and `qa-theme-evidence/` were not modified.

## Findings and request trace

`AdminSchedulePanel` sends authenticated POST/PUT requests via `staffApi` and `apiClient` to `/api/admin/doctors/:doctorId/schedules[/scheduleId]`. `adminScheduling.js` authenticates the caller, requires ADMIN, and validates a strict Zod payload (including all seven weekday enum values). `replaceSchedule` validates times, active periods and breaks, locks the Doctor row in a Prisma transaction, checks ownership and version ranges, checks future appointment conflicts, replaces child periods/breaks, and writes an audit record. Status activation also checks doctor ownership and excludes the activated schedule's own ID from version conflicts.

The exact reported period error comes from comparing active periods **within the submitted payload**, before database work. Every added period defaulted to Monday 09:00–17:00, and the UI had no weekday selector. Adding two rows therefore generated a legitimate overlap. PostgreSQL and the weekday schema do not impose a Monday-only restriction. The fix supplies a seven-day selector on every period and returns the actual conflicting day and intervals. Overlap, break, ownership, and future-appointment validation remain enforced.

Self-conflict was not found in the existing update/activation version checks: both exclude their own schedule ID. API/database tests confirm unchanged-period updates and repeat activation succeed, while other active versions still conflict. Adjacent time periods are allowed.

A separate repeat-edit problem existed: after creating tomorrow's replacement, the editor selected today's version again and could POST a second replacement. The editor now selects the nearest active future version when one is pending, shows its effective date, and edits it using PUT. Other consumers retain the helper's current-first default. Edits also preserve `effectiveTo`, rather than silently making a bounded version open-ended.

The existing latest-request guard compared doctor IDs, allowing an old A response after A→B→A. Save and exception responses were unguarded and could reload A into B's view. Unique operation tokens now guard load/save/exception success, failure, and completion; switching invalidates operations immediately and clears doctor-specific state. Both forms are disabled until a successful load and during saving. Failed loads are errors, not empty schedules; retry is available. Failed saves retain input. Switching does not cancel a mutation already sent to the server; its response cannot affect the newly selected doctor.

The undecided policy for activating schedules that conflict with future appointments was not changed. Replacement/deactivation checks retain existing behavior.

## Changed files

- `frontend/src/features/admin/AdminSchedulePanel.jsx`: weekday editing, operation state, strict load handling, race protection, bounded payloads, pending-version editing.
- `frontend/src/features/admin/latestRequest.js`: unique tokens; extends existing uncommitted helper.
- `frontend/src/features/admin/scheduleVersion.js`: opt-in future-version preference.
- `frontend/src/features/admin/adminSchedule.css`: neutral wrapper fieldsets and readable effective-date notice in dark/light themes.
- `frontend/src/i18n.js`: Arabic/English labels for day, loading, retry.
- `frontend/test/adminScheduleComponent.test.js`: executable React DOM tests with controlled API responses, using Vite's JSX transformer and jsdom.
- `frontend/test/adminSchedulePanelRace.test.js`: preserves executable guard tests, replaces source-only race checks with component coverage above.
- `frontend/test/adminSchedulePanel.test.js`: updates the existing disabled-state structural assertion.
- `frontend/scripts/verify-doctor-schedule.mjs` and `frontend/package.json`: repeatable headless Chrome component smoke check on dedicated port 5189, controlled API fixture.
- `backend/src/services/doctorSchedulingAdmin.js`: actionable period conflict message; validation rules unchanged.
- `backend/test/schedule-workflow.test.js`: API/Prisma integration tests with their own fixtures.
- `backend/scripts/test-schedule-workflow.js` and `backend/package.json`: isolated no-seed test command.
- `backend/test/run-tests.js`: adds the previously omitted existing admin-scheduling and scheduling suites to the standard runner.
- This report.

## Executed verification

Before implementation, the first six executable component tests had **5 failures, 1 pass**: missing day selection, lost effective end date, A→B→A stale load, stale save after switching, and ignored load failure. Save-failure input retention already passed. After implementation those six pass, and the expanded component suite has **11 passing tests** covering all-day editing, pending replacements, input-value persistence, and stale exception saves too.

- `cd frontend && node test/adminScheduleComponent.test.js`: 11 passed.
- `cd frontend && npm test`: all 39 test files passed; the `test/*.test.js` glob includes both new component and race files. This environment's Node runner reports file totals; the direct component invocation reports the individual cases.
- `cd backend && npm run test:schedule-workflow` with `TEST_DATABASE_URL` supplied internally for **clinic-test-db on 127.0.0.1:5433/clinic_test**: 10 tests passed (6 workflow API/database tests, 4 clinic-time tests). Each run migrates a new `schedule_workflow_*` schema, creates only test fixtures, and retains that schema. No seed, reset, schema-drop, or shared-data cleanup command runs.
- Backend workflow coverage includes seven-day persisted rows, adjacent periods, PUT self-exclusion, actual within-payload overlap with no persisted rows, version conflicts, invalid weekday validation, role restrictions, cross-doctor ownership, activation self-exclusion/other-version conflict, current-to-tomorrow replacement with repeat PUT, and future-appointment rejection with unchanged persisted children/audit count.
- `cd frontend && npm run build`: passed.
- `cd frontend && npm run lint`: completed successfully; existing warnings remain in i18n duplicate keys, patient onboarding control regex, and ThemeContext exports. Scheduling changes have no lint warnings after final cleanup.
- Targeted backend oxlint: completed successfully; existing unused `dateInRange` warning in the scheduling service.
- `cd frontend && npm run qa:schedule`: Chrome passed seven-day selector, actual overlap message with retained input, multi-day save/reload, repeat PUT edit, doctor switching, true 390px viewport without horizontal overflow, and no browser exceptions. The harness mounts the actual component and shared application CSS with a controlled API fixture. It does not exercise dashboard authentication or real database persistence; those are distinct from the API integration checks.
- `git diff --check`: passed.

The new backend workflow test is explicitly included in the dedicated no-seed runner. It is intentionally separate from the standard seeded runner, which was **not run** because it invokes `prisma/seed.js`. The newly included legacy scheduling suites were not individually run in this session. No full authenticated dashboard-to-database browser run or human manual acceptance is claimed. No production/development database was inspected to determine the user's exact stored rows.

## Reproduction and manual review

Use an approved test environment and normal administrator login. Do not reset or seed shared databases.

1. Open Admin → scheduling. Verify the displayed doctor and loading status; both forms must remain disabled until that doctor's data loads.
2. For a test doctor, add periods and select each of the seven weekdays. Save, switch away/back, and reload the page. Confirm days, hours, duration, breaks, and active flags persist.
3. Add two active Monday 09:00–17:00 rows. Save must fail with Monday and both intervals in the message; all entered rows and values remain. Change one row to Tuesday and save successfully.
4. Test adjacent Monday 09:00–11:00 and 11:00–12:00 periods. They should save; 10:30–12:00 should conflict with the first.
5. Edit a currently effective schedule. Verify the tomorrow notice and POST replacement. The loaded editor should then show the future effective date; subsequent edits must PUT that version, with no second overlapping version. Verify the previous version ends the day before the replacement. For an already bounded future version, verify the original end date remains intact.
6. In DevTools, throttle requests and switch A→B→A while loads are pending. Resolve old responses last; only the latest selection may appear. Switch during a save (including a rejected save or unavailable-date save); its completion must not change the new doctor's rows/messages. The original submitted save may still persist to its original doctor.
7. Block a schedule GET: an error and retry appear; saving remains blocked. Restore the request and retry. Block/reject a save: unsaved input remains editable and retryable.
8. In an appropriate existing appointment-conflict fixture, try replacing hours with periods excluding the future booked slot. Verify rejection and unchanged appointments/schedule. Do not infer or alter the undecided activation policy.
9. Review in Arabic/English and mobile/desktop, including the doctor name, effective-date notice, loading, saving, and error states.

Repeat automated checks with `npm test`, `npm run lint`, `npm run build`, and `npm run qa:schedule` from `frontend`. From `backend`, supply the already configured `TEST_DATABASE_URL` for clinic-test-db and run `npm run test:schedule-workflow`. Never substitute clinic_dev. Review this change and the authenticated manual checks before committing.
