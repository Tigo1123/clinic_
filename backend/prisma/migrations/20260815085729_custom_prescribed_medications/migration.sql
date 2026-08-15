-- DropForeignKey
ALTER TABLE "PrescribedDrug" DROP CONSTRAINT "PrescribedDrug_drugId_fkey";

-- AlterTable
ALTER TABLE "PrescribedDrug" ADD COLUMN     "customDrugName" TEXT,
ALTER COLUMN "drugId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "PrescribedDrug" ADD CONSTRAINT "PrescribedDrug_drugId_fkey" FOREIGN KEY ("drugId") REFERENCES "DrugFormulary"("id") ON DELETE SET NULL ON UPDATE CASCADE;
