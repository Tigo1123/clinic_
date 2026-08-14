# Authenticated staging acceptance checklist

Status until executed and signed: **MANUAL VERIFICATION REQUIRED**.

Use dedicated non-real QA identities. Record the tested commit, deployment IDs, timestamp,
tester, browser/version, and evidence links. For every action inspect Console and Network;
record HTTP status, final UI/database-visible state, loading/error behavior, and whether more
than one mutation request was emitted. Never place credentials, tokens, or clinical content in
screenshots or the report.

## Clinical workflow

- [ ] PATIENT: register, verify, log in, restore session after refresh, browse a real active
  doctor, book an available slot, open details, and confirm another patient's IDs return safe
  403/404 responses.
- [ ] RECEPTION: observe the booking notification, confirm, check in, verify the correct queue,
  create the invoice, record a partial payment, then the final payment. Double-click each action
  and verify one mutation only.
- [ ] DOCTOR: see only the assigned queue/patient, start consultation, save vitals, diagnosis and
  encrypted notes, create a multi-item lab order and prescription, then complete the visit.
- [ ] LAB: see the order, enter distinct values for every item, confirm one value does not
  overwrite another, complete/release once, and verify patient visibility only after release.
- [ ] PHARMACY: load the prescription, verify earliest valid expiry (FEFO), reject expired and
  insufficient batches, dispense once, and reconcile the exact inventory deduction without
  negative stock.
- [ ] BILLING: verify partial and final balances, retry a payment with the same idempotency key,
  reject overpayment, record partial/full refunds, and verify append-only payments, refunds and
  audit history.
- [ ] ADMIN: verify operational/revenue analytics against the workflow records and confirm empty
  or missing optional values do not produce NaN, undefined values, or rendering failures.
- [ ] SOCKET.IO: confirm booking, queue, lab, pharmacy and notification updates reach only their
  intended users/roles; test reconnect, refresh and logout without duplicated listeners/events.

## Language, direction and viewport matrix

Run the authentication screen and each role's primary workflow in both English/LTR and
Arabic/RTL. At minimum execute the critical patient/reception flow at every width below, then
exercise each staff dashboard at its indicated mobile/tablet/desktop representative widths.

| Width | Patient/auth | Reception | Doctor | Lab | Pharmacy | Admin |
| ---: | :---: | :---: | :---: | :---: | :---: | :---: |
| 360 | ✓ | ✓ |  | ✓ | ✓ | ✓ |
| 390 | ✓ | ✓ |  |  | ✓ |  |
| 430 | ✓ |  |  | ✓ |  | ✓ |
| 768 | ✓ |  | ✓ |  |  |  |
| 1024 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 1366 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 1440 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

At each selected width check horizontal overflow, clipped text, long Arabic names, navigation,
tables, charts, dialogs, form labels/errors, keyboard focus, bottom-navigation overlap and
disabled/submitting states. Acceptance requires zero uncaught errors, React warnings, CORS
errors, failed critical requests, unauthorized data exposure, and duplicate mutations.
