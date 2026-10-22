# Doctor and catalog configuration — Neon approval packet

Superseded for current release approval by the [Neon-only production packet](../neon-production-release/approval-packet.md). The user has chosen Neon as authoritative and canceled Render migration. The new packet includes fresh schema/migration verification and the exact five-specialty bootstrap in addition to the two prepared migrations. The content below records the earlier proposal.

**Status: PREPARED LOCALLY ONLY. No Neon connection or database write was made in this implementation phase. No general seed, database reset/truncate/drop, commit or push was performed. Existing reference tests clean up only their own isolated local schemas.**

Read the preceding readiness audit for deployment limits. This packet is not permission to deploy: explicit approval of the intended target and migration set is still required. The earlier audit could not establish a read-only Neon connection, so deployed migration history, privileges and row counts remain unverified.

## Proposed migrations and exact SQL

This phase adds `20261022110000_admin_catalog_configuration`. It adds an optional unique service code, a payment-method configuration table, four existing manual-method definitions, and restrictive foreign keys from historical payments/refunds. Existing monetary types are unchanged.

```sql
-- Additive configuration only. Historical application rows are not rewritten.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
ALTER TABLE "ClinicalService" ADD COLUMN "code" TEXT;
CREATE UNIQUE INDEX "ClinicalService_code_key" ON "ClinicalService"("code");
CREATE TABLE "PaymentMethod" (
  "code" TEXT NOT NULL PRIMARY KEY,
  "labelAr" TEXT NOT NULL,
  "labelEn" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentMethod_supported_code" CHECK ("code" IN ('CASH', 'CARD', 'BANKAK', 'FAWRY'))
);
-- Existing runtime/SQL payment codes only; these are not financial transactions.
INSERT INTO "PaymentMethod" ("code", "labelAr", "labelEn") VALUES
 ('CASH', 'نقداً', 'Cash'),
 ('CARD', 'بطاقة / جهاز نقاط البيع', 'Card / POS'),
 ('BANKAK', 'بنكك — دفع يدوي', 'Bankak — manual mobile money'),
 ('FAWRY', 'فوري — دفع يدوي', 'Fawry — manual mobile money');
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_paymentMethod_fkey" FOREIGN KEY ("paymentMethod") REFERENCES "PaymentMethod"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_refundMethod_fkey" FOREIGN KEY ("refundMethod") REFERENCES "PaymentMethod"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
COMMIT;
```

The earlier, still-unapproved index migration may also be pending. Its exact SQL is included below for review; it is not silently authorized as part of this phase:

```sql
-- Additive query indexes only. No rows, IDs, constraints, or monetary types change.
-- Run only after target/drift review and explicit production approval.
-- Use a maintenance window: ordinary CREATE INDEX briefly blocks table writes.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
CREATE INDEX "Appointment_patientId_appointmentDate_appointmentTime_idx" ON "Appointment"("patientId", "appointmentDate", "appointmentTime");
CREATE INDEX "MedicalRecord_patientId_visitDate_idx" ON "MedicalRecord"("patientId", "visitDate");
CREATE INDEX "Prescription_patientId_prescriptionDate_idx" ON "Prescription"("patientId", "prescriptionDate");
CREATE INDEX "LabOrder_patientId_releasedToPatientAt_orderDate_idx" ON "LabOrder"("patientId", "releasedToPatientAt", "orderDate");
CREATE INDEX "Invoice_patientId_invoiceDate_idx" ON "Invoice"("patientId", "invoiceDate");
CREATE INDEX "Payment_invoiceId_createdAt_idx" ON "Payment"("invoiceId", "createdAt");
COMMIT;
```

Do not run an unrestricted `prisma migrate deploy` against Neon without comparing the entire deployed migration history. Any additional pending historical migrations require their own review; some perform backfills.

## Exact tables and row impact

| Table | Schema effect | Existing values / inserts |
|---|---|---|
| ClinicalService | Add nullable `code`; unique index permits multiple legacy NULL codes | Existing IDs, labels, categories, status and prices unchanged. New field is NULL on legacy rows; no invented codes/backfill. |
| PaymentMethod | New table, supported-code check, PK and timestamps | Exactly four legitimate reference rows: CASH, CARD, BANKAK, FAWRY, with the bilingual labels above, initially active. No payment transaction is created. |
| Payment | Add restrictive method FK | No existing row update, ID change, money rewrite or deletion. Existing codes must resolve to the four reference rows. |
| Refund | Add restrictive method FK | Same preservation guarantees as Payment. |
| _prisma_migrations | Prisma deployment bookkeeping | A migration-history row is written only if deployment is explicitly approved. |
| Appointment, MedicalRecord, Prescription, LabOrder, Invoice, Payment | Earlier packet adds six query indexes if that migration is also approved/pending | No application row values change. |

