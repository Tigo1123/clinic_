ALTER TABLE "User" ADD COLUMN "email" TEXT;
ALTER TABLE "User" ADD COLUMN "phoneNormalized" TEXT;
ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" DATETIME;
ALTER TABLE "User" ADD COLUMN "phoneVerifiedAt" DATETIME;

ALTER TABLE "Patient" ADD COLUMN "userId" TEXT REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LabOrder" ADD COLUMN "releasedToPatientAt" DATETIME;

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "User_phoneNormalized_key" ON "User"("phoneNormalized");
CREATE UNIQUE INDEX "Patient_userId_key" ON "Patient"("userId");

CREATE TABLE "VerificationChallenge" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "targetNormalized" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "expiresAt" DATETIME NOT NULL,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 5,
  "usedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VerificationChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "VerificationChallenge_userId_type_createdAt_idx" ON "VerificationChallenge"("userId", "type", "createdAt");

CREATE TABLE "PatientClaimCode" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "patientId" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "expiresAt" DATETIME NOT NULL,
  "usedAt" DATETIME,
  "createdById" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PatientClaimCode_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PatientClaimCode_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "PatientClaimCode_patientId_createdAt_idx" ON "PatientClaimCode"("patientId", "createdAt");
