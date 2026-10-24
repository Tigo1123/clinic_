# Laboratory catalogue management review — 24 October 2026

Branch: `feat/next-improvements`. No commit, push, deployment, production/staging write, schema change or migration was performed. The pre-existing untracked `qa-evidence/auth-mobile-fields/` was left untouched.

## Before changes

- **COMPLETE:** `ClinicalService`, `LabOrder` and `LabOrderItem`; Admin-only catalogue create/edit/list and pricing; positive whole-SDG prices with Decimal conversion; normalized duplicate names and unique codes; audit transactions; active-only public service list; doctor ordering by service ID; historical service relations and invoice snapshots; laboratory invoice deduplication and payment gates; custom-test review and unpriced/inactive drafts.
- **PARTIAL:** Admin → Doctors & catalogs → Laboratory tests already existed, but used generic cards, was hard to discover, and had no direct activation action. Doctor selection supported name search but omitted service code and price, hid search for small catalogues, and offered radiology despite the laboratory-only backend order contract. Two catalogue writers used inconsistent name normalization.
- **MISSING:** Direct laboratory navigation, desktop table/mobile bilingual cards, clear Add Test and status actions, code search/price display for doctors, and regression coverage connecting the complete catalogue-to-order-to-billing workflow.
- **DO NOT CHANGE:** Existing service IDs, database currency, order/item models, invoice history, paid-only clinical gates, custom-test review architecture, Admin pricing authority, security and financial transaction protections.

The authoritative currency remains **SDG**, with USD conversion snapshots. RWF was not introduced.

## Implementation

1. Added an explicit Admin navigation entry: **Clinical services · Laboratory tests**. It opens the existing `ClinicSetupPanel` on its laboratory tab; no second catalogue UI or storage model was introduced.
2. Added a searchable, paginated desktop table showing code, Arabic name, English name, official price, status, Edit and Activate/Deactivate. Mobile uses bilingual cards with the same actions. Existing MUI themes, RTL cache and design tokens are reused.
3. Reused the existing add/edit and confirmation dialogs. Codes normalize to lowercase NFKC form; both names, code and positive whole-SDG price are required. New entries start inactive unless explicitly activated. Duplicate errors retain the entered values. Activation of an incomplete legacy draft opens its editor for completion.
4. Added a confirmation dialog for direct activation/deactivation. Status-only updates preserve prices and names. No delete action or endpoint was added.
5. Added `/api/admin/catalog/laboratory-tests` GET/POST and `/:id` PATCH aliases to the **same existing handlers**. This view fixes listing to LABORATORY, rejects other categories on creation, rejects updates to non-laboratory IDs, and retains immutable category validation. The original generic catalogue endpoints remain available for other clinical services. All aliases inherit the existing Admin authorization.
6. Fixed a discovered PATCH validator bug: the create-time INACTIVE default leaked into partial updates, so a price-only edit silently deactivated a service. Partial updates now preserve status when it is omitted; the new workflow test asserts this behavior.
7. Aligned Admin and laboratory-review normalization/duplicate-lock identities. Code normalization also accepts and normalizes uppercase/full-width input. Existing database uniqueness and transactions remain in use.
8. Added `code` to the existing non-sensitive public clinical-service DTO. Doctor selection always offers search, searches codes and both names, shows current SDG price, and presents LABORATORY entries matching the backend contract. Loading/error/empty/search-empty states are explicit. Custom tests are clearly labelled as requiring laboratory review. The order payload still contains only service IDs, with no catalogue prices.
9. Existing lab review, order/result links, authoritative invoice pricing, invoice duplicate protection, price snapshots and paid-only processing were verified rather than rebuilt.

## Changed files

