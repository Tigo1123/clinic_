# Neon production release — approval required

Prepared 2026-10-22. **No Neon write, migration, bootstrap, seed, commit or push has been executed.** Neon is now the authoritative production database by user instruction. Render migration/assessment is canceled and is not a release prerequisite. Earlier Render planning documents are historical.

## Verified target and current state

- Database/schema: **neondb/public**, PostgreSQL 18.6 (fd34222). Latest inventory: `2026-10-22T08:48:41.912Z` UTC; direct endpoint confirmation: `2026-10-22T08:52:47.460Z` UTC.
- Pooler fingerprint: `082a234b31a142af`. Equivalent verified direct migration endpoint fingerprint: `c9f8bb593c61b80e`. Hostnames/passwords/connection URLs are excluded from this packet.
- Both endpoints connect with verified TLS and enforced read-only transactions. Direct endpoint migration history matches the pooler. All 24 applied migration checksums match repository history; no failed, unknown or checksum-mismatched migration exists. Exactly the two migrations below are pending.
- Public application schema matches a fresh local reconstruction of those 24 applied migrations: 40 tables, 367 columns, 401 constraints, 95 indexes, 7 enum labels, 5 triggers, 5 function definitions, one sequence definition, RLS flags and zero policies. Ownership/grants/provider extensions/database settings are outside the schema-equivalence claim; separately verified CREATE/USAGE and inherited table ownership are sufficient for the proposed DDL. UUID generation is available.
- Existing records: 18 canonical states, 1 patient, 1 PATIENT user, 1 external identity, 1 registration, 1 verification challenge, 1 pending external-auth record, 1 notification log and 5 audit entries. Doctor, Specialty, ClinicalService, DrugFormulary, InventoryBatch, StockMovement, Appointment, MedicalRecord, Prescription, LabOrder, Invoice, Payment and Refund are empty at this snapshot. PaymentMethod does not exist yet.
- The 18 existing states match the repository's IDs and both labels exactly. **No state insert/update is proposed.** Newer patient/account/auth/audit rows are retained.

Evidence: [preflight](preflight.json), [drift comparison](drift-verification.json), [direct endpoint](direct-connection-preflight.json), [privileges](privilege-preflight.json).

## Exact approved scope proposed

1. Six nonunique query indexes.
2. Nullable unique ClinicalService.code, PaymentMethod, four existing supported method definitions, and restrictive Payment/Refund method foreign keys.
3. Insert only the five specialty vocabulary definitions below if missing, using the reviewed guarded SQL. Existing matching specialties keep their UUID, status and timestamps. Label/code conflicts abort the transaction; no automatic repair.

No doctor/staff/account/patient/appointment/medicine/stock/service/price/prescription/invoice/payment/refund/lab-result/medical-record row will be inserted, updated or deleted. No password/hash/auth-version/external identity or existing timestamp changes are proposed. No existing operational row is rewritten. Prisma adds its migration-history entries for the two reviewed migrations. The specialty SQL does not add synthetic users or operational audit events.

Doctor/specialty/schedule foundations are already in the applied 24-migration history. Their completed lifecycle code needs no additional schema migration. New doctor hours remain empty until explicitly configured; historical appointments/hours stay intact.

## Exact migration SQL

These are verbatim migration files. [Combined review copy](reviewed-migrations.sql) is for review; deployment must preserve Prisma migration bookkeeping using the frozen bundle.

### 20261022100000_patient_workflow_query_indexes

SHA-256: `e22824191a81a9ea356c05fd33bb04b78426beace5bd0e2c7159eedf04319824`.

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

### 20261022110000_admin_catalog_configuration

SHA-256: `2dfc7ce5a2558916afdc7ef4bbe00b78a5c0ce7bf431f3a4728e34a65d721188`.

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

## Exact reference rows

Payment rows are part of the second migration, initially active:

| Code | Arabic label | English label | active |
|---|---|---|---|
| CASH | نقداً | Cash | true |
| CARD | بطاقة / جهاز نقاط البيع | Card / POS | true |
| BANKAK | بنكك — دفع يدوي | Bankak — manual mobile money | true |
| FAWRY | فوري — دفع يدوي | Fawry — manual mobile money | true |

PaymentMethod.code is the primary key. createdAt/updatedAt use the migration transaction timestamp. Codes represent manual records; no gateway or card-secret fields are created. Insurance remains the existing claim/patient-share workflow.

Specialty lookup rows, separately initialized after migration:

| Code | Arabic name | English name | active for new row |
|---|---|---|---|
| surgery | الجراحة | Surgery | true |
| dentistry | طب الأسنان | Dentistry | true |
| orthopedics | جراحة العظام | Orthopedics | true |
| internal-medicine | الباطنية | Internal Medicine | true |
| neurology | طب الأعصاب | Neurology | true |

