# Audit issue 13: SMS and Sudan phone verification foundation

## Implemented

- Appointment SMS has no configured transport and remains disabled unless a transport is explicitly injected. Disabled and development-simulated sends return no success signal. Simulation is limited to `development` and `test`.
- The transport setting defaults to `disabled`; unset, disabled, and unknown provider values fail closed even if a transport is passed in. The provider-neutral transport contract accepts only `{ accepted: true }`. Rejections and malformed results remain failures. An accepted submission is logged as `ACCEPTED`; it does not claim handset delivery. Simulation is explicit and cannot call a real transport.
- SMS delivery and notification-log failures are contained after appointment commits. Operational SMS logs keep a masked destination and a generic message label; they omit message text and OTPs.
- Phone challenge delivery reuses the existing `VerificationChallenge` lifecycle. Development codes are available only in `development` and `test`. A failed delivery invalidates its challenge, and phone verification still occurs only in the existing successful challenge-consumption transition.
- The existing public appointment OTP flow now has a resend cooldown that remains effective after successful use or attempt lockout, expiry, a five-attempt limit, reservation while booking, and single-use consumption after appointment creation. Each reservation has an opaque ownership token: resend is blocked while it is live, expiry permits replacement, and stale completions cannot release or consume replacement challenges. Failures before appointment commit release only their own reservation.
- Sudan `+249` normalization uses the existing libphonenumber path. Other valid international numbers remain accepted.
- Existing patient-record linking checks and staff MFA paths are unchanged. No migration, queue, reminder schedule, or provider-specific code was added.

## Existing paths traced

- Booking confirmation and staff status changes call `sendSMS` through `sendBookingConfirmation` and `sendStatusUpdateNotification`; both run after the appointment database transaction commits. The patient-facing self-booking response also retains its existing WhatsApp links.
- Registration, authenticated phone verification, and profile phone changes use `createVerificationChallenge` and the persisted `VerificationChallenge` model. The challenge is consumed by the existing verification transition; no parallel account-verification flow was introduced.
- Anonymous public appointment booking uses its pre-existing development OTP map in the appointment routes. Its state and checks were extracted into `appointmentOtp.js` so expiry, throttling, attempts, reservation, and consumption are testable without creating a second challenge store.
- Staff authentication continues to use its existing MFA challenge and TOTP paths.

HTTP booking regressions verify successful consumption, reuse rejection, retry after a pre-commit failure, concurrent reuse rejection, and OTP non-restoration after post-commit notification/log failures. Unit tests cover expired reservation replacement and stale-token completion, along with disabled/unknown SMS providers and rejected or malformed transport outcomes.

## Blocked on provider selection

No SMS provider or credentials were supplied. The application has no real SMS transport, so appointment texts cannot currently be submitted or delivered. This issue remains incomplete until a provider is selected, its credentials are configured through the deployment secret store, and real delivery is verified.

## Real-delivery acceptance

After provider selection and integration:

1. Configure credentials outside the repository and confirm startup keeps SMS disabled when required credentials are absent. Implement a provider adapter that returns `{ accepted: true }` only after provider submission is accepted; keep delivery receipts as a separate outcome.
2. Use provider-approved test numbers to verify Sudanese `+249` and at least one other supported country, including appointment confirmation and status notifications.
3. Verify registration and authenticated phone-verification codes arrive, expire, reject repeated use, enforce attempt and resend limits, and never mark a number verified after provider failure.
4. Confirm provider acceptance and delivery receipts are represented separately. Check application and notification logs contain no OTP, credential, full phone number, or SMS body.
5. Force a provider timeout and a notification-log failure; confirm the committed appointment remains successful and the phone remains unverified.
6. Complete manual browser acceptance with clinic staff and record the provider, sender identity, destination country, delivery outcome, and test timestamp without recording message contents or secrets.
