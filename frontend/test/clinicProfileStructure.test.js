import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const panel = fs.readFileSync(new URL('../src/features/admin/ClinicProfilePanel.jsx', import.meta.url), 'utf8');
const dashboard = fs.readFileSync(new URL('../src/features/admin/AdminDashboard.jsx', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../src/features/admin/clinicProfile.css', import.meta.url), 'utf8');
const translations = fs.readFileSync(new URL('../src/i18n.js', import.meta.url), 'utf8');

test('clinic profile does not invent unsupported identity or financial edit controls', () => {
  assert.doesNotMatch(dashboard, /vatPercent|stampDutySdg|exchangeRate|Clinic Global Settings/);
  assert.doesNotMatch(panel, /<input|<form/);
  assert.doesNotMatch(panel, />\s*(?:15|500|1500)\s*</);
  assert.match(panel, /clinicProfileReadOnlyTitle/);
  assert.match(panel, /clinicProfileReadOnlyDescription/);
});

test('facility profile presents confirmed capabilities and reads configured display identity', () => {
  for (const key of ['clinicIdentityTitle', 'clinicProfileLanguages', 'clinicProfileCurrency', 'clinicProfileSecurity', 'clinicProfileBilling', 'clinicProfileAccess', 'clinicProfileAudit']) assert.match(panel, new RegExp(key));
  assert.match(panel, /useFacilityBranding/);
  assert.match(panel, /branding\.displayNameAr/);
  assert.match(panel, /branding\.displayNameEn/);
  assert.match(dashboard, /ClinicProfilePanel.*onNavigate/);
});

test('clinic profile is bilingual, direction-aware, and responsive', () => {
  assert.match(panel, /dir=\{lang === 'ar' \? 'rtl' : 'ltr'\}/);
  assert.match(translations, /clinicProfileTitle:'الملف التعريفي للمنشأة'/);
  assert.match(translations, /clinicProfileTitle:'Facility Profile'/);
  assert.match(styles, /grid-template-columns:repeat\(3/);
  assert.match(styles, /@media\(max-width:1000px\)/);
  assert.match(styles, /@media\(max-width:600px\)/);
  assert.doesNotMatch(styles, /sidebar/);
});

test('facility profile links only to existing admin configuration sections', () => {
  for (const tab of ['clinic-setup', 'pricing', 'users', 'logs']) assert.match(panel, new RegExp(`onNavigate\\('${tab}'\\)`));
  assert.match(app, /user.role ===/);
  assert.match(translations, /clinicProfileReadOnly:'للقراءة فقط'/);
  assert.match(translations, /clinicProfileReadOnly:'Read only'/);
});
