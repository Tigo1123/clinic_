-- DropForeignKey
ALTER TABLE "LabOrderItem" DROP CONSTRAINT "LabOrderItem_serviceId_fkey";

-- AlterTable
ALTER TABLE "LabOrderItem" ADD COLUMN     "customTestName" TEXT,
ALTER COLUMN "serviceId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "LabOrderItem" ADD CONSTRAINT "LabOrderItem_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "ClinicalService"("id") ON DELETE SET NULL ON UPDATE CASCADE;
