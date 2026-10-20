import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { transformWithOxc } from 'vite';

const dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true });
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  IS_REACT_ACT_ENVIRONMENT: true
});
const { createElement: h, act, useState } = await import('react');
const { createRoot } = await import('react-dom/client');
globalThis.clinicalIcon = () => null;
globalThis.modalUser = null;
globalThis.staffSocketMock = { on() {}, off() {} };

async function compileComponent(relativePath, replacements) {
  let source = await readFile(new URL(relativePath, import.meta.url), 'utf8');
  for (const [pattern, replacement] of replacements) source = source.replace(pattern, replacement);
  source = source.replace(/import\s+\{([^}]+)\}\s+from 'lucide-react';/, (_match, names) => names.split(',').map((name) => `const ${name.trim()} = globalThis.clinicalIcon;`).join('\n'));
  source = source.replace(/import\s+['"][^'"]+\.css['"];?/g, '');
  const compiled = await transformWithOxc(source, relativePath.split('/').at(-1), { jsx: { runtime: 'automatic' } });
  const modulePath = new URL(`.clinical-runtime-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url);
  await writeFile(modulePath, compiled.code);
  try { return await import(modulePath.href); } finally { await unlink(modulePath); }
}

const modalModules = await compileComponent('../src/features/clinical/ClinicalModals.jsx', [
  [/import \{ fetchWithAuth \} from '\.\.\/\.\.\/services\/staffApi';/, 'const fetchWithAuth = (...args) => globalThis.modalFetch(...args);'],
  [/import \{ useAuth \} from '\.\.\/\.\.\/app\/auth\/auth-context';/, 'const useAuth = () => ({ user: globalThis.modalUser });'],
  [/import \{ useFacilityBranding \} from '\.\.\/\.\.\/app\/branding\/FacilityBrandingContext\.js';/, "const useFacilityBranding = () => ({ displayNameAr: 'شفاء', displayNameEn: 'Shifa', facilityNameAr: null, facilityNameEn: null, productNameAr: 'شفاء', productNameEn: 'Shifa', productDescriptorAr: 'نظام إدارة المنشآت الصحية', productDescriptorEn: 'Healthcare Facility Management System' });"],
  [/import FacilityIdentityLine from '\.\.\/\.\.\/components\/FacilityIdentityLine';/, 'const FacilityIdentityLine = () => null;']
]);
const doctorModule = await compileComponent('../src/features/doctor/DoctorDashboard.jsx', [
  [/import \{ PatientProfileModal, PostVisitSummaryModal \} from '\.\.\/clinical\/ClinicalModals';/, 'const PatientProfileModal = () => null; const PostVisitSummaryModal = () => null;'],
  [/import \{ getWhatsAppLink \} from '\.\.\/reception\/clinicData';/, 'const getWhatsAppLink = () => "#";'],
  [/import \{ apiErrorMessage, fetchWithAuth \} from '\.\.\/\.\.\/services\/staffApi';/, 'const fetchWithAuth = (...args) => globalThis.doctorFetch(...args); const apiErrorMessage = (data, fallback) => data?.error?.message || data?.error || fallback;'],
  [/import \{ staffSocket as socket \} from '\.\.\/\.\.\/services\/staffSocket';/, 'const socket = globalThis.staffSocketMock;'],
  [/import RoleHero from '\.\.\/\.\.\/components\/healthcare\/RoleHero';/, 'const RoleHero = () => null;'],
  [/import \{ clinicDateString \} from '\.\.\/\.\.\/utils\/clinicTime';/, 'const clinicDateString = () => "2099-01-01";'],
  [/import \{ staffApiRequest as apiRequest \} from '\.\.\/\.\.\/services\/apiClient';/, 'const apiRequest = (...args) => globalThis.doctorApiRequest(...args);'],
  [/import MedicineCombobox from '\.\/MedicineCombobox';/, 'const MedicineCombobox = () => null;'],
  [/import \{ doctorPrescriptionItem, duplicatePrescriptionItem, validateDoctorPrescriptionEntry \} from '\.\.\/\.\.\/utils\/doctorPrescription';/, 'const doctorPrescriptionItem = () => ({}); const duplicatePrescriptionItem = () => false; const validateDoctorPrescriptionEntry = () => null;'],
  [/import \{ useFacilityBranding \} from '\.\.\/\.\.\/app\/branding\/FacilityBrandingContext\.js';/, "const useFacilityBranding = () => ({ displayNameAr: 'شفاء', displayNameEn: 'Shifa', facilityNameAr: null, facilityNameEn: null, productNameAr: 'شفاء', productNameEn: 'Shifa', productDescriptorAr: 'نظام إدارة المنشآت الصحية', productDescriptorEn: 'Healthcare Facility Management System' });"],
  [/import FacilityIdentityLine from '\.\.\/\.\.\/components\/FacilityIdentityLine';/, 'const FacilityIdentityLine = () => null;']
]);

let root;
let previousConsoleError;
let doctorRequests;
let modalRequests;
const reply = (data, { ok = true, status = 200 } = {}) => ({
  ok,
  status,
  headers: { get: () => 'application/json' },
  json: async () => data,
  text: async () => JSON.stringify(data)
});
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const unreadable = () => reply({ error: { code: 'CLINICAL_DATA_UNREADABLE', message: 'Clinical information is unavailable.' } }, { ok: false, status: 500 });

const patient = (id) => ({
  id: `patient-${id}`,
  fullNameEn: `Synthetic Patient ${id}`,
  fullNameAr: `مريض ${id}`,
  fileNumber: `SYN-${id}`,
  gender: 'FEMALE',
  dateOfBirth: '1990-01-01',
  phone: '+250788000000'
});
const appointment = (id, overrides = {}) => ({
  id: `visit-${id}`,
  patient: patient(id),
  status: 'IN_CONSULTATION',
  consultationReady: true,
  medicalRecordId: `record-${id}`,
  appointmentTime: '10:00',
  appointmentDate: '2099-01-01',
  ...overrides
});
const clinicalSummary = (id) => ({
  id: `record-${id}`,
  symptoms: `Synthetic symptom ${id}`,
  diagnosis: `Synthetic diagnosis ${id}`,
  treatment: `Synthetic treatment ${id}`,
  clinicalNotes: `Synthetic note ${id}`,
  vitals: {},
  labOrders: [],
  prescriptions: []
});
const profileData = (id) => ({
  id: `patient-${id}`,
  fullNameEn: `Synthetic Profile ${id}`,
  fullNameAr: `ملف ${id}`,
  fileNumber: `PROFILE-${id}`,
  gender: 'FEMALE',
  dateOfBirth: '1990-01-01',
  status: 'ACTIVE',
  availableSections: ['overview', 'visits'],
  summaryCounts: {},
  appointments: [],
  invoices: [],
  prescriptions: [],
  laboratory: [],
  visits: [{ id: `visit-${id}`, visitDate: '2099-01-01', symptoms: `Profile symptom ${id}`, diagnosis: `Profile diagnosis ${id}`, treatment: `Profile treatment ${id}`, doctor: {} }]
});
const render = async (node) => act(async () => root.render(node));
const clickButton = async (text) => {
  const button = [...document.querySelectorAll('button')].find((item) => item.textContent.includes(text));
  assert.ok(button, `button containing ${text}`);
  await act(async () => button.click());
};
const jsonResponse = (data, opts) => Promise.resolve(reply(data, opts));

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root'));
  doctorRequests = [];
  modalRequests = [];
  previousConsoleError = console.error;
  console.error = () => {};
  globalThis.doctorApiRequest = async () => [];
  globalThis.doctorFetch = async (url, options = {}) => {
    doctorRequests.push({ url, options });
    if (url.startsWith('/api/appointments/queue/')) return jsonResponse(globalThis.doctorQueue || []);
    if (url === '/api/records/drugs') return jsonResponse([]);
    if (url.startsWith('/api/patients/') && url.endsWith('/history')) return jsonResponse({ history: [] });
    return jsonResponse({});
  };
  globalThis.modalFetch = async (url, options = {}) => {
    modalRequests.push({ url, options });
    return jsonResponse({});
  };
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = null;
  console.error = previousConsoleError;
  delete globalThis.doctorQueue;
});

test('doctor keeps A labelled and editable as A when B is unreadable, and only saves to A', async () => {
  globalThis.doctorQueue = [appointment('A'), appointment('B', { status: 'CHECKED_IN', consultationReady: true })];
  globalThis.doctorFetch = async (url, options = {}) => {
    doctorRequests.push({ url, options });
    if (url.startsWith('/api/appointments/queue/')) return jsonResponse(globalThis.doctorQueue);
    if (url === '/api/records/drugs') return jsonResponse([]);
    if (url === '/api/records/visit-A/summary') return jsonResponse(clinicalSummary('A'));
    if (url === '/api/records/visit-B/summary') return unreadable();
    if (url === '/api/patients/patient-A/history') return jsonResponse({ history: [] });
    return jsonResponse({});
  };
  await render(h(doctorModule.default, { user: { doctorId: 'doctor-synthetic' }, lang: 'en', t: (key) => key }));
  await clickButton('Synthetic Patient A');
  assert.equal(document.querySelector('#doctor-diagnosis').value, 'Synthetic diagnosis A');
  await clickButton('Synthetic Patient B');
  assert.equal(document.querySelector('.doctor-patient-context h2').textContent, 'Synthetic Patient A');
  assert.equal(document.querySelector('#doctor-diagnosis').value, 'Synthetic diagnosis A');
  assert.match(document.querySelector('[role="alert"]').textContent, /unavailable.*not opened for editing/i);
  assert.equal(doctorRequests.some(({ url, options }) => url === '/api/appointments/visit-B/status' || (url === '/api/records' && JSON.parse(options.body || '{}').appointmentId === 'visit-B')), false);
  await clickButton('Complete Visit');
  const save = doctorRequests.find(({ url }) => url === '/api/records/record-A/finalize');
  assert.ok(save);
  assert.equal(JSON.parse(save.options.body).diagnosis, 'Synthetic diagnosis A');
  assert.equal(doctorRequests.some(({ url }) => url.includes('record-B') || url === '/api/records/visit-B/finalize'), false);
});

test('doctor ignores an earlier visit response after a newer visit selection succeeds', async () => {
  const a = deferred();
  globalThis.doctorQueue = [appointment('A'), appointment('B')];
  globalThis.doctorFetch = async (url, options = {}) => {
    doctorRequests.push({ url, options });
    if (url.startsWith('/api/appointments/queue/')) return jsonResponse(globalThis.doctorQueue);
    if (url === '/api/records/drugs') return jsonResponse([]);
    if (url === '/api/records/visit-A/summary') return a.promise;
    if (url === '/api/records/visit-B/summary') return jsonResponse(clinicalSummary('B'));
    return jsonResponse({ history: [] });
  };
  await render(h(doctorModule.default, { user: { doctorId: 'doctor-synthetic' }, lang: 'en', t: (key) => key }));
  await clickButton('Synthetic Patient A');
  await clickButton('Synthetic Patient B');
  assert.equal(document.querySelector('.doctor-patient-context h2').textContent, 'Synthetic Patient B');
  assert.equal(document.querySelector('#doctor-diagnosis').value, 'Synthetic diagnosis B');
  await act(async () => a.resolve(reply(clinicalSummary('A'))));
  assert.equal(document.querySelector('.doctor-patient-context h2').textContent, 'Synthetic Patient B');
  assert.equal(document.querySelector('#doctor-diagnosis').value, 'Synthetic diagnosis B');
});

test('doctor treats a missing lookup for an existing record as an error but keeps first visits available', async () => {
  globalThis.doctorQueue = [appointment('A'), appointment('FIRST', { status: 'CHECKED_IN', medicalRecordId: null })];
  globalThis.doctorFetch = async (url, options = {}) => {
    doctorRequests.push({ url, options });
    if (url.startsWith('/api/appointments/queue/')) return jsonResponse(globalThis.doctorQueue);
    if (url === '/api/records/drugs') return jsonResponse([]);
    if (url === '/api/records/visit-A/summary') return reply({ error: 'not found' }, { ok: false, status: 404 });
    return jsonResponse({});
  };
  await render(h(doctorModule.default, { user: { doctorId: 'doctor-synthetic' }, lang: 'en', t: (key) => key }));
  await clickButton('Synthetic Patient A');
  assert.equal(document.querySelector('.doctor-patient-context'), null);
  assert.match(document.querySelector('[role="alert"]').textContent, /existing clinical record could not be loaded/i);
  assert.equal(document.querySelector('button')?.textContent.includes('Complete Visit'), false);
  assert.equal(doctorRequests.some(({ url }) => url === '/api/appointments/visit-A/status'), false);

  await clickButton('Synthetic Patient FIRST');
  assert.equal(document.querySelector('.doctor-patient-context h2').textContent, 'Synthetic Patient FIRST');
  assert.equal(document.querySelector('#doctor-diagnosis').value, '');
  assert.equal(doctorRequests.some(({ url }) => url === '/api/records/visit-FIRST/summary'), false);
  assert.ok(doctorRequests.some(({ url, options }) => url === '/api/appointments/visit-FIRST/status' && options.method === 'PUT'));
});

function ProfileHarness() {
  const [patientId, setPatientId] = useState('patient-A');
  return h('div', {}, h('button', { onClick: () => setPatientId('patient-B') }, 'Switch profile'),
    h(modalModules.PatientProfileModal, { patientId, lang: 'en', onClose() {} }));
}

test('patient profile does not let a delayed A response overwrite selected B', async () => {
  const a = deferred();
  globalThis.modalFetch = async (url) => {
    modalRequests.push({ url });
    if (url.endsWith('/patient-A/profile')) return a.promise;
    if (url.endsWith('/patient-B/profile')) return jsonResponse(profileData('B'));
    return jsonResponse({});
  };
  await render(h(ProfileHarness));
  await clickButton('Switch profile');
  assert.match(document.querySelector('#patient-file-title').textContent, /Synthetic Profile B/);
  await act(async () => a.resolve(reply(profileData('A'))));
  assert.match(document.querySelector('#patient-file-title').textContent, /Synthetic Profile B/);
  assert.doesNotMatch(document.body.textContent, /Synthetic Profile A|Profile diagnosis A/);
});

test('patient profile removes A when selected B fails its clinical read', async () => {
  globalThis.modalFetch = async (url) => {
    modalRequests.push({ url });
    if (url.endsWith('/patient-A/profile')) return jsonResponse(profileData('A'));
    if (url.endsWith('/patient-B/profile')) return unreadable();
    return jsonResponse({});
  };
  await render(h(ProfileHarness));
  assert.match(document.querySelector('#patient-file-title').textContent, /Synthetic Profile A/);
  await clickButton('Switch profile');
  assert.doesNotMatch(document.body.textContent, /Synthetic Profile A|Profile diagnosis A/);
  assert.match(document.querySelector('[role="alert"]').textContent, /Clinical information is unavailable/);
});

function SummaryHarness() {
  const [summaryId, setSummaryId] = useState('record-A');
  return h('div', {}, h('button', { onClick: () => setSummaryId('record-B') }, 'Switch summary'),
    h(modalModules.PostVisitSummaryModal, { summaryId, lang: 'en', onClose() {} }));
}
const summaryResponse = (id) => ({
  ...clinicalSummary(id),
  visitDate: '2099-01-01',
  patient: { fullNameEn: `Synthetic Summary ${id}`, phone: null },
  doctor: { fullNameEn: 'Synthetic Doctor', specialtyEn: 'Synthetic specialty' }
});

test('summary hides A before loading B, shows an explicit failure, and removes print and email actions', async () => {
  globalThis.modalFetch = async (url, options = {}) => {
    modalRequests.push({ url, options });
    if (url === '/api/records/record-A/summary') return jsonResponse(summaryResponse('A'));
    if (url === '/api/records/record-B/summary') return unreadable();
    return jsonResponse({});
  };
  await render(h(SummaryHarness));
  assert.match(document.body.textContent, /Synthetic Summary A/);
  await clickButton('Switch summary');
  assert.match(document.querySelector('[role="dialog"]').textContent, /Clinical information is unavailable/);
  assert.doesNotMatch(document.body.textContent, /Synthetic Summary A|Synthetic diagnosis A/);
  assert.equal([...document.querySelectorAll('button')].some((button) => /Email Summary|Print \/ Export PDF/.test(button.textContent)), false);
  await act(async () => document.querySelector('[role="dialog"]')?.dispatchEvent(new window.Event('click', { bubbles: true })));
  assert.equal(modalRequests.some(({ url }) => url.endsWith('/send-summary')), false);
});

test('summary ignores a delayed A response after B has become current', async () => {
  const a = deferred();
  globalThis.modalFetch = async (url) => {
    modalRequests.push({ url });
    if (url === '/api/records/record-A/summary') return a.promise;
    if (url === '/api/records/record-B/summary') return jsonResponse(summaryResponse('B'));
    return jsonResponse({});
  };
  await render(h(SummaryHarness));
  await clickButton('Switch summary');
  assert.match(document.body.textContent, /Synthetic Summary B/);
  await act(async () => a.resolve(reply(summaryResponse('A'))));
  assert.match(document.body.textContent, /Synthetic Summary B/);
  assert.doesNotMatch(document.body.textContent, /Synthetic Summary A|Synthetic diagnosis A/);
});