For each missing specialty, PostgreSQL generates a UUID; deletionProtected=false; createdAt/updatedAt use the bootstrap transaction timestamp. Existing identical codes are skipped without changing their IDs or active status. This vocabulary does not assert that a doctor or clinic service exists for every specialty. No service/lab/medicine category table or dosage-form/unit lookup exists in the repository: their supported category codes remain code validation/free text, and **no invented rows or new lookup tables are proposed**. Actual doctors, medicines, services/prices and stock must be entered through authorized UI workflows.

Specialty SQL SHA-256: `7b914f5d4cb174d16e7c108609c18cb2afd6e7af0a04b03f3f22d614561ebbda`. Exact SQL:

```sql
-- Reviewed lookup vocabulary only. No doctors, services, medicines or prices.
-- Execute only after approval against the verified Neon public schema.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
LOCK TABLE public."Specialty" IN SHARE ROW EXCLUSIVE MODE;
DO $bootstrap$
DECLARE
  expected jsonb := '[
    {"code":"surgery","nameAr":"الجراحة","nameEn":"Surgery"},
    {"code":"dentistry","nameAr":"طب الأسنان","nameEn":"Dentistry"},
    {"code":"orthopedics","nameAr":"جراحة العظام","nameEn":"Orthopedics"},
    {"code":"internal-medicine","nameAr":"الباطنية","nameEn":"Internal Medicine"},
    {"code":"neurology","nameAr":"طب الأعصاب","nameEn":"Neurology"}
  ]'::jsonb;
  item record;
BEGIN
  -- Inspect the complete vocabulary before inserting anything. Preserve every
  -- existing ID, label, active flag and timestamp; abort on conflicting labels.
  FOR item IN SELECT * FROM jsonb_to_recordset(expected)
    AS x(code text, "nameAr" text, "nameEn" text)
  LOOP
    IF EXISTS (SELECT 1 FROM public."Specialty" s WHERE s.code=item.code
      AND (s."nameAr"<>item."nameAr" OR s."nameEn"<>item."nameEn")) THEN
      RAISE EXCEPTION 'Specialty code/label conflict; no references inserted';
    END IF;
    IF EXISTS (SELECT 1 FROM public."Specialty" s WHERE s.code<>item.code AND (
      lower(regexp_replace(btrim(normalize(s."nameAr", NFKC)), '\s+', ' ', 'g')) =
        lower(regexp_replace(btrim(normalize(item."nameAr", NFKC)), '\s+', ' ', 'g')) OR
      lower(regexp_replace(btrim(normalize(s."nameEn", NFKC)), '\s+', ' ', 'g')) =
        lower(regexp_replace(btrim(normalize(item."nameEn", NFKC)), '\s+', ' ', 'g'))
    )) THEN
      RAISE EXCEPTION 'Specialty normalized-name conflict; no references inserted';
    END IF;
  END LOOP;
  INSERT INTO public."Specialty" (id,code,"nameAr","nameEn",active,"deletionProtected","createdAt","updatedAt")
  SELECT gen_random_uuid()::text,x.code,x."nameAr",x."nameEn",true,false,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
  FROM jsonb_to_recordset(expected) AS x(code text,"nameAr" text,"nameEn" text)
  WHERE NOT EXISTS (SELECT 1 FROM public."Specialty" s WHERE s.code=x.code);
END
$bootstrap$;
COMMIT;
```

## Local verification completed

- Read-only Neon custom-format export succeeded and was restored into two fresh databases in a separate loopback-only PostgreSQL 18 container. Protected dump and credential files remain outside the repository in a mode-0700 temporary directory, with mode-0600 credential/dump files.
- Applying the two pending migrations to the local upgrade clone succeeded. Exact rows in all **40 existing application tables** remained unchanged, including states, patient/account/password hash/authVersion, registration, external identity, verification and audit history. All **53 FKs** validated with zero orphans; all **69 unique indexes** validated with zero duplicate groups. Decimal/timestamp column definitions were unchanged. The MRN sequence remained 1 with is_called=true and existing largest suffix 1. There were no financial rows to compare in this production snapshot; the separate populated synthetic migration regression covers those rows.
- Applying the specialty SQL to that local upgraded clone inserted exactly five specialties. **All other 41 tables**, including payment methods and migration history, retained exact row snapshots. States remain 18; methods remain four.
- Four isolated local specialty regressions passed: exact five definitions/UUIDs, idempotency preserving archived status/timestamps, atomic code-label conflict refusal, normalized-name conflict refusal. Four assessment safety tests passed. Neither suite runs the general seed.
- Earlier implementation verification remains: 349 backend tests and 299 frontend tests passed, plus populated migration preservation and fixture-based UI checks. This phase repeated Prisma validation, frontend production build, new-script syntax checks and diff checks. The existing build chunk advisory remains.

Evidence: [local migration preservation](../render-neon-assessment/local-neon-rehearsal.json), [local reference preservation](local-reference-rehearsal.json), [frozen release manifest](release-manifest.json). The older directory name on the migration evidence is historical; the data used for this proof was a Neon export only.

