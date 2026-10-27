# Notification system audit and repair — 27 October 2026

Repository branch: `feat/next-improvements`; starting HEAD: `1c34036`.
All changes are local. Nothing was committed, pushed, or deployed.

## Discovered architecture and confirmed causes

The system was partially implemented. Prisma already had per-user `Notification`
records and read flags, authenticated notification APIs, a shared staff Socket.IO
client, authenticated user/role/doctor rooms, and a PostgreSQL-backed socket
revocation listener. `NotificationLog` separately records email/SMS delivery.

Only public appointment booking called the in-app creation helper. It inserted
notices after the business transaction, swallowed delivery failures, and copied
patient/doctor names into Arabic-only text. Most other workflows created no
notification at all. Some emitted `queueUpdated`, but that was neither durable
nor subscribed to by Pharmacy/Lab. The staff bell fetched only on mount, blindly
prepended socket payloads and incremented its badge, lacked reconnect recovery,
and hid errors in the console. Repeated read clicks could decrement the count
twice. Retrieval stopped at 50 records without pagination.

The socket fallback also ignored an absolute staff API origin. **This is not
the current staging root cause:** inspection of the deployed public
`App-BKHvZ1vu.js` chunk confirmed that staging explicitly supplies
`VITE_STAFF_SOCKET_URL=https://clinic-staging-api.onrender.com`. The staging
frontend `/socket.io/` probe returns HTML; the backend endpoint returns an
Engine.IO polling handshake, `Cache-Control: no-store`, and the correct allowed
frontend origin. No staging account, authenticated socket, private data, Render
environment settings, or deployed commit identity was accessed. Bundle behavior
was inspected; exact deployment revision remains unverified.

The final public health check returned HTTP 200 for both `/api/health/live` and
`/api/health/ready` after an initial 30-second timeout. Readiness includes the
existing socket-revocation listener gate. This confirms public service readiness
at that check, not authenticated notification delivery on staging.

Headed-browser verification found another defect: on a non-UTC PostgreSQL
session, the old `timestamp without time zone DEFAULT CURRENT_TIMESTAMP` stored
local wall time. Prisma interpreted it as UTC. A browser read-all cutoff could
therefore precede the displayed notices even after a successful response. The
new notification timestamp default explicitly stores UTC. Existing timestamps
are not rewritten because their original session timezone is unknown. The
read-all cutoff includes visible legacy timestamps that are ahead of UTC, and
older clients sending an empty read-all body retain their existing behavior.

## Event and recipient matrix

| Actual supported event | Recipients | Before | Repair/action |
|---|---|---|---|
| Patient file registration | Active Admin, Reception | Missing | Durable generic registration notice; profile edits do not repeat it |
| Appointment booking | Active Admin, Reception, assigned Doctor | Only public booking notified Admin/Reception | Shared transactional coverage includes public/patient/staff write paths |
| Appointment cancellation, reschedule, transfer/status change | Admin, Reception, old/new assigned Doctor | Partial queue events only | Durable notices and targeted view invalidation |
| Check-in / walk-in | Reception/Admin and assigned Doctor | Queue events only | Durable check-in notice; consultation payment rules unchanged |
| Doctor schedule/configuration change | Admin, Reception, affected Doctor | Missing | Durable schedule notice; unused profile creation does not create history |
| Prescription creation | Pharmacy | Missing | Durable prescription-ready notice and queue refresh |
| Medication review / prescription resolution / dispense status | Pharmacy; prescribing Doctor on changes | Missing | Durable review/status notices; authoritative queues refetched |
| New unpriced/inactive medicine | Admin | Missing | Pricing/activation-required notice |
| Medicine metadata/price/status update | Pharmacy | No cross-page delivery | Catalog notice and authoritative catalog/inventory refetch |
| Low / out-of-stock episode | Pharmacy; Admin for out-of-stock | Dashboard-derived only | Durable deduplicated stock episodes for medicines with inventory history |
| Batch approaching expiry / expired, with stock remaining | Pharmacy | Dashboard-derived only | Durable deduplicated batch/date alerts; existing 90-day rule |
| Lab order awaiting billing | Admin, Reception | Missing | Durable billing action notice |
| Paid lab order / collected sample | Lab | Missing | Durable work-ready/result-entry notices and Lab queue refresh |
| Custom lab test review / review decision | Lab; Reception and assigned Doctor on decisions | Partial queue hints | Durable review notices and targeted refresh |
| Lab results completed / released | Ordering Doctor | Partial queue hints | Durable notices; no result text in events |
| Consultation/general payment required; payment status changes | Authorized operational roles; Pharmacy for pharmacy payments | Partial queue hints | Durable generic payment notices; financial authorization unchanged |
| Insurance claim status changes | Admin, Reception | Missing | Durable generic insurance action notice |
| Existing staff creation/status/reset/revocation and MFA enable/disable audits | Admin | Audit records only | Generic security notice; audit details/secrets never copied |
| Minor batch quantity/receipt changes | Pharmacy, Admin | No cross-page delivery | Post-commit refetch hint, without a durable notice per minor change |
| Patient in-app bell | Patient | Navigation shortcuts, not a feed | No new patient socket/feed or invented workflow; existing own-record API and SMS/email behavior preserved |

