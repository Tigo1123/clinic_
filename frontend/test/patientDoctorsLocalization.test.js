import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  doctorMatchesDirectorySearch,
  doctorSpecialtyKey,
  doctorSpecialtyOptions,
  localizeDoctorSpecialty
} from '../src/features/patient/portal/doctorSpecialty.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = (relative) => readFileSync(path.join(root, relative), 'utf8');
const patientPagesSource = () => readdirSync(path.join(root, 'src/features/patient/portal/pages')).filter((file) => file.endsWith('.jsx')).sort().map((file) => source(`src/features/patient/portal/pages/${file}`)).join('\n');
const doctors = [
  { id: 'cardio', fullNameAr: 'د. أحمد', fullNameEn: 'Dr Ahmed', specialtyAr: 'Cardiology', specialtyEn: 'Cardiology', consultationFee: 1500 },
  { id: 'peds', fullNameAr: 'د. سارة', fullNameEn: 'Dr Sara', specialtyAr: '', specialtyEn: 'Pediatrics', consultationFee: 1200 },
  { id: 'general', fullNameAr: 'د. علي', fullNameEn: 'Dr Ali', specialtyAr: 'طب عام', specialtyEn: 'General Practice', consultationFee: 1000 }
];

test('known specialties render consistently in Arabic and English', () => {
  assert.equal(localizeDoctorSpecialty(doctors[0], 'ar'), 'أمراض القلب');
  assert.equal(localizeDoctorSpecialty(doctors[0], 'en'), 'Cardiology');
  assert.equal(localizeDoctorSpecialty(doctors[1], 'ar'), 'طب الأطفال');
  assert.equal(localizeDoctorSpecialty(doctors[1], 'en'), 'Pediatrics');
  assert.equal(localizeDoctorSpecialty(doctors[2], 'ar'), 'طب عام');
  assert.equal(localizeDoctorSpecialty(doctors[2], 'en'), 'General Medicine');
});

test('localized specialty search preserves English and doctor-name matching', () => {
  assert.equal(doctorMatchesDirectorySearch(doctors[0], 'أمراض القلب'), true);
  assert.equal(doctorMatchesDirectorySearch(doctors[0], 'قلب'), true);
  assert.equal(doctorMatchesDirectorySearch(doctors[0], 'Cardiology'), true);
  assert.equal(doctorMatchesDirectorySearch(doctors[0], 'أحمد'), true);
  assert.equal(doctorMatchesDirectorySearch(doctors[0], 'Sara'), false);
});

test('localized filter labels retain canonical filtering keys', () => {
  const arabic = doctorSpecialtyOptions(doctors, 'ar');
  assert.deepEqual(arabic.map((option) => option.label), ['أمراض القلب', 'طب الأطفال', 'طب عام']);
  assert.equal(doctorSpecialtyKey(doctors[0]), 'CARDIOLOGY');
  assert.equal(doctors.filter((doctor) => doctorSpecialtyKey(doctor) === 'CARDIOLOGY')[0].id, 'cardio');
});

test('unknown specialties safely retain stored labels', () => {
  const unknown = { specialtyAr: '', specialtyEn: 'Clinical Genetics' };
  assert.equal(localizeDoctorSpecialty(unknown, 'ar'), 'Clinical Genetics');
  assert.equal(localizeDoctorSpecialty(unknown, 'en'), 'Clinical Genetics');
});

test('Doctors page uses localized UI while preserving names, fees, details, and booking routes', () => {
  const page = patientPagesSource();
  const i18n = ['src/i18n.js', 'src/locales/ar.js', 'src/locales/en.js'].map(source).join('\n');
  assert.match(i18n, /searchDoctors: 'ابحث عن طبيب'/);
  assert.match(i18n, /searchDoctors: 'Search doctors'/);
  assert.match(page, /placeholder=\{t\('searchDoctors'\)\}/);
  assert.match(page, /localizeDoctorSpecialty\(doctor, language\)/);
  assert.match(page, /doctorName\(doctor, i18n\.language\)/);
  assert.match(page, /doctor\.consultationFee/);
  assert.match(page, /to=\{`\/patient\/doctors\/\$\{doctor\.id\}`\}/);
  assert.match(page, /to=\{`\/patient\/book\/\$\{doctor\.id\}`\}/);
  assert.match(page, /dir=\{language === 'ar' \? 'rtl' : 'ltr'\}/);
});
