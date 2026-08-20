ALTER TABLE "LabOrderItem"
ADD COLUMN "labReviewStatus" TEXT NOT NULL DEFAULT 'NOT_REQUIRED',
ADD COLUMN "labReviewedAt" TIMESTAMP(3),
ADD COLUMN "labReviewNote" TEXT;

UPDATE "LabOrderItem"
SET "labReviewStatus" = 'PENDING_REVIEW'
WHERE "serviceId" IS NULL
  AND "customTestName" IS NOT NULL;

ALTER TABLE "LabOrderItem"
ADD CONSTRAINT "LabOrderItem_labReviewStatus_check"
CHECK (
  "labReviewStatus" IN (
    'NOT_REQUIRED',
    'PENDING_REVIEW',
    'APPROVED',
    'EXTERNAL'
  )
);

CREATE INDEX "LabOrderItem_labReviewStatus_idx"
ON "LabOrderItem"("labReviewStatus");