## Implementation and transaction decision

`Notification` is reused. The migration adds `type`, optional entity references,
an optional event key with a per-recipient unique constraint, a latest-record
index, and the UTC timestamp default. `StockNotificationState` stores only the
medicine stock episode/revision needed to rearm alerts after replenishment.
The existing `(userId,isRead)` index remains in place.

Ordinary **SECURITY INVOKER** domain triggers cover the implemented write paths,
including alternate routes and background/database writes. Important notices
commit atomically with the source event. Existing clinical/financial routes
already treat audit insertion failures as transaction failures; these small
in-app inserts follow that discipline. Missing notification permissions fail
the source write rather than silently losing the notice. No business event can
produce a notification from a rolled-back transaction.

PostgreSQL delivers `NOTIFY` only after commit. The existing revocation listener
also listens on `clinic_notifications_v1` and `clinic_inventory_v1`; there is no
second websocket service or per-component connection. Relay queries are bounded
and batched, with user/topic coalescing. Each API instance emits to its local
authorized user rooms. Durable state recovers events missed while offline.
After a short PostgreSQL listener outage, already-connected clients also receive
a recovery hint after authVersion reconciliation succeeds.

Stock checks run at server startup, on committed inventory changes, on listener
recovery, and hourly. They scan medicines in pages of 100 and use a transaction
advisory lock plus unique event keys to prevent duplicate alerts across nodes.
The scanner is independent of critical stock mutations; a failed scan is logged
and retried by the next scheduled/event-triggered scan. No frontend polling was
added.

## Socket/API protocol and client behavior

- Existing `notification`: `{id,type,title,message,createdAt,isRead}` with static safe text; compatible with older clients, with no clinical record. New clients always refetch the API.
- `notifications:changed`: `{id}` read hint, or `{}` after listener recovery.
- `workflowUpdated`: `{topic}` only. Topics: `reception`, `appointments`,
  `prescriptions`, `laboratory`, `billing`, `catalog`, `inventory`, `security`,
  and `reconnected` for recovery.
- Existing `queueUpdated` remains compatible and feeds the same coalesced queue
  refresh mechanism.
- Existing notification API paths remain. GET defaults to 20, caps at 50,
  orders by timestamp then ID, returns an opaque next cursor, an authoritative
  unread count, and a read-all snapshot cutoff. Every query/write includes the
  authenticated recipient. Repeated mark-read is idempotent.
- The bell refetches on events, socket reconnect, opening, focus and visibility
  recovery. It never increments badges from event counts or pretends a failed
  read succeeded. Stale reads cannot overwrite newer state or mutations.
- The panel has bilingual safe text, RTL/LTR direction, loading/empty/error/retry
  states, pagination, keyboard-operable controls, Escape/focus return, live count
  announcements, theme tokens, 44px controls and a narrow-screen panel.
- Pharmacy, Lab, Reception, Doctor and active Admin pricing views subscribe to
  appropriate topics, serialize/coalesce refreshes and use the existing APIs.
  Pharmacy avoids rescanning the inventory catalog for prescription-only hints.
  Existing Admin pricing mutation/version guards remain intact.

## Security, privacy and deployment

Socket authentication, MFA policy, active-role checks, authVersion revocation,
fail-closed listener readiness, HTTP rate limits, audit writes, stock/payment
gates, and database ownership boundaries are preserved. No frontend forces
business state. The socket exposes IDs/topics and static safe creation metadata, never patient names,
results, diagnoses, credentials, JWTs or MFA information. New API text is a
static Arabic/English catalog; authorized details remain behind existing APIs.
Historical legacy notices remain visible only to their owner.

Apply `20261027120000_durable_workflow_notifications` with the migration identity.
Review runtime grants before serving writes. The explicit psql helper
`backend/scripts/sql/grant-notifications.sql` accepts `schema_name` and
`runtime_role` and grants only SELECT/INSERT/UPDATE on the two notification
tables and EXECUTE on the notification insertion function. It grants no schema
ownership, role management, DDL or bypass privilege. Existing User/Doctor SELECT
permissions remain necessary. The dedicated PG listener still uses the existing
direct connection configuration; new authoritative lookups use the runtime
Prisma client.

Build-time socket resolution is: explicit socket override, absolute staff API
origin, absolute general API origin, then the existing development/same-origin
default. Same-origin LAN routing and `/socket.io/` remain intact. Build frontend
and backend from the reviewed revision, apply migration/grants in the normal
release process, and open a fresh staging tab for the new client bundle. Existing creation-event metadata and empty-body read-all requests remain compatible with already-open clients. No automatic page reload was added.

## Verification and remaining limits

Verification results and exact changed files are recorded below at completion.
All database writes and browser workflows use guarded, loopback-only synthetic
fixtures. The browser harness uses real application pages, APIs, database
records and authenticated sockets; it does not mock notification responses.

