import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { localClinicalFixtureInternals, safeClinicalFixtureReport, validateLocalClinicalEnvironment, LOCAL_API_ORIGIN } from '../scripts/localClinicalQaFixtures.mjs';

const UUID = '10000000-0000-4000-8000-000000000001';
const DOCTOR_ID = '10000000-0000-4000-8000-000000000002';
const APPOINTMENT_ID = '10000000-0000-4000-8000-000000000003';
const LAB_ORDER_ID = '10000000-0000-4000-8000-000000000004';
const LAB_ITEM_ID = '10000000-0000-4000-8000-000000000005';
const PRESCRIPTION_ID = '10000000-0000-4000-8000-000000000006';
const CONSULT_INVOICE_ID = '10000000-0000-4000-8000-000000000007';
const LAB_INVOICE_ID = '10000000-0000-4000-8000-000000000008';
const FAKE_PASSWORD = 'not-a-real-password-QA-test';
const FAKE_TOKEN = 'fake.jwt.qa-token';
const credentials = Object.fromEntries([
  ['doctor', 'DOCTOR'], ['lab', 'LAB_TECH'], ['pharmacist', 'PHARMACIST'], ['receptionist', 'RECEPTIONIST']
].map(([key, role]) => [key, { username: `${key}@example.invalid`, password: FAKE_PASSWORD, role }]));
const env = Object.freeze({
  NODE_ENV: 'development', APP_ENV: 'development', DEPLOYMENT_ENV: 'development', DATABASE_ENVIRONMENT: 'local',
  QA_LOCAL_EXECUTION: 'true', QA_API_ORIGIN: LOCAL_API_ORIGIN, QA_EXPECTED_API_ORIGIN: LOCAL_API_ORIGIN,
  QA_PREPARE_LOCAL_CLINICAL_FIXTURES: 'true',
  QA_EXPECTED_TARGET_ID: 'clinic-local-disposable',
  DATABASE_URL: 'postgresql://shifa_local_qa@127.0.0.1:55491/clinic_local_qa?schema=public',
  DIRECT_URL: 'postgresql://shifa_local_qa@127.0.0.1:55491/clinic_local_qa?schema=public',
  SOCKET_REVOCATION_DATABASE_URL: 'postgresql://shifa_local_qa@127.0.0.1:55491/clinic_local_qa?schema=public',
  NOTIFICATIONS_DISABLED: 'true', SMS_PROVIDER: 'disabled', VERIFICATION_PROVIDER: 'development',
  PHONE_VERIFICATION_PROVIDER: 'development', QA_PAYMENT_MODE: 'disabled'
});
const identity = { database: 'clinic_local_qa', schema: 'public', role: 'shifa_local_qa' };

