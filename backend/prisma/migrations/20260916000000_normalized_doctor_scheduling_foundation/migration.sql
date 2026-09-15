CREATE TYPE "ScheduleDayOfWeek" AS ENUM ('SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY');

CREATE TABLE "DoctorSchedule" (
  "id" TEXT NOT NULL,
  "doctorId" TEXT NOT NULL,
  "effectiveFrom" TEXT NOT NULL,
  "effectiveTo" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DoctorSchedule_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DoctorSchedule_dates_check" CHECK ("effectiveFrom" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND ("effectiveTo" IS NULL OR ("effectiveTo" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND "effectiveTo" >= "effectiveFrom")))
);
CREATE INDEX "DoctorSchedule_doctorId_effectiveFrom_effectiveTo_idx" ON "DoctorSchedule"("doctorId", "effectiveFrom", "effectiveTo");
CREATE INDEX "DoctorSchedule_doctorId_active_idx" ON "DoctorSchedule"("doctorId", "active");
ALTER TABLE "DoctorSchedule" ADD CONSTRAINT "DoctorSchedule_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "DoctorSchedulePeriod" (
  "id" TEXT NOT NULL,
  "scheduleId" TEXT NOT NULL,
  "dayOfWeek" "ScheduleDayOfWeek" NOT NULL,
  "startTime" TEXT NOT NULL,
  "endTime" TEXT NOT NULL,
  "slotDurationMinutes" INTEGER NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DoctorSchedulePeriod_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DoctorSchedulePeriod_time_check" CHECK ("startTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "endTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "startTime" < "endTime" AND "slotDurationMinutes" BETWEEN 1 AND 1440)
);
CREATE INDEX "DoctorSchedulePeriod_scheduleId_dayOfWeek_active_idx" ON "DoctorSchedulePeriod"("scheduleId", "dayOfWeek", "active");
ALTER TABLE "DoctorSchedulePeriod" ADD CONSTRAINT "DoctorSchedulePeriod_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "DoctorSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "DoctorScheduleBreak" (
  "id" TEXT NOT NULL,
  "periodId" TEXT NOT NULL,
  "startTime" TEXT NOT NULL,
  "endTime" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DoctorScheduleBreak_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DoctorScheduleBreak_time_check" CHECK ("startTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "endTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "startTime" < "endTime")
);
CREATE INDEX "DoctorScheduleBreak_periodId_active_idx" ON "DoctorScheduleBreak"("periodId", "active");
ALTER TABLE "DoctorScheduleBreak" ADD CONSTRAINT "DoctorScheduleBreak_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "DoctorSchedulePeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "DoctorScheduleException" (
  "id" TEXT NOT NULL,
  "doctorId" TEXT NOT NULL,
  "date" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "reason" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DoctorScheduleException_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DoctorScheduleException_type_check" CHECK ("type" IN ('FULL_DAY_LEAVE', 'SPECIAL_HOURS')),
  CONSTRAINT "DoctorScheduleException_date_check" CHECK ("date" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
);
CREATE UNIQUE INDEX "DoctorScheduleException_doctorId_date_key" ON "DoctorScheduleException"("doctorId", "date");
CREATE INDEX "DoctorScheduleException_doctorId_date_active_idx" ON "DoctorScheduleException"("doctorId", "date", "active");
ALTER TABLE "DoctorScheduleException" ADD CONSTRAINT "DoctorScheduleException_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "DoctorScheduleExceptionPeriod" (
  "id" TEXT NOT NULL,
  "exceptionId" TEXT NOT NULL,
  "startTime" TEXT NOT NULL,
  "endTime" TEXT NOT NULL,
  "slotDurationMinutes" INTEGER NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DoctorScheduleExceptionPeriod_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DoctorScheduleExceptionPeriod_time_check" CHECK ("startTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "endTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "startTime" < "endTime" AND "slotDurationMinutes" BETWEEN 1 AND 1440)
);
CREATE INDEX "DoctorScheduleExceptionPeriod_exceptionId_active_idx" ON "DoctorScheduleExceptionPeriod"("exceptionId", "active");
ALTER TABLE "DoctorScheduleExceptionPeriod" ADD CONSTRAINT "DoctorScheduleExceptionPeriod_exceptionId_fkey" FOREIGN KEY ("exceptionId") REFERENCES "DoctorScheduleException"("id") ON DELETE CASCADE ON UPDATE CASCADE;
