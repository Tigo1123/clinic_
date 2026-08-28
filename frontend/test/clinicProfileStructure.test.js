import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const panel = fs.readFileSync(new URL('../src/features/admin/ClinicProfilePanel.jsx', import.meta.url), 'utf8');
const dashboard = fs.readFileSync(new URL('../src/features/admin/AdminDashboard.jsx', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../src/features/admin/clinicProfile.css', import.meta.url), 'utf8');
const translations = fs.readFileSync(new URL('../src/i18n.js', import.meta.url), 'utf8');

test('clinic profile removes decorative financial configuration and all edit affordances', () => {
  assert.doesNotMatch(dashboard, /vatPercent|stampDutySdg|exchangeRate|Clinic Global Settings/);
  assert.doesNotMatch(panel, /<input|<form|Save|Edit|حفظ|تعديل/);
  assert.doesNotMatch(panel, />\s*(?:15|500|1500)\s*</);
});

test('clinic profile presents only confirmed capabilities and keeps identity static', () => {
  for (const key of ['clinicIdentityTitle', 'clinicProfileLanguages', 'clinicProfileCurrency', 'clinicProfileSecurity', 'clinicProfileBilling', 'clinicProfileAccess', 'clinicProfileAudit']) assert.match(panel, new RegExp(key));
  assert.match(dashboard, /<ClinicProfilePanel lang=\{lang\} t=\{t\}\/>/);
});

test('clinic profile is bilingual, direction-aware, and responsive', () => {
  assert.match(panel, /dir=\{lang === 'ar' \? 'rtl' : 'ltr'\}/);
  assert.match(translations, /clinicProfileTitle:'الملف التعريفي للعيادة'/);
  assert.match(translations, /clinicProfileTitle:'Clinic Profile'/);
  assert.match(styles, /grid-template-columns:repeat\(3/);
  assert.match(styles, /@media\(max-width:1000px\)/);
  assert.match(styles, /@media\(max-width:600px\)/);
  assert.doesNotMatch(styles, /sidebar/);
});
