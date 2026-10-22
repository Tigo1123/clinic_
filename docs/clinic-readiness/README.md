# Clinic production-readiness audit — first run

Current release decision (2026-10-22): Neon is authoritative; Render migration is canceled by the user. See the [Neon-only production approval packet](neon-production-release/approval-packet.md) for fresh connectivity/drift evidence, exact SQL/reference rows, local rehearsal and rollback. This first-run audit below remains historical; its earlier connection failure is superseded by the successful new preflight. No Neon write has been approved or executed.

Audit date: 2026-10-22. **No Neon write, migration, general seed, live account creation, clinical transaction, or financial transaction was performed.** Existing working-tree changes were preserved. No applicable `AGENTS.md` was found in the repository or ancestor paths. Nothing was committed or pushed.

This phase audits the existing implementation and prepares a small safe foundation. It does not claim the entire clinic product is production-ready. Empty catalogs are not evidence that workflows are absent, and frontend pages are not evidence that their backend operations exist.

## Evidence and limits

Inspected the complete 40-model Prisma schema, the 24 existing SQL migrations, route registrations and authorization policies, backend domain write paths/services, reference/bootstrap scripts, and admin, scheduling, reception/billing, doctor, pharmacy, lab and patient frontend consumers. See [all models/relations and migration inventory](model-inventory.md) and [machine-readable schema inventory](repository-inventory.json).

The explicit read-only metadata/count audit against the configured backend database timed out during connection (`ETIMEDOUT`). No recovery or write was attempted. The configured target is confirmed to be a Neon pooler without disclosing its address or credentials; a server connection was not established. Live Neon row counts, migration application/checksums, indexes, constraints, and privileges therefore remain **UNVERIFIED**. See [connection outcome](database-read-only.json). The previously repaired states and working connectivity/registration are supplied user context, not fresh live verification in this audit. Local migration replay and integration results must not be substituted for live deployment evidence.

Classifications below concern repository capabilities: **COMPLETE** means the stated bounded capability is implemented and covered, **PARTIAL** means an important workflow/management gap remains, **MISSING** means no supporting model/API/workflow was found, and **PRESENT BUT UNUSED** identifies stored fields with no operational lifecycle consumer. None is a blanket production certification.

## Domain assessment