Remaining limits: authenticated multi-role staging acceptance has not been run;
staging's exact deployed commit and private service configuration are unverified.
Patient in-app notification UX/realtime delivery is not implemented by the
existing product and is not invented here. Historical workflow events are not
backfilled into new notices. Existing ambiguous historical timestamps are not
rewritten. Notification retention and external SMS/email retry/operator policy
are unchanged. These are distinct from the repaired staff notification flows.

## Completed verification and verdict

| Check | Result |
|---|---|
| Prisma validate | Passed |
| Clean migration replay | Passed through all 29 migrations in fresh test schemas |
| Guarded schema drift check, both datasource URLs set explicitly | No difference detected |
| Full backend suite | 74 files; 835 passed, 1 skipped, 0 failed |
| Final notification API/transaction/socket/stock/timezone/legacy tests | 13 passed |
| Actual public booking plus durable Reception notice assertion | 12 passed |
| Existing socket revocation/security suite | 10 passed within the full run |
| Full frontend suite | 63 test files passed |
| Lint | Passed with 6 existing warnings; no new warnings |
| Production frontend build | Passed; existing large-chunk warning remains |
| Changed backend/QA JavaScript syntax and git diff --check | Passed |
| Headed Chrome, DevTools closed | 26/26 checks passed |

The browser run used Admin, Reception, Doctor, Pharmacy, Lab and a second,
unrelated Doctor. It exercised real Reception check-in, Admin price/activation
and Pharmacy refetch, Doctor prescription, Reception lab billing/payment, Lab
sample/result entry, and Pharmacy payment/dispensing. Database records and
socket event shapes were checked. The correct bell updated without refresh or
focus; the unrelated doctor stayed isolated. Read-all persisted, a deliberately
disconnected Pharmacy client recovered its missed notice, and reload preserved
the durable unread count. Arabic/English × light/dark × desktop/390px mobile
screenshots passed; the final run used the application's actual theme control.
No browser exceptions occurred. Clinical details were not sent in notification
socket frames.

Local evidence is under `/tmp/clinic-notifications-browser/` (`report.json` and
eight screenshots), with backend/frontend reports under
`/tmp/clinic-notifications-*`. Failed intermediate harness attempts were
superseded by the successful final run. Temporary quota exhaustion was resolved
by removing this task's completed isolated schemas and closed QA browser caches.

Verification correction: an optional read-only schema-diff command initially
inherited the repository's remote `DIRECT_URL`. It inspected schema metadata
only, without reading business rows or writing anything. That result was
discarded. The corrected command explicitly pinned **both** `DATABASE_URL` and
`DIRECT_URL` to the guarded local QA schema and reported no difference. All
workflow mutations and record-level verification used isolated local data.

**Safe to commit:** yes, the listed task files are ready for review/commit;
pre-existing untracked authentication QA files were left untouched.
**Safe to deploy to staging:** ready for a coordinated staging release after
reviewing/applying the migration and runtime grants, followed by authenticated
fresh-tab multi-role acceptance on staging. No deployment was performed; this
does not claim that current staging already contains the repair.

## Exact changed files

- `DEPLOYMENT.md`
- `backend/prisma/migrations/20261027120000_durable_workflow_notifications/migration.sql`
- `backend/prisma/schema.prisma`
- `backend/scripts/qa-notifications.mjs`
- `backend/scripts/sql/grant-notifications.sql`
- `backend/src/routes/appointments.js`
- `backend/src/routes/notifications.js`
- `backend/src/server.js`
- `backend/src/services/notificationDelivery.js`
- `backend/src/services/socketRevocation.js`
- `backend/src/services/stockNotifications.js`
- `backend/test/appointment-notifications.test.js`
- `backend/test/clinic-readiness.test.js`
- `backend/test/lan-same-origin.test.js`
- `backend/test/notifications.test.js`
- `docs/notification-system-audit.md`
- `frontend/.env.example`
- `frontend/scripts/verify-notifications.mjs`
- `frontend/src/components/NotificationDropdown.jsx`
- `frontend/src/components/notificationDropdown.css`
- `frontend/src/features/admin/AdminDashboard.jsx`
- `frontend/src/features/doctor/DoctorDashboard.jsx`
- `frontend/src/features/laboratory/LaboratoryDashboard.jsx`
- `frontend/src/features/pharmacy/PharmacyDashboard.jsx`
- `frontend/src/features/reception/ReceptionDashboard.jsx`
- `frontend/src/hooks/useWorkflowRefresh.js`
- `frontend/src/services/apiClient.js`
- `frontend/src/services/notificationFeed.js`
- `frontend/src/services/staffSocket.js`
- `frontend/src/services/staffSocketUrl.js`
- `frontend/test/adminPricing.runtime.test.js`
- `frontend/test/clinicalReadViews.runtime.test.js`
- `frontend/test/notificationDropdown.runtime.test.js`
- `frontend/test/notifications.test.js`
- `frontend/test/socketRevocation.test.js`
