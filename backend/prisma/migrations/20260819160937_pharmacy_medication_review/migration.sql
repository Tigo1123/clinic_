-- AlterTable
ALTER TABLE "PrescribedDrug" ADD COLUMN     "pharmacyReviewNote" TEXT,
ADD COLUMN     "pharmacyReviewStatus" TEXT NOT NULL DEFAULT 'NOT_REQUIRED',
ADD COLUMN     "pharmacyReviewedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "PrescribedDrug_pharmacyReviewStatus_idx" ON "PrescribedDrug"("pharmacyReviewStatus");

-- Enforce valid pharmacy review workflow states.
ALTER TABLE "PrescribedDrug"
ADD CONSTRAINT "PrescribedDrug_pharmacyReviewStatus_check"
CHECK (
  "pharmacyReviewStatus" IN (
    'NOT_REQUIRED',
    'PENDING_REVIEW',
    'APPROVED',
    'EXTERNAL'
  )
);

-- Only active legacy free-text prescriptions require pharmacy review.
-- Historical filled/cancelled prescriptions are intentionally left unchanged.
UPDATE "PrescribedDrug" AS pd
SET "pharmacyReviewStatus" = 'PENDING_REVIEW'
WHERE pd."drugId" IS NULL
  AND pd."customDrugName" IS NOT NULL
  AND BTRIM(pd."customDrugName") <> ''
  AND EXISTS (
    SELECT 1
    FROM "Prescription" AS p
    WHERE p."id" = pd."prescriptionId"
      AND p."status" IN ('ACTIVE', 'PARTIALLY_FILLED')
  );