| Area | Status | What exists; gap |
|---|---|---|
| Facility/branches/tenant isolation | MISSING | Environment-based clinic branding only. No Facility, Branch or Tenant model or facility FK. `TenantAuditLog` is a name, not tenant isolation. Product is currently one clinic per deployment. |
| Departments and rooms | MISSING | No models, relationships, occupancy checks or management APIs. |
| Specialties | COMPLETE | Stable unique code, bilingual names, active status, doctor FK, admin CRUD, audit, historical deletion protection. Existing doctors may retain legacy text specialties. Catalog contents remain clinic configuration. |
| Doctor master/profile | PARTIAL | User-linked Doctor, bilingual name, specialty, fee, active flag; admin account creation and profile-update API. No qualifications, professional registration, department, room, contacts or dedicated profile-edit UI. |
| Doctor availability | PARTIAL | Normalized effective schedules, periods, breaks, full-day/special-hours exceptions, slot generation and conflict checks. UI handles recurring hours and full-day leave but not every API feature. New doctor creation still silently assigns a legacy seven-day 09:00–15:00 schedule; fix before real onboarding. |
| Staff/accounts/roles | PARTIAL | ADMIN, RECEPTIONIST, DOCTOR, PHARMACIST, LAB_TECH, PATIENT; secure creation, password lifecycle, MFA, revocation and status controls. No distinct CASHIER role or granular organization permissions. Admin tables are largely unpaginated. |
| Patient accounts/files | COMPLETE | Registration/verification, optional account/file link, immutable database MRN, structured bilingual names, contacts, state address, emergency contact, profile and authorized history. Scope is existing single-clinic workflows. |
| Patient insurance enrollment | PARTIAL | Insurance attachment, company and claim support. No policy/membership enrollment, coverage validity, benefit limits or claim settlement workflow. |
| Appointment types | MISSING | No appointment-type model or per-type duration/service mapping. Duration belongs to schedule periods. |
| Booking/rescheduling/cancellation | COMPLETE | Authenticated patient flow, public verified booking, queue/status transitions, staff walk-in, cancellation/rescheduling, doctor-schedule locks and SQL partial unique active-slot protection. |
| Consultation services | PARTIAL | Doctor consultation fee is authoritative; ClinicalService has four category strings. Admin can change existing prices/status, but cannot independently create/edit a general catalog service. |
| Procedures/radiology | PARTIAL | ClinicalService categories and general invoice items exist. No procedure execution/room assignment or radiology reporting workflow. |
| Service categories/pricing | PARTIAL | Hardcoded CONSULTATION, LABORATORY, RADIOLOGY, CLINICAL_PROCEDURE. No category CRUD, service code/unique identity, price history/effective dates or currency policy. |
| Medicine master | PARTIAL | Brand/generic, bilingual labels, strength, free-text dosage form, canonical unique identity, selling price/status. Pharmacist creation/label correction, admin pricing. No units, category, manufacturer, registration code, pack conversion or supplier relationship. |
| Inventory/batches | PARTIAL | Unique normalized batch+expiry per drug, integer on-hand/reorder threshold, real-date validation, receipt and FEFO dispensing. No purchase cost, purchase documents, supplier receipts, stocktake, wastage/expiry write-off, returns or transfers. |
| Stock audit/no negative stock | COMPLETE | Atomic quantity/version comparisons, database nonnegative checks, immutable StockMovement ledger and audit rollback coverage for existing OPENING_BALANCE, RECEIPT and DISPENSE operations. This does not implement the missing movement types. |
| Suppliers/manufacturers/purchasing | MISSING | No models, APIs or management pages. Brand name is not manufacturer data. |
| Prescriptions/dispensing | COMPLETE | Authorized doctor prescriptions, formulary and custom-drug review/external resolution, pharmacist queue, payment gate, partial dispensing, FEFO and immutable stock ledger. Production use still needs real medicine/pricing/stock configuration. |
| Laboratory catalog | PARTIAL | Laboratory ClinicalService entries, prices, custom-test review and inactive/unpriced service creation through an actual lab request. No independent admin test CRUD, lab subcategories, analyte/specimen/unit/default reference-range catalog. |
| Lab orders/results | COMPLETE | Doctor orders, payment gate, sample collection, result version control, range bounds/abnormal flag, attachments, completion, explicit patient release and authorized doctor/patient views. Reference limits are order-item data, not reusable test definitions. |
| Invoices/items | PARTIAL | Consultation/lab/pharmacy/general source-linked invoices, frozen descriptions/quantity/prices, outstanding balance and status, insurance split. No invoice public number, item source FK/tax/discount/credit-note model or full invoice-history/refund UI. |
| Internal payments | COMPLETE | Cash, manual card/POS reference, BANKAK and FAWRY manual references; validated amounts, split payments, idempotency operations, actor/session revalidation, invoice locking and status updates. No gateway or card-secret storage found. |
| Payment-method configuration | PARTIAL | Four codes duplicated in runtime, UI and SQL checks. No PaymentMethod table, CRUD, enable/disable policy or centralized localized reference endpoint. Insurance is a claim/liability split, not a supported Payment.paymentMethod value. |
| Refunds/voids | PARTIAL | Refund API, amount/state checks and audit; special lab reversal rules, pharmacy restrictions, internal VOIDED status. No general cancellation/credit-note lifecycle UI or refund idempotency operation equivalent to payment operations. |
| Clinical encounter/notes/vitals | PARTIAL | MedicalRecord is the encounter, one per appointment. Encrypted symptoms/diagnosis/treatment/notes, JSON vitals, lab-wait/finalize flow and completed-visit read-only rules. No structured diagnosis terminology, typed vitals/history or signed amendment/version model. |
| Auditability | PARTIAL | Transaction-coupled TenantAuditLog, immutable stock ledger, invoice snapshots and refunds. Generic actor IDs/details and mutable clinical records do not provide a complete medical/financial amendment ledger; retention/access/immutability need a dedicated design. |
| States | COMPLETE | Exact repository IDs 1–18 and bilingual labels, matching frontend/backend reference contract; guarded idempotent state bootstrap. Live contents were not re-verified here. |
| Other lookups | MISSING | No medicine categories, dosage-form/unit catalogs, lab subcategories or appointment types. Do not create lookup tables with no intended consumer. |
| Legacy MFA field | PRESENT BUT UNUSED | User.mfaSecret is retained historical storage; active MFA uses encrypted MfaConfiguration, hashed recovery codes and challenges. Do not backfill/repurpose the legacy field blindly. |
| Insurance lifecycle fields | PRESENT BUT UNUSED | billingCycleDays, submissionDate/paymentDate and lifecycle statuses exist, but no submit/adjudicate/settle management workflow was found. Claims are created DRAFT and exposed read-only. |
| Notifications | PARTIAL | User-scoped notifications/read actions and delivery logs exist; no complete durable delivery/retry operator workflow. Never synthesize clinical activity to populate feeds. |

