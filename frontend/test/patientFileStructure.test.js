import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const panel = fs.readFileSync(new URL('../src/features/clinical/ClinicalModals.jsx', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../src/features/clinical/patientFile.css', import.meta.url), 'utf8');

test('patient file presents immutable MRN and role-aware sections', () => {
  assert.match(panel, /profile\.fileNumber/);
  assert.match(panel, /Copy file number|نسخ رقم الملف/);
  assert.match(panel, /appointments/);
  assert.match(panel, /billing/);
  assert.match(panel, /user\?\.role === 'DOCTOR'/);
  assert.match(panel, /profile\.availableSections/);
  assert.match(panel, /profile\.summaryCounts/);
  assert.match(panel, /localizedStatus/);
  assert.match(panel, /profile\.prescriptions/);
  assert.match(panel, /profile\.laboratory/);
});

test('patient file layout is responsive and avoids UUID-first identity', () => {
  assert.match(styles, /patient-file-number/);
  assert.match(styles, /@media \(max-width: 560px\)/);
  assert.doesNotMatch(panel, /Patient ID:/);
  assert.doesNotMatch(panel, /profile\.id/);
  assert.match(panel, /lang === 'ar'/);
  assert.match(panel, /lang === 'ar' \? 'ملف المريض' : 'Patient File'/);
  assert.match(styles, /overflow-x: auto/);
  assert.match(styles, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
});

test('patient file renders bounded empty loading and error states safely', () => {
  assert.match(panel, /Loading patient profile/);
  assert.match(panel, /No appointments recorded/);
  assert.match(panel, /No prescriptions in the authorized record/);
  assert.match(panel, /No laboratory orders in the authorized record/);
  assert.match(panel, /Retry/);
});
