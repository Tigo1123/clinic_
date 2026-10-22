import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { transformWithOxc } from 'vite';

const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
const { createElement, act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { MemoryRouter, Routes, Route } = await import('react-router-dom');
let source = await readFile(new URL('../src/features/patient-dashboard/PatientPages.jsx', import.meta.url), 'utf8');
source = source
  .replace(/import \{ useTheme \}[^;]+;/, "const useTheme = () => ({ theme: 'light' });")
  .replace(/import PasswordField[^;]+;/, 'const PasswordField = ({label,value,onChange,name,autoComplete}) => <label>{label}<input name={name} aria-label={label} value={value} onChange={onChange} type="password" autoComplete={autoComplete}/></label>;')
  .replace(/import \{ clearPatientSession \}[^;]+;/, 'const clearPatientSession = () => {};')
  .replace(/import \{ useTranslation \}[^;]+;/, "const useTranslation = () => ({ t: key => key, i18n: { language: globalThis.portalTestLanguage || 'en' } });")
  .replace(/import \{ patientApiRequest as apiRequest \}[^;]+;/, 'const apiRequest = (...args) => globalThis.portalTestApi(...args);')
  .replace(/import StatusBadge[^;]+;/, 'const StatusBadge = ({status}) => <span>{status}</span>;')
  .replace(/import \{ GoogleIdentityButton \}[^;]+;/, 'const GoogleIdentityButton = () => null;')
  .replace(/import Dialog[^;]+;/, 'const Dialog = ({open, children, onClose}) => open ? <section role="dialog">{children}<button onClick={onClose}>Close dialog</button></section> : null;')
  .replace(/import \{ EmptyState, ErrorState, Skeleton \}[^;]+;/, 'const Skeleton = () => <div role="status">Loading</div>; const ErrorState = ({message}) => <div role="alert">{message}</div>; const EmptyState = ({title}) => <div>{title}</div>;')
  .replace(/from '\.\.\/\.\.\/utils\/([^']+)'/g, "from '../src/utils/$1.js'");
const compiled = await transformWithOxc(source, 'PatientPages.jsx', { jsx: { runtime: 'automatic' } });
const file = new URL(`.portal-interactions-${process.pid}.mjs`, import.meta.url);
await writeFile(file, compiled.code);
let pages;
try { pages = await import(file.href); } finally { await unlink(file); }
let rescheduleSource = await readFile(new URL('../src/features/appointments/RescheduleAppointment.jsx', import.meta.url), 'utf8');
rescheduleSource = rescheduleSource
  .replace(/import \{ useTranslation \}[^;]+;/, "const useTranslation = () => ({ t: key => key });")
  .replace(/import \{ patientApiRequest as apiRequest \}[^;]+;/, 'const apiRequest = (...args) => globalThis.portalTestApi(...args);')
  .replace(/import \{ ErrorState, Skeleton \}[^;]+;/, 'const Skeleton = () => <div role="status">Loading</div>; const ErrorState = ({message}) => <div role="alert">{message}</div>;')
  .replace("from '../../utils/clinicTime'", "from '../src/utils/clinicTime.js'");
const rescheduleFile = new URL(`.portal-reschedule-${process.pid}.mjs`, import.meta.url);
await writeFile(rescheduleFile, (await transformWithOxc(rescheduleSource, 'RescheduleAppointment.jsx', { jsx: { runtime: 'automatic' } })).code);
let RescheduleAppointment;
try { RescheduleAppointment = (await import(rescheduleFile.href)).default; } finally { await unlink(rescheduleFile); }
let root;
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
async function mount(Page, route = '/patient') {
  root = createRoot(document.getElementById('root'));
  await act(async () => root.render(createElement(MemoryRouter, { initialEntries: [route] }, createElement(Routes, null, createElement(Route, { path: '/patient/book/:doctorId', element: createElement(Page) }), createElement(Route, { path: '/patient/appointments/:id/reschedule', element: createElement(Page) }), createElement(Route, { path: '/patient', element: createElement(Page) })))));
}
async function click(element) { await act(async () => element.click()); }
afterEach(async () => { if (root) await act(async () => root.unmount()); root = null; delete globalThis.portalTestApi; delete globalThis.portalTestLanguage; });