## Admin CRUD coverage verified against APIs and consumers

| Capability | API / frontend evidence | Coverage and next action |
|---|---|---|
| Staff and doctor creation | POST `/api/auth/users`; AdminDashboard Users | Create accounts and Doctor atomically; require specialty/fee; must-change-password. Remove implicit doctor working hours and fee/name assumptions in next slice. |
| Doctor edit/activate/archive | GET/PATCH `/api/admin/doctors/:id`; adminDoctors.js | Backend exists; no dedicated admin profile editor consumer found. User status and Doctor status are separate; disabling an account does not automatically hide its active Doctor in directory queries. Define and test coordinated lifecycle. |
| Schedules | `/api/admin/doctors/:doctorId/schedules`, exceptions, preview; AdminSchedulePanel | Existing editor works, with race guards and bounded changes; full special-hours/version/status features need UI completion. Some schedule text favors English in Arabic mode. |
| Specialties | `/api/specialties`; SpecialtyRow/DeleteButton | Create/update/deactivate; delete only never-used unprotected references, otherwise archive. Add pagination/search, stronger labels and mutation loading/error handling. |
| Services/lab test catalog | `/api/admin/pricing/services/:id`; AdminDashboard Pricing | Edit existing official price/status only. General service creation/metadata CRUD is missing; lab custom-request creation is not an admin catalog manager. |
| Medicines/prices | `/api/pharmacy/formulary`; PharmacyManagement; admin pricing | Pharmacist owns medicine metadata/receipts, ADMIN owns prices/activation. ADMIN has read access but no pharmacy write authority; preserve this separation unless explicitly redesigned. |
| Inventory | Formulary batch/movement routes; PharmacyManagement | Search/filter/pagination, batch receipt and immutable history exist. Missing stock adjustment/reorder editing of existing batches and procurement workflows. |
| Suppliers/manufacturers | None | Missing. Build catalogs and receipt workflow together. |
| Payment methods | Hardcoded in billing/pharmacy/reception and SQL checks | No CRUD. Centralize and retain existing codes before introducing safe optional enable/disable configuration. |
| Insurance companies/claims | GET `/api/billing/insurance-companies`; reception preview | Selection/read plus DRAFT claim creation, no admin company CRUD or claim progression/settlement. |
| Billing/refunds | Reception billing/reconciliation; backend refund API | Invoice/payment workflows exist; admin/cashier invoice-history/refund UI is incomplete. No standalone cashier role. |
| Clinic organization | ClinicProfilePanel reads public config | Branding display is not facility/department/room CRUD. |

Most staff pages still use the established custom shared design system, not MUI. The patient dashboard now has a MUI adapter using the same tokens. Future management pages should reuse/extract that adapter and shared controls, preserving staff role checks, light/dark, Arabic/English, RTL/LTR, accessible labels, dialogs, errors, search and pagination. No new management UI was built speculatively in this first audit.

## End-to-end workflow coverage

These paths are present in code and exercised by focused integration cases; this is not a claim of one single uninterrupted production journey.

