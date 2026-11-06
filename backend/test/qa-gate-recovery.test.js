import test from 'node:test';
import assert from 'node:assert/strict';
import { createQaTransport } from '../scripts/qaTransport.mjs';
import { createQaReport, publicQaReport } from '../scripts/qaReport.mjs';
import { registrationBody, STAGING_API, STAGING_TARGET, syntheticPatient } from '../scripts/qaPatientPlan.mjs';

const env = { QA_API_ORIGIN: STAGING_API, QA_EXPECTED_API_ORIGIN: STAGING_API,
  QA_EXPECTED_TARGET_ID: STAGING_TARGET, QA_VERIFICATION_CAPTURE_TOKEN: 'synthetic-recovery-credential-not-a-real-secret',
  QA_EXECUTE_PATIENT_WORKFLOWS: 'true' };
const target = { service: 'clinic-api', environment: 'staging', loadTestAllowed: true, targetId: STAGING_TARGET,
  databaseEnvironment: 'staging', databaseIdentity: 'verified', notifications: 'sink',
  verificationCapture: 'enabled', payments: 'disabled', reasons: [] };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const sequence = ['/api/health/load-test-target', '/api/health', '/api/health/ready'];

function setup({ failures = 0, override, delay, signal } = {}) {
  let remaining = failures;
  let time = Date.now();
  const calls = [];
  const delays = [];
  const report = createQaReport(); report.runNamespace = 'qa-20261106-a1b2c3d4';
  const client = createQaTransport({ env, report, signal, now: () => time,
    sleep: async ms => { delays.push(ms); await delay?.(ms); time += ms; },
    fetchImpl: async (input, options) => {
      const path = new URL(input).pathname; calls.push({ path, method: options.method });
      const custom = await override?.(path, options);
      if (custom) return custom;
      if (path === '/api/health/ready' && remaining-- > 0) throw new TypeError('synthetic network failure; never serialize this exception');
      if (path === sequence[0]) return json(target);
      if (path === sequence[1]) return json({ status: 'alive' });
      if (path === sequence[2]) return json({ status: 'healthy' });
      if (path === '/api/patient-auth/register') return json({ state: 'VERIFICATION_REQUIRED' }, 201);
      assert.fail('unexpected test request');
    }
  });
  const register = () => client.json('/api/patient-auth/register', {
    method: 'POST', expectedStatus: 201, body: registrationBody(syntheticPatient(report.runNamespace, 1, 1))
  });
  return { client, calls, report, delays, register };
}

for (const failures of [1, 2]) {
  test(`${failures} transient gate timeout(s) retry the full sequence before registration`, async () => {
    const h = setup({ failures });
    await h.register();
    assert.deepEqual(h.calls.map(c => c.path), [...Array.from({ length: failures + 1 }, () => sequence).flat(), '/api/patient-auth/register']);
    assert.equal(h.report.gate, 'PASS');
    assert.equal(h.report.gateRetryCount, failures);
    assert.equal(h.report.gateChecks, failures + 1);
    assert.deepEqual(h.delays.filter(ms => ms >= 2000), [2000, 5000].slice(0, failures));
    assert.equal(publicQaReport(h.report).gateRetryCount, failures);
    assert.equal(publicQaReport(h.report).retryCount, failures);
  });
}

test('three gate transport failures exhaust the budget and create zero patients', async () => {
  const h = setup({ failures: 3 });
  await assert.rejects(h.register(), error => error.reason === 'gate_transport_retry_exhausted');
  assert.equal(h.report.gateRetryCount, 2);
  assert.equal(h.report.gateChecks, 3);
  assert.equal(h.report.gate, 'BLOCKED');
  assert.equal(h.client.stopped, 'gate_transport_retry_exhausted');
  assert.ok(h.calls.every(c => c.method === 'GET'));
});

