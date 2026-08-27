# Clinic Pilot Demo Setup

This checklist prepares a controlled 10–15 minute clinic demonstration. Use normal application workflows, approved pilot infrastructure, and fictional data only. Do not use seeds, direct database edits, or ad hoc reset scripts to prepare the demonstration.

## Before demo

- [ ] Backend and frontend are reachable through the approved pilot addresses.
- [ ] A health check succeeds and each required role can reach its permitted workspace.
- [ ] Email delivery is ready if the patient portal or profile verification will be shown.
- [ ] Six separate demo accounts are available and their owners know how to authenticate privately.
- [ ] The demo doctor is active, scheduled for the chosen time, and available to receive the appointment.
- [ ] One active, priced laboratory test is visible to the doctor and laboratory workflow.
- [ ] One active, priced medicine has a usable inventory batch with sufficient stock.
- [ ] Consultation, laboratory, and pharmacy prices have been reviewed before the audience arrives.
- [ ] Desktop presentation browser is ready and signed out; mobile view is available if requested.
- [ ] Browser autofill, notifications, and screen sharing will not expose credentials or unrelated information.
- [ ] A five-minute no-laboratory backup patient/slot is available.

## Accounts

Create staff through **Admin → Staff Accounts → Add New Staff**. This is the supported path because it validates the role, creates the Doctor profile when required, records the Admin actor, and applies the normal password policy. Do not use seed scripts, direct SQL, or manual Prisma writes.

Create the PATIENT login through the normal patient registration and verification screens. A patient record created by Reception for a walk-in is not by itself a portal login account. If patient self-service is not part of the live presentation, keep the fictional portal account available only for the final permitted-history view.

| Role | Fictional display name | Required status | MFA for pilot | Demo responsibility | Verify before demo |
|---|---|---|---|---|---|
| ADMIN | Pilot Administrator | `ACTIVE` | Required | Create/verify staff, prices, and account status | MFA works; Admin pages open; account is not shared. |
| RECEPTIONIST | Pilot Receptionist | `ACTIVE` | Recommended | Patient intake, appointment, consultation/lab billing, and final reconciliation | Patient search, walk-in, queue, invoice, and payment actions open. |
| DOCTOR | Dr. Demo General | `ACTIVE` | Recommended | Consultation, clinical notes, lab order, review, and prescription | Doctor profile, schedule, fee, queue, and formulary selection are correct. |
| LAB_TECH | Pilot Laboratory Technician | `ACTIVE` | Recommended | Sample/result workflow and release | Paid lab order queue and result actions open. |
| PHARMACIST | Pilot Pharmacist | `ACTIVE` | Recommended | Pharmacy invoice, FEFO dispense, and stock movement review | Prescription queue, invoice action, inventory, and movements open. |
| PATIENT | Demo Patient Alpha | `ACTIVE` after verification | Not applicable | Optional self-service and final permitted history | Account is linked only to the fictional demo patient and shows no other patient data. |

Passwords, one-time codes, MFA setup material, and recovery codes must be created and handled outside Git and documentation. Do not display them to the audience.

## Reference data

The minimum demo dataset is:

- [ ] One active Doctor profile with the intended fictional display name.
- [ ] A Doctor schedule containing an open slot for the demo time.
- [ ] A positive official consultation fee for that Doctor.
- [ ] One active laboratory Clinical Service with a positive official price.
- [ ] One active formulary medicine suitable for the fictional prescription.
- [ ] A positive official pharmacy selling price for that medicine.
- [ ] One inventory batch for that medicine with:
  - [ ] a clearly fictional batch reference;
  - [ ] an expiry date after the demo date;
  - [ ] positive quantity on hand exceeding all planned demo runs;
  - [ ] a reviewed low-stock threshold.
- [ ] Reception can create and fully pay the consultation invoice before Doctor start.
- [ ] Reception can locate and fully pay the laboratory invoice before Lab processing.
- [ ] Pharmacy can locate and fully pay the pharmacy invoice before dispensing.
- [ ] The selected payment method is approved for fictional pilot transactions.

Prices must be reviewed in the Admin pricing workspace. Do not type substitute totals into browser fields or change stock outside the intended inventory workflow.

## Demo patient

Use one new fictional patient identity per run. Recommended display label: **Demo Patient Alpha**, followed by a run label visible to staff, such as the demo date or an approved short sequence.

Fill these fields manually through the application:

- fictional English and Arabic display names;
- fictional date of birth suitable for an adult demo patient;
- fictional gender selection;
- an approved non-real phone placeholder accepted by the pilot workflow;
- an approved state/address selection with non-sensitive demo wording;
- fictional emergency-contact wording;
- no national identifier unless the field is mandatory, in which case use an approved non-real placeholder;
- a controlled inbox only if the pilot owner later chooses to demonstrate verified email delivery.

During consultation, enter obviously fictional vitals, symptoms, diagnosis, laboratory result, treatment, and prescription instructions. Do not copy a real person's history or use a real phone number, email address, national ID, or clinical details.

## Live demo

Payment gates are part of the supported security workflow. Complete each invoice at the indicated checkpoint; the final billing step is a reconciliation review.