## Procedure after explicit approval — not executed

The frozen filesystem-only bundle is `/tmp/shifa-neon-release-62cAcC`. It contains the unchanged schema, all 26 historical SQL files/checksums and the exact specialty SQL. Its 24 historical migrations are already applied; the only permitted pending set is the two listed above. Do not run from a moving checkout, add a third migration, or run the general seed.

1. Recheck target/direct fingerprint, schema/migration history, exact pending set, all release SHA-256 values and reference conflicts immediately before execution. Stop if anything changed; do not broaden approval automatically.
2. Capture a fresh protected read-only pg_dump/recovery point and retain the verified rollback artifact. Coordinate a brief maintenance window for table/index/FK locks. Keep a known-good backend artifact available.
3. Supply the verified **direct** Neon connection as both DATABASE_URL and DIRECT_URL through private environment settings. Confirm it points to neondb/public. Apply the frozen migration set from backend/:

```sh
node node_modules/prisma/build/index.js migrate deploy --schema /tmp/shifa-neon-release-62cAcC/schema.prisma
```

This command is permitted only after step 1 confirms precisely the two reviewed pending migrations; do not point it at an unreviewed migration directory. Prisma must record each migration once. The files each have their own bounded transaction, so the first migration can remain successfully committed if the second fails.

4. Supply the same verified direct connection privately through PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD and PGSSLMODE=verify-full, PGSSLROOTCERT=system. Do not leave a connection-level read-only override enabled for this explicitly approved write. Execute only:

```sh
psql -X -w -v ON_ERROR_STOP=1 --file /tmp/shifa-neon-release-62cAcC/production-specialties.sql
```

There is no general seed or service bootstrap. Payment methods already come from the reviewed migration. States need no initialization. Do not run the existing clinical-service bootstrap with an invented manifest.

5. Return to enforced read-only sessions. Verify 26 completed migration records and matching checksums; six new valid indexes, nullable code/index, PaymentMethod definitions/check/FKs; five specialty definitions; four payment methods; canonical states still 18. Compare complete existing-row preservation against the immediate pre-write snapshot, including auth identities/versions/password hashes, timestamps, patient MRN sequence and audit links. Validate all FKs/unique indexes. Stop on any discrepancy.
6. Deploy the compatible application build only through its normal reviewed release process after schema readiness. Verify non-mutating routes and existing data visibility read-only. Do not manufacture accounts or clinical/financial transactions for production smoke tests.

## Admin workflow readiness and remaining access prerequisite

Local regressions verify ADMIN doctor/staff creation and profile/schedule management, specialty/catalog configuration and service/lab pricing. No Neon ADMIN currently exists. A **real named first administrator** must be separately approved/provisioned before those production screens can be used; this packet does not create or promote a user. The guarded provisioner now has an explicit Neon production mode and a non-writing `--preflight`; review [the Neon first-administrator procedure](first-admin-provisioning.md), confirm the exact endpoint and named user, and obtain separate approval before `--execute`. Do not invent administrator credentials.

Medicine metadata and stock receipt remain **PHARMACIST-only** through the established pharmacy management UI; ADMIN has medicine read/pricing/activation access. Preserve that authorization boundary. After the real administrator creates real staff, an authorized pharmacist enters actual medicines/stock. Direct ADMIN medicine creation would require a separate permission/UI change and regression review. No production doctor/medicine/service has been created to claim live acceptance.

## Rollback / stop conditions

- All SQL is additive. No DROP, TRUNCATE, RESET, destructive type change, existing-row UPDATE or existing-row DELETE is proposed. Ordinary CREATE INDEX/FK validation takes locks; 5-second lock timeouts and 60-second migration statement timeouts bound the attempt. The reference bootstrap has 5-second/30-second bounds and serializes Specialty writes.
- Before commit, failure aborts that transaction. Stop and inspect migration state read-only. Never auto-reset, edit old checksums, mark failed migrations resolved or rerun a broader deploy. If the first migration succeeded, leave its harmless indexes in place while investigating.
- After successful deployment, keep additive columns/table/indexes on application rollback. Do not drop PaymentMethod after history can reference it. Use a build retaining doctor eligibility and disabled-method enforcement, or suspend booking/payment mutations while rolling back to an older build.
- The reference transaction is atomic and idempotent. On conflict it changes nothing. Do not automatically delete newly inserted specialties/methods: clinic data may reference them after release. Disable/archive through reviewed APIs if appropriate.
- A disaster recovery restore would overwrite newer writes; it needs a separate explicit recovery approval and reconciliation plan. Preserve the fresh backup and post-release audit evidence. No automatic restore or data deletion is part of this packet.

## Approval requested

Approve **only** the two named migrations and the five-specialty bootstrap on the verified Neon neondb/public target: **four payment-method rows plus five specialty rows**, and Prisma migration bookkeeping. No other reference/operational insertion, data repair, administrator provisioning, Render import, commit or push is included.
