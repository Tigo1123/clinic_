import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { doctorPrescriptionItem, duplicatePrescriptionItem, searchDoctorMedicines } from '../src/utils/doctorPrescription.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = (relative) => readFileSync(path.join(root, relative), 'utf8');
const medicines = [
  { id: 'panadol', brandName: 'Panadol', labelAr: 'بنادول', labelEn: 'Panadol', genericName: 'Paracetamol', strength: '500 mg', dosageForm: 'Tablet' },
  { id: 'amox', brandName: 'Amoxil', labelAr: 'أموكسيل', labelEn: 'Amoxil', genericName: 'Amoxicillin', strength: '250 mg', dosageForm: 'Capsule' }
];

test('doctor medicine search matches brand, Arabic, English, generic, and strength', () => {
  for (const query of ['Panadol', 'بنادول', 'panadol', 'paracetamol', '500 mg']) {
    assert.deepEqual(searchDoctorMedicines(medicines, query).map((item) => item.id), ['panadol']);
  }
  assert.deepEqual(searchDoctorMedicines(medicines, 'amoxicillin').map((item) => item.id), ['amox']);
  assert.deepEqual(searchDoctorMedicines(medicines, 'missing'), []);
});

test('official and custom prescription payloads remain backend compatible and allow-listed', () => {
  const form = { dosage: ' 1x2 daily ', duration: ' 5 Days ', instructionsAr: ' بعد الطعام ', instructionsEn: ' After food ', quantity: '10', customDrugName: '' };
  const official = doctorPrescriptionItem(medicines[0], form);
  assert.deepEqual(official, {
    drugId: 'panadol', nameAr: 'بنادول', nameEn: 'Panadol',
    dosage: '1x2 daily', duration: '5 Days', instructionsAr: 'بعد الطعام', instructionsEn: 'After food', qtyPrescribed: 10
  });
  const custom = doctorPrescriptionItem(null, { ...form, customDrugName: ' Special medicine ' });
  assert.equal(custom.customDrugName, 'Special medicine');
  assert.equal('drugId' in custom, false);
  for (const forbidden of ['unitPriceSdg', 'status', 'identityKey', 'usableStock', 'actorUserId']) assert.equal(forbidden in official, false);
});

test('duplicate official and custom entries are detected while edit can exclude itself', () => {
  const official = doctorPrescriptionItem(medicines[0], { dosage: '1', duration: '1', instructionsAr: '', instructionsEn: '', quantity: 1, customDrugName: '' });
  const custom = doctorPrescriptionItem(null, { dosage: '1', duration: '1', instructionsAr: '', instructionsEn: '', quantity: 1, customDrugName: 'Rest' });
  assert.equal(duplicatePrescriptionItem([official], official), true);
  assert.equal(duplicatePrescriptionItem([official], official, 0), false);
  assert.equal(duplicatePrescriptionItem([custom], { ...custom, customDrugName: ' rest ' }), true);
});

test('doctor prescription UI uses accessible combobox without formulary chip cloud', () => {
  const dashboard = source('src/features/doctor/DoctorDashboard.jsx');
  const combobox = source('src/features/doctor/MedicineCombobox.jsx');
  assert.match(dashboard, /<MedicineCombobox medicines=\{drugs\}/);
  assert.doesNotMatch(dashboard, /drugs\.slice\(0, 10\)\.map/);
  assert.doesNotMatch(dashboard, /<select[\s\S]{0,300}drugs\.map/);
  assert.match(combobox, /role="combobox"/);
  assert.match(combobox, /role="listbox"/);
  assert.match(combobox, /role="option"/);
  assert.match(combobox, /ArrowDown/);
  assert.match(combobox, /ArrowUp/);
  assert.match(combobox, /event\.key === 'Enter'/);
  assert.match(combobox, /event\.key === 'Escape'/);
  assert.match(combobox, /\.slice\(0, 30\)/);
});

test('selected medicines support display, edit, remove, and pharmacist-reviewed custom path', () => {
  const dashboard = source('src/features/doctor/DoctorDashboard.jsx');
  assert.match(dashboard, /doctor-prescribed-card/);
  assert.match(dashboard, /handleEditPrescriptionItem\(item, index\)/);
  assert.match(dashboard, /handleRemovePrescriptionItem\(index\)/);
  assert.match(dashboard, /دواء غير موجود \/ كتابة يدوية/);
  assert.match(dashboard, /سيُرسل هذا الدواء إلى الصيدلي للمراجعة/);
  assert.match(dashboard, /customDrugName/);
  assert.match(dashboard, /prescribedDrugs: prescribedItems/);
});

test('prescription styles preserve RTL, responsive layout, focus, and readable technical values', () => {
  const dashboard = source('src/features/doctor/DoctorDashboard.jsx');
  const css = source('src/App.css');
  assert.match(dashboard, /doctor-rx-instructions-ar[\s\S]{0,180}dir="rtl"/);
  assert.match(dashboard, /doctor-rx-instructions-en[\s\S]{0,180}dir="ltr"/);
  assert.match(css, /doctor-prescription-fields/);
  assert.match(css, /@media \(max-width: 680px\)[\s\S]*doctor-medicine-mode, \.doctor-prescription-fields/);
  assert.match(css, /doctor-medicine-option:hover, \.doctor-medicine-option\.is-active/);
});

test('doctor UI exposes no price, status, or stock mutation authority', () => {
  const dashboard = source('src/features/doctor/DoctorDashboard.jsx');
  const combobox = source('src/features/doctor/MedicineCombobox.jsx');
  assert.doesNotMatch(`${dashboard}\n${combobox}`, /name="(unitPriceSdg|status|qtyOnHand)"/);
  assert.doesNotMatch(combobox, /unitPriceSdg|price|method: ['"](POST|PATCH|PUT|DELETE)/);
  assert.match(dashboard, /fetchWithAuth\('\/api\/records\/drugs'\)/);
});
