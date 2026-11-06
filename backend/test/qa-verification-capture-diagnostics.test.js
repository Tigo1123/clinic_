import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import express from 'express';
import request from 'supertest';
import { registerQaVerificationCaptureRoutes } from '../src/routes/qaVerificationCapture.js';
import {
  captureQaVerificationCode, clearQaVerificationCapturesForTests,
  discardQaVerificationCapture, peekQaVerificationCapture
} from '../src/utils/qaVerificationCapture.js';

const AUTH_CHECK = '/api/qa/verification-capture-auth-check';
const CHALLENGE_ID = '123e4567-e89b-42d3-a456-426614174000';
const CAPTURE_PATH = `/api/qa/verification-capture/${CHALLENGE_ID}`;
const TOKEN = 'Synthetic-Capture-Auth-Token-Not-A-Real-Secret';
const CODE = '987654';
const EMAIL = 'qa-20261106-a1b2c3d4+patient-001@example.invalid';
const SAFE_ENV = {
  NODE_ENV: 'production', APP_ENV: 'staging', DEPLOYMENT_ENV: 'staging',
  QA_LOAD_TEST_ALLOWED: 'true', QA_VERIFICATION_CAPTURE_ENABLED: 'true',
  QA_VERIFICATION_CAPTURE_TOKEN: TOKEN, VERIFICATION_PROVIDER: 'email',
  QA_NOTIFICATION_MODE: 'sink', NOTIFICATIONS_DISABLED: 'true', SMS_PROVIDER: 'disabled',
  DATABASE_ENVIRONMENT: 'staging', QA_LOAD_TEST_TARGET_ID: 'staging-qa-diagnostic-fixture',
  QA_EXPECTED_DATABASE_NAME: 'neondb', QA_EXPECTED_DATABASE_SCHEMA: 'public',
  QA_EXPECTED_DATABASE_ROLE: 'staging_fixture_runtime', QA_PAYMENT_MODE: 'disabled',
  DATABASE_URL: 'postgresql://synthetic:fixture@ep-muddy-unit-b4hvj7be-pooler.c-6.us-east-2.aws.neon.tech/neondb?schema=public&sslmode=verify-full',
  DIRECT_URL: 'postgresql://synthetic:fixture@ep-muddy-unit-b4hvj7be.c-6.us-east-2.aws.neon.tech/neondb?schema=public&sslmode=verify-full'
};
const DENIAL_REASONS = new Set(['capture_disabled', 'authorization_missing_or_invalid', 'gate_not_allowed',
  'capture_missing', 'challenge_not_valid', 'capture_consumption_failed']);

beforeEach(clearQaVerificationCapturesForTests);
afterEach(clearQaVerificationCapturesForTests);

function harness(overrides = {}, { identity, challenge } = {}) {
  const env = { ...SAFE_ENV, ...overrides };
  const events = [];
  const identityQueries = [];
  const challengeQueries = [];
  const prismaClient = {
    $queryRaw: async (...args) => {
      identityQueries.push(args);
      return identity ? identity() : [{ database: 'neondb', schema: 'public', role: 'staging_fixture_runtime' }];
    },
    verificationChallenge: { findFirst: async query => {
      challengeQueries.push(query);
      return challenge ? challenge(query) : { id: CHALLENGE_ID };
    } }
  };
  const app = express();
  registerQaVerificationCaptureRoutes(app, { prismaClient, env, log: { info: (...args) => events.push(args) } });
  return { app, env, events, identityQueries, challengeQueries };
}

async function seedCapture(env = SAFE_ENV) {
  const captured = await captureQaVerificationCode({
    env, challengeId: CHALLENGE_ID, recipient: EMAIL, code: CODE,
    findValidChallenge: async () => ({ id: CHALLENGE_ID, type: 'REGISTRATION_EMAIL', targetNormalized: EMAIL,
      usedAt: null, expiresAt: new Date(Date.now() + 60_000),
      user: { email: EMAIL, username: EMAIL, role: 'PATIENT', status: 'PENDING_VERIFICATION' } })
  });
  assert.equal(captured, true);
}

function assertSafeDiagnostics(events) {
  for (const [event, context, ...extra] of events) {
    assert.equal(extra.length, 0);
    if (event === 'qa.verification_capture_denied') {
      assert.deepEqual(Object.keys(context), ['reason']);
      assert.ok(DENIAL_REASONS.has(context.reason));
    } else {
      assert.equal(event, 'qa.verification_capture_served');
      assert.equal(context, undefined);
    }
  }
  const output = JSON.stringify(events);
  for (const sensitive of [TOKEN, CODE, CHALLENGE_ID, EMAIL, SAFE_ENV.DATABASE_URL, SAFE_ENV.DIRECT_URL,
    'Authorization', 'Bearer', 'password', 'jwt-fixture-secret']) {
    assert.equal(output.includes(sensitive), false, 'diagnostics must not contain request or secret data');
  }
}

