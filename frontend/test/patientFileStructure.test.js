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
  assert.match(panel, /profile\?\.availableSections/);
  assert.match(panel, /profile\.summaryCounts/);
  assert.match(panel, /localizedStatus/);
  assert.match(panel, /profile\.prescriptions/);
  assert.match(panel, /profile\.laboratory/);
  assert.match(panel, /السجلات الطبية/);
  assert.match(panel, /Medical Records/);
  assert.match(panel, /\['overview', 'visits', 'appointments', 'prescriptions', 'laboratory', 'billing'\]/);
});

test('patient file layout is responsive and avoids UUID-first identity', () => {
  assert.match(styles, /patient-file-number/);
  assert.match(styles, /@media \(max-width: 560px\)/);
  assert.doesNotMatch(panel, /Patient ID:/);
  assert.doesNotMatch(panel, /profile\.id/);
  assert.match(panel, /lang === 'ar'/);
  assert.match(panel, /lang === 'ar' \? 'ملف المريض' : 'Patient File'/);
  assert.match(styles, /overflow-x:\s*auto/);
  assert.match(styles, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
});

test('patient file renders bounded empty loading and error states safely', () => {
  assert.match(panel, /Loading patient profile/);
  assert.match(panel, /No appointments recorded/);
  assert.match(panel, /No prescriptions in the authorized record/);
  assert.match(panel, /No laboratory orders in the authorized record/);
  assert.match(panel, /Retry/);
  assert.match(panel, /لا توجد سجلات طبية لهذا المريض حتى الآن/);
  assert.match(panel, /No medical records are available for this patient yet/);
  assert.match(panel, /Medical records could not be loaded/);
  assert.match(panel, /onClick=\{loadProfile\}/);
});

test('authorized medical records render clinical details and tolerate missing optional fields', () => {
  assert.match(panel, /medicalRecords\.map/);
  assert.match(panel, /visit\.symptoms/);
  assert.match(panel, /visit\.diagnosis/);
  assert.match(panel, /visit\.treatment/);
  assert.match(panel, /visit\.clinicalNotes/);
  assert.match(panel, /vitals\.blood_pressure/);
  assert.match(panel, /vitals\.heart_rate/);
  assert.match(panel, /vitals\.temperature/);
  assert.match(panel, /vitals\.weight/);
  assert.match(panel, /visit\.doctor\?\.fullNameAr/);
  assert.match(panel, /profile\.appointments \|\| \[\]/);
  assert.match(panel, /prescriptionsCount/);
  assert.match(panel, /labOrdersCount/);
});

test('medical record discovery does not bypass backend clinical authorization', () => {
  assert.match(panel, /canViewMedicalRecords/);
  assert.match(panel, /authorizedSections\.includes\('visits'\)/);
  assert.match(panel, /السجلات الطبية متاحة فقط للممارسين المصرح لهم/);
  assert.match(panel, /Medical records are available only to authorized clinical practitioners/);
});

test('authorized patient file renders recorded and missing blood type safely', () => {
  assert.match(panel, /فصيلة الدم/);
  assert.match(panel, /Blood Type/);
  assert.match(panel, /profile\.bloodType \|\| \(lang === 'ar' \? 'غير مسجلة' : 'Not recorded'\)/);
  assert.match(panel, /Object\.prototype\.hasOwnProperty\.call\(profile, 'bloodType'\)/);
  assert.match(panel, /<strong dir="ltr">/);
  assert.match(styles, /patient-file-field--blood-type/);
  assert.doesNotMatch(panel, /profile\.bloodType \|\| ['"](?:A|B|AB|O)[+-]['"]/);
});

test('patient file remains mounted and inert behind a nested visit summary', () => {
  assert.match(panel, /nestedModalOpen = false/);
  assert.match(panel, /aria-hidden=\{nestedModalOpen \|\| undefined\}/);
  assert.match(panel, /inert=\{nestedModalOpen \? '' : undefined\}/);
  assert.match(panel, /event\.target === event\.currentTarget && !nestedModalOpen/);
  assert.match(panel, /onSelectSummary\(visit\.recordId \|\| visit\.id \|\| visit\.appointmentId, event\.currentTarget\)/);
});