No migration inserts doctors, users, patients, services, lab tests, prices, stock, invoices, payments, prescriptions, clinical records, or results. Doctor/account status synchronization and catalog changes happen only through subsequent authorized application actions, with audit events; no existing doctor is automatically activated/deactivated or rescheduled by migration.

## Preconditions

The older Render database may contain real clinic catalogs and operational history. Complete the [Render migration preflight](render-migration-preflight.md) before deciding how Neon should be populated. This packet authorizes neither an import nor replacement clinic data; source/destination reconciliation and any transfer require their own approval packet.

1. Restore a successful **read-only** audit against the intended Neon target; privately verify pooler/direct endpoints, database/schema identity, migration names/checksums and no failed/partial migrations. Do not print connection strings.
2. Verify supported historical payment/refund codes and absence of unexpected constraints/schema drift. Abort if existing codes are unsupported or existing object names conflict. Do not repair or rewrite financial rows automatically.
3. Review table sizes/locks and choose a maintenance window. The migration uses 5-second lock and 60-second statement timeouts and one transaction. FK validation and index creation can briefly block writes. Larger tables require a separately approved rollout strategy.
4. Capture a verified backup/recovery point and an application rollback artifact. Do not rely on local test replay as evidence of production recoverability.
5. Approve the exact migration set. Apply schema before deploying the new API build: payment endpoints require PaymentMethod, and catalog APIs require ClinicalService.code. Mixed old/new backend versions would not consistently enforce disabled methods or doctor eligibility; avoid a mixed-version rollout.
6. Retest authenticated admin configuration, patient discovery/slots, payments and pharmacist payment state after deployment using approved operational data. Do not create test patients or transactions in Neon.

## Rollback / unexpected errors

Stop on any conflict or error. There is no automatic destructive recovery. Inspect transaction/migration state read-only; do not reset, edit migration checksums or delete migration history.

Keep additive columns, table and indexes in place on application rollback; they preserve historical references and do not require reverting patient/financial rows. Never drop PaymentMethod after financial rows reference it. Roll back to a build retaining doctor-account eligibility and disabled-method safety checks, or suspend affected booking/payment operations during rollback: an older backend would ignore method deactivation settings.

Later configuration corrections use authorized audited APIs and reviewed prior values. They do not rewrite historical invoices, payments, refunds, appointments or results. Any index removal or schema rollback needs a separate approval packet.

## Expected behavior after approved deployment

- Admin → Doctors & catalogs configures doctor profiles, specialties, services, lab tests, and payment methods. Existing staff account and schedule panels remain supported.
- New doctors have **no default working hours**. Patient slot/booking requests require an explicit schedule plus active doctor/account/specialty eligibility. Existing legacy schedules remain unchanged.
- Doctor status and staff account status changes synchronize transactionally; account status changes increment authVersion and revoke stale sessions. Existing appointments/medical records remain.
- New service/test entries require unique codes, bilingual names, supported categories and official positive whole-SDG prices. Creation defaults inactive. Categories stay fixed after creation; archive/status replaces hard deletion. Existing unpriced/uncoded entries retain their IDs and can be configured by an administrator.
- Catalog writes use Decimal prices and conversions; whole-SDG billing remains the existing business contract. Conversion uses the existing 1500 rate, Decimal precision 65 and database scale 30. No new exchange-rate policy or gateway is introduced.
- Inactive services are unavailable for new selection and new invoices. Billing rechecks locked catalog prices/status before writing an invoice. Historical invoice lines keep their original descriptions/quantities/prices.
- Cash, manual Card/POS, Bankak and Fawry are configurable. Inactive methods are rejected for new payments, remain available historically, and do not invalidate an already-recorded idempotent payment replay. Refunds may still reference historical inactive methods. No PAN, CVV, PIN or payment-secret fields exist.
- Insurance remains the existing company/claim/patient-share workflow; it is not represented as a fictitious paid insurance transaction.

## Local test evidence

See `test-results.json` in this directory and the implementation report: **349 backend tests passed (16 files), 299 frontend tests passed, 572 browser checks passed (167 captures)**. Prisma validation, migration replay, populated-row preservation, build, syntax and diff checks passed. All database writes in tests were confined to fresh localhost:5433/clinic_test schemas using guarded fixtures. No general seed was executed. One pre-existing seed-execution test is deliberately excluded; seed guard tests remain included.

**Approval required:** approve only after the preconditions above are satisfied, identifying the intended target, whether the earlier index migration is included, and the exact SQL/reference inserts in this packet. No Neon write has been attempted or scheduled.
