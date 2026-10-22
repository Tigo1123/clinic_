-- 20261022100000_patient_workflow_query_indexes
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

-- 20261022110000_admin_catalog_configuration
-- Additive configuration only. Historical application rows are not rewritten.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
ALTER TABLE "ClinicalService" ADD COLUMN "code" TEXT;
CREATE UNIQUE INDEX "ClinicalService_code_key" ON "ClinicalService"("code");
CREATE TABLE "PaymentMethod" (
  "code" TEXT NOT NULL PRIMARY KEY,
  "labelAr" TEXT NOT NULL,
  "labelEn" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentMethod_supported_code" CHECK ("code" IN ('CASH', 'CARD', 'BANKAK', 'FAWRY'))
);
-- Existing runtime/SQL payment codes only; these are not financial transactions.
INSERT INTO "PaymentMethod" ("code", "labelAr", "labelEn") VALUES
 ('CASH', 'نقداً', 'Cash'),
 ('CARD', 'بطاقة / جهاز نقاط البيع', 'Card / POS'),
 ('BANKAK', 'بنكك — دفع يدوي', 'Bankak — manual mobile money'),
 ('FAWRY', 'فوري — دفع يدوي', 'Fawry — manual mobile money');
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_paymentMethod_fkey" FOREIGN KEY ("paymentMethod") REFERENCES "PaymentMethod"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_refundMethod_fkey" FOREIGN KEY ("refundMethod") REFERENCES "PaymentMethod"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
COMMIT;