function json(value, status = 200) { return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } }); }
function apiFixture({ cashEnabled = true, wrongRole = false, registrationConflict = false } = {}) {
  const calls = [];
  const patientId = UUID;
  let patientPhone;
  let patientName;
  const fetchImpl = async (input, options = {}) => {
    const url = new URL(input);
    calls.push({ origin: url.origin, path: url.pathname, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null, headers: options.headers || {} });
    if (url.origin !== LOCAL_API_ORIGIN) throw new Error('external request blocked in test fixture');
    if (url.pathname === '/api/health') return json({ status: 'alive' });
    if (url.pathname === '/api/health/ready') return json({ status: 'healthy' });
    if (url.pathname === '/api/auth/login') {
      const body = JSON.parse(options.body);
      if (body.username === 'doctor@example.invalid') return json({ token: FAKE_TOKEN, user: { role: 'DOCTOR', doctorId: DOCTOR_ID } });
      if (wrongRole && body.username === 'lab@example.invalid') return json({ token: FAKE_TOKEN, user: { role: 'DOCTOR' } });
      if (body.username === 'lab@example.invalid') return json({ token: FAKE_TOKEN, user: { role: 'LAB_TECH' } });
      if (body.username === 'pharmacist@example.invalid') return json({ token: FAKE_TOKEN, user: { role: 'PHARMACIST' } });
      if (body.username === 'receptionist@example.invalid') return json({ token: FAKE_TOKEN, user: { role: 'RECEPTIONIST' } });
      return json({ token: FAKE_TOKEN, user: { role: 'PATIENT', patientLinked: true, patientId } });
    }
    if (url.pathname === '/api/patient-auth/address-states') return json({ states: [{ id: 1 }] });
    if (url.pathname === '/api/patient-auth/register') {
      if (registrationConflict) return json({ code: 'ACCOUNT_ALREADY_EXISTS' }, 409);
      const body = JSON.parse(options.body);
      patientPhone = body.phone;
      patientName = `${body.firstNameEn} ${body.fatherNameEn} ${body.grandfatherNameEn} ${body.familyNameEn}`;
      return json({ state: 'VERIFICATION_REQUIRED', challengeId: APPOINTMENT_ID, developmentCode: '614209' }, 201);
    }
    if (url.pathname === '/api/patient-auth/verify') return json({ state: 'CLAIMED', patient: { id: patientId, phone: patientPhone, fullNameEn: patientName } });
    if (url.pathname === '/api/patient/me') return json({ id: patientId, phone: patientPhone });
    if (url.pathname === '/api/patient/doctors') return json([{ id: DOCTOR_ID, status: 'ACTIVE' }]);
    if (url.pathname === '/api/appointments/slots') return json(['09:00']);
    if (url.pathname === '/api/patient/appointments') return json({ id: APPOINTMENT_ID, status: 'PENDING', doctorId: DOCTOR_ID }, 201);
    if (url.pathname === '/api/billing/payment-methods') return json(cashEnabled ? [{ code: 'CASH' }] : []);
    if (url.pathname === '/api/billing/invoice' && JSON.parse(options.body).invoiceType === 'CONSULTATION') return json({ invoice: { id: CONSULT_INVOICE_ID, patientId, totalAmountSdg: 100 } }, 201);
    if (url.pathname === '/api/billing/invoice' && JSON.parse(options.body).invoiceType === 'LABORATORY') return json({ invoice: { id: LAB_INVOICE_ID, patientId, labOrderId: LAB_ORDER_ID, totalAmountSdg: 25 } }, 201);
    if (url.pathname.endsWith('/payments')) return json({ paymentStatus: 'PAID' }, 200);
    if (url.pathname === '/api/billing/services') return json([{ id: APPOINTMENT_ID, category: 'LABORATORY', baseFeeSdg: 25 }]);
    if (url.pathname === '/api/records/drugs') return json([{ id: LAB_ORDER_ID, status: 'ACTIVE' }]);
    if (url.pathname === '/api/records') return json({
      labOrder: { id: LAB_ORDER_ID, patientId }, prescription: { id: PRESCRIPTION_ID, patientId }
    }, 201);
    if (url.pathname === '/api/records/lab-orders/pending') return json([{ id: LAB_ORDER_ID, patientId, items: [{ id: LAB_ITEM_ID }] }]);
    if (url.pathname === '/api/patient/lab-results') return json([{ id: LAB_ORDER_ID, tests: [{ resultValue: '12.4' }] }]);
    if (url.pathname === '/api/records/prescriptions/pending') return json([{ id: PRESCRIPTION_ID, patientId }]);
    if (url.pathname === '/api/patient/prescriptions') return json([{ id: PRESCRIPTION_ID }]);
    if (url.pathname === `/api/patients/${patientId}/profile`) return json({ id: patientId, portalLinked: true,
      invoices: [{ id: LAB_INVOICE_ID, invoiceType: 'LABORATORY' }] });
    return json({}, options.method === 'PUT' ? 200 : 404);
  };
  return { calls, fetchImpl };
}

test('local fixture environment rejects staging, production, non-loopback and any external provider configuration', async () => {
  for (const override of [
    { QA_API_ORIGIN: 'https://clinic-staging-api.onrender.com' },
    { QA_API_ORIGIN: 'https://clinic-api.example.com' },
    { DATABASE_URL: 'postgresql://user@staging.example/neondb' },
    { NODE_ENV: 'production' }, { DATABASE_ENVIRONMENT: 'staging' }, { PAYMENT_API_KEY: 'present' },
    { QA_PREPARE_LOCAL_CLINICAL_FIXTURES: 'false' },
    { NOTIFICATIONS_DISABLED: 'false' }, { SMS_PROVIDER: 'twilio' },
    { SMTP_HOST: 'mail.example.invalid' }, { QA_PAYMENT_MODE: 'enabled' }, { STRIPE_SECRET_KEY: 'present' }
  ]) assert.throws(() => validateLocalClinicalEnvironment({ ...env, ...override }));
});

test('database identity mismatch blocks before the fixture API is called', async () => {
  const fixture = apiFixture();
  const report = await localClinicalFixtureInternals.run({ env, fetchImpl: fixture.fetchImpl,
    databaseProbe: async () => ({ ...identity, database: 'production' }), staffCredentials: credentials });
  assert.equal(report.workflowResult, 'FAILED');
  assert.equal(report.reason, 'database_identity_mismatch');
  assert.equal(fixture.calls.length, 0);
  assert.equal(fixture.calls.some(call => call.path === '/api/patient-auth/register'), false);
});

test('wrong seeded staff role is rejected and credentials are not reported', async () => {
  const fixture = apiFixture();
  const wrong = { ...credentials, lab: { ...credentials.lab, role: 'DOCTOR' } };
  const report = await localClinicalFixtureInternals.run({ env, fetchImpl: fixture.fetchImpl,
    databaseProbe: async () => identity, staffCredentials: wrong });
  assert.equal(report.workflowResult, 'FAILED');
  assert.equal(report.reason, 'unsafe_local_configuration');
  assert.equal(fixture.calls.length, 3);
});

