import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPatientQa } from '../scripts/qaPatientWorkflows.mjs';
import { runQaCli } from '../scripts/full-system-qa.mjs';
import { assertSyntheticPatient, permittedQaRequest, registrationBody, safeConcurrency, STAGING_API, STAGING_TARGET, syntheticPatient } from '../scripts/qaPatientPlan.mjs';
import { createQaReport, publicQaReport, qaMarkdown } from '../scripts/qaReport.mjs';
import { createQaTransport, SENSITIVE_INTERVAL_MS } from '../scripts/qaTransport.mjs';
import { patientDateOfBirthSchema } from '../src/utils/patientOnboarding.js';
import { normalizePhone } from '../src/utils/identity.js';
import { structuredPatientNameSchema } from '../src/utils/patientName.js';
import { passwordSchema } from '../src/utils/passwordPolicy.js';

const CAPTURE_TOKEN = 'Synthetic-Capture-Credential-Do-Not-Log';
const env = {
  QA_API_ORIGIN: STAGING_API, QA_EXPECTED_API_ORIGIN: STAGING_API,
  QA_EXPECTED_TARGET_ID: STAGING_TARGET, QA_VERIFICATION_CAPTURE_TOKEN: CAPTURE_TOKEN,
  QA_EXECUTE_PATIENT_WORKFLOWS: 'true'
};
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

function stagingMock({ fixtures = false, override } = {}) {
  let time = Date.now();
  const calls = [];
  const accounts = [];
  const appointments = [];
  let active = 0;
  let maxActive = 0;
  const target = {
    service: 'clinic-api', environment: 'staging', loadTestAllowed: true,
    databaseEnvironment: 'staging', databaseIdentity: 'verified', notifications: 'sink',
    verificationCapture: 'enabled', payments: 'disabled', targetId: STAGING_TARGET, reasons: []
  };
  const fetchImpl = async (input, options = {}) => {
    const url = new URL(input);
    assert.equal(url.origin, STAGING_API, 'mock must never call any real host');
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : null;
    const call = { path: url.pathname, url, method, body, options, time };
    calls.push(call);
    assert.equal(options.redirect, 'error');
    active++; maxActive = Math.max(maxActive, active);
    await Promise.resolve();
    try {
      const custom = await override?.(call, { accounts, calls, target, appointments });
      if (custom) return custom;
      if (url.pathname === '/api/health/load-test-target') return json(target);
      if (url.pathname === '/api/health') return json({ status: 'alive' });
      if (url.pathname === '/api/health/ready') return json({ status: 'healthy' });
      if (url.pathname === '/api/qa/verification-capture-auth-check') return options.headers.Authorization === `Bearer ${CAPTURE_TOKEN}`
        ? new Response(null, { status: 204 }) : json({}, 404);
      if (url.pathname === '/api/patient-auth/address-states') return json({ states: [{ id: 1 }] });
      if (url.pathname === '/api/patient-auth/register') {
        assert.match(body.email, /^qa-\d{8}-[a-f0-9]{8}\+patient-\d{3}@example\.invalid$/);
        const index = accounts.length + 1;
        accounts.push({ ...body, challengeId: uuid(index), patientId: uuid(1000 + index), userId: uuid(2000 + index), token: `jwt-sensitive-fixture-${index}` });
        return json({ state: 'VERIFICATION_REQUIRED', challengeId: uuid(index) }, 201);
      }
      if (url.pathname.startsWith('/api/qa/verification-capture/')) {
        assert.equal(options.headers.Authorization, `Bearer ${CAPTURE_TOKEN}`);
        const account = accounts.find(a => a.challengeId === url.pathname.split('/').at(-1));
        assert.ok(account);
        return json({ challengeId: account.challengeId, code: '654321', expiresAt: new Date(time + 300_000).toISOString() });
      }
      if (url.pathname === '/api/patient-auth/verify') {
        const account = accounts.find(a => a.challengeId === body.challengeId);
        assert.equal(body.code, '654321');
        return json({ state: 'CLAIMED', patient: { id: account.patientId, phone: account.phone,
          fullNameEn: `${account.firstNameEn} ${account.fatherNameEn} ${account.grandfatherNameEn} ${account.familyNameEn}` } });
      }
      if (url.pathname === '/api/auth/login') {
        const account = accounts.find(a => a.email === body.username);
        assert.equal(body.password, account.password);
        return json({ token: account.token, user: { id: account.userId, username: account.email, role: 'PATIENT', patientLinked: true, patientId: account.patientId } });
      }
      if (url.pathname === '/api/appointments/slots') return json(Array.from({ length: 32 }, (_, n) => `${String(8 + Math.floor(n / 4)).padStart(2, '0')}:${String(n % 4 * 15).padStart(2, '0')}`));
      const account = accounts.find(a => options.headers?.Authorization === `Bearer ${a.token}`);
      assert.ok(account, 'patient routes require the normal login token');
      if (url.pathname === '/api/patient/me') return json({ id: account.patientId, phone: account.phone });
      if (url.pathname === '/api/patient/doctors') return json(fixtures ? [{ id: uuid(3000), status: 'ACTIVE' }] : []);
      if (url.pathname === '/api/patient/specialties') return json(fixtures ? [{ id: uuid(4000) }] : []);
      if (url.pathname === '/api/patient/appointments' && method === 'POST') {
        const appointment = { id: uuid(5000 + appointments.length), patientId: account.patientId, ...body, status: 'PENDING' };
        appointments.push(appointment);
        return json(appointment, 201);
      }
      if (url.pathname === '/api/patient/appointments') return json(appointments.filter(a => a.patientId === account.patientId));
      if (url.pathname.startsWith('/api/patient/appointments/')) return json(appointments.find(a => a.id === url.pathname.split('/').at(-1)));
      if (['/api/patient/medical-records', '/api/patient/lab-results', '/api/patient/prescriptions'].includes(url.pathname)) return json([]);
      assert.fail('unsupported mock request');
    } finally { active--; }
  };
  return { accounts, appointments, calls, target, options: { env, fetchImpl, now: () => time, sleep: async ms => { time += ms; } },
    get maxActive() { return maxActive; } };
}

