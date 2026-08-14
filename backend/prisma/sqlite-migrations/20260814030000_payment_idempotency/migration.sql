ALTER TABLE "Invoice" ADD COLUMN "ledgerVersion" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "PaymentOperation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "invoiceId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "receivedBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PaymentOperation_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

ALTER TABLE "Payment" ADD COLUMN "paymentOperationId" TEXT REFERENCES "PaymentOperation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "PaymentOperation_idempotencyKey_key" ON "PaymentOperation"("idempotencyKey");
CREATE INDEX "PaymentOperation_invoiceId_createdAt_idx" ON "PaymentOperation"("invoiceId", "createdAt");
CREATE INDEX "Payment_paymentOperationId_idx" ON "Payment"("paymentOperationId");
