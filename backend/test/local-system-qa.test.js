import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyLocalQaGate } from '../scripts/stagingQaGate.mjs';
import { runPatientQa } from '../scripts/qaPatientWorkflows.mjs';
import { permittedQaRequest, STAGING_API } from '../scripts/qaPatientPlan.mjs';

const origin = 'http://127.0.0.1:5201';
const databaseUrl = 'postgresql://qa_disposable@127.0.0.1:55492/clinic_local_qa_disposable?schema=public';
const env = {
  NODE_ENV: 'development', APP_ENV: 'local', DEPLOYMENT_ENV: 'development', DATABASE_ENVIRONMENT: 'local',
  QA_LOCAL_EXECUTION: 'true', QA_LOCAL_API_PORT: '5201', QA_LOCAL_DB_PORT: '55492',
  QA_LOCAL_DATABASE_NAME: 'clinic_local_qa_disposable', QA_LOCAL_DATABASE_ROLE: 'qa_disposable',
  QA_API_ORIGIN: origin, QA_EXPECTED_API_ORIGIN: origin, QA_EXPECTED_TARGET_ID: 'clinic-local-disposable',
  DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl, SOCKET_REVOCATION_DATABASE_URL: databaseUrl,
  NOTIFICATIONS_DISABLED: 'true', SMS_PROVIDER: 'disabled', VERIFICATION_PROVIDER: 'development',
  PHONE_VERIFICATION_PROVIDER: 'development', QA_PAYMENT_MODE: 'disabled',
  QA_EXECUTE_PATIENT_WORKFLOWS: 'true', QA_MAX_CONCURRENCY: '2'
};
const identity = { database: 'clinic_local_qa_disposable', schema: 'public', role: 'qa_disposable', patientCount: 0 };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

test('local gate accepts explicit loopback ports, exact empty disposable identity, and disabled external providers', async () => {
  const seen = [];
  const result = await verifyLocalQaGate({ env, databaseProbe: async () => identity,
    fetchImpl: async input => { const url = new URL(input); seen.push(url.origin); return json(url.pathname === '/api/health' ? { status: 'alive' } : { status: 'healthy' }); } });
  assert.equal(result.gate, 'PASS');
  assert.equal(result.apiOrigin, origin);
  assert.ok(seen.every(item => item === origin));
});