test('failed mandatory preflight creates zero patients and performs no workflow requests', async () => {
  const mock = stagingMock({ override: call => call.path === '/api/health/load-test-target' ? json({ loadTestAllowed: false }, 503) : null });
  const report = await runPatientQa(mock.options);
  assert.equal(report.gate, 'BLOCKED');
  assert.equal(report.patientsCreated, 0);
  assert.equal(report.workflowStarted, false);
  assert.equal(mock.accounts.length, 0);
  assert.deepEqual(mock.calls.map(c => c.path), ['/api/health/load-test-target']);
});

test('execution flag absent or false preserves preflight-only behavior', async () => {
  for (const value of [undefined, 'false', '1']) {
    const mock = stagingMock();
    const report = await runPatientQa({ ...mock.options, env: { ...env, QA_EXECUTE_PATIENT_WORKFLOWS: value } });
    assert.equal(report.gate, 'PASS');
    assert.equal(report.patientsCreated, 0);
    assert.equal(report.workflowStarted, false);
    assert.equal(mock.accounts.length, 0);
    assert.equal(mock.calls.length, 3);
  }
});

test('wrong configured or server targetId blocks with zero patients', async () => {
  for (const serverMismatch of [false, true]) {
    const mock = stagingMock();
    if (serverMismatch) mock.target.targetId = 'different-staging-target';
    const report = await runPatientQa({ ...mock.options, env: { ...env, QA_EXPECTED_TARGET_ID: serverMismatch ? STAGING_TARGET : 'different-staging-target' } });
    assert.equal(report.gate, 'BLOCKED');
    assert.equal(report.patientsCreated, 0);
  }
});

