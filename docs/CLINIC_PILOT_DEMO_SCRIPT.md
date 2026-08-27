# Clinic Pilot Demo Script

## Preparation

- Duration: 10–15 minutes.
- Use approved demo accounts and fictional test data only.
- Confirm the demonstration appointment, laboratory service, medicine, valid inventory batch, and prices are available.
- Keep credentials and authentication codes off-screen.

## Main demonstration

| Step | Role | Action | Audience should observe | Expected success indicator |
|---:|---|---|---|---|
| 1 | Receptionist | Locate or create the fictional test patient, create the appointment, and check the patient in. | Patient identity and appointment are linked; reception controls arrival. | Appointment shows `CHECKED_IN` and appears in the operational queue. |
| 2 | Doctor | Open the assigned appointment and start the consultation. | Only the assigned doctor can begin the clinical workflow. | Appointment shows `IN_CONSULTATION`. |
| 3 | Doctor | Record fictional vitals, symptoms, diagnosis, and treatment notes. | Clinical information is captured in the visit rather than unrelated fields. | Consultation data saves successfully without exposing another patient's data. |
| 4 | Doctor | Order one configured laboratory test. | The test is selected from the intended laboratory workflow. | Laboratory order appears and the appointment shows `WAITING_LAB`. |
| 5 | Lab Tech | Open the laboratory order, enter the fictional result, complete it, and release it. | Laboratory staff control result entry and release. | Result is saved/released and the order completes through the expected states. |
| 6 | Doctor | Reopen the consultation and review the released result. | The doctor receives the result in the correct patient context. | Released result is visible and consultation can continue. |
| 7 | Doctor | Create a prescription using an approved formulary medicine. | Medicine selection and prescribed quantity are controlled. | Prescription is created and appears in the pharmacy workflow. |
| 8 | Pharmacist | Review and dispense the permitted prescribed quantity. | Pharmacy cannot exceed the prescription or available stock. | Dispense succeeds and prescription quantity/status updates. |
| 9 | Pharmacist | Open stock history for the medicine/batch. | The dispense created a traceable movement and FEFO selected valid stock. | Stock balance decreases by the dispensed amount and a movement is visible. |
| 10 | Receptionist/Billing | Open the correct invoice and record the approved test payment. | Prices and totals come from the system; duplicate/overpayment controls remain active. | Payment succeeds once and invoice payment state updates correctly. |
| 11 | Doctor or permitted patient view | Complete the visit and open final history. | The completed encounter links the clinical, lab, prescription, and financial workflow appropriately. | Appointment shows `COMPLETED`; permitted history shows the completed visit. |

## Presenter notes

- State the active role before each handoff.
- Point out visible success indicators rather than internal implementation details.
- Do not demonstrate security controls using real credentials or real patient information.
- If a step fails, stop that branch, record the problem, and use the backup demonstration rather than manipulating data outside the workflow.

## Five-minute backup demonstration

Use an already prepared fictional patient and a no-laboratory consultation.

| Step | Role | Action | Expected success indicator |
|---:|---|---|---|
| 1 | Receptionist | Open the prepared appointment and check in the patient. | Appointment becomes `CHECKED_IN`. |
| 2 | Doctor | Start the consultation and record brief fictional vitals/diagnosis. | Appointment becomes `IN_CONSULTATION`; clinical data saves. |
| 3 | Doctor | Prescribe one approved medicine and complete the consultation without a lab order. | Prescription is available and visit can complete through the no-lab path. |
| 4 | Pharmacist | Dispense one permitted quantity and show the resulting stock movement. | Prescription and stock update once. |
| 5 | Receptionist/Billing | Record the approved payment and show completed history. | Invoice updates and the visit appears as `COMPLETED`. |