test('auth-check returns 404 outside explicitly enabled staging QA without querying DB', async () => {
  for (const override of [
    { APP_ENV: '' }, { DEPLOYMENT_ENV: '' }, { APP_ENV: 'local', DEPLOYMENT_ENV: 'local' },
    { QA_LOAD_TEST_ALLOWED: 'false' }, { QA_VERIFICATION_CAPTURE_ENABLED: 'false' },
    { QA_VERIFICATION_CAPTURE_TOKEN: '' }, { QA_NOTIFICATION_MODE: 'external' },
    { NOTIFICATIONS_DISABLED: 'false' }, { SMS_PROVIDER: 'transport' }, { VERIFICATION_PROVIDER: 'development' }
  ]) {
    const h = harness(override);
    const response = await request(h.app).get(AUTH_CHECK).set('Authorization', `Bearer ${TOKEN}`);
    assert.equal(response.status, 404);
    assert.equal(h.identityQueries.length, 0);
    assert.equal(h.challengeQueries.length, 0);
    assert.deepEqual(h.events, []);
  }
});

test('production markers cannot expose either endpoint even with all QA flags enabled', async () => {
  for (const override of [
    { APP_ENV: 'production' }, { DEPLOYMENT_ENV: 'production' },
    { APP_ENV: ' PRODUCTION ', DEPLOYMENT_ENV: ' STAGING ' },
    { APP_ENV: ' STAGING ', DEPLOYMENT_ENV: ' PRODUCTION ' },
    { APP_ENV: 'production', DEPLOYMENT_ENV: 'production' }
  ]) {
    const h = harness(override);
    for (const path of [AUTH_CHECK, CAPTURE_PATH]) await request(h.app).get(path).set('Authorization', `Bearer ${TOKEN}`).expect(404);
    assert.equal(h.identityQueries.length, 0);
    assert.deepEqual(h.events, [], 'production must not emit staging diagnostic events');
  }
});

test('auth-check rejects missing or malformed Bearer authorization', async () => {
  for (const authorization of [undefined, 'Basic synthetic', 'Bearer', `Bearer  ${TOKEN}`, `Bearer ${TOKEN} extra`]) {
    const h = harness();
    const req = request(h.app).get(AUTH_CHECK);
    if (authorization !== undefined) req.set('Authorization', authorization);
    await req.expect(404);
    assert.equal(h.identityQueries.length, 0);
    assert.deepEqual(h.events, []);
  }
});

test('auth-check rejects wrong tokens without inspecting the gate or returning secrets', async () => {
  const h = harness();
  const response = await request(h.app).get(AUTH_CHECK).set('Authorization', 'Bearer Wrong-Synthetic-Token-Longer-Than-Thirty-Two').expect(404);
  assert.equal(h.identityQueries.length, 0);
  assert.equal(response.text, 'Not Found');
  assert.deepEqual(h.events, []);
});

test('correct token and PASS gate return only 204 with no-store headers and no capture access', async () => {
  const h = harness();
  await seedCapture();
  const before = peekQaVerificationCapture(CHALLENGE_ID);
  const response = await request(h.app).get(AUTH_CHECK).set('Authorization', `bEaReR ${TOKEN}`).expect(204);
  assert.equal(response.text, '');
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.headers.pragma, 'no-cache');
  assert.equal(response.headers['x-robots-tag'], 'noindex');
  assert.equal(h.identityQueries.length, 1);
  assert.equal(h.challengeQueries.length, 0);
  assert.deepEqual(peekQaVerificationCapture(CHALLENGE_ID), before, 'auth-check must never consume a code');
  assert.deepEqual(h.events, []);
  const output = JSON.stringify({ headers: response.headers, body: response.text });
  for (const sensitive of [TOKEN, CODE, CHALLENGE_ID, EMAIL, 'staging_fixture_runtime', 'neondb']) assert.equal(output.includes(sensitive), false);
});

test('auth-check fails closed on unsafe gate configuration, identity mismatch and DB errors', async () => {
  for (const [overrides, dependencies] of [
    [{ DATABASE_ENVIRONMENT: 'production' }, {}],
    [{ QA_PAYMENT_MODE: 'external' }, {}],
    [{}, { identity: () => [{ database: 'wrong', schema: 'public', role: 'staging_fixture_runtime' }] }],
    [{}, { identity: () => { throw new Error(`${TOKEN} ${CODE} ${EMAIL}`); } }]
  ]) {
    const h = harness(overrides, dependencies);
    const response = await request(h.app).get(AUTH_CHECK).set('Authorization', `Bearer ${TOKEN}`).expect(404);
    assert.equal(response.text, 'Not Found');
    assert.deepEqual(h.events, []);
  }
});

