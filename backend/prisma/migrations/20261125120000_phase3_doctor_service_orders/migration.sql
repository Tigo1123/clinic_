-- Phase 3: Doctor catalogue service orders for non-lab billable clinical services
CREATE TABLE "ServiceOrder" (
    "id" TEXT NOT NULL,
    "medicalRecordId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "orderDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'PENDING_BILLING',
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "ServiceOrder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ServiceOrderItem" (
    "id" TEXT NOT NULL,
    "serviceOrderId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ServiceOrderItem_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Invoice" ADD COLUMN "serviceOrderId" TEXT;

CREATE UNIQUE INDEX "ServiceOrder_medicalRecordId_key" ON "ServiceOrder"("medicalRecordId");
CREATE INDEX "ServiceOrder_patientId_status_orderDate_idx" ON "ServiceOrder"("patientId", "status", "orderDate");
CREATE INDEX "ServiceOrder_doctorId_status_orderDate_idx" ON "ServiceOrder"("doctorId", "status", "orderDate");
CREATE INDEX "ServiceOrderItem_serviceOrderId_idx" ON "ServiceOrderItem"("serviceOrderId");
CREATE INDEX "ServiceOrderItem_serviceId_idx" ON "ServiceOrderItem"("serviceId");
CREATE INDEX "Invoice_serviceOrderId_invoiceType_paymentStatus_idx" ON "Invoice"("serviceOrderId", "invoiceType", "paymentStatus");

ALTER TABLE "ServiceOrder" ADD CONSTRAINT "ServiceOrder_medicalRecordId_fkey" FOREIGN KEY ("medicalRecordId") REFERENCES "MedicalRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ServiceOrder" ADD CONSTRAINT "ServiceOrder_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ServiceOrder" ADD CONSTRAINT "ServiceOrder_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ServiceOrderItem" ADD CONSTRAINT "ServiceOrderItem_serviceOrderId_fkey" FOREIGN KEY ("serviceOrderId") REFERENCES "ServiceOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ServiceOrderItem" ADD CONSTRAINT "ServiceOrderItem_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "ClinicalService"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_serviceOrderId_fkey" FOREIGN KEY ("serviceOrderId") REFERENCES "ServiceOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Preserve corrected historical invoices while enforcing one active invoice per order.
CREATE UNIQUE INDEX "Invoice_active_service_order_key" ON "Invoice"("serviceOrderId")
WHERE "serviceOrderId" IS NOT NULL AND "paymentStatus" NOT IN ('REFUNDED', 'VOIDED');

ALTER TABLE "ServiceOrder" ADD COLUMN "billingVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ServiceOrderItem"
  ADD COLUMN "billingExcludedAt" TIMESTAMP(3),
  ADD COLUMN "billingExcludedBy" TEXT,
  ADD COLUMN "billingExclusionReason" TEXT;
