import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import express from 'express';
import request from 'supertest';
import { registerQaCleanupExecuteRoute } from '../src/routes/qaCleanupExecute.js';
import { registerQaCleanupDryRunRoute } from '../src/routes/qaCleanupDryRun.js';
import { CleanupRefusal } from '../scripts/cleanup-staging-qa.mjs';

const PATH = '/api/qa/cleanup-execute';
const TOKEN = 'synthetic-execution-fixture-credential-not-a-real-secret';
const SAFE_ENV = {
  NODE_ENV: 'production', APP_ENV: 'staging', DEPLOYMENT_ENV: 'staging', DATABASE_ENVIRONMENT: 'staging',
  QA_LOAD_TEST_ALLOWED: 'true', QA_LOAD_TEST_TARGET_ID: 'clinic-staging-qa-20261106',
  QA_EXPECTED_DATABASE_NAME: 'neondb', QA_EXPECTED_DATABASE_SCHEMA: 'public', QA_EXPECTED_DATABASE_ROLE: 'clinic_runtime',
  QA_NOTIFICATION_MODE: 'sink', NOTIFICATIONS_DISABLED: 'true', SMS_PROVIDER: 'disabled', QA_PAYMENT_MODE: 'disabled',
  VERIFICATION_PROVIDER: 'email', QA_VERIFICATION_CAPTURE_ENABLED: 'true', QA_VERIFICATION_CAPTURE_TOKEN: TOKEN,
  QA_CLEANUP_EXECUTION_ALLOWED: 'true',
  DATABASE_URL: 'postgresql://synthetic:fixture@ep-muddy-unit-b4hvj7be-pooler.c-6.us-east-2.aws.neon.tech/neondb?schema=public&sslmode=verify-full',
  DIRECT_URL: 'postgresql://synthetic:fixture@ep-muddy-unit-b4hvj7be.c-6.us-east-2.aws.neon.tech/neondb?schema=public&sslmode=verify-full'
};
const IDENTITY = { database: 'neondb', schema: 'public', role: 'clinic_runtime' };

function harness(overrides = {}, options = {}) {
  const env = { ...SAFE_ENV, ...overrides }, identities = [], clients = [], queries = [];
  const app = express();
  const dependencies = { env, prismaClient: { $queryRaw: async () => {
    identities.push(true);
    if (options.gateError) throw options.gateError;
    return [options.gateIdentity || IDENTITY];
  } }, createClient: clientOptions => {
    const state = { options: clientOptions, ended: false, errorListener: null }; clients.push(state);
    return {
      on: (event, listener) => { assert.equal(event, 'error'); state.errorListener = listener; },
      connect: async () => { if (options.connectError) throw options.connectError; },
      end: async () => { state.ended = true; },
      query: async (sql, values) => {
        queries.push({ sql, values });
        if (sql.startsWith('SELECT current_database')) return { rows: [options.cleanupIdentity || IDENTITY] };
        if (sql.includes('AS count FROM pg_catalog.pg_class')) return { rows: [{ count: 8 }] };
        // No real records: exact-count validation must refuse before deletion.
        if (sql.includes('FROM public."User"')) return { rows: [] };
        assert.ok(/^(BEGIN|SET LOCAL|ROLLBACK)/.test(sql));
        return { rows: [] };
      }
    };
  } };
  registerQaCleanupExecuteRoute(app, dependencies);
  registerQaCleanupDryRunRoute(app, dependencies);
  app.use(express.json());
  return { app, env, identities, clients, queries };
}
const post = h => request(h.app).post(PATH).set('Authorization', `Bearer ${TOKEN}`);
function untouched(h) { assert.equal(h.identities.length, 0); assert.equal(h.clients.length, 0); assert.equal(h.queries.length, 0); }

