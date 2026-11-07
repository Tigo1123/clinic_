import test from 'node:test';
import assert from 'node:assert/strict';
import { createQaTransport, LONG_PAUSE_TOLERANCE_MS, SENSITIVE_INTERVAL_MS } from '../scripts/qaTransport.mjs';
import { createQaReport, publicQaReport } from '../scripts/qaReport.mjs';
import { runPatientQa } from '../scripts/qaPatientWorkflows.mjs';
import { registrationBody, syntheticPatient, STAGING_API, STAGING_TARGET } from '../scripts/qaPatientPlan.mjs';

const secret = 'synthetic-pause-credential-never-serialize';
const env = { QA_API_ORIGIN: STAGING_API, QA_EXPECTED_API_ORIGIN: STAGING_API,
  QA_EXPECTED_TARGET_ID: STAGING_TARGET, QA_VERIFICATION_CAPTURE_TOKEN: secret,
  QA_EXECUTE_PATIENT_WORKFLOWS: 'true', QA_MAX_CONCURRENCY: '2' };
const target = { service: 'clinic-api', environment: 'staging', loadTestAllowed: true, targetId: STAGING_TARGET,
  databaseEnvironment: 'staging', databaseIdentity: 'verified', notifications: 'sink',
  verificationCapture: 'enabled', payments: 'disabled', reasons: [] };
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });
const HOURS = 9 * 60 * 60 * 1000;
function harness() {
  let time = Date.now(), overrun = 0;
  const calls = [], sleeps = [];
  const report = createQaReport(); report.runNamespace = 'qa-20261107-a1b2c3d4';
  const options = { env, report, now: () => time, sleep: async ms => { sleeps.push(ms); time += ms + overrun; },
    fetchImpl: async (url, opts) => {
      const path = new URL(url).pathname; calls.push({ path, method: opts.method, time });
      if (path === '/api/health/load-test-target') return json(target);
      if (path === '/api/health') return json({ status: 'alive' });
      if (path === '/api/health/ready') return json({ status: 'healthy' });
      if (path === '/api/qa/verification-capture-auth-check') return new Response(null, { status: 204 });
      if (path === '/api/patient-auth/address-states') return json({ states: [{ id: 1 }] });
      if (path === '/api/patient-auth/register') return json({ state: 'VERIFICATION_REQUIRED', challengeId: '123e4567-e89b-42d3-a456-426614174000' }, 201);
      assert.fail('expired workflow must not continue');
    } };
  const client = createQaTransport(options);
  return { client, report, calls, sleeps, options, advance: ms => { time += ms; }, oversleep: ms => { overrun = ms; },
    register: index => client.json('/api/patient-auth/register', { method: 'POST', expectedStatus: 201,
      body: registrationBody(syntheticPatient(report.runNamespace, index, 1)) }) };
}

test('normal 95-second pacing and small scheduler delays preserve continuity', async () => {
  for (const jitter of [0, 1500]) {
    const h = harness(); h.oversleep(jitter);
    await h.register(1); await h.register(2);
    const posts = h.calls.filter(c => c.method === 'POST');
    assert.equal(posts.length, 2);
    assert.ok(posts[1].time - posts[0].time >= SENSITIVE_INTERVAL_MS);
    assert.equal(h.client.stopped, null); assert.equal(h.report.gate, 'PASS');
  }
  assert.equal(LONG_PAUSE_TOLERANCE_MS, 60000);
});

test('normal Retry-After waits are scheduled waits, not unexpected pauses', async () => {
  const h = harness(); let attempts = 0;
  const original = h.options.fetchImpl;
  const client = createQaTransport({ ...h.options, fetchImpl: (url, opts) => {
    if (new URL(url).pathname === '/api/patient-auth/address-states' && ++attempts === 1) return json({}, 429, { 'retry-after': '600' });
    return original(url, opts);
  } });
  await client.json('/api/patient-auth/address-states');
  assert.equal(attempts, 2); assert.equal(client.stopped, null);
  assert.equal(publicQaReport(h.report).workflowRetryCount, 1);
});

test('nine-hour oversleep fails closed before the next registration or any further request', async () => {
  const h = harness(); await h.register(1);
  const sent = h.calls.length; h.oversleep(HOURS);
  await assert.rejects(h.register(2), error => error.reason === 'run_long_pause_detected');
  assert.equal(h.calls.length, sent);
  assert.equal(h.calls.filter(c => c.method === 'POST').length, 1);
  assert.equal(h.client.stopped, 'run_long_pause_detected');
  assert.equal(h.report.gate, 'BLOCKED');
});