test('booking discards late slot responses, clears old selections, and blocks submission after slot errors', async () => {
  const requests = [];
  globalThis.portalTestApi = () => { const request = deferred(); requests.push(request); return request.promise; };
  await mount(pages.BookAppointment, '/patient/book/doctor-fixture');
  await click(document.querySelectorAll('.date-chip')[0]);
  await click(document.querySelectorAll('.date-chip')[1]);
  assert.equal(requests.length, 2);
  await act(async () => requests[1].resolve(['14:00']));
  await act(async () => requests[0].resolve(['09:00']));
  assert.deepEqual([...document.querySelectorAll('.slot-chip')].map(node => node.textContent), ['14:00']);
  await click(document.querySelector('.slot-chip'));
  assert.equal(document.querySelector('form>button').disabled, false);
  await click(document.querySelectorAll('.date-chip')[2]);
  assert.equal(document.querySelector('form>button').disabled, true);
  assert.equal(document.querySelectorAll('.slot-chip').length, 0);
  await act(async () => requests[2].reject(new Error('Slots unavailable')));
  assert.equal(document.querySelector('[role=alert]').textContent, 'Slots unavailable');
  assert.equal(document.querySelector('form>button').disabled, true);
});

test('closing a loading record does not reopen it when its response arrives', async () => {
  const detail = deferred();
  globalThis.portalTestApi = path => path.endsWith('/medical-records')
    ? Promise.resolve([{ id: 'record-fixture', visitDate: '2026-10-01', doctor: {}, diagnosis: 'Follow-up' }])
    : detail.promise;
  await mount(pages.MedicalRecords);
  await click(document.querySelector('.medical-record-card'));
  assert.ok(document.querySelector('[role=dialog]'));
  await click([...document.querySelectorAll('button')].find(button => button.textContent === 'Close dialog'));
  await act(async () => detail.resolve({ id: 'record-fixture', visitDate: '2026-10-01', doctor: {}, prescriptions: [], releasedLabResults: [] }));
  assert.equal(document.querySelector('[role=dialog]'), null);
});

