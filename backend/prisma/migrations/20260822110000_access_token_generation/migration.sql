-- Add an authoritative security generation used to revoke all previously
-- issued access tokens after a credential change.
ALTER TABLE "User"
ADD COLUMN "authVersion" INTEGER NOT NULL DEFAULT 0;

-- Bind newly-created login challenges to the credential generation that
-- completed password authentication. NULL intentionally invalidates legacy
-- challenges without assuming they belong to generation zero.
ALTER TABLE "MfaChallenge"
ADD COLUMN "authVersion" INTEGER;
