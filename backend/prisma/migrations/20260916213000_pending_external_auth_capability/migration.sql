-- Add the hashed, rotatable onboarding capability for pending external auth.
ALTER TABLE "PendingExternalAuth"
ADD COLUMN "capabilityHash" TEXT NOT NULL;

CREATE UNIQUE INDEX "PendingExternalAuth_capabilityHash_key"
ON "PendingExternalAuth"("capabilityHash");
