-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "invoiceType" TEXT NOT NULL DEFAULT 'GENERAL';

-- CreateIndex
CREATE INDEX "Invoice_appointmentId_invoiceType_paymentStatus_idx" ON "Invoice"("appointmentId", "invoiceType", "paymentStatus");
