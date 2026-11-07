# Staging QA safety gate

`full-system-qa.mjs` defaults to preflight only: `patientsCreated: 0` and
`workflowStarted: false`. It runs the controlled 100-patient workflow only with
`QA_EXECUTE_PATIENT_WORKFLOWS=true`, after `verifyStagingQaGate()` passes.
Before any registration, the runner also requires HTTP 204 from the protected
`/api/qa/verification-capture-auth-check` endpoint using the exact local capture
token. A public gate PASS alone does not prove that the local credential matches.
The implementation has been tested with mocked HTTP; no live workflow run is
part of implementing or testing this script.

## Backend staging configuration

Configure the following on the **staging API service only**. Do not copy these
values to production. Production must keep load testing disabled and must not
declare either application environment as staging.

Required explicit markers:

- `APP_ENV`: `staging`
- `DEPLOYMENT_ENV`: `staging`
- `QA_LOAD_TEST_ALLOWED`: boolean string `true`, only during an approved QA run
- `DATABASE_ENVIRONMENT`: `staging`
- `QA_LOAD_TEST_TARGET_ID`: unique non-secret identifier, 12–80 safe characters
- `QA_EXPECTED_DATABASE_NAME`: configured staging database name
- `QA_EXPECTED_DATABASE_SCHEMA`: configured staging schema
- `QA_EXPECTED_DATABASE_ROLE`: dedicated staging runtime role
- `QA_NOTIFICATION_MODE`: `sink`
- `NOTIFICATIONS_DISABLED`: boolean string `true`
- `SMS_PROVIDER`: `disabled`
- `VERIFICATION_PROVIDER`: `email`
- `QA_VERIFICATION_CAPTURE_ENABLED`: boolean string `true`
- `QA_VERIFICATION_CAPTURE_TOKEN`: secret, at least 32 characters; share only between staging API and the QA runner
- `QA_VERIFICATION_CAPTURE_STORAGE_KEY`: dedicated server-side secret, exactly 64 hexadecimal characters representing 32 random bytes; never reuse clinical, MFA, JWT, or capture-auth credentials. Do not put it in the runner environment, source, or reports.
- `QA_PAYMENT_MODE`: `disabled` or `ledger-only`

The staging service must also retain its existing `DATABASE_URL` (pooled) and
`DIRECT_URL` (direct) settings. Both must resolve to the pinned staging database
target, use the expected database and schema, and agree on the underlying host.
The runtime connection must authenticate as `QA_EXPECTED_DATABASE_ROLE`. The
identity endpoint queries only `current_database()`, `current_schema()`, and
`current_user`, and returns only their verified status, never connection data.

Remove any active payment gateway configuration from staging. The gate rejects
known payment-provider secret/configuration variables if present, regardless of
the selected QA payment mode. In-app notifications remain within the isolated
staging database; external email and SMS are never sent. SMS attempts are
recorded only as simulated. No notification payload or recipient is logged by
the QA sink. WhatsApp links are generated for the UI but are not sent by the
backend.

For patient registration, the QA email sink can capture verification codes only
for the exact generated `qa-YYYYMMDD-xxxxxxxx+patient-NNN@example.invalid`
identity pattern, a pending `PATIENT` registration and its active
`REGISTRATION_EMAIL` challenge. Captures are stored in the dedicated
`QaVerificationCapture` table, linked by foreign key to the real challenge.
The six-digit code is encrypted with AES-256-GCM, a random 12-byte nonce, a
16-byte authentication tag, and AAD binding the challenge ID and capture expiry.
No recipient/email or plaintext code is stored in that table. The original
five-minute maximum remains; expiry is also bounded by challenge issuance plus
five minutes and the underlying challenge expiry. A duplicate cannot refresh
an existing capture. Expired or invalid captures are removed when looked up.
The code is never included in logs or the registration response.
The QA runner retrieves it from `/api/qa/verification-capture/:challengeId`
using `Authorization: Bearer` and the capture token. The endpoint verifies the
challenge/account again, checks the full staging safety gate, and returns
`Cache-Control: no-store`. Outside explicitly enabled staging QA mode it returns
404. SMS verification remains disabled; use email verification for synthetic
registration. Shared encrypted database storage permits retrieval from a fresh
instance after restart, within the original expiry. Consumption locks the real
user and challenge in normal verification lock order, validates current account,
challenge generation/attempt budget and expiry, and atomically deletes the
capture inside one transaction. Concurrent consumers have one winner.

