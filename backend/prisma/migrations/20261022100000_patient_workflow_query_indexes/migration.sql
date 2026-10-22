-- Additive query indexes only. No rows, IDs, constraints, or monetary types change.
-- Run only after target/drift review and explicit production approval.
-- Use a maintenance window: ordinary CREATE INDEX briefly blocks table writes.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
CREATE INDEX "Appointment_patientId_appointmentDate_appointmentTime_idx" ON "Appointment"("patientId", "appointmentDate", "appointmentTime");
CREATE INDEX "MedicalRecord_patientId_visitDate_idx" ON "MedicalRecord"("patientId", "visitDate");
CREATE INDEX "Prescription_patientId_prescriptionDate_idx" ON "Prescription"("patientId", "prescriptionDate");
CREATE INDEX "LabOrder_patientId_releasedToPatientAt_orderDate_idx" ON "LabOrder"("patientId", "releasedToPatientAt", "orderDate");
CREATE INDEX "Invoice_patientId_invoiceDate_idx" ON "Invoice"("patientId", "invoiceDate");
CREATE INDEX "Payment_invoiceId_createdAt_idx" ON "Payment"("invoiceId", "createdAt");
COMMIT;
