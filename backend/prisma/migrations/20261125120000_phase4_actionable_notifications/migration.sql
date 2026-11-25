-- AlterTable
ALTER TABLE "Notification"
ADD COLUMN "titleAr" TEXT,
ADD COLUMN "titleEn" TEXT,
ADD COLUMN "messageAr" TEXT,
ADD COLUMN "messageEn" TEXT,
ADD COLUMN "eventType" TEXT,
ADD COLUMN "targetType" TEXT,
ADD COLUMN "targetId" TEXT,
ADD COLUMN "payload" JSONB,
ADD COLUMN "dedupeKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Notification_userId_dedupeKey_key" ON "Notification"("userId", "dedupeKey");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_id_idx" ON "Notification"("userId", "createdAt", "id");
