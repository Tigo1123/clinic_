-- AlterTable
ALTER TABLE "DrugFormulary" ADD COLUMN     "unitPriceSdg" DECIMAL(65,30);

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "prescriptionId" TEXT;

-- CreateIndex
CREATE INDEX "Invoice_prescriptionId_invoiceType_paymentStatus_idx" ON "Invoice"("prescriptionId", "invoiceType", "paymentStatus");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "Prescription"("id") ON DELETE SET NULL ON UPDATE CASCADE;