test('wrong capture token blocks before any registration despite a PASS public gate', async () => {
  const mock = stagingMock();
  const wrong = 'wrong-synthetic-credential-long-enough-to-pass-length-validation';
  const report = await runPatientQa({ ...mock.options, env: { ...env, QA_VERIFICATION_CAPTURE_TOKEN: wrong } });
  assert.equal(report.gate, 'PASS');
  assert.equal(report.result, 'BLOCKED');
  assert.equal(report.reason, 'capture_authentication_failed');
  assert.equal(report.captureAuthenticationPassed, false);
  assert.equal(report.patientsCreated, 0);
  assert.equal(report.workflowStarted, false);
  assert.equal(report.securityAuthorizationFailures, 1);
  assert.equal(mock.accounts.length, 0);
  assert.ok(mock.calls.every(c => c.method === 'GET'));
  assert.equal(JSON.stringify(report).includes(wrong), false);
  assert.equal(mock.calls[0].path, '/api/health/load-test-target');
});

test('capture auth-check must return exactly 204 before any patient request', async () => {
  for (const status of [200, 401, 403, 404, 503]) {
    const mock = stagingMock({ override: call => call.path === '/api/qa/verification-capture-auth-check' ? json({ error: CAPTURE_TOKEN }, status) : null });
    const report = await runPatientQa(mock.options);
    assert.equal(report.patientsCreated, 0);
    assert.equal(report.workflowStarted, false);
    assert.ok(mock.calls.every(c => c.method === 'GET'));
    assert.equal(mock.calls.some(c => c.path === '/api/patient-auth/address-states'), false);
    assert.equal(JSON.stringify(report).includes(CAPTURE_TOKEN), false);
  }
});

test('production, localhost, IP, frontend, HTTP, and unapproved staging origins never reach the network', async () => {
  for (const origin of ['https://clinic-api.onrender.com', 'https://production.example.test', 'https://localhost', 'https://127.0.0.1', 'https://[::1]', 'https://clinic-staging-web.onrender.com', 'http://clinic-staging-api.onrender.com', 'https://other-staging.example.test']) {
    let requested = false;
    const report = await runPatientQa({ env: { ...env, QA_API_ORIGIN: origin, QA_EXPECTED_API_ORIGIN: origin }, fetchImpl: async () => { requested = true; assert.fail('forbidden origin'); } });
    assert.equal(report.patientsCreated, 0);
    assert.equal(report.gate, 'BLOCKED');
    assert.equal(requested, false);
  }
});

test('synthetic identities satisfy real registration rules and reject non-synthetic identity changes', () => {
  const namespace = 'qa-20261106-a1b2c3d4';
  const phones = new Set();
  for (let index = 1; index <= 100; index++) {
    const patient = syntheticPatient(namespace, index, 1);
    structuredPatientNameSchema.parse(registrationBody(patient));
    passwordSchema.parse(patient.password);
    patientDateOfBirthSchema.parse(patient.dateOfBirth);
    assert.equal(normalizePhone(patient.phone), patient.phone);
    phones.add(patient.phone);
    assert.throws(() => assertSyntheticPatient({ ...patient, email: 'real@example.com' }, namespace, index), /non_synthetic_identity/);
    assert.throws(() => assertSyntheticPatient({ ...patient, phone: '+12025551212' }, namespace, index), /non_synthetic_identity/);
    assert.throws(() => assertSyntheticPatient({ ...patient, email: 'qa-20261106-deadbeef+patient-001@example.invalid' }, namespace, index), /non_synthetic_identity/);
  }
  assert.equal(phones.size, 100);
});

test('concurrency is hard-capped at two and unsafe settings block before registration', async () => {
  assert.equal(safeConcurrency(), 2);
  assert.equal(safeConcurrency('1'), 1);
  for (const value of ['0', '3', '100', 'NaN', '-1', '2.5']) {
    assert.throws(() => safeConcurrency(value));
    const mock = stagingMock();
    const report = await runPatientQa({ ...mock.options, env: { ...env, QA_MAX_CONCURRENCY: value } });
    assert.equal(report.patientsCreated, 0);
    assert.equal(report.workflowStarted, false);
    assert.equal(mock.accounts.length, 0);
  }
});

