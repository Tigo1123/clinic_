# Billing and insurance review — 24 October 2026

Repository: `clinic_`; branch: `feat/next-improvements`. No commit, push, deployment, staging migration or production database write was performed.

## Inspection and original gaps

Inspected `backend/prisma/schema.prisma`, the existing migration history, billing/patient/appointment/admin/catalog/pharmacy/records routes, the money and pharmacy-invoice services, public DTO and role policies, integration/readiness tests, reception/admin/patient-file screens, existing CSS and frontend test harnesses.

| Classification before changes | Finding |
| --- | --- |
| COMPLETE | Doctor-specific consultation pricing, authoritative diagnostic catalogue and formulary prices, invoice line snapshots and source links, patient payment states, overpayment protection, payment idempotency and row/ledger locks, refund ledger, pharmacy automatic invoice preparation, atomic dispensing/stock protection, paid-only consultation and laboratory gates. Existing integration tests exercise these paths. |
| PARTIAL | Reception company-level insurance preview and draft claims; patient Billing showed invoice totals only. Claim status values existed without a transition API/UI. Reception combined issuance and payment, and recreated payment retry keys. |
| MISSING | Patient membership/validity, active insurer configuration, covered service categories, insurer administration, patient financial ledger, general invoice retry identity, and a reference check on generic invoices. |
| DO NOT CHANGE | Doctor-specific fee design; whole-SDG Decimal arithmetic and exchange-rate snapshots; issued line prices; existing payment/refund/dispensing transaction protections; security/MFA/authentication, clinical access rules, audit rollback behavior and isolated testing safeguards. |

## Implemented changes

- Added migration `20261024100000_patient_insurance_membership`. `PatientInsurance` stores company, member number, optional descriptive plan, inclusive validity dates and active status. One membership per patient/company; referenced records cannot be deleted. Existing patients receive no fabricated memberships. Existing invoices, claims and monetary values are preserved.
- Added insurer active status and covered clinical-service categories. Existing company copay remains authoritative; no duplicate fee or pricing system was added. Admin clinic setup can create/update/inactivate insurers and configure copay, categories and billing cycle, using the existing confirmation dialog and design system.
- Added membership read/write endpoints for Admin/Reception and the editor in patient Billing. Validity and active insurer/membership are checked by the backend for preview and issuance. Uncovered services, expired, future-dated and inactive insurance reject insured billing. Explicit self-pay remains available. Preview and issuance use the same eligibility service; issuance repeats it inside its serializable transaction.
- Extended insurance preview to laboratory orders; lab prices remain catalogue-owned. Zero-copay invoices have no patient payment requirement and unlock the applicable laboratory billing gate. Claim state remains separate from patient payment state.
- Added Admin-only claim transitions: DRAFT → SUBMITTED → UNDER_REVIEW → APPROVED/REJECTED; APPROVED → PAID. Conditional updates reject stale/concurrent transitions. Submission/payment timestamps and audits are recorded atomically. Controls appear beside the claim in patient Billing.
- Added invoice issue operation records for `Idempotency-Key` retries. Reception retains invoice and payment keys until a confirmed response. Repeated/concurrent general invoice requests with the same key reuse one invoice; conflicting payloads reject. Existing consultation/lab source uniqueness and pharmacy protections are preserved.
- Rejected unrelated source references on general, consultation and lab requests. Consultation fee/state are rechecked during issuance. Added invoice creation audit in the issuance transaction.
- Added a restricted patient financial projection with line charges, gross charge, insurer portion, patient payable, payments, refunds, net remaining balance and claim status. It excludes user/security relations, operator IDs, transaction references, refund free text and clinical notes. Existing Admin/Reception financial permissions are preserved; doctor clinical projections do not gain financial access.
- Patient Billing displays the latest 50 invoices, localized types/payment/claim states and separate monetary totals. Authorized staff can collect outstanding non-pharmacy balances using the existing payment endpoint and retained retry keys. Pharmacy payment authority stays with the pharmacist workflow.
- Reception can issue without collecting payment. The summary distinguishes paid and outstanding amounts. Existing lab invoices use their issued patient responsibility; the lab queue no longer presents insurer responsibility as patient debt.
- Patient overview now derives current insurance from valid membership rather than treating the latest claim as current membership; corrected the former copay-as-coverage percentage display.
- Added eligibility, claim, insured lab, issuance concurrency, financial projection, migration preservation and UI regressions. Updated stale schema/DTO/tab/summary expectations and frontend compilation harnesses. Theme checks retain their contrast assertions while accounting for existing MUI selector exclusions. Added the new backend tests to the existing readiness runner.