| Step | Status | Evidence / limitation |
|---|---|---|
| 1 Admin creates doctor | COMPLETE | auth users transaction creates User + Doctor. Existing default schedule needs correction. |
| 2 Assign specialty | COMPLETE | Active Specialty FK required on creation, admin doctor patch supported. Profile-edit UI missing. |
| 3 Create schedule | COMPLETE | Normalized schedule endpoints, admin editor and conflict tests. |
| 4 Patient sees doctor | COMPLETE | `/api/patient/doctors`; active doctor/specialty filter. Account-status consistency gap remains. |
| 5 Patient books | COMPLETE | Owned patient booking + slot lock/unique constraint; initial PENDING review. |
| 6 Doctor sees appointment | COMPLETE | Doctor-scoped queue and DoctorDashboard. |
| 7 Open encounter | COMPLETE | Appointment must belong to doctor/patient and be in consultation; consultation billing gate enforced. |
| 8 Notes/diagnosis | COMPLETE | Encrypted record creation/finalize, validation, audit and completed-visit protection. Signed amendments absent. |
| 9 Prescription | COMPLETE | Formulary/custom item validation and pharmacy billing preparation. |
| 10 Pharmacy sees prescription | COMPLETE | Pharmacist pending/history routes and dashboard. |
| 11 Dispense | COMPLETE | Pharmacist-only, paid pharmacy invoice required. |
| 12 Stock decreases | COMPLETE | FEFO, expiry exclusion, quantity/version checks, immutable movements and atomic audit. |
| 13 Lab order | COMPLETE | Standard/custom tests linked to record/patient/doctor. |
| 14 Receive lab order | COMPLETE | Lab pending/review queues with payment/sample gates. |
| 15 Result entry | COMPLETE | Expected-version concurrency, permitted order state, attachment/range fields. |
| 16 Authorized result view | COMPLETE | Doctor-scoped clinical views; patient lab API only completed, explicitly released orders. |
| 17 Invoice items | COMPLETE | Server-authoritative consultation/service/lab/medicine prices, frozen item snapshots. |
| 18 Record internal payment | COMPLETE | ADMIN/RECEPTIONIST general authority; PHARMACIST restricted pharmacy authority; idempotency header required. |
| 19 Invoice status | COMPLETE | Locked/optimistic ledger updates, partial/full paid and refund states. |
| 20 Patient dashboard | COMPLETE | Existing authenticated appointments/records/labs/prescriptions; truthful zero/unavailable states and no synthetic activity. |

## Production model plan

Keep existing IDs/FKs and status semantics. Introduce optional relationships first, use reviewed backfills only when real clinic mappings exist, validate constraints separately, then enforce required fields. Keep existing records readable during deployment and roll back application slices before considering schema removal.

1. **Doctor/catalog management first, without a broad schema rewrite.** Explicit working hours; profile editor connected to existing API; coordinated user/doctor availability policy. Add service creation/metadata/archive and pagination using existing ClinicalService. Introduce stable service codes only with collision reporting and explicit legacy mapping; do not derive arbitrary IDs or overwrite descriptions on old invoices.
2. **Payment methods and money policy.** Retain CASH/CARD/BANKAK/FAWRY codes. A future PaymentMethod(code primary key, bilingual labels, active, timestamps) can be related to existing Payment.paymentMethod and Refund.refundMethod only after approved inserts/backfill and SQL-check compatibility. Existing payment records must remain valid after method archival. Card/manual POS stores reference only. Insurance remains a separate receivable/claim, not an invented payment gateway or method. Current PostgreSQL `Decimal` columns map to DECIMAL(65,30), so storage is decimal-safe; several runtime USD conversions/refund calculations use JS Number and tolerances. Define currency/rounding and convert arithmetic to Decimal before narrowing any database precision. Do not automatically convert existing monetary columns or historical amounts.
3. **Pharmacy reference and procurement.** Add DosageForm, MedicineCategory, StockUnit and Manufacturer only with consuming APIs/forms; retain current dosageForm text until mapped. Add Supplier, GoodsReceipt and GoodsReceiptItem with supplier document identity, receipt actor/time/status, batch allocation, quantity, optional purchaseUnitCostSdg as Decimal and real references. Do not place changing purchase costs on the medicine master. Snapshot cost per receipt line; keep selling price separate. Add medicine-level reorder policy if needed, preserving existing batch thresholds. Extend movement constraints/API/ledger together for adjustment, write-off and return; signed reason/actor and stock bounds required. Supplier returns and dispensing reversals are separate authorized operations, not row edits/deletes.
4. **Lab definitions.** Associate optional LaboratoryTestDefinition with a LABORATORY service; stable code, category, specimen, result type, unit and versioned reference ranges. Snapshot unit/range on order items. Existing free-text results remain intact; a single min/max cannot represent every age/sex/unit-specific range.
5. **Appointments and organization.** AppointmentType optional FK with code, duration and linked service only after slot-capacity rules are explicit. For a confirmed multi-branch requirement add Facility/Department/Room with optional initial links, doctor assignments and room conflicts, then enforce scoped uniqueness/access. Do not label the current product multi-tenant or bolt on nullable tenant IDs without complete authorization isolation tests.
6. **Clinical/financial governance.** Add signed encounter/amendment versions and typed vital observations if required, preserving ciphertext and historical snapshots. Introduce invoice display numbers (server-side sequence), item source snapshots/FKs, actor relations and refund idempotency with compatibility review. Review duplicate InsuranceClaim.invoiceId / Invoice.insuranceClaimId representation before changing it. Existing free scalar actor/reference IDs in Invoice, Payment, PaymentOperation, EmergencyOverride, Notification and TenantAuditLog need orphan audit before FKs. Do not add cascading clinical/financial deletion. Add createdAt/updatedAt on mutable masters consistently; do not fabricate historic creation times during backfill. Ledger entries remain append-only.