test('enabled execution creates exactly 100 accounts through real API contracts and respects pacing', async () => {
  const mock = stagingMock({ fixtures: true });
  const report = await runPatientQa(mock.options);
  assert.equal(mock.accounts.length, 100);
  assert.equal(report.requestedPatients, 100);
  assert.equal(report.patientsCreated, 100);
  assert.equal(report.patientsVerified, 100);
  assert.equal(report.loginSuccess, 100);
  assert.equal(report.loginFailure, 0);
  assert.equal(report.captureAuthenticationPassed, true);
  const authCheck = mock.calls.findIndex(c => c.path === '/api/qa/verification-capture-auth-check');
  const registration = mock.calls.findIndex(c => c.path === '/api/patient-auth/register');
  assert.ok(authCheck >= 0 && authCheck < registration);
  assert.equal(report.stages.appointmentCreate.success, 100);
  assert.equal(report.stages.appointmentDetail.success, 100);
  assert.equal(report.stages.labWorkflow.blocked, 100);
  assert.equal(report.stages.pharmacyWorkflow.blocked, 100);
  assert.equal(report.stages.billingWorkflow.blocked, 100);
  assert.equal(report.result, 'PARTIAL', 'missing staff clinical fixtures are not reported as success');
  assert.equal(report.cleanupCandidates.length, 100);
  assert.equal(report.maxActiveRequests, 1);
  assert.ok(mock.maxActive <= 2);
  assert.equal(new Set(mock.accounts.map(a => a.email)).size, 100);
  for (const path of ['/api/patient-auth/register', '/api/patient-auth/verify', '/api/auth/login']) {
    const calls = mock.calls.filter(c => c.path === path);
    for (let n = 1; n < calls.length; n++) assert.ok(calls[n].time - calls[n - 1].time >= SENSITIVE_INTERVAL_MS, path);
  }
  assert.ok(mock.calls.every(c => permittedQaRequest(c.url, c.method)));
  assert.equal(report.notificationSinkConfirmed, true);
  assert.equal(report.paymentDisabledConfirmed, true);
  assert.equal(report.externalNotificationRequests, 0);
  assert.equal(report.externalPaymentRequests, 0);
  const output = JSON.stringify(report) + qaMarkdown(report);
  for (const secret of [CAPTURE_TOKEN, '654321', ...mock.accounts.flatMap(a => [a.password, a.token])]) assert.equal(output.includes(secret), false);
});

test('missing clinical capacity blocks dependent stages without fabricating fixtures', async () => {
  const mock = stagingMock();
  const report = await runPatientQa(mock.options);
  assert.equal(report.patientsCreated, 100);
  assert.equal(report.stages.appointmentCreate.blocked, 100);
  assert.equal(report.stages.appointmentList.success, 100);
  assert.equal(report.stages.labResults.success, 100);
  assert.equal(mock.appointments.length, 0);
  assert.ok(mock.calls.every(c => !['PATCH', 'PUT', 'DELETE'].includes(c.method)));
});

test('invalidated gate stops ongoing execution and prevents further registration', async () => {
  const mock = stagingMock({ override: (call, state) => call.path === '/api/health/load-test-target' && state.accounts.length >= 2
    ? json({ ...state.target, notifications: 'external' }) : null });
  const report = await runPatientQa(mock.options);
  assert.equal(report.gate, 'BLOCKED');
  assert.ok(report.patientsCreated <= 2);
  const failure = mock.calls.findIndex(c => c.path === '/api/health/load-test-target' && mock.calls.slice(0, mock.calls.indexOf(c)).filter(p => p.path === '/api/patient-auth/register').length >= 2);
  assert.ok(failure >= 0);
  assert.equal(mock.calls.slice(failure + 1).filter(c => c.method === 'POST').length, 0);
});

