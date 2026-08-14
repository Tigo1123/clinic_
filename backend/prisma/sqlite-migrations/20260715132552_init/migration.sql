-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "lastPasswordChange" DATETIME,
    "mfaSecret" TEXT,
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "preferredLanguage" TEXT NOT NULL DEFAULT 'ar',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "State" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "labelAr" TEXT NOT NULL,
    "labelEn" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Doctor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "fullNameAr" TEXT NOT NULL,
    "fullNameEn" TEXT NOT NULL,
    "specialtyAr" TEXT NOT NULL,
    "specialtyEn" TEXT NOT NULL,
    "consultationFee" DECIMAL NOT NULL,
    "weeklySchedule" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    CONSTRAINT "Doctor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Patient" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fullNameAr" TEXT NOT NULL,
    "fullNameEn" TEXT NOT NULL,
    "gender" TEXT NOT NULL,
    "dateOfBirth" TEXT NOT NULL,
    "nationalId" TEXT,
    "phone" TEXT NOT NULL,
    "addressStateId" INTEGER NOT NULL,
    "addressDetails" TEXT,
    "emergencyContact" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Patient_addressStateId_fkey" FOREIGN KEY ("addressStateId") REFERENCES "State" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Appointment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "patientId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "appointmentDate" TEXT NOT NULL,
    "appointmentTime" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Appointment_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Appointment_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EmergencyOverride" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "appointmentId" TEXT NOT NULL,
    "justification" TEXT NOT NULL,
    "authorizedById" TEXT NOT NULL,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmergencyOverride_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MedicalRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "patientId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "visitDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "symptomsEncrypted" TEXT NOT NULL,
    "diagnosisEncrypted" TEXT NOT NULL,
    "treatmentEncrypted" TEXT NOT NULL,
    "vitalSignsJson" TEXT NOT NULL,
    "clinicalNotesEncrypted" TEXT NOT NULL,
    CONSTRAINT "MedicalRecord_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MedicalRecord_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MedicalRecord_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Consent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "patientId" TEXT NOT NULL,
    "consentType" TEXT NOT NULL,
    "signatureSvg" TEXT,
    "otpVerified" BOOLEAN NOT NULL DEFAULT false,
    "guardianName" TEXT,
    "guardianNationalId" TEXT,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Consent_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Prescription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "medicalRecordId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "prescriptionDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    CONSTRAINT "Prescription_medicalRecordId_fkey" FOREIGN KEY ("medicalRecordId") REFERENCES "MedicalRecord" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Prescription_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Prescription_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DrugFormulary" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "labelAr" TEXT NOT NULL,
    "labelEn" TEXT NOT NULL,
    "genericName" TEXT NOT NULL,
    "strength" TEXT NOT NULL,
    "dosageForm" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "PrescribedDrug" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "prescriptionId" TEXT NOT NULL,
    "drugId" TEXT NOT NULL,
    "dosage" TEXT NOT NULL,
    "duration" TEXT NOT NULL,
    "instructionsAr" TEXT NOT NULL,
    "instructionsEn" TEXT NOT NULL,
    "qtyPrescribed" INTEGER NOT NULL,
    "qtyDispensed" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "PrescribedDrug_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "Prescription" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PrescribedDrug_drugId_fkey" FOREIGN KEY ("drugId") REFERENCES "DrugFormulary" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InventoryBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "drugId" TEXT NOT NULL,
    "batchNumber" TEXT NOT NULL,
    "expiryDate" TEXT NOT NULL,
    "qtyOnHand" INTEGER NOT NULL,
    "minReorderLevel" INTEGER NOT NULL DEFAULT 10,
    CONSTRAINT "InventoryBatch_drugId_fkey" FOREIGN KEY ("drugId") REFERENCES "DrugFormulary" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ClinicalService" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "labelAr" TEXT NOT NULL,
    "labelEn" TEXT NOT NULL,
    "baseFeeSdg" DECIMAL NOT NULL,
    "baseFeeUsd" DECIMAL NOT NULL,
    "category" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "LabOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "medicalRecordId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "orderDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'PENDING_BILLING',
    CONSTRAINT "LabOrder_medicalRecordId_fkey" FOREIGN KEY ("medicalRecordId") REFERENCES "MedicalRecord" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LabOrder_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LabOrder_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LabOrderItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "labOrderId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "resultValue" TEXT,
    "referenceRangeMin" DECIMAL,
    "referenceRangeMax" DECIMAL,
    "isOutOfRange" BOOLEAN NOT NULL DEFAULT false,
    "fileAttachmentPath" TEXT,
    CONSTRAINT "LabOrderItem_labOrderId_fkey" FOREIGN KEY ("labOrderId") REFERENCES "LabOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LabOrderItem_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "ClinicalService" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "patientId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "invoiceDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalAmountSdg" DECIMAL NOT NULL,
    "totalAmountUsd" DECIMAL NOT NULL,
    "invoiceExchangeRate" DECIMAL NOT NULL,
    "paymentStatus" TEXT NOT NULL DEFAULT 'UNPAID',
    "insuranceClaimId" TEXT,
    "createdBy" TEXT NOT NULL,
    CONSTRAINT "Invoice_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Invoice_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Invoice_insuranceClaimId_fkey" FOREIGN KEY ("insuranceClaimId") REFERENCES "InsuranceClaim" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InvoiceItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "invoiceId" TEXT NOT NULL,
    "descriptionAr" TEXT NOT NULL,
    "descriptionEn" TEXT NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "unitPriceSdg" DECIMAL NOT NULL,
    "unitPriceUsd" DECIMAL NOT NULL,
    CONSTRAINT "InvoiceItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "invoiceId" TEXT NOT NULL,
    "amountSdg" DECIMAL NOT NULL,
    "amountUsd" DECIMAL NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "transactionReference" TEXT,
    "verificationStatus" TEXT NOT NULL DEFAULT 'VERIFIED',
    "receivedBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InsuranceCompany" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "labelAr" TEXT NOT NULL,
    "labelEn" TEXT NOT NULL,
    "copayPercentage" DECIMAL NOT NULL,
    "billingCycleDays" INTEGER NOT NULL DEFAULT 30
);

