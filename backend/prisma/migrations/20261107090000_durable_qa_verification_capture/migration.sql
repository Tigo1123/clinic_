-- Dedicated staging QA-only, encrypted, single-use registration captures.
CREATE TABLE "QaVerificationCapture" (
    "challengeId" TEXT NOT NULL,
    "codeEncrypted" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "QaVerificationCapture_pkey" PRIMARY KEY ("challengeId"),
    CONSTRAINT "QaVerificationCapture_expiry_check" CHECK (
      "expiresAt" > "createdAt" AND "expiresAt" <= "createdAt" + INTERVAL '5 minutes'
    ),
    CONSTRAINT "QaVerificationCapture_challengeId_fkey" FOREIGN KEY ("challengeId")
      REFERENCES "VerificationChallenge"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "QaVerificationCapture_expiresAt_idx" ON "QaVerificationCapture"("expiresAt");
