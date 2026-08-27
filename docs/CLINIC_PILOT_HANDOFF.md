# Clinic Pilot Handoff

## Pilot purpose

This system is ready for a controlled clinic pilot. The pilot is intended to validate day-to-day workflows, usability, staff training needs, and operational fit in a supervised setting.

This is not approval for unrestricted production use. Pilot staff should use only approved pilot data and processes, record feedback, and escalate problems promptly.

## System roles

### ADMIN

- Can manage staff accounts, approved service and medicine information, official prices, and administrative review activities.
- Cannot replace clinical judgment or perform role-restricted clinical, laboratory, or dispensing work merely by using an Admin account.
- Enters the workflow during setup, staff support, account administration, catalog maintenance, and incident review.

### RECEPTIONIST

- Can register or locate patients, create walk-in appointments, confirm arrival, manage permitted appointment states, prepare invoices, and record authorized payments.
- Cannot write diagnoses, finalize clinical records, enter laboratory results, dispense medicine, change stock directly, or administer staff accounts.
- Enters at patient arrival and returns for billing, payment, and permitted scheduling tasks.

### DOCTOR

- Can start assigned consultations, record clinical information, order laboratory work, review results, finalize the visit, and prescribe medicines.
- Cannot edit another doctor's unrelated clinical work, enter or release laboratory results, dispense medicines, manipulate stock, or administer staff accounts.
- Enters after patient check-in and again after laboratory results when tests are required.

### LAB_TECH

- Can review permitted laboratory work, record samples/results, complete laboratory processing, and release results through the intended workflow.
- Cannot diagnose, prescribe, dispense medicine, change pharmacy stock, manage staff, or control unrelated appointment work.
- Enters when a doctor orders a laboratory test.

### PHARMACIST

- Can maintain permitted pharmacy information, receive inventory batches, review prescriptions, dispense authorized quantities, and inspect stock movements.
- Cannot edit diagnoses or treatments, enter laboratory results, manage unrelated appointment states, change official Admin-controlled prices, or manage staff.
- Enters after a valid prescription is available and applicable payment/workflow requirements are satisfied.

### PATIENT

- Can use approved self-service features for their own profile, appointments, released results, invoices, notifications, and history.
- Cannot access another patient's information, set workflow or payment states, change prices or stock, or perform staff actions.
- Enters through self-service or through the reception/walk-in process.

## End-to-end workflow

### Laboratory path

Patient or walk-in → Reception → Doctor → Laboratory → Doctor review → Pharmacy → Billing/payment → Completed

1. Reception identifies or registers the patient, creates the appointment, and checks the patient in.
2. The assigned doctor starts the consultation and records the clinical assessment.
3. If tests are needed, the doctor submits a laboratory order.
4. Laboratory staff process the order and release the result.
5. The doctor reviews the result, completes the treatment plan, and issues any prescription.
6. Pharmacy verifies and dispenses the prescribed quantity through the system.
7. Reception or the authorized billing workflow records payment and confirms the final state.
8. The completed visit appears in the patient's permitted history.

### No-laboratory path

Patient or walk-in → Reception → Doctor → Pharmacy if prescribed → Billing/payment → Completed

The doctor completes the consultation without a laboratory order. If no medicine is prescribed, the pharmacy step is skipped.

## Status meanings

| Status | Operational meaning |
|---|---|
| `PENDING` | The appointment has been requested and is waiting for reception review or confirmation. |
| `SCHEDULED` | A time has been reserved for the appointment. |
| `CONFIRMED` | The appointment has been accepted and the patient is expected. |
| `CHECKED_IN` | The patient has arrived and is waiting for the clinical workflow. |
| `IN_CONSULTATION` | The doctor is actively handling the visit. |
| `WAITING_LAB` | The consultation is paused while required laboratory work is processed. |
| `COMPLETED` | The permitted visit workflow is finished. |
| `CANCELLED` | The appointment was cancelled and must not continue through the active workflow. |
| `NO_SHOW` | The patient did not attend the scheduled appointment. |

Do not force a status merely to bypass a workflow step. If a status appears wrong, report it.

## Pharmacy workflow

- The formulary is the approved medicine list used by prescribing and pharmacy workflows.
- Stock is received in inventory batches with quantity and expiry information.
- Expiry information must be checked when stock is received and before dispensing.
- The system uses FEFO: stock with the earliest valid expiry is used first.
- Every intended receipt or dispense action creates a stock movement that explains the balance change.
- Low-stock information should be reviewed regularly and escalated before shortages affect care.
- Never alter stock outside the intended receipt, dispense, correction, or approved administrative workflow.

## Laboratory workflow

1. A doctor creates a laboratory order for the patient encounter.
2. Laboratory staff review the requested work and record sample/result information through the assigned order.
3. Each required result is completed through the controlled result workflow.
4. Results are released only through the intended release action.
5. The doctor reviews released results and resumes or completes the consultation.

Do not place results in notes or unrelated fields to bypass the laboratory workflow.

## Billing workflow

- Prices come from approved server-side service and medicine information; staff must not substitute browser-entered totals.
- An invoice records the authorized charges for the patient and workflow context.
- Payments are recorded against the correct invoice by an authorized role.
- The system protects against duplicate operations, reused payment requests, and overpayment.
- If a payment appears duplicated or inconsistent, stop and report it before attempting another adjustment.

## Security operating notes

- Never share user accounts.
- Never share passwords, one-time codes, MFA secrets, or recovery codes.
- Log out before leaving a shared computer.
- Use Admin accounts only for Admin tasks.
- Report unexpected access, missing access, or unfamiliar activity immediately.
- Do not include credentials, codes, tokens, or private patient information in support screenshots.
- Verify the selected patient before recording clinical, laboratory, pharmacy, or payment information.

## Pilot limitations

- This is a controlled pilot, not unrestricted production approval.
- Infrastructure may remain pilot-tier during evaluation.
- Rate limiting currently uses single-instance, in-memory counters that reset on restart.
- The deployment trust-proxy and direct-access policy must be reviewed before a full launch.
- Dedicated paid database capacity, backups, durable file storage, and production domain work are post-acceptance activities.
- This handoff does not claim regulatory or compliance certification.

## Problem reporting format

```text
Role:
Patient/Test ID:
Time:
Page:
Action attempted:
Expected result:
Actual result:
Screenshot available: Yes/No
Urgency: Blocking/High/Normal
Notes:
```

Use an approved test or non-sensitive reference whenever possible. Never put passwords, OTPs, MFA secrets, recovery codes, access tokens, database information, or sensitive health details in a bug report.