test('API staff role mismatch fails before any synthetic patient registration', async () => {
  const fixture = apiFixture({ wrongRole: true });
  const report = await localClinicalFixtureInternals.run({ env, fetchImpl: fixture.fetchImpl,
    databaseProbe: async () => identity, staffCredentials: credentials });
  assert.equal(report.reason, 'staff_authentication_failed');
  assert.equal(fixture.calls.some(call => call.path === '/api/patient-auth/register'), false);
});

test('existing/non-synthetic identity conflict is never reused or advanced', async () => {
  const fixture = apiFixture({ registrationConflict: true });
  const report = await localClinicalFixtureInternals.run({ env, fetchImpl: fixture.fetchImpl,
    databaseProbe: async () => identity, staffCredentials: credentials });
  assert.equal(report.reason, 'registration_conflict');
  assert.equal(fixture.calls.some(call => call.path === '/api/patient-auth/verify'), false);
  assert.equal(fixture.calls.some(call => call.path === '/api/records'), false);
});

test('normal staff and patient APIs create, release, and read exact synthetic lab and pharmacy fixtures', async () => {
  const fixture = apiFixture();
  const report = await localClinicalFixtureInternals.run({ env, fetchImpl: fixture.fetchImpl,
    databaseProbe: async () => identity, staffCredentials: credentials,
    now: () => new Date('2026-11-08T12:00:00.000Z') });
  assert.equal(report.workflowResult, 'PASS', `${JSON.stringify(report)} | ${fixture.calls.map(call => `${call.method} ${call.path}`).join(', ')}`);
  assert.equal(report.patientFixtureIndex, 1);
  assert.equal(report.labOrderCreated, true);
  assert.equal(report.labResultReleased, true);
  assert.equal(report.patientLabReadConfirmed, true);
  assert.equal(report.prescriptionCreated, true);
  assert.equal(report.pharmacistWorkflowConfirmed, true);
  assert.equal(report.patientPrescriptionReadConfirmed, true);
  assert.equal(report.invoiceCreated, true);
  assert.equal(report.localPaymentSimulationStatus, 'ledger_cash_recorded');
  assert.ok(fixture.calls.every(call => call.origin === LOCAL_API_ORIGIN));
  assert.ok(fixture.calls.some(call => call.method === 'POST' && call.path === '/api/records'));
  assert.ok(fixture.calls.some(call => call.method === 'PUT' && call.path.endsWith('/release')));
  assert.ok(fixture.calls.some(call => call.method === 'GET' && call.path === '/api/patient/lab-results'));
  assert.ok(fixture.calls.some(call => call.method === 'GET' && call.path === '/api/records/prescriptions/pending'));
  assert.ok(fixture.calls.some(call => call.method === 'GET' && call.path === '/api/patient/prescriptions'));
  assert.ok(fixture.calls.some(call => call.method === 'GET' && call.path === `/api/patients/${UUID}/profile`));
  assert.ok(fixture.calls.filter(call => call.path.endsWith('/payments')).every(call => call.body.payments.every(payment => payment.paymentMethod === 'CASH')));
  assert.equal(fixture.calls.some(call => /notification|sms|whatsapp|stripe|gateway/i.test(call.path)), false);
  const serialized = JSON.stringify(report);
  for (const secret of [FAKE_PASSWORD, FAKE_TOKEN, '614209', UUID, APPOINTMENT_ID, LAB_ORDER_ID, PRESCRIPTION_ID]) assert.equal(serialized.includes(secret), false);
  assert.match(report.namespace, /^qa-\d{8}-[a-f0-9]{8}$/);
});

test('missing local cash ledger method stops at invoice creation without payment or clinical mutations', async () => {
  const fixture = apiFixture({ cashEnabled: false });
  const report = await localClinicalFixtureInternals.run({ env, fetchImpl: fixture.fetchImpl,
    databaseProbe: async () => identity, staffCredentials: credentials,
    now: () => new Date('2026-11-08T12:00:00.000Z') });
  assert.equal(report.workflowResult, 'PARTIAL', `${JSON.stringify(report)} | ${fixture.calls.map(call => `${call.method} ${call.path}`).join(', ')}`);
  assert.equal(report.reason, 'local_payment_simulation_unavailable');
  assert.equal(report.invoiceCreated, true);
  assert.equal(report.localPaymentSimulationStatus, 'local_payment_simulation_unavailable');
  assert.equal(fixture.calls.some(call => call.path.endsWith('/payments')), false);
  assert.equal(fixture.calls.some(call => call.path === '/api/records'), false);
});

test('runner has no direct fixture database writes and report allowlist excludes credential-like data', async () => {
  const source = await readFile(new URL('../scripts/prepare-local-clinical-qa-fixtures.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /PrismaClient|\.create\(|\.insert\(|INSERT\s+INTO|UPDATE\s+"|DELETE\s+FROM/i);
  const report = safeClinicalFixtureReport('qa-20261108-a1b2c3d4', { reason: 'workflow_api_failed', password: FAKE_PASSWORD, token: FAKE_TOKEN });
  assert.equal(JSON.stringify(report).includes(FAKE_PASSWORD), false);
  assert.equal(JSON.stringify(report).includes(FAKE_TOKEN), false);
});
