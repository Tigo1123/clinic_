import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import express from 'express';
import request from 'supertest';
import { registerQaCleanupDryRunRoute } from '../src/routes/qaCleanupDryRun.js';
import { QA_CAPTURE_TEST_ENV } from './helpers/qaCaptureFixture.js';

const PATH = '/api/qa/cleanup-dry-run';
const TOKEN = QA_CAPTURE_TEST_ENV.QA_VERIFICATION_CAPTURE_TOKEN;
function harness(overrides = {}) {
  const env = { ...QA_CAPTURE_TEST_ENV, QA_LOAD_TEST_TARGET_ID: 'clinic-staging-qa-20261106', ...overrides };
  const state = { connected: 0, ended: 0 };
  const app = express();
  registerQaCleanupDryRunRoute(app, { env, createClient: () => {
    state.connected++;
    return { on: () => {}, connect: async () => { throw new Error('private-provider-error ' + env.DATABASE_URL + TOKEN + env.QA_VERIFICATION_CAPTURE_STORAGE_KEY); },
      end: async () => { state.ended++; } };
  } });
  app.use(express.json());
  return { app, env, state };
}
const get = h => request(h.app).get(PATH).set('Authorization', 'Bearer ' + TOKEN);

test('temporary cleanup route rejects production, mixed markers and every unsafe gate before DB access', async () => {
  for (const change of [{ APP_ENV: 'production' }, { DEPLOYMENT_ENV: 'production' }, { DATABASE_ENVIRONMENT: 'production' },
    { APP_ENV: '' }, { QA_LOAD_TEST_ALLOWED: 'false' }, { QA_LOAD_TEST_TARGET_ID: 'other-staging-target' },
    { QA_EXPECTED_DATABASE_NAME: 'other' }, { QA_EXPECTED_DATABASE_SCHEMA: 'private' }, { QA_EXPECTED_DATABASE_ROLE: 'owner' },
    { DATABASE_URL: 'postgresql://test:test@localhost/neondb' }, { DIRECT_URL: 'postgresql://test:test@localhost/neondb' },
    { QA_NOTIFICATION_MODE: 'external' }, { NOTIFICATIONS_DISABLED: 'false' }, { SMS_PROVIDER: 'external' },
    { QA_PAYMENT_MODE: 'ledger-only' }, { QA_PAYMENT_MODE: 'enabled' }, { STRIPE_SECRET_KEY: 'synthetic-provider-sentinel' },
    { QA_VERIFICATION_CAPTURE_ENABLED: 'false' }, { QA_VERIFICATION_CAPTURE_STORAGE_KEY: '' }]) {
    const h = harness(change);
    const response = await get(h).expect(404);
    assert.equal(response.text, 'Not Found'); assert.equal(h.state.connected, 0);
    assert.equal(response.headers['cache-control'], 'no-store');
  }
});

test('missing, malformed and wrong capture credentials cannot open a cleanup DB connection', async () => {
  for (const token of [undefined, 'Basic synthetic', 'Bearer', 'Bearer  ' + TOKEN, 'Bearer ' + TOKEN + ' extra', 'Bearer ' + 'x'.repeat(TOKEN.length)]) {
    const h = harness(), req = request(h.app).get(PATH);
    if (token) req.set('Authorization', token);
    assert.equal((await req.expect(404)).text, 'Not Found'); assert.equal(h.state.connected, 0);
  }
});

test('caller namespace/count/execution queries, bodies, alternate methods and alternate paths are rejected', async () => {
  const h = harness();
  for (const suffix of ['?namespace=other', '?QA_EXECUTE_CLEANUP=true', '?execute=true', '?accounts=10', '/']) {
    await request(h.app).get(PATH + suffix).set('Authorization', 'Bearer ' + TOKEN).expect(404);
  }
  for (const method of ['post', 'put', 'patch', 'delete', 'head', 'options']) {
    await request(h.app)[method](PATH).set('Authorization', 'Bearer ' + TOKEN).expect(404);
  }
  await get(h).send({ namespace: 'other', execute: true }).expect(404);
  await get(h).set('Content-Type', 'application/json').send('{invalid-json').expect(404);
  await request(h.app).post('/api/qa/cleanup-execute').set('Authorization', 'Bearer ' + TOKEN).expect(404);
  assert.equal(h.state.connected, 0);
});

test('raw provider errors and secrets never appear in HTTP output or logs', async t => {
  const events = []; t.mock.method(console, 'log', (...args) => events.push(args));
  t.mock.method(console, 'error', (...args) => events.push(args));
  const h = harness({ QA_EXECUTE_CLEANUP: 'true', QA_CLEANUP_NAMESPACE: 'other', QA_EXPECTED_CLEANUP_ACCOUNTS: '999' });
  const response = await get(h).expect(409);
  assert.deepEqual(response.body, { result: 'REFUSED', reason: 'cleanup_failed' });
  assert.equal(h.state.connected, 1); assert.equal(h.state.ended, 1);
  const output = response.text + JSON.stringify(events);
  for (const secret of [TOKEN, h.env.DATABASE_URL, h.env.QA_VERIFICATION_CAPTURE_STORAGE_KEY, 'private-provider-error']) assert.equal(output.includes(secret), false);
  assert.deepEqual(events, []);
});

test('server registers the read-only route before body parsing and has no cleanup execution route', async () => {
  const server = await readFile(new URL('../src/server.js', import.meta.url), 'utf8');
  assert.ok(server.indexOf('registerQaCleanupDryRunRoute(app);') < server.indexOf('app.use(express.json())'));
  assert.equal(server.includes('cleanup-execute'), false);
});