test('execution is opaque 404 before DB access for production, mixed, missing and unsafe staging markers', async () => {
  for (const overrides of [
    { APP_ENV: 'production' }, { DEPLOYMENT_ENV: 'production' }, { DATABASE_ENVIRONMENT: 'production' },
    { APP_ENV: ' STAGING ', DEPLOYMENT_ENV: ' PRODUCTION ' }, { APP_ENV: 'local', DEPLOYMENT_ENV: 'local' },
    { APP_ENV: '' }, { DEPLOYMENT_ENV: '' }, { DATABASE_ENVIRONMENT: '' }, { QA_LOAD_TEST_ALLOWED: 'false' },
    { QA_LOAD_TEST_TARGET_ID: 'other-staging-target' }, { QA_EXPECTED_DATABASE_NAME: 'other' },
    { QA_EXPECTED_DATABASE_SCHEMA: 'private' }, { QA_EXPECTED_DATABASE_ROLE: 'owner' },
    { QA_NOTIFICATION_MODE: 'external' }, { NOTIFICATIONS_DISABLED: 'false' }, { SMS_PROVIDER: 'transport' },
    { QA_PAYMENT_MODE: 'external' }, { QA_PAYMENT_MODE: 'ledger-only' }, { PAYMENT_API_KEY: 'synthetic-payment-key' },
    { QA_VERIFICATION_CAPTURE_ENABLED: 'false' }, { VERIFICATION_PROVIDER: 'development' },
    { DATABASE_URL: 'postgresql://synthetic:fixture@localhost/neondb' }
  ]) {
    const h = harness(overrides);
    assert.equal((await post(h).expect(404)).text, 'Not Found'); untouched(h);
  }
});

test('separate execution authorization marker must be exactly true regardless of inherited execution flag', async () => {
  for (const marker of [undefined, '', 'false', 'TRUE', ' true ', '1']) {
    const h = harness({ QA_CLEANUP_EXECUTION_ALLOWED: marker, QA_EXECUTE_CLEANUP: 'true' });
    assert.equal((await post(h).expect(404)).text, 'Not Found'); untouched(h);
  }
});

test('missing, malformed and wrong credentials return opaque 404 without DB access', async () => {
  for (const token of [undefined, 'Bearer Wrong-Synthetic-Credential', 'Bearer', `Bearer  ${TOKEN}`, `Bearer ${TOKEN} extra`, `Basic ${TOKEN}`]) {
    const h = harness(); const req = request(h.app).post(PATH);
    if (token) req.set('Authorization', token);
    assert.equal((await req.expect(404)).text, 'Not Found'); untouched(h);
  }
});

test('only exact POST path without query parameters may reach execution validation', async () => {
  for (const suffix of ['?namespace=qa-20261106-deadbeef', '?counts=0', '?QA_EXECUTE_CLEANUP=true',
    '?QA_EXPECTED_CLEANUP_ACCOUNTS=0', '?QA_EXPECTED_CLEANUP_APPOINTMENTS=0', '?sql=DELETE', '?command=node',
    '?DATABASE_URL=untrusted', '/', '/other']) {
    const h = harness();
    await request(h.app).post(PATH + suffix).set('Authorization', `Bearer ${TOKEN}`).expect(404); untouched(h);
  }
  const h = harness();
  await request(h.app).post('/api/qa/CLEANUP-EXECUTE').set('Authorization', `Bearer ${TOKEN}`).expect(404); untouched(h);
});

test('bodies, including empty or malformed JSON and chunked requests, are rejected before parsing', async () => {
  for (const body of ['{}', '{invalid', '{"namespace":"other","counts":0,"execute":true}', 'sql=DELETE']) {
    const h = harness();
    await post(h).set('Content-Type', 'application/json').send(body).expect(404); untouched(h);
  }
  const h = harness();
  await post(h).set('Transfer-Encoding', 'chunked').expect(404); untouched(h);
});

test('GET PUT PATCH DELETE HEAD and OPTIONS cannot execute', async () => {
  for (const method of ['get', 'put', 'patch', 'delete', 'head', 'options']) {
    const h = harness();
    await request(h.app)[method](PATH).set('Authorization', `Bearer ${TOKEN}`).expect(404); untouched(h);
  }
});

test('unsafe fresh database identity or identity error returns opaque 404 before cleanup connection', async () => {
  for (const options of [{ gateIdentity: { ...IDENTITY, role: 'owner' } },
    { gateIdentity: { ...IDENTITY, database: 'other' } }, { gateIdentity: { ...IDENTITY, schema: 'private' } },
    { gateError: new Error(`${TOKEN} ${SAFE_ENV.DATABASE_URL}`) }]) {
    const h = harness({}, options);
    assert.equal((await post(h).expect(404)).text, 'Not Found');
    assert.equal(h.identities.length, 1); assert.equal(h.clients.length, 0);
  }
});