test('gate is monitored during long pacing waits and stops before the next write', async () => {
  const mock = stagingMock({ override: (call, state) => call.path === '/api/health/load-test-target' && state.accounts.length === 1
    ? json({ ...state.target, loadTestAllowed: false }) : null });
  const report = await runPatientQa(mock.options);
  assert.equal(report.gate, 'BLOCKED');
  assert.equal(mock.accounts.length, 1);
  assert.equal(mock.calls.filter(c => c.method === 'POST').length, 1);
  const written = mock.calls.find(c => c.path === '/api/patient-auth/register');
  assert.ok(mock.calls.at(-1).time - written.time <= 31_000);
});

test('sink, capture, and disabled payments are mandatory throughout execution', async () => {
  for (const changed of [{ notifications: 'external' }, { verificationCapture: 'disabled' }, { payments: 'ledger-only' }, { payments: 'enabled' }]) {
    const mock = stagingMock();
    Object.assign(mock.target, changed);
    const report = await runPatientQa(mock.options);
    assert.equal(report.patientsCreated, 0);
    assert.equal(report.gate, 'BLOCKED');
  }
});

test('external notification, payment, OTP, and staff routes are rejected before fetch', async () => {
  let requested = false;
  const client = createQaTransport({ env, report: createQaReport(), fetchImpl: async () => { requested = true; } });
  for (const path of ['https://wa.me/123', 'https://api.stripe.com/payments', `${STAGING_API}/api/billing/payments`, `${STAGING_API}/api/appointments/otp/request`, `${STAGING_API}/api/notifications`, `${STAGING_API}/api/records`]) {
    await assert.rejects(client.workflowFetch(path, { method: 'POST' }));
  }
  assert.equal(requested, false);
});

test('transport refuses non-synthetic registration bodies before any network request', async () => {
  let requested = false;
  const report = createQaReport(); report.runNamespace = 'qa-20261106-a1b2c3d4';
  const client = createQaTransport({ env, report, fetchImpl: async () => { requested = true; } });
  await assert.rejects(client.json('/api/patient-auth/register', { method: 'POST', body: { email: 'real@example.com' } }), /non_synthetic_identity/);
  assert.equal(requested, false);
});

test('preflight still supports ledger-only, but execution requires payments disabled', async () => {
  const mock = stagingMock(); mock.target.payments = 'ledger-only';
  const report = await runPatientQa({ ...mock.options, env: { ...env, QA_EXECUTE_PATIENT_WORKFLOWS: undefined } });
  assert.equal(report.gate, 'PASS');
  assert.equal(report.workflowStarted, false);
  assert.equal(report.patientsCreated, 0);
  assert.equal(report.paymentDisabledConfirmed, false);
});

test('reports use an allowlist and never serialize injected secrets or response payloads', () => {
  const report = createQaReport();
  report.runNamespace = 'qa-20261106-a1b2c3d4';
  report.password = CAPTURE_TOKEN; report.DATABASE_URL = CAPTURE_TOKEN; report.authorization = CAPTURE_TOKEN;
  report.reason = CAPTURE_TOKEN;
  report.patients = [{ patientId: CAPTURE_TOKEN, password: CAPTURE_TOKEN, token: CAPTURE_TOKEN,
    stages: { login: { status: 'FAILURE', reason: CAPTURE_TOKEN } } }];
  const output = JSON.stringify(publicQaReport(report)) + qaMarkdown(publicQaReport(report));
  assert.equal(output.includes(CAPTURE_TOKEN), false);
  assert.equal(output.includes('DATABASE_URL'), false);
});

