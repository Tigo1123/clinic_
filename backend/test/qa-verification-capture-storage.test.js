import test from 'node:test';
import assert from 'node:assert/strict';
import { captureQaVerificationCode, consumeQaVerificationCapture, isQaVerificationCaptureEnabled } from '../src/utils/qaVerificationCapture.js';
import { validateQaVerificationCaptureStorage } from '../src/utils/qaVerificationCaptureConfig.js';
import { CAPTURE_ID, CAPTURE_EMAIL, CAPTURE_CODE, QA_CAPTURE_TEST_ENV, qaCaptureFixture } from './helpers/qaCaptureFixture.js';

function setup(overrides = {}) {
  const env = { ...QA_CAPTURE_TEST_ENV, ...overrides }, fixture = qaCaptureFixture(env);
  const options = { env, prismaClient: fixture.prismaClient, challengeId: CAPTURE_ID };
  return { env, fixture, options,
    seed: changes => captureQaVerificationCode({ ...options, recipient: CAPTURE_EMAIL, code: CAPTURE_CODE, ...changes }),
    consume: changes => consumeQaVerificationCapture({ ...options, ...changes }) };
}

test('capture stores only authenticated ciphertext and challenge metadata, never plaintext or recipient', async () => {
  const h = setup(); assert.equal(await h.seed(), true);
  const row = h.fixture.captures.get(CAPTURE_ID);
  assert.deepEqual(Object.keys(row).sort(), ['challengeId', 'codeEncrypted', 'createdAt', 'expiresAt']);
  assert.match(row.codeEncrypted, /^v1:[a-f0-9]{24}:[a-f0-9]{32}:[a-f0-9]{12}$/);
  for (const sensitive of [CAPTURE_CODE, CAPTURE_EMAIL, h.env.QA_VERIFICATION_CAPTURE_STORAGE_KEY]) assert.equal(row.codeEncrypted.includes(sensitive), false);
  const consumed = await h.consume(); assert.equal(consumed.capture?.code === CAPTURE_CODE, true);
  assert.equal(h.fixture.captures.size, 0); assert.equal((await h.consume()).capture, null);
});

test('freshly imported service code reads the shared durable record rather than module memory', async () => {
  const h = setup(); await h.seed();
  const fresh = await import('../src/utils/qaVerificationCapture.js?simulated-new-instance');
  assert.equal((await fresh.consumeQaVerificationCapture(h.options)).capture?.code === CAPTURE_CODE, true);
});

test('effective TTL is at most five minutes and expired records are removed on lookup', async () => {
  const now = Date.now();
  for (const lifespan of [60_000, 600_000]) {
    const h = setup(); h.fixture.challenge.expiresAt = new Date(now + lifespan);
    await h.seed({ now });
    const row = h.fixture.captures.get(CAPTURE_ID);
    assert.equal(row.expiresAt.getTime(), now + Math.min(lifespan, 300_000));
    assert.equal((await h.consume({ now: row.expiresAt.getTime() })).capture, null);
    assert.equal(h.fixture.captures.size, 0);
  }
});

test('a duplicate capture never replaces ciphertext or extends its original expiry', async () => {
  const h = setup(); await h.seed(); const before = structuredClone(h.fixture.captures.get(CAPTURE_ID));
  assert.equal(await h.seed(), false); assert.deepEqual(h.fixture.captures.get(CAPTURE_ID), before);
});

test('persisting a new capture opportunistically removes expired QA rows only', async () => {
  const h = setup(); await h.seed();
  h.fixture.captures.get(CAPTURE_ID).expiresAt = new Date(0);
  const other = '223e4567-e89b-42d3-a456-426614174000'; h.fixture.challenge.id = other;
  assert.equal(await h.seed({ challengeId: other }), true);
  assert.equal(h.fixture.captures.has(CAPTURE_ID), false); assert.equal(h.fixture.captures.has(other), true);
});

test('wrong key fails closed and destroys the unusable encrypted record', async () => {
  const h = setup(); await h.seed(); h.env.QA_VERIFICATION_CAPTURE_STORAGE_KEY = 'b2'.repeat(32);
  assert.deepEqual(await h.consume(), { capture: null, reason: 'capture_consumption_failed' });
  assert.equal(h.fixture.captures.size, 0);
});