| Step | Account | Page/module | Action | Expected status | Visible evidence |
|---:|---|---|---|---|---|
| 1 | Pilot Receptionist | Reception → Patient/Walk-in | Create or locate the fresh fictional patient and create the walk-in appointment for Dr. Demo General. | `CHECKED_IN` | Patient appears once in the Doctor queue with the correct Doctor and time. |
| 2 | Pilot Receptionist | Reception → Billing | Open the consultation invoice and record the approved fictional payment. | Fully paid consultation invoice | Server-priced total and payment state are visible; no duplicate payment appears. |
| 3 | Dr. Demo General | Doctor → Queue/Consultation | Start the assigned consultation. | `IN_CONSULTATION` | Consultation workspace opens for the correct fictional patient. |
| 4 | Dr. Demo General | Doctor → Clinical record | Enter fictional vitals, symptoms, diagnosis, and initial treatment, then order the prepared laboratory test. | `WAITING_LAB` | Clinical information saves and the laboratory order appears. |
| 5 | Pilot Receptionist | Reception → Laboratory billing queue | Select the new laboratory order and fully pay its server-priced invoice. | Paid laboratory order | Laboratory charge and payment state are visible against the correct order. |
| 6 | Pilot Laboratory Technician | Laboratory → Orders/Results | Record the fictional sample/result, complete required items, and release the result. | Laboratory order completed/released | Result is visible as released and the visit returns to Doctor review. |
| 7 | Dr. Demo General | Doctor → Consultation review | Review the released result, finalize the fictional care plan, and prescribe the prepared formulary medicine. | Consultation ready to complete; prescription active | Released result and prescription are attached to the same visit. |
| 8 | Pilot Pharmacist | Pharmacy → Prescription/Invoice | Review the prescription and fully pay the server-priced pharmacy invoice using the intended pharmacy payment action. | Paid pharmacy invoice | Correct medicine, prescribed quantity, price, and paid state are visible. |
| 9 | Pilot Pharmacist | Pharmacy → Dispensing | Dispense the permitted quantity. | Prescription filled or partially filled as planned | Dispensed quantity updates once; no over-dispense occurs. |
| 10 | Pilot Pharmacist | Pharmacy → Inventory/Movements | Show the batch and resulting stock movement. | Updated batch balance | FEFO batch selection and one dispense movement explain the new balance. |
| 11 | Pilot Receptionist | Reception → Billing/Patient | Review consultation, laboratory, and pharmacy payment states; do not enter a second payment. | All required invoices reconciled | Each invoice is identifiable and paid once. |
| 12 | Dr. Demo General or Demo Patient Alpha | Doctor completion/Patient history | Complete the visit if not already completed and open the permitted final history. | `COMPLETED` | Final visit, released result, and prescription appear in the correct permitted view. |

## Backup demo

Target duration: five minutes. Use a separate fresh fictional patient and an available slot.

1. **Pilot Receptionist — Reception/Walk-in:** create and check in the patient, then pay the server-priced consultation invoice. Expected: `CHECKED_IN` and paid consultation.
2. **Dr. Demo General — Doctor/Consultation:** start the visit, enter brief fictional vitals and diagnosis, skip laboratory ordering, and prescribe the prepared medicine. Expected: `IN_CONSULTATION` progressing through the no-lab path.
3. **Pilot Pharmacist — Pharmacy:** review the prescription, complete the pharmacy payment prerequisite, and dispense the permitted quantity. Expected: paid invoice, updated prescription, and one stock movement.
4. **Pilot Receptionist — Billing:** review the already-recorded payments without duplicating them. Expected: reconciled invoice states.
5. **Dr. Demo General or Demo Patient Alpha — History:** complete and show the permitted final visit. Expected: `COMPLETED` history.

## Repeated demo strategy

- Create a fresh fictional patient for every run and include an approved run label in the display name or notes.
- Choose a new available Doctor slot; do not reuse an active same-day appointment for the same fictional identity.
- Never reuse a prescription that has already been dispensed.
- Check usable, non-expired stock before every run and keep planned quantities small.
- After each run, reconcile the batch balance against its receipt/dispense movements.
- Keep demo invoices identifiable through their fictional patient and appointment context; do not put special values into financial fields.
- Never delete or rewrite completed records merely to reset the demo.
- If an appointment is still in a supported cancellable state and will not be used, cancel it through the normal Reception or Patient action. Do not force terminal or clinical statuses backward.
- Keep demo activity out of real clinic records by using dedicated fictional accounts, names, slots, and approved pilot context.

## After demo

- [ ] Log out every role on every browser and mobile device used.
- [ ] Close private browser windows and ensure no credential prompt remains visible.
- [ ] Confirm the demonstrated prescription was dispensed only once.
- [ ] Reconcile the medicine batch balance and stock movement.
- [ ] Confirm consultation, laboratory, and pharmacy invoices were paid only once.
- [ ] Record the fictional patient/run reference used for follow-up.
- [ ] Disable or rotate demo accounts that will not be reused; keep required accounts assigned to named owners.
- [ ] Store any MFA recovery material only in the approved secure location outside Git.
- [ ] Capture issues using the handoff template without credentials or sensitive health information.
- [ ] Collect audience feedback using the pilot feedback form.