test('CLI writes JSON and Markdown and prints only safe counts, never capture tokens', async () => {
  for (const execute of [undefined, 'true']) {
    const directory = await mkdtemp(join(tmpdir(), 'shifa-qa-runner-test-'));
    const output = [];
    const mock = stagingMock();
    const report = await runQaCli({ ...mock.options, env: { ...env, QA_EXECUTE_PATIENT_WORKFLOWS: execute }, outputDirectory: directory, log: value => output.push(value) });
    assert.equal(report.workflowStarted, execute === 'true');
    const files = await readdir(directory);
    assert.equal(files.length, 2);
    for (const file of files) output.push(await readFile(join(directory, file), 'utf8'));
    for (const secret of [CAPTURE_TOKEN, '654321', ...mock.accounts.flatMap(a => [a.password, a.token])]) assert.equal(output.join('').includes(secret), false);
    assert.equal(JSON.parse(output[0]).patientsCreated, execute === 'true' ? 100 : 0);
  }
});

test('read 5xx and 429 retries are bounded and honor Retry-After', async () => {
  let attempts = 0;
  const mock = stagingMock({ override: call => {
    if (call.path !== '/api/patient-auth/address-states') return null;
    attempts++;
    return attempts < 3 ? json({}, attempts === 1 ? 429 : 503, { 'retry-after': '100' }) : json({ states: [] });
  } });
  const report = await runPatientQa(mock.options);
  assert.equal(attempts, 3);
  assert.equal(report.retryCount, 2);
  assert.equal(report.httpStatusBreakdown['429'], 1);
  assert.equal(report.serverErrors5xx, 1);
  assert.equal(report.patientsCreated, 0);
  const calls = mock.calls.filter(c => c.path === '/api/patient-auth/address-states');
  assert.ok(calls[1].time - calls[0].time >= 100_000);
  assert.ok(calls[2].time - calls[1].time >= 100_000);
});

test('persistent 5xx stops after two retries and excessive Retry-After is never shortened', async () => {
  for (const excessive of [false, true]) {
    const mock = stagingMock({ override: call => call.path === '/api/patient-auth/address-states' ? json({}, 503, excessive ? { 'retry-after': '3600' } : {}) : null });
    const report = await runPatientQa(mock.options);
    assert.equal(report.patientsCreated, 0);
    assert.equal(mock.calls.filter(c => c.path === '/api/patient-auth/address-states').length, excessive ? 1 : 3);
  }
});

test('ambiguous registration failures are never replayed and retain cleanup candidates', async () => {
  for (const network of [false, true]) {
    const mock = stagingMock({ override: call => {
      if (call.path !== '/api/patient-auth/register') return null;
      if (network) throw new Error(CAPTURE_TOKEN);
      return json({ error: CAPTURE_TOKEN }, 500);
    } });
    const report = await runPatientQa(mock.options);
    assert.equal(mock.calls.filter(c => c.path === '/api/patient-auth/register').length, 1);
    assert.equal(report.patientsCreated, 0);
    assert.ok(report.cleanupCandidates.some(p => p.ambiguousMutation));
    assert.equal(JSON.stringify(report).includes(CAPTURE_TOKEN), false);
  }
});

test('registration 429 retries are paced, bounded, and never rotate synthetic identities', async () => {
  const mock = stagingMock({ override: call => call.path === '/api/patient-auth/register' ? json({}, 429, { 'retry-after': '95' }) : null });
  const report = await runPatientQa(mock.options);
  const calls = mock.calls.filter(c => c.path === '/api/patient-auth/register');
  // Two workers may each be waiting, but the first exhausted budget stops both.
  assert.ok(calls.length <= 5);
  assert.ok(new Set(calls.map(c => c.body.email)).size <= 2);
  for (const email of new Set(calls.map(c => c.body.email))) assert.ok(calls.filter(c => c.body.email === email).length <= 3);
  for (let n = 1; n < calls.length; n++) assert.ok(calls[n].time - calls[n - 1].time >= SENSITIVE_INTERVAL_MS);
  assert.equal(report.patientsCreated, 0);
  assert.equal(report.unexpected4xx, 0);
});

