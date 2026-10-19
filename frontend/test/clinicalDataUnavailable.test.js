import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = (relative) => readFileSync(path.join(root, relative), 'utf8');

test('doctor reads existing clinical data before changing appointment state or filling editable fields', () => {
  const dashboard = source('src/features/doctor/DoctorDashboard.jsx');
  const start = dashboard.indexOf('const handlePatientSelect = async (appt) =>');
  const end = dashboard.indexOf('const focusClinicalField =', start);
  const handler = dashboard.slice(start, end);
  const summaryRead = handler.indexOf('fetchWithAuth(`/api/records/${appt.id}/summary`)');
  const stateMutation = handler.indexOf("fetchWithAuth(`/api/appointments/${appt.id}/status`");
  const formPopulate = handler.indexOf('setSymptoms(existingSummary.symptoms || \'\')');
  assert.ok(summaryRead >= 0 && stateMutation > summaryRead && formPopulate > stateMutation);
  assert.match(handler, /error\.code = apiError\?\.code/);
  assert.match(handler, /Clinical information for this visit is unavailable\. The visit was not opened for editing\./);
});

test('clinical views show an unavailable state and keep printable or editable content gated on a successful read', () => {
  const modal = source('src/features/clinical/ClinicalModals.jsx');
  const patientPage = source('src/features/patient-dashboard/PatientPages.jsx');
  assert.match(modal, /setLoadedProfile\(null\)/);
  assert.match(modal, /Clinical information is unavailable\./);
  assert.match(modal, /if \(!summary\)/);
  assert.ok(modal.indexOf('if (!summary)') < modal.indexOf('onClick={() => window.print()}'));
  assert.match(patientPage, /detailError \? \(/);
  assert.match(patientPage, /error=\{error\}/);
});

test('email summary UI surfaces the sanitized read failure and explicitly confirms no email was sent', () => {
  const modal = source('src/features/clinical/ClinicalModals.jsx');
  assert.match(modal, /apiError\?\.code === 'CLINICAL_DATA_UNREADABLE'/);
  assert.match(modal, /Clinical information is unavailable\. No email was sent\./);
  assert.match(modal, /apiError\?\.message \|\| errData\.error/);
});