## Prepared local changes

- New read-only `backend/scripts/audit-clinic-readiness.js`: explicit audit URL, no application startup/config import, repeatable-read READ ONLY transaction, enforced read-only mode, bounded queries, schema identifier validation, aggregate counts and migration checksums only. No patient row fetching, DDL, seed or repair path; URL/credentials are never included in output. `--schema-only` produces the repository inventory without connecting.
- Fixed `backend/test/helpers/testRunner.js` to pin **DIRECT_URL as well as DATABASE_URL** to each isolated local schema. Previously an inherited direct URL could redirect Prisma migrations away from the test schema. Regression supplies an unintended external direct URL and asserts it is overridden for every child. This affects test setup only, not production runtime.
- Added six Prisma query indexes and `20261022100000_patient_workflow_query_indexes/migration.sql`. No new entity model, altered type, enum/status change, data backfill, FK rewrite or uniqueness tightening. Prisma datamodel diff confirms exactly the same six CREATE INDEX statements.
- New audit safety and populated-migration regression tests. `backend/scripts/test-clinic-readiness.js` runs a fixed focused suite using guarded `test/helpers/operationalFixtures.js` in fresh localhost:5433/clinic_test schemas; it explicitly excludes the one general-seed execution test while retaining the seed guard tests. No general seed is called.
- Regression and fixture guards preserve the original runtime permission model; no frontend or production route behavior was changed in this audit.

## Proposed safe reference data

- States: retain the current canonical 18 IDs/labels. No insert is proposed when already present. Existing guarded bootstrap remains the only reviewed executable state initializer.
- Specialties: [proposed repository list](proposed-specialties.json) contains only the five existing seed definitions (surgery, dentistry, orthopedics, internal-medicine, neurology). It is a **proposal**, not a runnable seed. A later guarded bootstrap must match unique code, preserve current UUID/active status, verify both labels, abort on ambiguous label/code conflicts and insert only missing definitions in one transaction with audit. These five are not claimed to be the clinic's complete specialty offering.
- Service categories: retain the four existing codes; they currently live in application validation, not a table to insert into.
- Payment methods: retain the four existing manual codes; no rows can be inserted until a reviewed PaymentMethod model and consumers exist.
- Dosage forms, medicine/lab categories, stock units and appointment types: obtain a clinic-approved, versioned vocabulary before adding records. Do not invent medicine products, clinical tests, prices, suppliers, stock or doctor identities.
- No doctors, users, patients, prescriptions, invoices, payments, records, results, stock or clinic-specific services are proposed for Neon insertion.

## Neon approval packet — STOPPED before writes

| Requirement | Exact proposal |
|---|---|
| Schema/migration | Only six new nonunique B-tree query indexes; migration named above. |
| Tables affected | Appointment, MedicalRecord, Prescription, LabOrder, Invoice, Payment. Prisma's migration history would also receive a record if deployment were approved. |
| Existing rows | No row values/IDs/FKs/statuses change; no inserts into application tables and no deletion. |
| Reference inserts | None in this deployment packet. Specialty JSON is a separate, unapproved future proposal. |
| Operational effect | Index build scans tables and ordinary CREATE INDEX temporarily blocks writes; script has 5s lock timeout and 60s statement timeout in a transaction. Large tables require a separately reviewed concurrent-index rollout. |
| Preconditions | Restore read-only target verification; compare all deployed migration checksums; identify pending old migrations and their data effects; inspect table sizes/invalid indexes and capture a verified backup/recovery point. Never blindly deploy all pending migrations. |
| Failure/rollback | On lock/statement error the transaction aborts; stop and inspect migration state. No automatic recovery. If successfully applied, leave unused indexes safely in place while rolling back app code, or request approval to remove only these six indexes using a reviewed rollback. Never drop tables or reset migration history. |
| Approval | No Neon write is authorized by this audit result. Review the tests/risks and approve the exact target and packet in a later step. |

Historical migrations include real data transformations (medicine identity/opening balance, MRN backfill, specialty protection, free-text review state) and SQL-only triggers/partial uniqueness/checks. Their checksums must not be changed or replaced by a fresh baseline. The pending-auth capability migration adds a non-null column without a data backfill; if it is pending on a populated target, it needs explicit preflight. Replaying history on a new local schema does not prove existing Neon contents can accept every pending migration.