test('local gate rejects staging/production, non-loopback origins, unsafe providers, and database identity mismatch before workflow', async () => {
  for (const change of [
    { NODE_ENV: 'production' }, { DEPLOYMENT_ENV: 'staging' }, { QA_LOCAL_EXECUTION: 'false' },
    { QA_API_ORIGIN: STAGING_API }, { QA_API_ORIGIN: 'https://clinic-api.example.com' },
    { QA_API_ORIGIN: 'http://127.0.0.1:5200' }, { QA_LOCAL_API_PORT: '5200' },
    { DATABASE_URL: 'postgresql://user:pass@remote.example/neondb' },
    { DATABASE_URL: 'postgresql://qa_disposable@127.0.0.1:55491/clinic_local_qa_disposable?schema=public' },
    { QA_LOCAL_DB_PORT: '55491' }, { QA_LOCAL_DATABASE_NAME: 'clinic_local_qa' },
    { QA_LOCAL_DATABASE_ROLE: 'shifa_local_qa' },
    { NOTIFICATIONS_DISABLED: 'false' }, { SMS_PROVIDER: 'transport' }, { QA_PAYMENT_MODE: 'enabled' },
    { SMTP_HOST: 'smtp.example.invalid' }
  ]) {
    let requests = 0;
    await assert.rejects(verifyLocalQaGate({ env: { ...env, ...change }, databaseProbe: async () => identity,
      fetchImpl: async () => { requests++; return json({ status: 'alive' }); } }));
    assert.equal(requests, 0);
  }
  await assert.rejects(verifyLocalQaGate({ env, databaseProbe: async () => ({ ...identity, database: 'neondb' }),
    fetchImpl: async () => json({ status: 'alive' }) }));
  let workflowRequests = 0;
  const nonEmptyPreflight = await runPatientQa({ env, mode: 'local',
    databaseProbe: async () => ({ ...identity, patientCount: 1 }),
    fetchImpl: async () => { workflowRequests++; return json({ status: 'alive' }); } });
  assert.equal(nonEmptyPreflight.gate, 'BLOCKED');
  assert.equal(nonEmptyPreflight.patientsCreated, 0);
  assert.equal(workflowRequests, 0);
  for (const mismatch of [{ patientCount: 1 }, { role: 'other_role' }, { schema: 'private' }]) {
    let requests = 0;
    await assert.rejects(verifyLocalQaGate({ env, databaseProbe: async () => ({ ...identity, ...mismatch }),
      fetchImpl: async () => { requests++; return json({ status: 'alive' }); } }));
    assert.equal(requests, 0);
  }
  for (const patientCount of [1, 2, 50, 100]) {
    const continuity = await verifyLocalQaGate({ env, initialPreflight: false,
      databaseProbe: async () => ({ ...identity, patientCount }),
      fetchImpl: async input => json(new URL(input).pathname === '/api/health' ? { status: 'alive' } : { status: 'healthy' }) });
    assert.equal(continuity.gate, 'PASS');
  }
  for (const mismatch of [{ database: 'different_db' }, { role: 'different_role' }, { schema: 'private' }]) {
    await assert.rejects(verifyLocalQaGate({ env, initialPreflight: false,
      databaseProbe: async () => ({ ...identity, patientCount: 1, ...mismatch }),
      fetchImpl: async () => json({ status: 'alive' }) }));
  }
  for (const unsafe of [{ NOTIFICATIONS_DISABLED: 'false' }, { SMS_PROVIDER: 'twilio' },
    { QA_PAYMENT_MODE: 'enabled' }, { STRIPE_SECRET_KEY: 'configured' }]) {
    await assert.rejects(verifyLocalQaGate({ env: { ...env, ...unsafe }, initialPreflight: false,
      databaseProbe: async () => ({ ...identity, patientCount: 1 }),
      fetchImpl: async () => json({ status: 'alive' }) }));
  }
  for (const change of [{ QA_MAX_CONCURRENCY: '3' }, { QA_REQUESTED_PATIENTS: '99' }]) {
    let requests = 0;
    const report = await runPatientQa({ env: { ...env, ...change }, mode: 'local', databaseProbe: async () => identity,
      fetchImpl: async () => { requests++; return json({ status: 'alive' }); } });
    assert.equal(report.patientsCreated, 0);
    assert.equal(requests, 0);
  }
});

test('local workflow continues through login after registration changes the patient count', async () => {
  let time = Date.now();
  let patientCount = 0;
  let registration;
  const controller = new AbortController();
  const calls = [];
  const fetchImpl = async (input, options = {}) => {
    const url = new URL(input);
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push(`${method} ${url.pathname}`);
    if (url.pathname === '/api/health') return json({ status: 'alive' });
    if (url.pathname === '/api/health/ready') return json({ status: 'healthy' });
    if (url.pathname === '/api/patient-auth/address-states') return json({ states: [{ id: 1 }] });
    if (url.pathname === '/api/patient-auth/register') {
      registration = body;
      patientCount = 1;
      return json({ state: 'VERIFICATION_REQUIRED', challengeId: '00000000-0000-4000-8000-000000000001', developmentCode: '493821' }, 201);
    }
    if (url.pathname === '/api/patient-auth/verify') return json({ state: 'CLAIMED', patient: {
      id: '10000000-0000-4000-8000-000000000001', phone: registration.phone,
      fullNameEn: `${registration.firstNameEn} ${registration.fatherNameEn} ${registration.grandfatherNameEn} ${registration.familyNameEn}`
    } });
    if (url.pathname === '/api/auth/login') {
      controller.abort();
      return json({ token: 'local-only-token', user: { id: '20000000-0000-4000-8000-000000000001',
        username: registration.email, role: 'PATIENT', patientLinked: true, patientId: '10000000-0000-4000-8000-000000000001' } });
    }
    assert.fail(`unexpected request ${method} ${url.pathname}`);
  };
  const report = await runPatientQa({ env: { ...env, QA_MAX_CONCURRENCY: '1' }, mode: 'local', signal: controller.signal,
    fetchImpl, now: () => time, sleep: async ms => { time += ms; },
    databaseProbe: async () => ({ ...identity, patientCount }) });
  assert.ok(calls.includes('POST /api/patient-auth/register'));
  assert.ok(calls.includes('POST /api/patient-auth/verify'));
  assert.ok(calls.includes('POST /api/auth/login'), 'login should continue after a successful post-registration continuity check');
  assert.notEqual(report.reason, 'local_database_identity_mismatch');
});