-- CreateTable
CREATE TABLE "InsuranceClaim" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "insuranceCompanyId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "claimAmountSdg" DECIMAL NOT NULL,
    "claimStatus" TEXT NOT NULL DEFAULT 'DRAFT',
    "submissionDate" DATETIME,
    "paymentDate" DATETIME,
    CONSTRAINT "InsuranceClaim_insuranceCompanyId_fkey" FOREIGN KEY ("insuranceCompanyId") REFERENCES "InsuranceCompany" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InsuranceClaim_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NotificationLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "recipientPhone" TEXT NOT NULL,
    "messageType" TEXT NOT NULL,
    "messageBody" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'ar',
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttempt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "TenantAuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "ipAddress" TEXT NOT NULL,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Doctor_userId_key" ON "Doctor"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Patient_nationalId_key" ON "Patient"("nationalId");

-- CreateIndex
CREATE INDEX "Patient_phone_idx" ON "Patient"("phone");

-- CreateIndex
CREATE INDEX "Appointment_appointmentDate_appointmentTime_idx" ON "Appointment"("appointmentDate", "appointmentTime");

-- CreateIndex
CREATE UNIQUE INDEX "EmergencyOverride_appointmentId_key" ON "EmergencyOverride"("appointmentId");

-- CreateIndex
CREATE UNIQUE INDEX "MedicalRecord_appointmentId_key" ON "MedicalRecord"("appointmentId");

-- CreateIndex
CREATE INDEX "InventoryBatch_expiryDate_idx" ON "InventoryBatch"("expiryDate");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_insuranceClaimId_key" ON "Invoice"("insuranceClaimId");

-- CreateIndex
CREATE INDEX "Invoice_invoiceDate_idx" ON "Invoice"("invoiceDate");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_transactionReference_key" ON "Payment"("transactionReference");

-- CreateIndex
CREATE UNIQUE INDEX "InsuranceClaim_invoiceId_key" ON "InsuranceClaim"("invoiceId");
