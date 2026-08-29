import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = (relative) => readFileSync(path.join(root, relative), 'utf8');

test('doctor workspace preserves the role hero and renders authoritative daily metrics', () => {
  const dashboard = source('src/features/doctor/DoctorDashboard.jsx');
  assert.match(dashboard, /<RoleHero role="doctor" lang=\{lang\}\/>/);
  assert.match(dashboard, /doctor-daily-summary/);
  assert.match(dashboard, /item\.status === 'CHECKED_IN' && item\.consultationReady/);
  assert.match(dashboard, /queue\.filter\(\(item\) => item\.status === 'IN_CONSULTATION'\)/);
  assert.match(dashboard, /queue\.filter\(\(item\) => item\.status === 'COMPLETED'\)/);
  assert.match(dashboard, /queue\.filter\(\(item\) => item\.status === 'WAITING_LAB'\)/);
});

test('doctor queue has date controls, accessible patient cards, selection, and compact empty state', () => {
  const dashboard = source('src/features/doctor/DoctorDashboard.jsx');
  assert.match(dashboard, /className="doctor-queue-panel"/);
  assert.match(dashboard, /type="date" value=\{filterDate\}/);
  assert.match(dashboard, /onClick=\{\(\) => handlePatientSelect\(appt\)\}/);
  assert.match(dashboard, /aria-pressed=\{selectedAppointmentId === appt\.id\}/);
  assert.match(dashboard, /لا يوجد مرضى في طابورك لهذا اليوم/);
  assert.match(dashboard, /There are no patients in your queue for this day/);
});

test('selected patient context keeps MRN isolation and Patient File integration', () => {
  const dashboard = source('src/features/doctor/DoctorDashboard.jsx');
  assert.match(dashboard, /className="doctor-patient-context"/);
  assert.match(dashboard, /className="doctor-mrn" dir="ltr"/);
  assert.match(dashboard, /setViewingProfilePatientId\(selectedPatient\.id\)/);
  assert.match(dashboard, /<PatientProfileModal/);
  assert.match(dashboard, /فتح ملف المريض/);
  assert.match(dashboard, /Open Patient File/);
});

test('clinical workflow retains vitals, assessment, prescription, lab, and completion controls', () => {
  const dashboard = source('src/features/doctor/DoctorDashboard.jsx');
  for (const id of ['doctor-vital-bp', 'doctor-vital-heart-rate', 'doctor-vital-temperature', 'doctor-vital-weight', 'doctor-symptoms', 'doctor-diagnosis', 'doctor-treatment', 'doctor-clinical-notes']) {
    assert.match(dashboard, new RegExp(`id="${id}"`));
  }
  assert.match(dashboard, /<MedicineCombobox medicines=\{drugs\}/);
  assert.match(dashboard, /doctor-custom-medicine/);
  assert.match(dashboard, /doctor-lab-order-card/);
  assert.match(dashboard, /handleToggleTest\(svc\.id\)/);
  assert.match(dashboard, /onClick=\{handleSaveConsultation\}/);
  assert.match(dashboard, /disabled=\{isSavingConsultation \|\| isReadOnlyVisit\}/);
});

test('doctor layout is RTL-aware, responsive, and avoids fixed-width page overflow', () => {
  const dashboard = source('src/features/doctor/DoctorDashboard.jsx');
  const css = source('src/features/doctor/doctorDashboard.css');
  assert.match(dashboard, /dir=\{lang === 'ar' \? 'rtl' : 'ltr'\}/);
  assert.match(css, /grid-template-columns: minmax\(250px, \.36fr\) minmax\(0, 1fr\)/);
  assert.match(css, /@media \(max-width: 860px\)[\s\S]*flex-direction: column/);
  assert.match(css, /@media \(max-width: 620px\)[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /overflow-x: clip/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(css, /min-width:\s*\d{4,}px/);
});
