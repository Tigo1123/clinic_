# Staging QA safety gate

`full-system-qa.mjs` is currently preflight-only. It does not create accounts or
run clinic workflows. The deployed API must expose a passing
`/api/health/load-test-target` response before any future workflow runner is
enabled.

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
`REGISTRATION_EMAIL` challenge. Captures exist only in backend process memory,
expire after at most five minutes (or earlier challenge expiry), and are
single-use. The code is never included in logs or the registration response.
The QA runner retrieves it from `/api/qa/verification-capture/:challengeId`
using `Authorization: Bearer` and the capture token. The endpoint verifies the
challenge/account again, checks the full staging safety gate, and returns
`Cache-Control: no-store`. Outside explicitly enabled staging QA mode it returns
404. SMS verification remains disabled; use email verification for synthetic
registration. If the API runs multiple instances, capture and retrieval must be
routed to the same instance; otherwise retrieval safely fails and registration
must be retried.

## QA runner configuration

Set these in the local QA runner environment without placing credentials in
source files or logs:

- `QA_API_ORIGIN`: canonical HTTPS origin of the staging **API**
- `QA_EXPECTED_API_ORIGIN`: separately pinned canonical HTTPS API origin; must
  exactly match `QA_API_ORIGIN`
- `QA_EXPECTED_TARGET_ID`: must match the API's non-secret target identifier
- `QA_VERIFICATION_CAPTURE_TOKEN`: same secret as the staging API capture token;
  keep it in local secret storage and never print it

The runner rejects the known staging frontend origin, known production origins,
non-HTTPS URLs, paths, credentials, missing pins, HTML responses, mismatched
identity, and any unsafe/missing safety marker. It requests the identity endpoint
first, then liveness and readiness. There is no override/bypass option.

## Safe rollout sequence

1. Configure the variables on staging only; confirm its DB and notification
   integrations are isolated before enabling the load-test flag.
2. Deploy the backend gate to staging through the normal reviewed deployment
   process. This repository change does not deploy anything.
3. Run `node scripts/full-system-qa.mjs` with the three runner variables above.
   It performs preflight only and reports `patientsCreated: 0`.
4. Review the API identity response and runner PASS before separately authorizing
   any patient workflow simulation. This implementation does not start that
   simulation.

Do not add secret values to this document, test output, screenshots, or QA
reports. The exposed local QA password was rotated in ignored local QA
configuration; any reuse in a remote secret store must be rotated there by its
owner.
