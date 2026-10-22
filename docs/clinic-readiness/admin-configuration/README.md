# Doctor onboarding and core catalog configuration

Implemented locally on 2026-10-22, building on the preceding readiness audit. No Neon read/write, general seed, database reset/truncate/drop, commit or push was performed in this phase. Existing reference tests clean up only their own isolated local schemas. Existing uncommitted work was preserved. **Schema/API changes are staged for review and must not be deployed against the unmigrated Neon database.**

## Doctor lifecycle

- Staff/doctor creation keeps the existing ADMIN authorization, active-specialty/fee validation, password policy and first-login password-change requirement. It now creates an empty legacy working schedule (`[]`), rather than assigning seven arbitrary working days. The admin fee form also has no guessed default fee.
- Explicit schedules continue through the existing normalized schedule APIs/editor, with effective dates, breaks, exceptions, booking conflicts and audit safeguards preserved. The editor now uses the ADMIN doctor list, so an inactive doctor can still be selected and configured, and the selected doctor is passed through from the new profile screen. Arabic doctor names are preferred in Arabic mode.
- New MUI profile editor changes bilingual names, specialty, official fee and active status. Account creation is available in the MUI screen and the existing staff form. Existing password/reset/security workflows are retained.
- Doctor profile and staff-account status transitions synchronize in one transaction. Writers lock account before profile, increment the account authentication generation when account status changes, and retain audit events. Existing appointments, schedules and clinical records are never deleted by deactivation.
- Public/patient discovery checks active doctor **and** active account/specialty. Slot generation and in-transaction booking/rescheduling/transfer checks recheck eligibility. Missing explicit working hours return no slots. Existing legacy schedules are preserved; their provenance cannot safely be inferred or rewritten.
- Profile/pricing UI displays effective availability when a legacy account/profile status is inconsistent, preventing a misleading active badge. Clinical access/role rules are not bypassed.

## Catalog management

The ADMIN workspace has a **Doctors & catalogs** entry with five MUI tabs: Doctors, Specialties, Medical services, Laboratory tests and Payment methods. The existing account, pricing and schedule tools remain supported.

- Specialties retain stable IDs/codes, bilingual labels, archive/reactivation, audited creation/editing and historical deletion protection. API writes now also reject normalized duplicate Arabic/English names. Referenced specialties cannot be deleted; the new screen uses status changes rather than destructive deletion. The repository's canonical specialty definitions are retained; no specialty list is silently inserted into Neon.
- Services and lab tests share the existing ClinicalService model and consumers. ADMIN can create, list/search/filter/page, edit names/code/official price, and activate/archive. Supported existing categories are CONSULTATION, CLINICAL_PROCEDURE, RADIOLOGY and LABORATORY. Category changes are rejected after creation. Service codes are unique; normalized labels are protected per category with advisory locks shared with lab review. Existing legacy services retain their UUID and nullable code until explicitly configured.
- New entries default inactive, require bilingual names, a code and a positive whole-SDG official price. Whole SDG remains the existing billing contract; no new fractional-pricing policy is invented. Prices and currency conversion use Decimal, retaining existing PostgreSQL Decimal storage. Existing 1500 currency conversion behavior is preserved, with precision 65 and scale 30.
- Billing retains server-authoritative prices and rechecks locked catalog prices/status before creating a new invoice, rejecting a catalog that changed during checkout. Existing invoice item descriptions, quantities and prices remain untouched when a catalog is renamed, repriced or archived.
- No catalog units/default reference ranges were invented: the current schema stores reference limits on result items, not on reusable catalog definitions. Unsupported catalog reference metadata is rejected. Existing lab review/sample/result/release workflows remain intact.
- PaymentMethod configuration covers the four existing codes: CASH, CARD, BANKAK and FAWRY. Admins edit bilingual labels and enable/disable methods. Codes cannot be renamed or deleted through the API. Receipt/reference records remain manual; there is no gateway or card-secret model.
- Reception fetches active payment methods and uses configured labels. Pharmacy payment-state responses expose active codes and configured labels, and its form disables submission if no method is available. The server serializes method checks against configuration updates and rejects inactive methods for new payments. Recorded idempotent payment retries still replay successfully after a method is disabled. Historical payments/refunds retain their codes/FKs; refunds can still reference an inactive historical method.
- Insurance remains the existing company/claim/patient-share flow. An insurance receivable is not invented as a paid cash transaction or new payment-method code.

## UI quality

MUI reuses the existing Shifa theme adapter/CSS tokens and Emotion RTL caches. Both languages/themes have localized forms, native selects with nonoverlapping labels, loading/errors, empty states, search/status filters, pagination, edit/confirmation dialogs, focus handling and safe long-text wrapping. Secret fields are absent from profile edits and payment settings; temporary passwords are cleared on close/save.

The new cards collapse to one column on smaller widths. Existing admin navigation becomes a compact horizontally scrollable menu below 900px, scoped to ADMIN only. Clinic setup omits the duplicate staff hero so the operational forms appear sooner. Existing schedule controls are reused inside the new layout rather than replacing the scheduling architecture.

Service pagination/filtering is server-side. Doctor/specialty/payment configuration lists retain their existing array APIs and are searched/paged client-side; very large staff/specialty catalogs would benefit from a separately compatible server-pagination extension.

