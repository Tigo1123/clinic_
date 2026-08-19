ALTER TABLE "Invoice"
ADD COLUMN "labOrderId" TEXT;

ALTER TABLE "Invoice"
ADD CONSTRAINT "Invoice_labOrderId_fkey"
FOREIGN KEY ("labOrderId")
REFERENCES "LabOrder"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

CREATE INDEX "Invoice_labOrderId_invoiceType_paymentStatus_idx"
ON "Invoice"("labOrderId", "invoiceType", "paymentStatus");
