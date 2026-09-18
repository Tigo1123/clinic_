-- CreateTable
CREATE TABLE "UserExternalIdentity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerSubject" TEXT NOT NULL,
    "normalizedEmailAtLink" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserExternalIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PendingExternalAuth" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerSubject" TEXT NOT NULL,
    "verifiedEmail" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PendingExternalAuth_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserExternalIdentity_userId_idx" ON "UserExternalIdentity"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserExternalIdentity_provider_providerSubject_key" ON "UserExternalIdentity"("provider", "providerSubject");

-- CreateIndex
CREATE UNIQUE INDEX "UserExternalIdentity_userId_provider_key" ON "UserExternalIdentity"("userId", "provider");

-- CreateIndex
CREATE INDEX "PendingExternalAuth_expiresAt_consumedAt_idx" ON "PendingExternalAuth"("expiresAt", "consumedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PendingExternalAuth_provider_providerSubject_key" ON "PendingExternalAuth"("provider", "providerSubject");

-- AddForeignKey
ALTER TABLE "UserExternalIdentity" ADD CONSTRAINT "UserExternalIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
