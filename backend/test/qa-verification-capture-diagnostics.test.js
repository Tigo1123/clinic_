import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import express from 'express';
import request from 'supertest';
import { registerQaVerificationCaptureRoutes } from '../src/routes/qaVerificationCapture.js';
import { captureQaVerificationCode } from '../src/utils/qaVerificationCapture.js';
import { CAPTURE_ID, CAPTURE_EMAIL, CAPTURE_CODE, QA_CAPTURE_TEST_ENV, qaCaptureFixture } from './helpers/qaCaptureFixture.js';

const AUTH_CHECK = '/api/qa/verification-capture-auth-check';
const PATH = '/api/qa/verification-capture/' + CAPTURE_ID;
const TOKEN = QA_CAPTURE_TEST_ENV.QA_VERIFICATION_CAPTURE_TOKEN;
function harness(overrides = {}) {
  const env = { ...QA_CAPTURE_TEST_ENV, ...overrides }, fixture = qaCaptureFixture(env), events = [];
  const app = express();
  registerQaVerificationCaptureRoutes(app, { env, prismaClient: fixture.prismaClient, log: { info: (...args) => events.push(args) } });
  return { app, env, fixture, events,
    seed: () => captureQaVerificationCode({ env, prismaClient: fixture.prismaClient,
      challengeId: CAPTURE_ID, recipient: CAPTURE_EMAIL, code: CAPTURE_CODE }) };
}
const get = (h, path = PATH) => request(h.app).get(path).set('Authorization', `Bearer ${TOKEN}`);
function safe(events) {
  const reasons = new Set(['capture_disabled', 'authorization_missing_or_invalid', 'gate_not_allowed',
    'capture_missing', 'challenge_not_valid', 'capture_consumption_failed']);
  for (const [event, context, ...rest] of events) {
    assert.equal(rest.length, 0);
    if (event === 'qa.verification_capture_denied') { assert.deepEqual(Object.keys(context), ['reason']); assert.ok(reasons.has(context.reason)); }
    else { assert.equal(event, 'qa.verification_capture_served'); assert.equal(context, undefined); }
  }
  for (const secret of [TOKEN, CAPTURE_CODE, CAPTURE_ID, CAPTURE_EMAIL, QA_CAPTURE_TEST_ENV.QA_VERIFICATION_CAPTURE_STORAGE_KEY,
    QA_CAPTURE_TEST_ENV.DATABASE_URL, QA_CAPTURE_TEST_ENV.DIRECT_URL, 'Authorization', 'Bearer', 'ciphertext-fixture']) {
    assert.equal(JSON.stringify(events).includes(secret), false);
  }
}

test('auth-check and capture are opaque 404 outside safe staging without DB access', async () => {
  for (const override of [{ APP_ENV: '' }, { DEPLOYMENT_ENV: '' }, { APP_ENV: 'production' },
    { DEPLOYMENT_ENV: ' PRODUCTION ' }, { APP_ENV: 'local', DEPLOYMENT_ENV: 'local' },
    { QA_LOAD_TEST_ALLOWED: 'false' }, { QA_VERIFICATION_CAPTURE_ENABLED: 'false' },
    { QA_VERIFICATION_CAPTURE_TOKEN: '' }, { QA_VERIFICATION_CAPTURE_STORAGE_KEY: '' },
    { QA_NOTIFICATION_MODE: 'external' }, { NOTIFICATIONS_DISABLED: 'false' },
    { SMS_PROVIDER: 'transport' }, { VERIFICATION_PROVIDER: 'development' }]) {
    const h = harness(override);
    for (const path of [PATH, AUTH_CHECK]) assert.equal((await get(h, path).expect(404)).text, 'Not Found');
    assert.equal(h.fixture.queries.length, 0); assert.equal(h.fixture.transactions, 0); safe(h.events);
    if (override.APP_ENV === 'production' || override.DEPLOYMENT_ENV === ' PRODUCTION ') assert.deepEqual(h.events, []);
  }
});

test('missing malformed and incorrect credentials cannot query DB or consume capture', async () => {
  for (const authorization of [undefined, 'Basic synthetic', 'Bearer', `Bearer  ${TOKEN}`, `Bearer ${TOKEN} extra`, 'Bearer Wrong-Synthetic-Token-Longer-Than-Thirty-Two']) {
    const h = harness(); assert.equal(await h.seed(), true);
    const queries = h.fixture.queries.length, transactions = h.fixture.transactions;
    for (const path of [PATH, AUTH_CHECK]) {
      const req = request(h.app).get(path); if (authorization) req.set('Authorization', authorization);
      assert.equal((await req.expect(404)).text, 'Not Found');
    }
    assert.equal(h.fixture.queries.length, queries); assert.equal(h.fixture.transactions, transactions);
    assert.equal(h.fixture.captures.size, 1); safe(h.events);
  }
});

