ALTER TABLE "Patient" ADD COLUMN "firstNameAr" TEXT, ADD COLUMN "fatherNameAr" TEXT, ADD COLUMN "grandfatherNameAr" TEXT, ADD COLUMN "familyNameAr" TEXT, ADD COLUMN "firstNameEn" TEXT, ADD COLUMN "fatherNameEn" TEXT, ADD COLUMN "grandfatherNameEn" TEXT, ADD COLUMN "familyNameEn" TEXT;
ALTER TABLE "PatientRegistration" ADD COLUMN "firstNameAr" TEXT, ADD COLUMN "fatherNameAr" TEXT, ADD COLUMN "grandfatherNameAr" TEXT, ADD COLUMN "familyNameAr" TEXT, ADD COLUMN "firstNameEn" TEXT, ADD COLUMN "fatherNameEn" TEXT, ADD COLUMN "grandfatherNameEn" TEXT, ADD COLUMN "familyNameEn" TEXT;
CREATE TABLE "Specialty" ("id" TEXT NOT NULL, "code" TEXT NOT NULL, "nameAr" TEXT NOT NULL, "nameEn" TEXT NOT NULL, "active" BOOLEAN NOT NULL DEFAULT true, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "Specialty_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "Specialty_code_key" ON "Specialty"("code");
ALTER TABLE "Doctor" ADD COLUMN "specialtyId" TEXT;
ALTER TABLE "Doctor" ADD CONSTRAINT "Doctor_specialtyId_fkey" FOREIGN KEY ("specialtyId") REFERENCES "Specialty"("id") ON DELETE SET NULL ON UPDATE CASCADE;
