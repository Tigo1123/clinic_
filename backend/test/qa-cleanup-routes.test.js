import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import express from 'express';
import request from 'supertest';
import { registerQaCleanupRoutes } from '../src/routes/qaCleanup.js';
import { QA_CAPTURE_TEST_ENV } from './helpers/qaCaptureFixture.js';

const DRY = '/api/qa/cleanup-dry-run';
const EXECUTE = '/api/qa/cleanup-execute';
const NAMESPACE = 'qa-20261106-73412c3e';
const TOKEN = QA_CAPTURE_TEST_ENV.QA_VERIFICATION_CAPTURE_TOKEN;
const IDENTITY = { database: 'neondb', schema: 'public', role: 'clinic_runtime' };

function harness(overrides = {}) {
  const env = { ...QA_CAPTURE_TEST_ENV, QA_LOAD_TEST_TARGET_ID: 'clinic-staging-qa-20261106',
    QA_CLEANUP_EXECUTION_ALLOWED: 'true', ...overrides };
  const state = { clients: 0, connected: 0, ended: 0, statements: [], errors: [] };
  const app = express();
  registerQaCleanupRoutes(app, { env, createClient: () => {
    state.clients++;
    const number = state.clients;
    return {
      on: () => {},
      connect: async () => { state.connected++; },
      query: async sql => {
        state.statements.push(String(sql));
        if (String(sql).startsWith('SELECT current_database')) return { rows: [IDENTITY] };
        throw new Error('private-db-error ' + TOKEN + env.DATABASE_URL + env.QA_VERIFICATION_CAPTURE_STORAGE_KEY);
      },
      end: async () => { state.ended++; }
    };
  } });
  app.use(express.json());
  return { app, env, state };
}
const auth = req => req.set('Authorization', `Bearer ${TOKEN}`);
async function sendChunkedWithoutLength(app) {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    return await new Promise((resolve, reject) => {
      const req = httpRequest({ host: '127.0.0.1', port: server.address().port, path: EXECUTE,
        method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Transfer-Encoding': 'chunked' } }, res => {
        res.resume(); res.once('end', () => resolve(res.statusCode));
      });
      req.once('error', reject); req.write('{}'); req.end();
    });
  } finally { await new Promise(resolve => server.close(resolve)); }
}

test('execution marker must be exact true and unsafe environment/auth fail before database access', async () => {
  for (const change of [
    { QA_CLEANUP_EXECUTION_ALLOWED: undefined }, { QA_CLEANUP_EXECUTION_ALLOWED: 'false' },
    { QA_CLEANUP_EXECUTION_ALLOWED: 'TRUE' }, { QA_CLEANUP_EXECUTION_ALLOWED: ' true ' },
    { QA_CLEANUP_EXECUTION_ALLOWED: '1' }, { APP_ENV: 'production' }, { DEPLOYMENT_ENV: 'production' },
    { DATABASE_ENVIRONMENT: 'production' }, { APP_ENV: 'local' }, { QA_LOAD_TEST_ALLOWED: 'false' },
    { QA_LOAD_TEST_TARGET_ID: 'other-target' }, { QA_EXPECTED_DATABASE_NAME: 'production' },
    { QA_EXPECTED_DATABASE_SCHEMA: 'private' }, { QA_EXPECTED_DATABASE_ROLE: 'owner' },
    { QA_NOTIFICATION_MODE: 'external' }, { NOTIFICATIONS_DISABLED: 'false' }, { SMS_PROVIDER: 'enabled' },
    { QA_PAYMENT_MODE: 'ledger-only' }, { QA_VERIFICATION_CAPTURE_ENABLED: 'false' }
  ]) {
    const h = harness(change);
    await auth(request(h.app).post(EXECUTE)).expect(404);
    assert.equal(h.state.clients, 0);
  }
  for (const authorization of [undefined, 'Basic synthetic', 'Bearer', `Bearer  ${TOKEN}`,
    `Bearer ${TOKEN} extra`, `Bearer ${'x'.repeat(TOKEN.length)}`]) {
    const h = harness(); const req = request(h.app).post(EXECUTE); if (authorization) req.set('Authorization', authorization);
    await req.expect(404); assert.equal(h.state.clients, 0);
  }
});

test('execution accepts only the exact POST with no query, body, malformed JSON or alternate path', async () => {
  const h = harness();
  for (const method of ['get', 'put', 'patch', 'delete', 'head', 'options']) {
    await auth(request(h.app)[method](EXECUTE)).expect(404);
  }
  for (const suffix of ['?namespace=other', '?accounts=9', '?execute=false', '/extra', '/']) {
    await auth(request(h.app).post(EXECUTE + suffix)).expect(404);
  }
  await auth(request(h.app).post(EXECUTE)).send({}).expect(404);
  await auth(request(h.app).post(EXECUTE)).set('Content-Type', 'application/json').send('{bad-json').expect(404);
  assert.equal(await sendChunkedWithoutLength(h.app), 404);
  assert.equal(h.state.clients, 0);
});

test('cleanup paths are hard-pinned and preserve safe failures without exposing secrets', async () => {
  const h = harness({ QA_CLEANUP_NAMESPACE: 'qa-20261107-395a4fb6',
    QA_EXPECTED_CLEANUP_ACCOUNTS: '1', QA_EXPECTED_CLEANUP_APPOINTMENTS: '0', QA_EXECUTE_CLEANUP: 'false' });
  const response = await auth(request(h.app).post(EXECUTE)).expect(409);
  assert.deepEqual(response.body, { result: 'REFUSED', reason: 'cleanup_failed' });
  assert.equal(h.state.clients, 2); assert.equal(h.state.connected, 2); assert.equal(h.state.ended, 2);
  assert.deepEqual(h.state.statements.filter(sql => sql.startsWith('BEGIN')), ['BEGIN ISOLATION LEVEL SERIALIZABLE']);
  for (const sensitive of [TOKEN, h.env.DATABASE_URL, h.env.QA_VERIFICATION_CAPTURE_STORAGE_KEY,
    NAMESPACE, 'private-db-error', 'qa-20261107-395a4fb6']) {
    assert.equal((response.text + JSON.stringify(h.state.errors)).includes(sensitive), false);
  }
});

test('dry-run remains permanently read-only even with execution marker and inherited true flag', async () => {
  const h = harness({ QA_EXECUTE_CLEANUP: 'true' });
  const response = await auth(request(h.app).get(DRY)).expect(409);
  assert.deepEqual(response.body, { result: 'REFUSED', reason: 'cleanup_failed' });
  assert.deepEqual(h.state.statements.filter(sql => sql.startsWith('BEGIN')),
    ['BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY']);
});

test('server mounts both exact cleanup routes before CORS and JSON parsing', async () => {
  const server = await readFile(new URL('../src/server.js', import.meta.url), 'utf8');
  assert.ok(server.indexOf('registerQaCleanupRoutes(app);') < server.indexOf('app.use(corsMiddleware'));
  assert.ok(server.indexOf('registerQaCleanupRoutes(app);') < server.indexOf('app.use(express.json())'));
});