test('auth-check stays HTTP 204 with no body no-store headers and no capture consumption', async () => {
  const h = harness(); await h.seed(); const record = structuredClone(h.fixture.captures.get(CAPTURE_ID));
  const transactions = h.fixture.transactions;
  const response = await get(h, AUTH_CHECK).expect(204);
  assert.equal(response.text, ''); assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.headers.pragma, 'no-cache'); assert.equal(response.headers['x-robots-tag'], 'noindex');
  assert.equal(h.fixture.transactions, transactions); assert.deepEqual(h.fixture.captures.get(CAPTURE_ID), record);
  assert.deepEqual(h.events, []);
});

test('gate configuration identity mismatch and raw DB errors fail closed without exposing a reason', async () => {
  for (const change of ['DATABASE_ENVIRONMENT', 'QA_PAYMENT_MODE', 'identity', 'identityError']) {
    const h = harness();
    if (change === 'identity') h.fixture.identity = { database: 'other', schema: 'public', role: 'clinic_runtime' };
    else if (change === 'identityError') h.fixture.identityError = new Error(TOKEN + CAPTURE_CODE + CAPTURE_EMAIL);
    else h.env[change] = 'production';
    for (const path of [PATH, AUTH_CHECK]) assert.equal((await get(h, path).expect(404)).text, 'Not Found');
    assert.equal(h.fixture.transactions, 0); safe(h.events);
  }
});

test('auth-check is still registered before challenge retrieval and never enters consumption', async () => {
  const h = harness();
  assert.deepEqual(h.app._router.stack.filter(layer => layer.route).map(layer => layer.route.path),
    [AUTH_CHECK, '/api/qa/verification-capture/:challengeId']);
  await get(h, AUTH_CHECK).expect(204);
  assert.equal(h.fixture.transactions, 0); assert.equal(h.fixture.challengeQueries.length, 0);
  const server = await readFile(new URL('../src/server.js', import.meta.url), 'utf8');
  assert.ok(server.includes('registerQaVerificationCaptureRoutes(app, { prismaClient: prisma })'));
});

test('successful capture payload is unchanged and a second request returns opaque 404', async () => {
  const h = harness(); await h.seed();
  const response = await get(h).expect(200);
  assert.deepEqual(Object.keys(response.body).sort(), ['challengeId', 'code', 'expiresAt']);
  assert.equal(response.body.challengeId, CAPTURE_ID); assert.equal(response.body.code === CAPTURE_CODE, true);
  assert.ok(Date.parse(response.body.expiresAt) > Date.now());
  assert.equal(response.headers['cache-control'], 'no-store'); assert.equal(h.fixture.captures.size, 0);
  await get(h).expect(404); safe(h.events);
});

test('concurrent HTTP consumers receive exactly one code and one opaque 404', async () => {
  const h = harness(); await h.seed();
  const responses = await Promise.all([get(h), get(h)]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 404]);
  assert.equal(h.fixture.captures.size, 0); safe(h.events);
});

test('invalid used and expired challenges are discarded and keep failure bodies opaque', async () => {
  for (const change of [c => { c.usedAt = new Date(); }, c => { c.user.status = 'ACTIVE'; },
    c => { c.expiresAt = new Date(0); }, c => { c.authVersion++; }]) {
    const h = harness(); await h.seed(); change(h.fixture.challenge);
    assert.equal((await get(h).expect(404)).text, 'Not Found');
    assert.equal(h.fixture.captures.size, 0);
    assert.deepEqual(h.events, [['qa.verification_capture_denied', { reason: 'challenge_not_valid' }]]); safe(h.events);
  }
});

test('wrong key and raw storage failures never expose ciphertext codes or exceptions in responses or logs', async () => {
  for (const failure of ['key', 'read', 'challenge']) {
    const h = harness(); await h.seed();
    const encrypted = h.fixture.captures.get(CAPTURE_ID).codeEncrypted;
    if (failure === 'key') h.env.QA_VERIFICATION_CAPTURE_STORAGE_KEY = 'b2'.repeat(32);
    else if (failure === 'read') h.fixture.readError = new Error(TOKEN + CAPTURE_CODE + encrypted + 'ciphertext-fixture');
    else h.fixture.challengeError = new Error(TOKEN + CAPTURE_CODE + encrypted);
    const response = await get(h).expect(404);
    assert.equal(response.text, 'Not Found'); assert.equal(response.text.includes(encrypted), false); safe(h.events);
  }
});