test('AES-GCM AAD binds ciphertext to its challenge and expiry', async () => {
  const h = setup(); await h.seed(); const encrypted = h.fixture.captures.get(CAPTURE_ID).codeEncrypted;
  const other = '223e4567-e89b-42d3-a456-426614174000'; h.fixture.challenge.id = other;
  assert.equal(await h.seed({ challengeId: other }), true);
  h.fixture.captures.get(other).codeEncrypted = encrypted;
  assert.equal((await h.consume({ challengeId: other })).capture, null);
  const row = h.fixture.captures.get(CAPTURE_ID);
  h.fixture.challenge.id = CAPTURE_ID; row.expiresAt = new Date(row.expiresAt.getTime() - 1000);
  assert.equal((await h.consume()).capture, null);
});

test('capture refuses production unsafe gates bad identities and missing key before persistence', async () => {
  for (const overrides of [{ APP_ENV: 'production' }, { DEPLOYMENT_ENV: 'production' },
    { DATABASE_ENVIRONMENT: 'production' }, { QA_PAYMENT_MODE: 'enabled' }, { QA_NOTIFICATION_MODE: 'external' },
    { QA_VERIFICATION_CAPTURE_STORAGE_KEY: undefined }]) {
    const h = setup(overrides); assert.equal(await h.seed(), false); assert.equal(h.fixture.transactions, 0);
    assert.equal((await h.consume()).capture, null);
  }
});

test('creation rejects non-synthetic recipient, incorrect or used challenge and active or mismatched user', async () => {
  for (const change of [h => { h.fixture.challenge.type = 'EMAIL'; }, h => { h.fixture.challenge.usedAt = new Date(); },
    h => { h.fixture.challenge.user.status = 'ACTIVE'; }, h => { h.fixture.challenge.user.email = 'other@example.invalid'; },
    h => { h.fixture.challenge.user.id = 'other'; }, h => { h.fixture.challenge.authVersion++; },
    h => { h.fixture.challenge.expiresAt = new Date(0); }, h => { h.fixture.challenge.attemptCount = 5; }]) {
    const h = setup(); change(h); assert.equal(await h.seed(), false); assert.equal(h.fixture.captures.size, 0);
  }
  const h = setup(); assert.equal(await h.seed({ recipient: 'real@example.com' }), false);
  assert.equal(await h.seed({ challengeId: 'invalid' }), false); assert.equal(await h.seed({ code: 'invalid' }), false);
  assert.equal(h.fixture.transactions, 0);
});

test('concurrent consumers have one winner and the rest receive no code', async () => {
  const h = setup(); await h.seed();
  const results = await Promise.all(Array.from({ length: 5 }, () => h.consume()));
  assert.equal(results.filter(result => result.capture).length, 1);
  assert.equal(h.fixture.captures.size, 0);
});

test('missing malformed or reused storage keys fail closed only for configured staging capture', () => {
  for (const key of [undefined, '', 'short', 'a1'.repeat(31), 'z1'.repeat(32), ' ' + 'a1'.repeat(32)]) {
    const env = { ...QA_CAPTURE_TEST_ENV, QA_VERIFICATION_CAPTURE_STORAGE_KEY: key };
    assert.equal(isQaVerificationCaptureEnabled(env), false);
    assert.throws(() => validateQaVerificationCaptureStorage(env), /QA_VERIFICATION_CAPTURE_STORAGE_KEY/);
    for (const overrides of [{ APP_ENV: 'production' }, { DEPLOYMENT_ENV: 'production' }, { QA_VERIFICATION_CAPTURE_ENABLED: 'false' }]) {
      assert.doesNotThrow(() => validateQaVerificationCaptureStorage({ ...env, ...overrides }));
    }
  }
  for (const name of ['MEDICAL_ENCRYPTION_KEY', 'MFA_ENCRYPTION_KEY', 'JWT_SECRET']) {
    const env = { ...QA_CAPTURE_TEST_ENV, [name]: QA_CAPTURE_TEST_ENV.QA_VERIFICATION_CAPTURE_STORAGE_KEY };
    assert.throws(() => validateQaVerificationCaptureStorage(env));
  }
});

test('raw storage errors return only safe failure values without logging', async () => {
  const h = setup(); h.fixture.writeError = new Error(CAPTURE_CODE + h.env.QA_VERIFICATION_CAPTURE_STORAGE_KEY);
  const output = [], old = console.error; console.error = (...args) => output.push(args);
  try { assert.equal(await h.seed(), false); assert.deepEqual(output, []); }
  finally { console.error = old; }
});