test('content, identity, unsafe configuration and explicit non-PASS failures never retry', async () => {
  for (const changes of [{ targetId: 'wrong-staging-target' }, { notifications: 'external' }, { payments: 'enabled' },
    { loadTestAllowed: false }, { environment: 'production' }, { databaseIdentity: 'unverified' }, { reasons: ['unsafe'] }]) {
    const h = setup({ override: path => path === sequence[0] ? json({ ...target, ...changes }) : null });
    await assert.rejects(h.register());
    assert.equal(h.report.gateRetryCount, 0);
    assert.equal(h.client.stopped, 'gate_invalid');
    assert.ok(h.calls.every(c => c.method === 'GET'));
  }
});

test('HTTP failures, HTML and invalid JSON are never treated as transient transport failures', async () => {
  for (const response of [() => json({}, 401), () => json({}, 403), () => json({}, 503), () => json({ status: 'unhealthy' }),
    () => new Response('{invalid', { headers: { 'content-type': 'application/json' } }),
    () => new Response('<html>not API</html>', { headers: { 'content-type': 'text/html' } })]) {
    const h = setup({ override: path => path === sequence[1] ? response() : null });
    await assert.rejects(h.register());
    assert.equal(h.report.gateRetryCount, 0);
    assert.ok(h.calls.every(c => c.method === 'GET'));
  }
});

test('a transport retry that discovers an unsafe target stops immediately without a second retry', async () => {
  let targets = 0;
  const h = setup({ failures: 1, override: path => {
    if (path === sequence[0] && ++targets > 1) return json({ ...target, targetId: 'wrong-target' });
  } });
  await assert.rejects(h.register(), error => error.reason === 'gate_invalid');
  assert.equal(h.report.gateRetryCount, 1);
  assert.equal(h.report.gateChecks, 2);
  assert.ok(h.calls.every(c => c.method === 'GET'));
});

test('abort during retry delay stops without another check or any mutation', async () => {
  const controller = new AbortController();
  const h = setup({ failures: 1, signal: controller.signal, delay: ms => { if (ms === 2000) controller.abort(); } });
  await assert.rejects(h.register(), error => error.reason === 'run_interrupted');
  assert.equal(h.report.gate, 'BLOCKED');
  assert.equal(h.report.gateChecks, 1);
  assert.equal(h.calls.length, 3);
});

test('abort during a fetch is never retried', async () => {
  const controller = new AbortController();
  const h = setup({ signal: controller.signal, override: path => {
    if (path === sequence[1]) { controller.abort(); throw new Error('aborted'); }
  } });
  await assert.rejects(h.register(), error => error.reason === 'run_interrupted');
  assert.equal(h.report.gateRetryCount, 0);
  assert.equal(h.report.gate, 'BLOCKED');
});

test('an earlier PASS cannot release registration while a fresh gate retry is pending', async () => {
  let fail = false;
  let release;
  let sleeping;
  const asleep = new Promise(resolve => { sleeping = resolve; });
  const hold = new Promise(resolve => { release = resolve; });
  const h = setup({ override: path => {
    if (path === sequence[2] && fail) { fail = false; throw new Error('network'); }
  }, delay: ms => { if (ms === 2000) { sleeping(); return hold; } } });
  await h.client.checkGate();
  fail = true;
  const pending = h.register();
  await asleep;
  assert.equal(h.report.gate, 'CHECKING');
  assert.equal(h.calls.some(c => c.method === 'POST'), false);
  release();
  await pending;
  assert.equal(h.report.gate, 'PASS');
  assert.deepEqual(h.calls.slice(-4).map(c => c.path), [...sequence, '/api/patient-auth/register']);
});

test('mutation failures are never retried by gate recovery and reports contain no exceptions', async () => {
  const secret = 'synthetic-sensitive-failure-fixture';
  const h = setup({ override: (path, options) => { if (options.method === 'POST') throw new Error(secret); } });
  await assert.rejects(h.register(), error => error.reason === 'mutation_outcome_unknown');
  assert.equal(h.report.gateRetryCount, 0);
  assert.equal(h.calls.filter(c => c.method === 'POST').length, 1);
  assert.equal(JSON.stringify(publicQaReport(h.report)).includes(secret), false);
});