test('static auth-check is registered before the challenge route and never enters its handler', async () => {
  const h = harness();
  const routes = h.app._router.stack.filter(layer => layer.route).map(layer => layer.route.path);
  assert.deepEqual(routes, [AUTH_CHECK, '/api/qa/verification-capture/:challengeId']);
  await request(h.app).get(AUTH_CHECK).set('Authorization', `Bearer ${TOKEN}`).expect(204);
  assert.equal(h.challengeQueries.length, 0);
  assert.deepEqual(h.events, [], 'no capture_missing or capture_served event may occur for auth-check');
  const server = await readFile(new URL('../src/server.js', import.meta.url), 'utf8');
  assert.ok(server.includes('registerQaVerificationCaptureRoutes(app, { prismaClient: prisma })'));
});

test('existing capture success payload, challenge validation and one-time 404 behavior remain unchanged', async () => {
  const h = harness();
  await seedCapture();
  const response = await request(h.app).get(CAPTURE_PATH).set('Authorization', `Bearer ${TOKEN}`).expect(200);
  assert.deepEqual(Object.keys(response.body).sort(), ['challengeId', 'code', 'expiresAt']);
  assert.equal(response.body.challengeId, CHALLENGE_ID);
  assert.equal(response.body.code === CODE, true);
  assert.ok(Date.parse(response.body.expiresAt) > Date.now());
  assert.equal(response.headers['cache-control'], 'no-store');
  const [query] = h.challengeQueries;
  assert.deepEqual(query, {
    where: { id: CHALLENGE_ID, type: 'REGISTRATION_EMAIL', targetNormalized: EMAIL, usedAt: null,
      expiresAt: { gt: query.where.expiresAt.gt },
      user: { is: { email: EMAIL, username: EMAIL, role: 'PATIENT', status: 'PENDING_VERIFICATION' } } },
    select: { id: true }
  });
  assert.ok(query.where.expiresAt.gt instanceof Date);
  assert.deepEqual(h.events, [['qa.verification_capture_served']]);
  await request(h.app).get(CAPTURE_PATH).set('Authorization', `Bearer ${TOKEN}`).expect(404);
  assert.deepEqual(h.events.at(-1), ['qa.verification_capture_denied', { reason: 'capture_missing' }]);
  assertSafeDiagnostics(h.events);
});

test('capture denial logs contain only the allowlisted reason at each failure point', async () => {
  const cases = [
    { reason: 'capture_disabled', overrides: { QA_VERIFICATION_CAPTURE_ENABLED: 'false' } },
    { reason: 'authorization_missing_or_invalid', authorization: 'Bearer Incorrect-Synthetic-Token-Only' },
    { reason: 'gate_not_allowed', overrides: { DATABASE_ENVIRONMENT: 'production' } },
    { reason: 'capture_missing' },
    { reason: 'challenge_not_valid', seed: true, discarded: true, dependencies: { challenge: () => null } },
    { reason: 'challenge_not_valid', seed: true, dependencies: { challenge: () => { throw new Error(`${TOKEN} ${CODE} ${CHALLENGE_ID} ${EMAIL} jwt-fixture-secret`); } } },
    { reason: 'capture_consumption_failed', seed: true, dependencies: { challenge: () => { discardQaVerificationCapture(CHALLENGE_ID); return { id: CHALLENGE_ID }; } } }
  ];
  for (const { reason, overrides, authorization, seed, discarded, dependencies } of cases) {
    clearQaVerificationCapturesForTests();
    const h = harness(overrides, dependencies);
    if (seed) await seedCapture();
    const response = await request(h.app).get(CAPTURE_PATH).set('Authorization', authorization || `Bearer ${TOKEN}`).expect(404);
    assert.equal(response.text, 'Not Found');
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.deepEqual(h.events, [['qa.verification_capture_denied', { reason }]]);
    assertSafeDiagnostics(h.events);
    if (discarded) assert.equal(peekQaVerificationCapture(CHALLENGE_ID), null);
  }
});

test('missing capture-route token cannot query or consume an existing capture', async () => {
  const h = harness();
  await seedCapture();
  await request(h.app).get(CAPTURE_PATH).expect(404);
  assert.equal(h.identityQueries.length, 0);
  assert.equal(h.challengeQueries.length, 0);
  assert.ok(peekQaVerificationCapture(CHALLENGE_ID));
  assert.deepEqual(h.events, [['qa.verification_capture_denied', { reason: 'authorization_missing_or_invalid' }]]);
  assertSafeDiagnostics(h.events);
});