## Recommended next implementation order

1. Restore/read-only verify deployment target, migration drift and least-privilege roles; approve a bounded release only after the packet is verified. Preserve working registration/reference recovery.
2. Doctor/staff readiness slice: explicit schedule on onboarding, no guessed hours, account/doctor activation policy, profile editor, complete schedule UI, role tests and one admin-to-patient booking journey.
3. Service/lab catalog management: admin creation/edit/archive, code/duplicate strategy, authoritative prices, pagination and real clinic-entry forms; ensure no zero/unpriced service becomes bookable/billable.
4. Shared reference contracts and guarded specialty bootstrap after approval; payment-method configuration and Decimal arithmetic/rounding tests. No payment gateway.
5. Medicine reference/metadata and supplier procurement slice, batch receipts/costs, immutable adjustment/write-off/return workflows and concurrent stock tests.
6. Lab test definitions, units/range snapshots, review/release safeguards and localized result forms.
7. Invoice/payment/refund administration, numbers, source snapshots, insurance-company CRUD and a separate insurer-claim settlement workflow. Append-only financial history.
8. Optional facility/department/room/type support once real clinic needs are confirmed; complete permission scoping before enabling it.
9. Clinical amendment/version governance, structured vitals/diagnoses, notification operations and recovery/retention controls.
10. Final acceptance on an isolated database from empty masters: real admin-entered local fixtures → booking → paid consultation → record → prescription/paid dispensing → paid lab/sample/results/release → patient views. Then review the production packet; do not insert fake transactions into Neon.

## Verification results

See [recorded test summary](test-results.json).

- **Backend: 337 passed, zero failures across 13 selected files.** Includes the large integration suite covering role/ownership denials, appointment concurrency, clinical record access and audit rollback, lab payment/sample/result/release lifecycle, authoritative prices, insurance liability, payment idempotency/races, refunds, pharmacist-only mutations, paid dispensing, FEFO and stock bounds. Additional files cover doctor management, scheduling, audit safety, references and runner isolation.
- One general-seed execution test is **intentionally excluded**, not silently treated as verified. The remaining seven seed-security checks pass. The fixture runner never executes `prisma/seed.js`.
- All 25 migrations replayed successfully in fresh local schemas. A populated migration proof compares exact clinical/financial row snapshots before/after the new migration and verifies preserved active-slot protection; no reset/drop cleanup is used by the new proof test. Older reference-bootstrap tests clean up their own temporary local schemas.
- Prisma validation passed. Offline datamodel diff from the pre-task schema contains exactly six CREATE INDEX statements, matching the prepared migration. Existing SQL-only checks/triggers are preserved rather than regenerated.
- **Frontend: all 289 tests passed**, including existing theme, RTL/layout, onboarding, navigation, pharmacy, billing/clinical view and dashboard regressions. Build passed. Lint has zero errors and six pre-existing warnings; the existing large-chunk advisory remains.
- Syntax checks and `git diff --check` passed.
- No new browser matrix or physical-device/accessibility acceptance run was performed in this source/schema audit; no frontend files were changed in this phase. Existing dashboard browser evidence remains documented in the earlier dashboard report. A complete staff/admin visual acceptance pass belongs to each implemented management slice.
- No fresh production-readiness certification is possible until live target/schema/privilege verification succeeds, real master data is entered, missing management flows are completed and the complete isolated acceptance journey is run.

Reproduce safely from `backend/` with a privately configured `TEST_DATABASE_URL` pointing only to the dedicated localhost:5433/clinic_test database:

```sh
node scripts/test-clinic-readiness.js
```

The command refuses other database targets before setup, pins DIRECT_URL, creates a separate schema per file and uses local fixtures. It does not load a production database URL as a fallback. For repository-only metadata without any database connection:

```sh
node scripts/audit-clinic-readiness.js --schema-only
```

Read-only deployment inspection requires an explicit, privately supplied `CLINIC_AUDIT_DATABASE_URL`; there is no write mode. Do not use the general seed, migration reset, db push, or a blind migrate deploy as a recovery operation.

Changed in this run: Prisma schema; the new six-index migration; read-only audit script; isolated readiness test command and guarded fixture helper; testRunner DIRECT_URL isolation and its regression; new audit/migration regression files; this audit directory. Earlier modified/untracked backend, frontend and documentation work was retained.
