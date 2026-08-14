-- Refunds are append-only reversals. Historical Payment rows remain immutable.
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "invoiceId" TEXT NOT NULL,
    "amountSdg" DECIMAL NOT NULL,
    "amountUsd" DECIMAL NOT NULL,
    "refundMethod" TEXT NOT NULL,
    "transactionReference" TEXT,
    "reason" TEXT,
    "processedBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Refund_positive_amount" CHECK ("amountSdg" > 0),
    CONSTRAINT "Refund_supported_method" CHECK ("refundMethod" IN ('CASH', 'CARD', 'BANKAK', 'FAWRY')),
    CONSTRAINT "Refund_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Refund_processedBy_fkey" FOREIGN KEY ("processedBy") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Refund_transactionReference_key" ON "Refund"("transactionReference");
CREATE INDEX "Refund_invoiceId_createdAt_idx" ON "Refund"("invoiceId", "createdAt");
