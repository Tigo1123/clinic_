import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { brandingSubline, DEFAULT_BRANDING, normalizeBrandingConfig } from '../src/app/branding/brandingConfig.js';

test('branding defaults and per-language facility fallbacks use Shifa identity', () => {
  assert.equal(normalizeBrandingConfig().displayNameAr, 'شفاء');
  assert.equal(normalizeBrandingConfig().displayNameEn, 'Shifa');
  assert.equal(normalizeBrandingConfig({ facilityNameAr: 'مركز الاختبار' }).displayNameAr, 'مركز الاختبار');
  assert.equal(normalizeBrandingConfig({ facilityNameAr: 'مركز الاختبار' }).displayNameEn, 'Shifa');
  assert.equal(DEFAULT_BRANDING.productDescriptorEn, 'Healthcare Facility Management System');
  assert.equal(brandingSubline(normalizeBrandingConfig(), 'en'), 'Healthcare Facility Management System');
  assert.equal(brandingSubline(normalizeBrandingConfig({ facilityNameEn: 'Test Facility' }), 'en'), 'Shifa · Healthcare Facility Management System');
});

test('facility names containing markup characters render as text, never executable markup', () => {
  const name = 'Care & <Partners> "West"';
  const branding = normalizeBrandingConfig({ facilityNameEn: name });
  const output = renderToStaticMarkup(React.createElement('h1', null, branding.displayNameEn));
  assert.equal(output, '<h1>Care &amp; &lt;Partners&gt; &quot;West&quot;</h1>');
});

test('shared UI, billing, prescription, report, and print identity consumer uses central names', () => {
  const identity = fs.readFileSync(new URL('../src/components/FacilityIdentityLine.jsx', import.meta.url), 'utf8');
  const clinicalPrint = fs.readFileSync(new URL('../src/features/clinical/ClinicalModals.jsx', import.meta.url), 'utf8');
  const reception = fs.readFileSync(new URL('../src/features/reception/ReceptionDashboard.jsx', import.meta.url), 'utf8');
  const doctor = fs.readFileSync(new URL('../src/features/doctor/DoctorDashboard.jsx', import.meta.url), 'utf8');
  const reports = fs.readFileSync(new URL('../src/features/admin/AnalyticsPanel.jsx', import.meta.url), 'utf8');
  assert.match(identity, /branding\.displayNameAr/);
  assert.match(identity, /branding\.displayNameEn/);
  assert.match(identity, /brandingSubline/);
  assert.match(identity, /dir=\{isArabic \? 'rtl' : 'ltr'\}/);
  assert.match(clinicalPrint, /<FacilityIdentityLine language=\{lang\}/);
  assert.match(reception, /<FacilityIdentityLine language=\{lang\}/);
  assert.match(doctor, /<FacilityIdentityLine language=\{lang\}/);
  assert.match(reports, /<FacilityIdentityLine language=\{lang\}/);
});