test('identity collisions are BLOCKED and never log into or overwrite existing accounts', async () => {
  const mock = stagingMock({ override: call => call.path === '/api/patient-auth/register' ? json({}, 409) : null });
  const report = await runPatientQa(mock.options);
  assert.equal(report.result, 'BLOCKED');
  assert.equal(report.stages.registration.blocked, 100);
  assert.equal(mock.calls.filter(c => c.path === '/api/auth/login').length, 0);
  assert.equal(mock.calls.filter(c => c.method === 'POST').length, 1);
});

test('one-time capture server failures are never replayed', async () => {
  const mock = stagingMock({ override: call => call.path.startsWith('/api/qa/verification-capture/') ? json({}, 500) : null });
  const report = await runPatientQa(mock.options);
  assert.equal(mock.calls.filter(c => c.path.startsWith('/api/qa/verification-capture/')).length, 1);
  assert.equal(report.patientsVerified, 0);
  assert.equal(report.retryCount, 0);
});

test('interruption stops pending requests and returns a report with cleanup candidates', async () => {
  const controller = new AbortController();
  const mock = stagingMock({ override: call => {
    if (call.path === '/api/patient-auth/register') controller.abort();
    return null;
  } });
  const report = await runPatientQa({ ...mock.options, signal: controller.signal });
  assert.equal(mock.calls.filter(c => c.method === 'POST').length, 1);
  assert.equal(report.reason, 'run_interrupted');
  assert.ok(report.cleanupCandidates.length >= 1);
  assert.equal(report.cleanupPerformed, false);
});

test('authentication failures stop the run without brute force or credential leakage', async () => {
  const mock = stagingMock({ override: call => call.path === '/api/auth/login' ? json({ error: CAPTURE_TOKEN }, 401) : null });
  const report = await runPatientQa(mock.options);
  assert.equal(mock.calls.filter(c => c.path === '/api/auth/login').length, 1);
  assert.equal(report.securityAuthorizationFailures, 1);
  assert.equal(report.loginFailure, 1);
  assert.equal(report.unexpected4xx, 1);
  assert.equal(JSON.stringify(report).includes(CAPTURE_TOKEN), false);
});

test('wrong authenticated patient identity is a security failure and stops later writes', async () => {
  const mock = stagingMock({ override: call => call.path === '/api/auth/login'
    ? json({ token: 'wrong-user-jwt', user: { id: uuid(9000), username: 'someone-else', role: 'ADMIN' } }) : null });
  const report = await runPatientQa(mock.options);
  assert.equal(report.securityAuthorizationFailures, 1);
  assert.equal(report.loginSuccess, 0);
  assert.equal(mock.calls.filter(c => c.path === '/api/patient/appointments' && c.method === 'POST').length, 0);
  assert.equal(JSON.stringify(report).includes('wrong-user-jwt'), false);
});

test('reviewed route contracts match actual API mounts and patient route definitions', async () => {
  const server = await readFile(new URL('../src/server.js', import.meta.url), 'utf8');
  for (const mount of ['/api/patient-auth', '/api/auth', '/api/patient', '/api/appointments']) assert.ok(server.includes(`app.use('${mount}',`));
  for (const [file, methods] of [
    ['patientAuth.js', [['get', '/address-states'], ['post', '/register'], ['post', '/verify']]],
    ['auth.js', [['post', '/login']]],
    ['patient.js', [['get', '/me'], ['get', '/doctors'], ['get', '/specialties'], ['post', '/appointments'], ['get', '/appointments'], ['get', '/appointments/:id'], ['get', '/medical-records'], ['get', '/lab-results'], ['get', '/prescriptions']]],
    ['appointments.js', [['get', '/slots']]]
  ]) {
    const source = await readFile(new URL(`../src/routes/${file}`, import.meta.url), 'utf8');
    for (const [method, path] of methods) assert.ok(source.includes(`router.${method}('${path}',`), `${file} ${method} ${path}`);
  }
});