The additive migration is `20261107090000_durable_qa_verification_capture`.
Apply it through the normal reviewed migration process before using capture,
and ensure the staging runtime role has SELECT/INSERT/DELETE privileges on the
new table through the existing role provisioning process. Configure the new
dedicated storage key on staging before deploying this change. Missing,
malformed, or reused keys fail closed when staging capture is enabled;
production/capture-disabled startup does not require this key. This document
does not authorize migration, deployment, key provisioning, or a live run.

## QA runner configuration

Set these in the local QA runner environment without placing credentials in
source files or logs:

- `QA_API_ORIGIN`: canonical HTTPS origin of the staging **API**
- `QA_EXPECTED_API_ORIGIN`: separately pinned canonical HTTPS API origin; must
  exactly match `QA_API_ORIGIN`
- `QA_EXPECTED_TARGET_ID`: must match the API's non-secret target identifier
- `QA_VERIFICATION_CAPTURE_TOKEN`: same secret as the staging API capture token;
  keep it in local secret storage and never print it

The runner pins `https://clinic-staging-api.onrender.com` and target
`clinic-staging-qa-20261106`. It rejects all other hosts (including production,
localhost and the frontend), non-HTTPS URLs, paths, credentials, missing pins,
HTML responses, mismatched identity, and any unsafe/missing safety marker. It
requests the identity endpoint first, then liveness and readiness. Execution
requires payments **disabled**; preflight retains support for ledger-only.
There is no override/bypass option.

## Safe rollout sequence

1. Configure the variables on staging only; confirm its DB and notification
   integrations are isolated before enabling the load-test flag.
2. Deploy the backend gate to staging through the normal reviewed deployment
   process. This repository change does not deploy anything.
3. Run `node scripts/full-system-qa.mjs` with the runner variables above.
   It performs preflight only and reports `patientsCreated: 0`.
4. Review the API identity response and runner PASS before starting a separately
   authorized patient workflow run using the execution flag below.

## Controlled 100-patient execution

From the repository root, with `QA_VERIFICATION_CAPTURE_TOKEN` already exported
from local secret storage (never put its value in the command or a report):

```sh
systemd-inhibit --what=sleep:idle:handle-lid-switch --mode=block \
  --who="Shifa staging QA" --why="Keep the authorized foreground QA run uninterrupted" \
  env QA_API_ORIGIN=https://clinic-staging-api.onrender.com \
  QA_EXPECTED_API_ORIGIN=https://clinic-staging-api.onrender.com \
  QA_EXPECTED_TARGET_ID=clinic-staging-qa-20261106 \
  QA_EXECUTE_PATIENT_WORKFLOWS=true QA_MAX_CONCURRENCY=2 \
  node backend/scripts/full-system-qa.mjs
```

This command is documented for a later authorized run; do not run it as part of
implementation validation. Without the execution flag, the same entry point
only runs preflight. There is no patient-count override: successful execution
registers and verifies exactly 100 accounts. A safety or prerequisite failure
can stop with fewer; the report never fabricates completion or creates extras.

`QA_MAX_CONCURRENCY` may be `1` or `2` (default `2`); other values fail before
registration. A shared HTTP queue permits only one network request at a time,
including probes/retries. Registration, verification and login each have a
minimum 95-second interval, preserving the normal default 10-per-15-minute IP
limits. HTTP requests are also spaced at least 250 ms apart. Expect several
hours for a full run. Do not raise server limits or rotate IPs to speed it up.