## Schema / deployment

Current schema has 41 models and 26 migration files, including the previous pending index migration. This phase adds only nullable ClinicalService.code plus a unique index, PaymentMethod, four canonical method rows and restrictive Payment/Refund method FKs. No historical money/data backfill, doctor-status mass update or schedule rewrite is included.

**Read the [Neon approval packet](approval-packet.md)** for exact SQL, affected tables, row-value effects, inserts, preconditions, rollback and expected application behavior. It includes the earlier index migration separately so it cannot be implicitly authorized. Deployment requires an explicit approval and successful read-only target/drift verification. Do not blindly apply every pending migration.

## Regression evidence

See [test-results.json](test-results.json). **349 backend tests passed across 16 files; all 299 frontend tests passed. Browser verification passed 572 checks across 167 captures (matrix plus actual admin navigation).**

- Backend isolated suite includes doctor creation/edit/specialty/status, absent vs explicit schedules, real local authenticated patient booking, deactivation blocking booking and preserving appointments, effective account status, service/lab CRUD/duplicates/pricing/history, payment-method lifecycle/idempotent replay, authorization and existing operational integration tests.
- Migration proof replays earlier migrations in a fresh local schema, creates local historical invoices/payments/refunds, applies the new migration, and proves exact financial row snapshots remain unchanged. It verifies four reference codes, preserved legacy service IDs/money, inactive historical methods, restrictive deletion and the supported-code constraint.
- Decimal tests cover 0.1 + 0.2, exact subtraction/multiplication, whole-SDG totals and 30-place repeating USD conversion without binary arithmetic.
- Frontend tests cover Arabic/English × light/dark MUI controls, direction, localized validation, retries, confirmation, duplicate recovery, successful create/reload, doctor profile/schedule targeting and absence of payment-secret fields. Original tests were retained; schedule mocks now use the correct ADMIN endpoint, and the pharmacy contract asserts the stronger inactive-method submission guard.
- Browser fixtures intercept all API requests and block sockets. All five tabs/editors are checked at 360, 390, 768, 1024, 1366 and 1600px in both languages/themes. Native select-label regression, empty/error states and actual ADMIN navigation/mobile layout are included. No live account or transaction was created.
- Prisma validation, local migration replay, offline Prisma datamodel diff, syntax, production build, lint and git diff checks are recorded in test results. Six pre-existing lint warnings and existing large-chunk build advisories remain.

## Remaining limits

- The older Render database may be the authoritative source of existing clinic data. Follow the [source/destination preflight](render-migration-preflight.md); do not initialize Neon from scratch or invent replacement doctors, medicines or services. A real-data transfer remains unstarted and requires a separate reviewed plan and approval.

- No Neon deployment or live acceptance was attempted. Earlier live schema/privilege verification remains unresolved; approved migration must precede the new backend build.
- Existing legacy doctors/schedules/prices need review by the clinic; existing hours are not silently erased. Active doctors with no schedule can be listed, but cannot supply a bookable slot.
- Config choices in already-open reception pages are snapshots until refresh. The server rejects stale disabled methods and changed/archived catalog entries; it does not silently accept them.
- Payment references are manual and do not verify settlement with a bank/POS provider. No raw-card/PIN/CVV fields are accepted by payment configuration or payment DTOs.
- Supplier/procurement, facilities/rooms, insurance claim settlement, lab unit/range definitions and signed clinical amendments remain outside this phase.
- Browser verification uses Chrome emulation/fixtures. Safari/Firefox, physical mobile devices and real assistive-technology sessions were not tested.

## Files changed in this phase

Backend:
- `prisma/schema.prisma`, `prisma/migrations/20261022110000_admin_catalog_configuration/migration.sql`.
- `src/routes/adminCatalogs.js` (new), `adminDoctors.js`, `admin.js`, `auth.js`, `appointments.js`, `patient.js`, `specialties.js`, `billing.js`, `pharmacy.js`; `src/server.js` route mount.
- `src/services/doctorLifecycle.js` and `paymentMethods.js` (new), `src/services/pharmacyInvoice.js`, `src/utils/money.js` (new), `src/utils/scheduling.js`.
- `test/admin-configuration.test.js`, `admin-configuration-migration.test.js`, `money.test.js` (new); lifecycle cleanup in `admin-doctor-management.test.js`; schema/migration-baseline assertions in `clinic-readiness.test.js` and `clinic-readiness-migration.test.js`; `scripts/test-clinic-readiness.js` focused suite.

Frontend:
- `src/features/admin/ClinicSetupPanel.jsx`, `clinicSetup.js`, `clinicSetup.css` (new), `AdminDashboard.jsx`, `AdminSchedulePanel.jsx`.
- `src/features/reception/ReceptionDashboard.jsx`, `src/features/pharmacy/PharmacyPayment.jsx`.
- `test/clinicSetup.test.js` (new), `adminScheduleComponent.test.js`, `adminSchedulePanel.test.js`, `pharmacyManagement.test.js`.
- `scripts/verify-clinic-setup.mjs` (new).

Documentation: this directory, including the exact approval packet, schema/diff artifacts and test summary. No new dependencies were added in this phase. Earlier working-tree changes are retained separately.
