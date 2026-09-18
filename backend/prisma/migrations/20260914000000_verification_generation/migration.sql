-- Legacy challenges remain unbound and cannot be consumed. Request a fresh code.
ALTER TABLE "VerificationChallenge" ADD COLUMN "authVersion" INTEGER;
