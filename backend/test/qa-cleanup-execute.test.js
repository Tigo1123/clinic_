import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { registerQaCleanupExecuteRoute } from '../src/routes/qaCleanupExecute.js';
import { QA_CAPTURE_TEST_ENV } from './helpers/qaCaptureFixture.js';

const PATH = '/api/qa/cleanup-execute', TOKEN = QA_CAPTURE_TEST_ENV.QA_VERIFICATION_CAPTURE_TOKEN;
function harness(overrides = {}) {
  const env = { ...QA_CAPTURE_TEST_ENV, QA_LOAD_TEST_TARGET_ID: 'clinic-staging-qa-20261106', QA_CLEANUP_EXECUTION_ALLOWED: 'true', ...overrides };
  const state = { connected: 0, ended: 0 }, app = express();
  registerQaCleanupExecuteRoute(app, { env, createClient: () => {
    state.connected++;
    return { on: () => {}, connect: async () => { throw new Error('private-provider-error ' + env.DATABASE_URL + TOKEN + env.QA_VERIFICATION_CAPTURE_STORAGE_KEY); }, end: async () => { state.ended++; } };
  } });
  app.use(express.json()); return { app, env, state };
}
const post = h => request(h.app).post(PATH).set('Authorization', 'Bearer ' + TOKEN);

test('execution requires explicit exact authorization marker and all safe staging pins before DB access', async () => {
  for (const change of [{ QA_CLEANUP_EXECUTION_ALLOWED: undefined }, { QA_CLEANUP_EXECUTION_ALLOWED: 'false' }, { QA_CLEANUP_EXECUTION_ALLOWED: ' true ' },
    { APP_ENV: 'production' }, { DEPLOYMENT_ENV: 'production' }, { DATABASE_ENVIRONMENT: 'production' }, { APP_ENV: '' },
    { QA_LOAD_TEST_ALLOWED: 'false' }, { QA_LOAD_TEST_TARGET_ID: 'other-staging-target' }, { QA_EXPECTED_DATABASE_NAME: 'other' },
    { QA_EXPECTED_DATABASE_SCHEMA: 'private' }, { QA_EXPECTED_DATABASE_ROLE: 'owner' }, { QA_PAYMENT_MODE: 'ledger-only' },
    { QA_NOTIFICATION_MODE: 'external' }, { NOTIFICATIONS_DISABLED: 'false' }, { SMS_PROVIDER: 'external' },
    { QA_VERIFICATION_CAPTURE_ENABLED: 'false' }, { QA_VERIFICATION_CAPTURE_STORAGE_KEY: '' },
    { DATABASE_URL: 'postgresql://test:test@localhost/neondb' }, { STRIPE_SECRET_KEY: 'synthetic-sentinel' }]) {
    const h = harness(change); assert.equal((await post(h).expect(404)).text, 'Not Found'); assert.equal(h.state.connected, 0);
  }
});

test('missing, wrong and malformed Bearer credentials never connect', async () => {
  for (const authorization of [undefined, 'Basic synthetic', 'Bearer', 'Bearer  ' + TOKEN, 'Bearer ' + TOKEN + ' extra', 'Bearer ' + 'x'.repeat(TOKEN.length)]) {
    const h = harness(), req = request(h.app).post(PATH); if (authorization) req.set('Authorization', authorization);
    await req.expect(404); assert.equal(h.state.connected, 0);
  }
});

test('execution accepts only exact POST without body/query and cannot accept caller cleanup options', async () => {
  const h = harness();
  for (const method of ['get', 'put', 'patch', 'delete', 'head', 'options']) await request(h.app)[method](PATH).set('Authorization', 'Bearer ' + TOKEN).expect(404);
  for (const suffix of ['?namespace=other', '?accounts=9', '?execute=true', '/']) await request(h.app).post(PATH + suffix).set('Authorization', 'Bearer ' + TOKEN).expect(404);
  await post(h).send({ namespace: 'other', execute: true }).expect(404);
  await post(h).set('Content-Type', 'application/json').send('{invalid-json').expect(404);
  assert.equal(h.state.connected, 0);
});

test('inherited cleanup overrides are ignored and raw DB exceptions never reach responses/logs', async t => {
  const events = []; t.mock.method(console, 'log', (...args) => events.push(args)); t.mock.method(console, 'error', (...args) => events.push(args));
  const h = harness({ QA_EXECUTE_CLEANUP: 'false', QA_CLEANUP_NAMESPACE: 'other', QA_EXPECTED_CLEANUP_ACCOUNTS: '999' });
  const response = await post(h).expect(409);
  assert.deepEqual(response.body, { result: 'REFUSED', reason: 'cleanup_failed' });
  assert.equal(h.state.connected, 1); assert.equal(h.state.ended, 1);
  for (const value of [TOKEN, h.env.DATABASE_URL, h.env.QA_VERIFICATION_CAPTURE_STORAGE_KEY, 'private-provider-error']) assert.equal((response.text + JSON.stringify(events)).includes(value), false);
  assert.deepEqual(events, []);
});