test('continuity checkpoint catches a pause between registration and capture without a sleep call', async () => {
  const h = harness(); await h.register(1); const sent = h.calls.length;
  h.advance(HOURS);
  await assert.rejects(h.client.workflowFetch(STAGING_API + '/api/qa/verification-capture/123e4567-e89b-42d3-a456-426614174000'),
    error => error.reason === 'run_long_pause_detected');
  await assert.rejects(h.register(2), error => error.reason === 'run_long_pause_detected');
  assert.equal(h.calls.length, sent);
  assert.equal(publicQaReport(h.report).reason, 'run_long_pause_detected');
  assert.equal(JSON.stringify(publicQaReport(h.report)).includes(secret), false);
});

test('oversleep during gate recovery stops before retrying the gate or sending a POST', async () => {
  const h = harness(); const original = h.options.fetchImpl;
  const client = createQaTransport({ ...h.options, fetchImpl: (url, opts) => {
    if (new URL(url).pathname === '/api/health/ready') { h.oversleep(HOURS); throw new Error(secret); }
    return original(url, opts);
  } });
  await assert.rejects(client.checkGate(), error => error.reason === 'run_long_pause_detected');
  assert.equal(h.calls.length, 2); assert.equal(h.report.gateRetryCount, 1);
  assert.equal(h.calls.some(c => c.method === 'POST'), false);
});

test('pause in a POST response is not replayed and preserves its ambiguous mutation outcome', async () => {
  const h = harness(); const original = h.options.fetchImpl;
  const client = createQaTransport({ ...h.options, fetchImpl: async (url, opts) => {
    const response = await original(url, opts);
    if (opts.method === 'POST') h.advance(HOURS);
    return response;
  } });
  await assert.rejects(client.json('/api/patient-auth/register', { method: 'POST',
    body: registrationBody(syntheticPatient(h.report.runNamespace, 1, 1)) }), error =>
    error.reason === 'run_long_pause_detected' && error.mutationOutcomeUnknown === true);
  assert.equal(h.calls.filter(c => c.method === 'POST').length, 1);
  assert.equal(h.report.retries, 0);
});

test('another worker scheduled wait cannot mask a pause between stages', async () => {
  const h = harness(); let wake, sleeping;
  const asleep = new Promise(resolve => { sleeping = resolve; });
  const held = new Promise(resolve => { wake = resolve; });
  const client = createQaTransport({ ...h.options, sleep: async ms => {
    if (ms >= 1000) { sleeping(); await held; }
    h.advance(ms);
  } });
  const register = index => client.json('/api/patient-auth/register', { method: 'POST', expectedStatus: 201,
    body: registrationBody(syntheticPatient(h.report.runNamespace, index, 1)) });
  await register(1); const pending = register(2); await asleep;
  h.advance(85000); const sent = h.calls.length;
  await assert.rejects(client.workflowFetch(STAGING_API + '/api/qa/verification-capture/123e4567-e89b-42d3-a456-426614174000'),
    error => error.reason === 'run_long_pause_detected');
  wake(); await assert.rejects(pending, error => error.reason === 'run_long_pause_detected');
  assert.equal(h.calls.length, sent); assert.equal(h.calls.filter(c => c.method === 'POST').length, 1);
});

test('a POST transport failure after suspension remains ambiguous and is never replayed', async () => {
  const h = harness(); const original = h.options.fetchImpl;
  const client = createQaTransport({ ...h.options, fetchImpl: async (url, opts) => {
    if (opts.method === 'POST') { await original(url, opts); h.advance(HOURS); throw new Error(secret); }
    return original(url, opts);
  } });
  await assert.rejects(client.json('/api/patient-auth/register', { method: 'POST',
    body: registrationBody(syntheticPatient(h.report.runNamespace, 1, 1)) }), error =>
    error.reason === 'run_long_pause_detected' && error.mutationOutcomeUnknown === true);
  assert.equal(h.calls.filter(c => c.method === 'POST').length, 1); assert.equal(h.report.retries, 0);
});

test('full runner stops with a redacted pause reason before capture or another registration', async () => {
  const h = harness(); const original = h.options.fetchImpl;
  const report = await runPatientQa({ ...h.options, fetchImpl: async (url, opts) => {
    const response = await original(url, opts);
    if (new URL(url).pathname === '/api/patient-auth/register') h.oversleep(HOURS);
    return response;
  } });
  assert.equal(report.reason, 'run_long_pause_detected'); assert.equal(report.gate, 'BLOCKED');
  assert.equal(report.patientsCreated, 1); assert.equal(report.patientsVerified, 0);
  assert.equal(h.calls.filter(c => c.method === 'POST').length, 1);
  assert.equal(h.calls.some(c => c.path.startsWith('/api/qa/verification-capture/')), false);
  assert.equal(report.cleanupPerformed, false); assert.equal(JSON.stringify(report).includes(secret), false);
});
