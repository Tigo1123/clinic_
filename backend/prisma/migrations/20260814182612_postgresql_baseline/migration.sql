-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "lastPasswordChange" TIMESTAMP(3),
    "mfaSecret" TEXT,
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "preferredLanguage" TEXT NOT NULL DEFAULT 'ar',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "email" TEXT,
    "phoneNormalized" TEXT,
    "emailVerifiedAt" TIMESTAMP(3),
    "phoneVerifiedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "State" (
    "id" INTEGER NOT NULL,
    "labelAr" TEXT NOT NULL,
    "labelEn" TEXT NOT NULL,

    CONSTRAINT "State_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Doctor" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fullNameAr" TEXT NOT NULL,
    "fullNameEn" TEXT NOT NULL,
    "specialtyAr" TEXT NOT NULL,
    "specialtyEn" TEXT NOT NULL,
    "consultationFee" DECIMAL(65,30) NOT NULL,
    "weeklySchedule" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "Doctor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Patient" (
    "id" TEXT NOT NULL,
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nationalIdAttachmentPath" TEXT,
    "insuranceAttachmentPath" TEXT,
    "userId" TEXT,

    CONSTRAINT "Patient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Appointment" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "appointmentDate" TEXT NOT NULL,
    "appointmentTime" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmergencyOverride" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "justification" TEXT NOT NULL,
    "authorizedById" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmergencyOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicalRecord" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "visitDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "symptomsEncrypted" TEXT NOT NULL,
    "diagnosisEncrypted" TEXT NOT NULL,
    "treatmentEncrypted" TEXT NOT NULL,
    "vitalSignsJson" TEXT NOT NULL,
    "clinicalNotesEncrypted" TEXT NOT NULL,
    "attachmentPath" TEXT,

    CONSTRAINT "MedicalRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Consent" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "consentType" TEXT NOT NULL,
    "signatureSvg" TEXT,
    "otpVerified" BOOLEAN NOT NULL DEFAULT false,
    "guardianName" TEXT,
    "guardianNationalId" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Consent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Prescription" (
    "id" TEXT NOT NULL,
    "medicalRecordId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "prescriptionDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "Prescription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrugFormulary" (
    "id" TEXT NOT NULL,
    "labelAr" TEXT NOT NULL,
    "labelEn" TEXT NOT NULL,
    "genericName" TEXT NOT NULL,
    "strength" TEXT NOT NULL,
    "dosageForm" TEXT NOT NULL,

    CONSTRAINT "DrugFormulary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrescribedDrug" (
    "id" TEXT NOT NULL,
    "prescriptionId" TEXT NOT NULL,
    "drugId" TEXT NOT NULL,
    "dosage" TEXT NOT NULL,
    "duration" TEXT NOT NULL,
    "instructionsAr" TEXT NOT NULL,
    "instructionsEn" TEXT NOT NULL,
    "qtyPrescribed" INTEGER NOT NULL,
    "qtyDispensed" INTEGER NOT NULL DEFAULT 0,
    "ledgerVersion" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PrescribedDrug_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryBatch" (
    "id" TEXT NOT NULL,
    "drugId" TEXT NOT NULL,
    "batchNumber" TEXT NOT NULL,
    "expiryDate" TEXT NOT NULL,
    "qtyOnHand" INTEGER NOT NULL,
    "minReorderLevel" INTEGER NOT NULL DEFAULT 10,
    "ledgerVersion" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "InventoryBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClinicalService" (
    "id" TEXT NOT NULL,
    "labelAr" TEXT NOT NULL,
    "labelEn" TEXT NOT NULL,
    "baseFeeSdg" DECIMAL(65,30) NOT NULL,
    "baseFeeUsd" DECIMAL(65,30) NOT NULL,
    "category" TEXT NOT NULL,

    CONSTRAINT "ClinicalService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabOrder" (
    "id" TEXT NOT NULL,
    "medicalRecordId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "orderDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'PENDING_BILLING',
    "releasedToPatientAt" TIMESTAMP(3),

    CONSTRAINT "LabOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationChallenge" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "targetNormalized" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientClaimCode" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PatientClaimCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientRegistration" (
    "userId" TEXT NOT NULL,
    "fullNameAr" TEXT NOT NULL,
    "fullNameEn" TEXT NOT NULL,
    "gender" TEXT NOT NULL,
    "dateOfBirth" TEXT NOT NULL,
    "addressStateId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PatientRegistration_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "LabOrderItem" (
    "id" TEXT NOT NULL,
    "labOrderId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "resultValue" TEXT,
    "referenceRangeMin" DECIMAL(65,30),
    "referenceRangeMax" DECIMAL(65,30),
    "isOutOfRange" BOOLEAN NOT NULL DEFAULT false,
    "fileAttachmentPath" TEXT,

    CONSTRAINT "LabOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "invoiceDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalAmountSdg" DECIMAL(65,30) NOT NULL,
    "totalAmountUsd" DECIMAL(65,30) NOT NULL,
    "invoiceExchangeRate" DECIMAL(65,30) NOT NULL,
    "paymentStatus" TEXT NOT NULL DEFAULT 'UNPAID',
    "ledgerVersion" INTEGER NOT NULL DEFAULT 0,
    "insuranceClaimId" TEXT,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceItem" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "descriptionAr" TEXT NOT NULL,
    "descriptionEn" TEXT NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "unitPriceSdg" DECIMAL(65,30) NOT NULL,
    "unitPriceUsd" DECIMAL(65,30) NOT NULL,

    CONSTRAINT "InvoiceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amountSdg" DECIMAL(65,30) NOT NULL,
    "amountUsd" DECIMAL(65,30) NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "transactionReference" TEXT,
    "verificationStatus" TEXT NOT NULL DEFAULT 'VERIFIED',
    "receivedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paymentOperationId" TEXT,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentOperation" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "receivedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentOperation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amountSdg" DECIMAL(65,30) NOT NULL,
    "amountUsd" DECIMAL(65,30) NOT NULL,
    "refundMethod" TEXT NOT NULL,
    "transactionReference" TEXT,
    "reason" TEXT,
    "processedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InsuranceCompany" (
    "id" TEXT NOT NULL,
    "labelAr" TEXT NOT NULL,
    "labelEn" TEXT NOT NULL,
    "copayPercentage" DECIMAL(65,30) NOT NULL,
    "billingCycleDays" INTEGER NOT NULL DEFAULT 30,

    CONSTRAINT "InsuranceCompany_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InsuranceClaim" (
    "id" TEXT NOT NULL,
    "insuranceCompanyId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "claimAmountSdg" DECIMAL(65,30) NOT NULL,
    "claimStatus" TEXT NOT NULL DEFAULT 'DRAFT',
    "submissionDate" TIMESTAMP(3),
    "paymentDate" TIMESTAMP(3),

    CONSTRAINT "InsuranceClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationLog" (
    "id" TEXT NOT NULL,
    "recipientPhone" TEXT NOT NULL,
    "messageType" TEXT NOT NULL,
    "messageBody" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'ar',
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttempt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantAuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "ipAddress" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_phoneNormalized_key" ON "User"("phoneNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "Doctor_userId_key" ON "Doctor"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Patient_nationalId_key" ON "Patient"("nationalId");

-- CreateIndex
CREATE UNIQUE INDEX "Patient_userId_key" ON "Patient"("userId");

-- CreateIndex
CREATE INDEX "Patient_phone_idx" ON "Patient"("phone");

-- CreateIndex
CREATE INDEX "Appointment_appointmentDate_appointmentTime_idx" ON "Appointment"("appointmentDate", "appointmentTime");

-- CreateIndex
CREATE INDEX "Appointment_doctorId_appointmentDate_appointmentTime_idx" ON "Appointment"("doctorId", "appointmentDate", "appointmentTime");

-- CreateIndex
CREATE UNIQUE INDEX "EmergencyOverride_appointmentId_key" ON "EmergencyOverride"("appointmentId");

-- CreateIndex
CREATE UNIQUE INDEX "MedicalRecord_appointmentId_key" ON "MedicalRecord"("appointmentId");

-- CreateIndex
CREATE INDEX "InventoryBatch_expiryDate_idx" ON "InventoryBatch"("expiryDate");

-- CreateIndex
CREATE INDEX "VerificationChallenge_userId_type_createdAt_idx" ON "VerificationChallenge"("userId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "PatientClaimCode_patientId_createdAt_idx" ON "PatientClaimCode"("patientId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_insuranceClaimId_key" ON "Invoice"("insuranceClaimId");

-- CreateIndex
CREATE INDEX "Invoice_invoiceDate_idx" ON "Invoice"("invoiceDate");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_transactionReference_key" ON "Payment"("transactionReference");

-- CreateIndex
CREATE INDEX "Payment_paymentOperationId_idx" ON "Payment"("paymentOperationId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentOperation_idempotencyKey_key" ON "PaymentOperation"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PaymentOperation_invoiceId_createdAt_idx" ON "PaymentOperation"("invoiceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_transactionReference_key" ON "Refund"("transactionReference");

-- CreateIndex
CREATE INDEX "Refund_invoiceId_createdAt_idx" ON "Refund"("invoiceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "InsuranceClaim_invoiceId_key" ON "InsuranceClaim"("invoiceId");

-- CreateIndex
CREATE INDEX "Notification_userId_isRead_idx" ON "Notification"("userId", "isRead");

-- AddForeignKey
ALTER TABLE "Doctor" ADD CONSTRAINT "Doctor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_addressStateId_fkey" FOREIGN KEY ("addressStateId") REFERENCES "State"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmergencyOverride" ADD CONSTRAINT "EmergencyOverride_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalRecord" ADD CONSTRAINT "MedicalRecord_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalRecord" ADD CONSTRAINT "MedicalRecord_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalRecord" ADD CONSTRAINT "MedicalRecord_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consent" ADD CONSTRAINT "Consent_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_medicalRecordId_fkey" FOREIGN KEY ("medicalRecordId") REFERENCES "MedicalRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescribedDrug" ADD CONSTRAINT "PrescribedDrug_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "Prescription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescribedDrug" ADD CONSTRAINT "PrescribedDrug_drugId_fkey" FOREIGN KEY ("drugId") REFERENCES "DrugFormulary"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryBatch" ADD CONSTRAINT "InventoryBatch_drugId_fkey" FOREIGN KEY ("drugId") REFERENCES "DrugFormulary"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabOrder" ADD CONSTRAINT "LabOrder_medicalRecordId_fkey" FOREIGN KEY ("medicalRecordId") REFERENCES "MedicalRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabOrder" ADD CONSTRAINT "LabOrder_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabOrder" ADD CONSTRAINT "LabOrder_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationChallenge" ADD CONSTRAINT "VerificationChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientClaimCode" ADD CONSTRAINT "PatientClaimCode_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientClaimCode" ADD CONSTRAINT "PatientClaimCode_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientRegistration" ADD CONSTRAINT "PatientRegistration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabOrderItem" ADD CONSTRAINT "LabOrderItem_labOrderId_fkey" FOREIGN KEY ("labOrderId") REFERENCES "LabOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabOrderItem" ADD CONSTRAINT "LabOrderItem_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "ClinicalService"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_insuranceClaimId_fkey" FOREIGN KEY ("insuranceClaimId") REFERENCES "InsuranceClaim"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_paymentOperationId_fkey" FOREIGN KEY ("paymentOperationId") REFERENCES "PaymentOperation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentOperation" ADD CONSTRAINT "PaymentOperation_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_processedBy_fkey" FOREIGN KEY ("processedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsuranceClaim" ADD CONSTRAINT "InsuranceClaim_insuranceCompanyId_fkey" FOREIGN KEY ("insuranceCompanyId") REFERENCES "InsuranceCompany"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsuranceClaim" ADD CONSTRAINT "InsuranceClaim_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Preserve concurrency and financial/inventory invariants that Prisma schema syntax cannot express.
CREATE UNIQUE INDEX "Appointment_active_doctor_slot_key"
ON "Appointment"("doctorId", "appointmentDate", "appointmentTime")
WHERE "status" NOT IN ('CANCELLED', 'NO_SHOW');

ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_positive_amount" CHECK ("amountSdg" > 0),
  ADD CONSTRAINT "Payment_supported_method" CHECK ("paymentMethod" IN ('CASH', 'CARD', 'BANKAK', 'FAWRY'));

ALTER TABLE "Refund"
  ADD CONSTRAINT "Refund_positive_amount" CHECK ("amountSdg" > 0),
  ADD CONSTRAINT "Refund_supported_method" CHECK ("refundMethod" IN ('CASH', 'CARD', 'BANKAK', 'FAWRY'));

ALTER TABLE "InventoryBatch"
  ADD CONSTRAINT "InventoryBatch_nonnegative_stock" CHECK ("qtyOnHand" >= 0),
  ADD CONSTRAINT "InventoryBatch_nonnegative_reorder_level" CHECK ("minReorderLevel" >= 0);

ALTER TABLE "PrescribedDrug"
  ADD CONSTRAINT "PrescribedDrug_positive_quantity" CHECK ("qtyPrescribed" > 0),
  ADD CONSTRAINT "PrescribedDrug_dispensed_range" CHECK ("qtyDispensed" >= 0 AND "qtyDispensed" <= "qtyPrescribed");
