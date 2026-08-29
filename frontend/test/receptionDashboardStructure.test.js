import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/features/reception/ReceptionDashboard.jsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/features/reception/receptionDashboard.css', import.meta.url), 'utf8');

test('reception workspace keeps patient access and operational actions in the compact layout', () => {
  assert.match(source, /reception-global-search/);
  assert.match(source, /SHF-000001/);
  assert.match(source, /setViewingProfilePatientId/);
  assert.match(source, /PatientProfileModal/);
  assert.match(source, /handleRegisterPatient/);
  assert.match(source, /handleWalkInSubmit/);
  assert.match(source, /handleApproveAppointment/);
  assert.match(source, /handleCancelAppointment/);
  assert.match(source, /handleCheckIn/);
  assert.match(source, /handleQuickBill/);
});

test('reception workspace provides native RTL, responsive queue cards, and accessible tabs', () => {
  assert.match(source, /dir=\{lang === 'ar' \? 'rtl' : 'ltr'\}/);
  assert.match(source, /role="tablist"/);
  assert.match(source, /aria-selected=/);
  assert.match(source, /dir="ltr"/);
  assert.match(styles, /border-inline-start/);
  assert.match(styles, /@media \(max-width: 760px\)/);
  assert.match(styles, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /prefers-reduced-motion/);
});

test('reception dashboard does not replace the approved patient-file styles', () => {
  assert.doesNotMatch(styles, /patient-file-/);
  assert.match(source, /import RoleHero/);
  assert.match(source, /<RoleHero role="reception" lang=\{lang\} \/>/);
});

test('patient searches are debounced and ignore stale responses', () => {
  assert.match(source, /createLatestSearchScheduler/);
  assert.match(source, /directorySearchSchedulerRef/);
  assert.match(source, /billingSearchSchedulerRef/);
  assert.match(source, /walkInSearchSchedulerRef/);
  assert.match(source, /visiblePatientDirectory/);
});

test('insurance billing preview is server-authoritative and exposes patient responsibility', () => {
  assert.match(source, /\/api\/billing\/insurance-preview/);
  assert.match(source, /insuranceCompanyId:\s*insuranceCompanyId \|\| null/);
  assert.match(source, /insurancePreview\.data\.grossTotalSdg/);
  assert.match(source, /insurancePreview\.data\.insuranceCoverageSdg/);
  assert.match(source, /insurancePreview\.data\.patientShareSdg/);
  assert.match(source, /تغطية التأمين/);
  assert.match(source, /Insurance coverage/);
  assert.match(source, /المطلوب من المريض/);
  assert.match(source, /Patient amount due/);
  assert.match(source, /requestedPaymentTotal > authoritativePatientShare/);
  assert.match(source, /issuedBillingInvoice/);
  assert.match(source, /selectedLabBillingOrder \|\| issuedBillingInvoice/);
  assert.match(styles, /\.reception-billing-summary/);
});
