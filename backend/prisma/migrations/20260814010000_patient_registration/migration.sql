CREATE TABLE "PatientRegistration" (
  "userId" TEXT NOT NULL PRIMARY KEY,
  "fullNameAr" TEXT NOT NULL,
  "fullNameEn" TEXT NOT NULL,
  "gender" TEXT NOT NULL,
  "dateOfBirth" TEXT NOT NULL,
  "addressStateId" INTEGER NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PatientRegistration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