test('rescheduling ignores late availability from a previously selected date', async () => {
  const requests = [];
  globalThis.portalTestApi = path => {
    if (path.startsWith('/api/patient/appointments/')) return Promise.resolve({ doctor: { id: 'doctor-fixture' }, appointmentDate: '2026-11-01' });
    const request = deferred(); requests.push(request); return request.promise;
  };
  await mount(RescheduleAppointment, '/patient/appointments/appointment-fixture/reschedule');
  await act(async () => {
    const input = document.querySelector('input[type=date]');
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, '2026-11-02');
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
  assert.equal(requests.length, 2);
  await act(async () => requests[1].resolve(['14:00']));
  await act(async () => requests[0].resolve(['09:00']));
  assert.deepEqual([...document.querySelectorAll('fieldset button')].map(button => button.textContent), ['14:00']);
  assert.equal(document.querySelector('form>button').disabled, true);
});

test('prescriptions display custom medicines without a formulary object', async () => {
  globalThis.portalTestApi = async () => [{ id: 'rx', prescriptionDate: '2026-10-01', medicines: [{ id: 'custom', medicine: null, customDrugName: 'Custom medication', dosage: '5 mg', duration: '3 days' }] }];
  await mount(pages.Prescriptions);
  assert.match(document.body.textContent, /Custom medication.*5 mg.*3 days/);
});

test('record details preserve zero values and zero reference-range bounds', async () => {
  globalThis.portalTestApi = async path => path.endsWith('/medical-records')
    ? [{ id: 'zero-record', visitDate: '2026-10-01', doctor: {} }]
    : { id: 'zero-record', visitDate: '2026-10-01', doctor: {}, vitalSigns: { temperature: 0 }, prescriptions: [], releasedLabResults: [{ id: 'zero-result', testNameEn: 'Zero result', resultValue: 0, referenceRangeMin: 0, referenceRangeMax: 100 }] };
  await mount(pages.MedicalRecords);
  await click(document.querySelector('.medical-record-card'));
  assert.equal(document.querySelector('.medical-vitals-grid strong').textContent, '0');
  assert.match(document.querySelector('[role=dialog]').textContent, /0 – 100/);
});

test('dashboard displays only the first name and disables booking when no doctors exist', async () => {
  const requests = [];
  globalThis.portalTestApi = async (path, options) => {
    requests.push({ path, options });
    return path === '/api/patient/me' ? { firstNameEn: 'Tag', fullNameEn: 'Tag Mohamed Ahmed' } : [];
  };
  await mount(pages.Dashboard);
  assert.match(document.querySelector('h1').textContent, /, Tag$/);
  assert.doesNotMatch(document.querySelector('h1').textContent, /Mohamed|Ahmed/);
  const booking = [...document.querySelectorAll('button')].find(button => button.textContent === 'dashboardBookAppointment');
  assert.equal(booking.disabled, true);
  assert.equal(document.getElementById(booking.getAttribute('aria-describedby')).textContent, 'dashboardBookingUnavailable');
  assert.match(document.body.textContent, /dashboardNoDoctorsHelp/);
  assert.equal(document.querySelectorAll('.health-summary-card').length, 4);
  assert.equal(document.querySelectorAll('.patient-dashboard__activity').length, 0);
  assert.ok(requests.every(request => !request.options?.method || request.options.method === 'GET'));
});

test('dashboard renders real activity and working booking links without inventing notifications', async () => {
  globalThis.portalTestApi = async path => {
    if (path.endsWith('/me')) return { fullNameEn: 'Tag Mohamed Ahmed' };
    if (path.endsWith('/doctors')) return [{ id: 'doctor-fixture' }];
    if (path.endsWith('/medical-records')) return [{ id: 'record-fixture', visitDate: '2026-10-01', doctor: { fullNameEn: 'Existing doctor' } }];
    if (path.endsWith('/lab-results')) throw new Error('Results unavailable');
    return [];
  };
  await mount(pages.Dashboard);
  assert.ok([...document.querySelectorAll('a')].some(link => link.textContent === 'dashboardBookAppointment' && link.getAttribute('href') === '/patient/doctors'));
  assert.equal(document.querySelectorAll('.patient-dashboard__activity').length, 1);
  assert.match(document.querySelector('.patient-dashboard__activity').textContent, /Existing doctor/);
  assert.match(document.body.textContent, /dashboardPartialActivity/);
  assert.match(document.querySelector('.health-summary-card[href="/patient/lab-results"]').textContent, /patientDataUnavailable/);
  assert.equal(document.querySelectorAll('.patient-pending-reminder').length, 0);
});


test('Arabic dashboard uses the structured Arabic first name without exposing the full name', async () => {
  globalThis.portalTestLanguage = 'ar';
  globalThis.portalTestApi = async path => path.endsWith('/me')
    ? { firstNameAr: 'تاج', firstNameEn: 'Tag', fullNameAr: 'تاج محمد أحمد', fullNameEn: 'Tag Mohamed Ahmed' }
    : [];
  await mount(pages.Dashboard);
  assert.match(document.querySelector('h1').textContent, /، تاج$/);
  assert.doesNotMatch(document.querySelector('h1').textContent, /محمد|أحمد|Tag|Mohamed/);
  assert.equal(document.querySelector('.patient-dashboard').dir, 'rtl');
});

test('dashboard selects the nearest appointment from the descending API list without mutating it', async () => {
  const appointments = Object.freeze([
    Object.freeze({ id: 'later-date', appointmentDate: '2026-12-02', appointmentTime: '08:00', status: 'CONFIRMED', doctor: {} }),
    Object.freeze({ id: 'later-time', appointmentDate: '2026-11-01', appointmentTime: '14:00', status: 'CONFIRMED', doctor: {} }),
    Object.freeze({ id: 'nearest', appointmentDate: '2026-11-01', appointmentTime: '09:00', status: 'CONFIRMED', doctor: {} }),
  ]);
  globalThis.portalTestApi = async path => {
    if (path.endsWith('/me')) return { firstNameEn: 'Tag' };
    if (path.includes('/appointments?')) return appointments;
    return [];
  };
  await mount(pages.Dashboard);
  assert.ok(document.querySelector('a[href="/patient/appointments/nearest"]'));
  assert.equal(document.querySelector('a[href="/patient/appointments/later-date"]'), null);
  assert.match(document.querySelector('.patient-dashboard article').textContent, /09:00/);
  assert.equal(appointments[0].id, 'later-date');
});
