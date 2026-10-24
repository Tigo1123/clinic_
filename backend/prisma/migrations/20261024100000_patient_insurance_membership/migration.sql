ALTER TABLE "InsuranceCompany" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "coveredCategories" TEXT[] NOT NULL DEFAULT ARRAY['CONSULTATION','LABORATORY','RADIOLOGY','CLINICAL_PROCEDURE']::TEXT[];
CREATE TABLE "PatientInsurance" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "patientId" TEXT NOT NULL REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "insuranceCompanyId" TEXT NOT NULL REFERENCES "InsuranceCompany"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "memberNumber" TEXT NOT NULL,
 "plan" TEXT,
 "validFrom" TEXT NOT NULL,
 "validUntil" TEXT NOT NULL,
 "active" BOOLEAN NOT NULL DEFAULT true,
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "PatientInsurance_dates_check" CHECK ("validFrom" <= "validUntil")
);
CREATE UNIQUE INDEX "PatientInsurance_patientId_insuranceCompanyId_key" ON "PatientInsurance"("patientId", "insuranceCompanyId");
CREATE TABLE "InvoiceIssueOperation" (
 "key" TEXT NOT NULL PRIMARY KEY,
 "requestHash" TEXT NOT NULL,
 "invoiceId" TEXT NOT NULL REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "InvoiceIssueOperation_invoiceId_idx" ON "InvoiceIssueOperation"("invoiceId");
