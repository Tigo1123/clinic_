# Audit issue 12: appointment confirmation recipient

The defect is confirmed in the Prisma schema and booking helper: `Appointment.patientId` identifies `Patient`, whose optional `userId`/`user` relation identifies `User`. Only `User` has an `email` field. `sendBookingConfirmation` read `patient.email`, which is absent from the Prisma patient returned by the booking transaction, so confirmation email was silently skipped.

The helper now queries that appointment patient's optional linked account, selecting only `user.email`. It does not accept an email from a caller-provided patient projection, fall back to a doctor/staff account, or add account fields to HTTP responses. No linked account, missing patient, null email, or empty email means no email attempt. With `NOTIFICATIONS_DISABLED=true`, account lookup and email delivery are skipped. Existing SMTP configuration, notification disabling, SMS behavior, templates, and WhatsApp links remain in place; no new notification preference or verified-email requirement is introduced.

Email lookup, SMTP configuration, delivery, and delivery-log errors are contained after the appointment has committed. This prevents the newly enabled email path from converting a successful booking into an HTTP failure. The existing SMS implementation is unchanged.

## Callers traced

- `POST /api/appointments/book` commits a pending appointment, then calls `sendBookingConfirmation`. This is the only booking-confirmation caller.
- Walk-in registration calls `sendStatusUpdateNotification` with `CHECKED_IN` after committing.
- Staff appointment status updates call `sendStatusUpdateNotification` after committing. Despite its existing SMS/Email comment, that helper currently sends only SMS and returns WhatsApp links; this fix does not add status emails.
- Authenticated patient self-booking in `routes/patient.js` does not call either notification helper. Adding notifications there is outside this correction.
- Verification emails use `sendEmail` directly with their own explicitly chosen recipient and are unchanged.

## Regression coverage

`backend/test/appointment-notifications.test.js` uses real Prisma relationships in an isolated test schema and mocks Nodemailer transport, so no real email can be sent. It covers recipient selection, unrelated/supplied-address rejection, unlinked accounts, null/empty email, disabled notifications, recipient lookup failure, and HTTP booking success with persisted pending appointments when delivery fails (including failure to record the email attempt). SMS delivery is unavailable in the existing implementation; its booking-test logging is mocked. Status behavior is checked without adding email.

Run through the existing runner against clinic-test-db at localhost:5433/clinic_test. Test execution uses a temporary source snapshot without application `.env` files and `DOTENV_CONFIG_PATH=/dev/null`; fixtures and migrations belong only to fresh `test_*` schemas. No application database or service is needed. These tests do not establish real SMTP delivery or inbox receipt.