On Fedora/Linux, the foreground `systemd-inhibit` command above takes its
sleep/idle/lid-switch block before starting Node and holds it for that process's lifetime.
It does not provide restart or resume behavior. The capture credential must
already be securely exported. Do not use shell tracing or put credential values
in the command. See the [systemd-inhibit manual](https://www.freedesktop.org/software/systemd/man/latest/systemd-inhibit.html).

The transport independently guards wall-clock continuity. Every scheduled
wait records its expected wake time; an overrun exceeding 60 seconds stops the
run with `run_long_pause_detected`. Ordinary 95-second pacing, Retry-After and
gate-retry waits are allowed for their scheduled duration. Continuity checkpoints
before/after network operations and between stages also detect unscheduled
pauses, even outside a sleep call. No subsequent workflow request is sent after
detection. A POST interrupted before its result is confirmed remains an ambiguous
mutation in the report. Sleep inhibition never disables or relaxes this guard.
Do not restart or automatically clean up an interrupted run.

The gate is checked before every workflow request, at intervals of at most
30 seconds during pacing/retry waits, and at completion. Request timeout is
20 seconds. A gate transport failure classified locally as `request_failed`
allows at most two retries, after 2 and 5 seconds. Each retry starts the entire
target/liveness/readiness sequence again; no workflow request proceeds until a
fresh full PASS. Content/target/configuration mismatches, invalid JSON, 401/403,
explicit non-PASS responses and aborts never qualify. Exhaustion stops with
`gate_transport_retry_exhausted`. Reports include `gateRetryCount`;
`retryCount` includes gate plus workflow retries, and `workflowRetryCount`
retains the workflow-only count. GET 5xx and 429 responses allow at most two retries. Retry-After
is honored; waits beyond 20 minutes fail instead of retrying early. A shared
cooldown prevents retry storms. Network failures are not retried. POST 5xx
responses and one-time capture 5xx responses are not replayed, since their
outcomes may be ambiguous. Authentication failures stop the entire run.

Each run uses one random dated namespace in every account's email and name.
Emails match the protected capture pattern. Passwords are random, exist only
in memory, and are never persisted. Login uses the generated email, which the
registration API assigns as username. Phones come only from the reserved
[NANPA fictional 555-0100–0199 range](https://nanpa.com/numbering/555-line-numbers).
The fixture phone pool is finite: any existing identity conflict stops the run;
it never logs into, modifies, or deletes the conflicting account.

### Reviewed routes and prerequisites

Routes were discovered in `src/server.js` mounts and the existing route files,
not guessed or probed against live staging during implementation. Execution
validates the deployed JSON contracts and records unsupported responses.

| Source | Routes used |
| --- | --- |
| `routes/patientAuth.js` | GET `/api/patient-auth/address-states`; POST `/api/patient-auth/register`, `/api/patient-auth/verify` |
| `server.js` | GET `/api/qa/verification-capture/:challengeId` with the protected capture token |
| `routes/auth.js` | POST `/api/auth/login` |
| `routes/patient.js` | GET `/api/patient/me`, `/doctors`, `/specialties`, `/appointments`, `/appointments/:id`, `/medical-records`, `/lab-results`, `/prescriptions`; POST `/api/patient/appointments` |
| `routes/appointments.js` | GET `/api/appointments/slots?doctorId=...&date=...` |

Only existing active doctors and real available slots are used. Slot discovery
is bounded to three doctors and the next seven clinic days and shared between
workers. At most one appointment is created per synthetic patient; a slot race
is reported BLOCKED without repeated booking attempts. Profile and returned
patient IDs must match the new synthetic account before later workflows run.
The patient APIs enforce ownership normally; staff credentials are never used.

Lab and prescription lists are read as the synthetic patient. Clinical ordering,
lab release, dispensing, and billing remain BLOCKED without prerequisite staff
actions/fixtures and a supported patient API path. No clinical data is invented.
There are no allowed OTP, email, SMS, WhatsApp, external payment, billing mutation,
staff mutation, deletion, or unrelated-record requests. The API's verified sink
is mandatory for the normal registration flow's email capture.

### Reports and cleanup

Every CLI invocation writes `<runNamespace>.json` and `<runNamespace>.md` under
`docs/full-system-qa/` (a timestamped preflight name if the gate fails before a
namespace exists). Existing reports are never overwritten. Reports include
per-patient/stage SUCCESS/FAILURE/BLOCKED, created-account and verified-patient
counts, login counts, HTTP statuses, retry and error counts, latency summaries,
safety confirmations, and cleanup candidates containing only synthetic emails
and validated resource UUIDs. No response bodies, verification codes, passwords,
tokens, headers or connection URLs are serialized. stdout contains counts only.

SUCCESS counts represent confirmed API responses; ambiguous writes are flagged
in cleanup candidates and never replayed. PARTIAL means patient registration
completed with downstream prerequisites blocked; FAILED/BLOCKED exits nonzero.
SIGINT/SIGTERM stops further requests and writes the partial report. No cleanup
runs automatically: candidates include attempted registrations even when a
response was lost. Review only those exact synthetic identities before any
separately authorized cleanup. Keep generated reports uncommitted.

Offline validation (no staging HTTP or database writes):

```sh
cd backend
node test/full-system-qa-runner.test.js
node test/staging-load-test-safety.test.js
node test/qa-run-namespace.test.js
```

## Interrupted-run cleanup (one namespace only; never automatic)

`cleanup-staging-qa.mjs` is pinned only to `qa-20261106-73412c3e` and target
`clinic-staging-qa-20261106`. It reuses the full existing staging environment
preflight, including the pinned staging URL checks, sink/capture markers and
disabled/ledger-only payment policy. Its connected database must additionally
be exactly `neondb`, schema `public`, role `clinic_runtime`; configured expected
identity markers must agree. It uses the normal staging `DATABASE_URL` already
available in the Render shell, without printing it or loading local `.env` files.

Later dry-run command, **only in an authorized staging backend execution
environment**, when one is available. No HTTP cleanup endpoint is provided:

```sh
QA_CLEANUP_NAMESPACE=qa-20261106-73412c3e \
QA_EXPECTED_CLEANUP_ACCOUNTS=10 \
QA_EXPECTED_CLEANUP_APPOINTMENTS=8 \
QA_EXECUTE_CLEANUP=false \
node scripts/cleanup-staging-qa.mjs
```

This performs a serializable **read-only** transaction and rolls it back. No
cleanup is performed as part of implementation validation. Actual deletion
requires a separately authorized invocation with `QA_EXECUTE_CLEANUP=true` and
the same exact expected counts. The script accepts no CLI switches or arbitrary
email patterns. Unknown execution values or other namespaces fail closed.

The tool discovers exact generated namespace addresses, validates ten PATIENT
users (indices 001–008 ACTIVE with verified email, indices 009–010
PENDING_VERIFICATION with null email verification and no Patient), eight unchanged synthetic
patient profiles, ten retained registrations/challenges, and exactly one
PENDING appointment per verified patient. Audit provenance must agree with the
runner's registration, patient creation and appointment creation records. It
also validates any normal LOGIN MFA challenges and the database-generated
PATIENT_REGISTERED/APPOINTMENT_BOOKED notices for those exact QA entities.
User creation dates must be exactly November 6, 2026 UTC for indices 001–009
and November 7, 2026 UTC for index 010; no date range is accepted. Every account
must have exactly one registration-email challenge: used with one attempt for
ACTIVE users, unused with zero attempts for the two pending users.
This historical run predates durable capture storage. Exactly zero
`QaVerificationCapture` rows may reference its ten challenges, including expired
captures. Any such row refuses cleanup before DELETE; captures are never
automatically deleted or silently trusted to cascade. The table participates
in schema/RLS and reference inspection, including non-FK challenge references.
Safe dry-run counts include `verificationCaptures: 0`.
Unexpected audit actions, changed profiles, progressed appointments, external
identities/MFA enrollment, claims/consents, clinical/billing data, unknown
referencing rows, missing privileges, unsupported relations or RLS cause refusal.
Foreign keys (including cascade descendants) and public identifier columns
without FKs are inspected; no cascade is trusted as proof that a row is safe.

An approved deletion validates and locks the scope inside one serializable DB
transaction. It deletes appointments, MFA challenges, verification challenges,
patient registrations, notifications, patients, audit rows scoped only by exact
matched QA user IDs, and users, in that order.
Only validated QA notice IDs are removed; unrelated staff notices/audits/users
remain. Before commit it verifies no namespace users or matched patient/appointment
IDs remain. Any count discrepancy or error rolls back the whole transaction.
Output contains only namespace, fixed status/reason labels and safe counts.

Offline recovery tests:

```sh
node test/qa-gate-recovery.test.js
node test/staging-qa-cleanup.test.js
```

The cleanup integration cases require `QA_CLEANUP_TEST_SOCKET` pointing to a
private disposable PostgreSQL cluster at `/tmp/shifa-qa-recovery-*/socket` with
the test-only `qa_recovery_owner` login. They recreate the isolated `neondb`
public schema, apply all repository migrations, and exercise deletion using a
non-superuser `clinic_runtime`. They never use application connection URLs.

Do not add secret values to this document, test output, screenshots, or QA
reports. The exposed local QA password was rotated in ignored local QA
configuration; any reuse in a remote secret store must be rotated there by its
owner.