- `backend/src/routes/adminCatalogs.js`
- `backend/src/routes/records.js`
- `backend/src/utils/publicDto.js`
- `backend/test/admin-configuration.test.js`
- `backend/test/integration.test.js`
- `frontend/src/features/admin/AdminDashboard.jsx`
- `frontend/src/features/admin/ClinicSetupPanel.jsx`
- `frontend/src/features/admin/clinicSetup.js`
- `frontend/src/features/doctor/DoctorDashboard.jsx`
- `frontend/src/features/doctor/doctorDashboard.css`
- `frontend/test/clinicSetup.test.js`
- `frontend/test/clinicalReadViews.runtime.test.js`
- `frontend/scripts/verify-laboratory-catalog.mjs`
- This report and `qa-evidence/laboratory-catalog/` verification evidence.

## Verification

- Prisma validation passed. No migration was needed; the existing migration history replayed successfully into fresh isolated schemas.
- **362 backend tests passed across the existing 19-file readiness suite**, including catalogue authorization/validation/normalization, active doctor selection, historical inactive lookup, price authority, forged browser prices, repeated lab invoices, custom review, payment gates, audit atomicity and stock/payment safeguards. The complete 70-file backend suite was not run; the 19-file suite covers the relevant clinical/billing and production-readiness regressions.
- All database writes were confined to fresh `test_*` schemas on the temporary local `clinic_test` database at loopback port 55471, using the existing guarded operational fixtures. No general/demo seed was run.
- Frontend: **all 57 test files passed**. Lint and production build passed, with six pre-existing warnings and the existing bundle-size advisory. Browser: **210 checks passed, 96 captures**, with no unhandled exceptions. Per-file results are in `qa-evidence/laboratory-catalog/verification.json`.
- Browser checks use intercepted synthetic fixtures at 320, 360, 390 and 1366px; Arabic/English; light/dark. They cover list/table/cards, names/currency, dialog fit, code normalization, add/edit success, confirmed inactivation, duplicate messages, empty/loading/error states and page overflow. These checks complement the real backend API/database tests rather than claiming live external-service validation.
- `git diff --check` and backend/browser script syntax checks passed. Existing six lint warnings and bundle-size advisory remain.

## Manual review steps

1. Sign in as Admin. Open **Clinical services · Laboratory tests** in the Admin sidebar, or **Doctors & catalogs → Laboratory tests**.
2. Search by code or either name; filter Active/Inactive; confirm desktop columns and mobile cards at 320/360/390px in both languages and themes.
3. Choose **Add Test**. Enter CBC, صورة دم كاملة, Complete Blood Count, 10000. Confirm code normalization to `cbc`, choose Active, save, then confirm. Do not add demonstration catalogue rows to production as part of QA.
4. Repeat with FBS / سكر صائم / Fasting Blood Sugar / 5000 in an isolated QA environment. Try duplicate code/name and a negative price; confirm safe errors and preserved form values.
5. Edit a test's name/price. Confirm and verify the updated list and unchanged status. Try Activate/Deactivate, cancel once, then confirm. No deletion should be offered.
6. As Doctor, open a consultation. Search `cbc`; confirm the catalogue name/code/current SDG price. Select it and send to the lab. A custom test should be clearly distinguished and require review before billing.
7. As Reception, issue the laboratory invoice. Confirm its price comes from current Admin configuration and that retrying does not create a second lab invoice. Lab processing remains gated by full patient payment.
8. Deactivate a referenced test. Reload the doctor's selection: it must be absent. Existing laboratory orders/results still resolve the service, and issued invoice prices remain unchanged.
9. Verify Doctor, Patient, Reception, Lab and Pharmacy roles cannot mutate the Admin catalogue endpoints. Lab may continue its existing custom-test review/draft workflow, but cannot assign the official master price.

## Commit review

**Safe to commit for review:** all exercised checks passed, and the evidence is saved. No migration or currency rollout is required. Existing null-code/unpriced laboratory drafts may still require Admin completion before UI activation. Service prices remain positive whole SDG; free-test billing and radiology ordering are not introduced by this change. No commit or push was performed.
