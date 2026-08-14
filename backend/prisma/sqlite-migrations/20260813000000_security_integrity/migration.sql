-- Forward-only reconciliation for fields added after the initial migration.
ALTER TABLE "Patient" ADD COLUMN "nationalIdAttachmentPath" TEXT;
ALTER TABLE "Patient" ADD COLUMN "insuranceAttachmentPath" TEXT;
ALTER TABLE "MedicalRecord" ADD COLUMN "attachmentPath" TEXT;

CREATE TABLE "Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "Notification_userId_isRead_idx" ON "Notification"("userId", "isRead");
CREATE INDEX "Appointment_doctorId_appointmentDate_appointmentTime_idx"
ON "Appointment"("doctorId", "appointmentDate", "appointmentTime");

-- Cancelled and no-show appointments release the slot. This partial unique index
-- is the final concurrency guard; Prisma/SQLite surfaces conflicts as P2002.
CREATE UNIQUE INDEX "Appointment_active_doctor_slot_key"
ON "Appointment"("doctorId", "appointmentDate", "appointmentTime")
WHERE "status" NOT IN ('CANCELLED', 'NO_SHOW');
