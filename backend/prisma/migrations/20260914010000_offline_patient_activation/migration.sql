ALTER TABLE "PatientClaimCode"
  ADD COLUMN "publicId" TEXT,
  ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "maxAttempts" INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN "issuerAuthVersion" INTEGER;

CREATE UNIQUE INDEX "PatientClaimCode_publicId_key" ON "PatientClaimCode"("publicId");