test('namespace, counts and execution flag are internally forced and inherited environment stays unchanged', async () => {
  const h = harness({ QA_CLEANUP_NAMESPACE: 'qa-20261106-deadbeef', QA_EXPECTED_CLEANUP_ACCOUNTS: '0',
    QA_EXPECTED_CLEANUP_APPOINTMENTS: '0', QA_EXECUTE_CLEANUP: 'false' });
  const before = { ...h.env };
  const response = await post(h).expect(409);
  assert.deepEqual(response.body, { result: 'REFUSED', reason: 'count_mismatch' });
  assert.equal(h.queries[0].sql, 'BEGIN ISOLATION LEVEL SERIALIZABLE');
  assert.equal(h.queries.at(-1).sql, 'ROLLBACK');
  const emails = h.queries.find(q => q.sql.includes('FROM public."User"')).values[0];
  assert.equal(emails.length, 1000);
  assert.ok(emails.every(value => /^qa-20261106-c16af28a\+patient-\d{3}@example\.invalid$/.test(value)));
  assert.equal(h.queries.some(q => /\bDELETE\b/.test(q.sql)), false);
  assert.equal(h.clients[0].options.connectionString === SAFE_ENV.DATABASE_URL, true);
  assert.equal(h.clients[0].options.connectionTimeoutMillis, 10_000);
  assert.equal(h.clients[0].ended, true); assert.deepEqual(h.env, before);
  assert.equal(response.headers['cache-control'], 'no-store');
});

test('identity is checked again within the transaction and mismatch is opaque 404 plus rollback', async () => {
  const h = harness({}, { cleanupIdentity: { ...IDENTITY, role: 'owner' } });
  assert.equal((await post(h).expect(404)).text, 'Not Found');
  assert.equal(h.queries.at(-1).sql, 'ROLLBACK');
  assert.equal(h.queries.some(q => /\bDELETE\b/.test(q.sql)), false);
});

test('dry-run remains read-only with both authorization and execution markers true', async () => {
  const h = harness({ QA_EXECUTE_CLEANUP: 'true' });
  const response = await request(h.app).get('/api/qa/cleanup-dry-run').set('Authorization', `Bearer ${TOKEN}`).expect(409);
  assert.deepEqual(response.body, { result: 'REFUSED', reason: 'count_mismatch' });
  assert.equal(h.queries[0].sql, 'BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY');
  assert.equal(h.queries.at(-1).sql, 'ROLLBACK');
  assert.equal(h.queries.some(q => /\bDELETE\b/.test(q.sql)), false);
});

test('connection errors, forged reasons and error events cannot expose secrets in response or logs', async () => {
  const secret = `${TOKEN} ${SAFE_ENV.DATABASE_URL} jwt-fixture password-fixture 123456`;
  const forged = new CleanupRefusal('count_mismatch'); forged.reason = secret;
  const output = [], original = {};
  for (const method of ['log', 'error', 'warn']) { original[method] = console[method]; console[method] = (...args) => output.push(args); }
  try {
    for (const error of [new Error(secret), forged]) {
      const h = harness({}, { connectError: error });
      assert.deepEqual((await post(h).expect(409)).body, { result: 'REFUSED', reason: 'cleanup_failed' });
      h.clients[0].errorListener(new Error(secret));
      assert.equal(h.clients[0].ended, true);
    }
    assert.deepEqual(output, []);
  } finally { for (const [method, fn] of Object.entries(original)) console[method] = fn; }
});

test('execution route is mounted before JSON parsing and creates a frozen private snapshot', async () => {
  const server = await readFile(new URL('../src/server.js', import.meta.url), 'utf8');
  assert.ok(server.indexOf('registerQaCleanupExecuteRoute(app, { prismaClient: prisma })') < server.indexOf('app.use(express.json())'));
  const route = await readFile(new URL('../src/routes/qaCleanupExecute.js', import.meta.url), 'utf8');
  assert.ok(route.includes('const snapshot = Object.freeze({ ...env,'));
});