## Accounting and rollout boundaries

- Apply the new migration before serving the new backend. Populate verified memberships before using insured billing. Historical company-only invoices remain unchanged and collectible under their issued amounts.
- Coverage is company copay plus service category eligibility. Plan is descriptive; deductibles, authorization limits, annual maxima, negotiated insurer tariffs and plan-specific rates are outside this minimal extension.
- Pharmacy continues as self-pay through its established pharmacist-owned workflow. Covered categories are consultation, laboratory, radiology and clinical procedures; pharmacy insurance adjudication was not invented.
- Patient `PAID` means patient responsibility is settled. A separate claim may remain DRAFT or unpaid. Marking a claim PAID records its administrative status/date, not a bank transfer, remittance ledger or automatic reconciliation.
- Rejected claims retain the issued patient/insurer allocation. No automatic extra patient debt, invoice repricing or clinical relocking occurs. A financial adjustment/appeal policy is needed before automating denial recovery.
- Generic invoice retry deduplication requires a stable `Idempotency-Key`; the updated reception UI supplies it. Legacy API callers omitting it can still intentionally create separate general invoices. Keys persist for in-session retries; reloading a browser requires reviewing the patient ledger before initiating another payment.
- Financial history is explicitly limited to the most recent 50 invoices. This is a bounded staff profile, not a new full accounting/export system or patient-portal finance permission.

## Verification

All database tests used fresh `test_*` schemas on an empty temporary loopback PostgreSQL instance, port 55471, database `clinic_test`. No production/staging data or general/demo seed was used. The existing guarded operational fixtures were used for integration tests.

- Prisma validation and full migration replay passed. The new populated migration regression preserved patient, invoice and claim rows and verified membership restrictions and date ordering.
- Final results across 19 unique backend readiness/billing test files: **361 passed, 0 failed**. The broad 16-file pass initially had a stale insurer DTO fixture assertion; the final focused run replaced that file's result and passed all 248 checks. Additional new migration/projection tests passed. This is the focused readiness suite, not a claim that every backend test file was run.
- Frontend: all **57 test files passed**; lint and production build passed. Six existing lint warnings and the existing bundle-size advisory remain.
- Browser: **82 checks passed, 16 captures** using synthetic intercepted API fixtures, desktop 1366px/mobile 360px, Arabic/English, light/dark, membership editor, financial distinctions, insurer editor and payment retry identity. See `qa-evidence/billing-insurance-review/report.json` and representative mobile captures. Browser fixture checks complement real backend authorization/transaction tests; they do not claim end-to-end live payment-provider validation.
- Backend/script syntax checks and `git diff --check` passed.

The pre-existing untracked `qa-evidence/auth-mobile-fields/` directory was left untouched. Review the migration and rollout boundaries before deploying. No commit or push was performed.

## Final commit review

**Safe to commit for review**, with the migration and documented rollout boundaries included. This is not a deployment approval or a claim that insurer remittance/denial recovery or pharmacy insurance is implemented. The existing production security and payment/stock safeguards remain in place; no failing checks remain in the exercised suites. Full per-file results are in `qa-evidence/billing-insurance-review/verification.json`.