test('local allowlist permits only existing patient workflow routes on loopback, never staging or external hosts', () => {
  assert.equal(permittedQaRequest(new URL(`${origin}/api/patient-auth/register`), 'POST', origin), true);
  assert.equal(permittedQaRequest(new URL(`${STAGING_API}/api/patient-auth/register`), 'POST'), true);
  assert.equal(permittedQaRequest(new URL(`${STAGING_API}/api/patient-auth/register`), 'POST', origin), false);
  assert.equal(permittedQaRequest(new URL(`${origin}/api/patient-auth/register`), 'POST', 'http://127.0.0.1:99999'), false);
  assert.equal(permittedQaRequest(new URL(`${origin}/api/patient-auth/register`), 'POST', 'http://0.0.0.0:5201'), false);
  assert.equal(permittedQaRequest(new URL('http://localhost:5201/api/patient-auth/register'), 'POST', origin), false);
  assert.equal(permittedQaRequest(new URL('https://example.invalid/api/patient-auth/register'), 'POST', origin), false);
  assert.equal(permittedQaRequest(new URL(`${origin}/api/billing/invoice/x/payments`), 'POST', origin), false);
});

test('local workflow uses in-memory development verification without capture endpoints or secret report output', async () => {
  let time = Date.now();
  let index = 0;
  const calls = [];
  const accounts = new Map();
  const fetchImpl = async (input, options = {}) => {
    const url = new URL(input);
    assert.equal(url.origin, origin);
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push(`${method} ${url.pathname}`);
    if (url.pathname === '/api/health') return json({ status: 'alive' });
    if (url.pathname === '/api/health/ready') return json({ status: 'healthy' });
    if (url.pathname === '/api/patient-auth/address-states') return json({ states: [{ id: 1 }] });
    if (url.pathname === '/api/patient-auth/register') {
      const id = `00000000-0000-4000-8000-${String(++index).padStart(12, '0')}`;
      accounts.set(id, { ...body, patientId: `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        userId: `20000000-0000-4000-8000-${String(index).padStart(12, '0')}` });
      return json({ state: 'VERIFICATION_REQUIRED', challengeId: id, developmentCode: '493821' }, 201);
    }
    if (url.pathname === '/api/patient-auth/verify') {
      const account = accounts.get(body.challengeId);
      assert.equal(body.code, '493821');
      return json({ state: 'CLAIMED', patient: { id: account.patientId, phone: account.phone,
        fullNameEn: `${account.firstNameEn} ${account.fatherNameEn} ${account.grandfatherNameEn} ${account.familyNameEn}` } });
    }
    if (url.pathname === '/api/auth/login') {
      const account = [...accounts.values()].find(item => item.email === body.username);
      account.token = `local-only-auth-${account.email}`;
      return json({ token: account.token, user: { id: account.userId, username: account.email,
        role: 'PATIENT', patientLinked: true, patientId: account.patientId } });
    }
    const account = [...accounts.values()].find(item => options.headers?.Authorization === `Bearer ${item.token}`);
    if (url.pathname === '/api/patient/me') return json({ id: account.patientId, phone: account.phone });
    if (url.pathname === '/api/patient/doctors' || url.pathname === '/api/patient/specialties'
        || url.pathname === '/api/patient/appointments' || url.pathname === '/api/patient/medical-records'
        || url.pathname === '/api/patient/lab-results' || url.pathname === '/api/patient/prescriptions') return json([]);
    assert.fail(`unexpected local request ${method} ${url.pathname}`);
  };
  const report = await runPatientQa({ env: { ...env, QA_API_ORIGIN: origin, QA_EXPECTED_API_ORIGIN: origin }, mode: 'local',
    fetchImpl, now: () => time, sleep: async ms => { time += ms; }, databaseProbe: async () => identity });
  assert.equal(report.patientsCreated, 100);
  assert.equal(report.patientsVerified, 100);
  assert.equal(report.loginSuccess, 100);
  assert.equal(report.localVerificationProviderConfirmed, true);
  assert.equal(report.captureAuthenticationPassed, false);
  assert.equal(calls.some(call => call.includes('/api/qa/verification-capture')), false);
  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes('493821'), false);
  assert.equal(serialized.includes('local-only-auth'), false);
  assert.equal(serialized.includes('Qa1!'), false);
  assert.match(serialized, /example\.invalid/);
});
