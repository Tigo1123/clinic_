import test from 'node:test';
import assert from 'node:assert/strict';
import { isStagingQaEnvironment } from '../src/utils/qaEnvironmentMarkers.js';
import {
  getStagingLoadTestTarget,
  isStagingNotificationSink,
  safeQaEnvironmentSummary,
  stagingLoadTestPreflight
} from '../src/utils/stagingLoadTestSafety.js';
import { clearQaVerificationCapturesForTests, captureQaVerificationCode, consumeQaVerificationCapture, isQaVerificationCaptureEnabled, isValidQaVerificationCaptureToken, peekQaVerificationCapture } from '../src/utils/qaVerificationCapture.js';
import { fetchQaVerificationCode, StagingQaGateError, validateStagingApiOrigin, verifyStagingQaGate } from '../scripts/stagingQaGate.mjs';

const directUrl = 'postgresql://synthetic:fixture@ep-muddy-unit-b4hvj7be.c-6.us-east-2.aws.neon.tech/neondb?schema=public&sslmode=verify-full';
const runtimeUrl = 'postgresql://synthetic:fixture@ep-muddy-unit-b4hvj7be-pooler.c-6.us-east-2.aws.neon.tech/neondb?schema=public&sslmode=verify-full';
const baseEnv = {
  APP_ENV: 'staging', DEPLOYMENT_ENV: 'staging', NODE_ENV: 'production',
  QA_LOAD_TEST_ALLOWED: 'true', QA_LOAD_TEST_TARGET_ID: 'staging-qa-target-2026',
  DATABASE_ENVIRONMENT: 'staging', QA_EXPECTED_DATABASE_NAME: 'neondb',
  QA_EXPECTED_DATABASE_SCHEMA: 'public', QA_EXPECTED_DATABASE_ROLE: 'shifa_staging_runtime',
  DATABASE_URL: runtimeUrl, DIRECT_URL: directUrl,
  QA_NOTIFICATION_MODE: 'sink', NOTIFICATIONS_DISABLED: 'true', SMS_PROVIDER: 'disabled',
  QA_PAYMENT_MODE: 'ledger-only', VERIFICATION_PROVIDER: 'email',
  QA_VERIFICATION_CAPTURE_ENABLED: 'true', QA_VERIFICATION_CAPTURE_TOKEN: 'test-capture-token-that-is-not-a-real-secret'
};
const expectedDbIdentity = { database: 'neondb', schema: 'public', role: 'shifa_staging_runtime' };

function jsonResponse(body, status = 200, contentType = 'application/json; charset=utf-8') {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': contentType } });
}

test('staging gate passes only for explicit markers and matching live DB identity', async () => {
  const result = await getStagingLoadTestTarget(baseEnv, async () => expectedDbIdentity);
  assert.equal(result.service, 'clinic-api');
  assert.equal(result.environment, 'staging');
  assert.equal(result.loadTestAllowed, true);
  assert.equal(result.databaseIdentity, 'verified');
  assert.equal(result.notifications, 'sink');
  assert.equal(result.verificationCapture, 'enabled');
  assert.equal(result.payments, 'ledger-only');
  assert.deepEqual(result.reasons, []);
});

for (const key of ['APP_ENV', 'DEPLOYMENT_ENV', 'DATABASE_ENVIRONMENT']) {
  for (const value of ['staging', ' staging ', 'STAGING', undefined, 'production', ' PRODUCTION ', 'unknown', ' ']) {
    test(`${key} accepts only normalized staging: ${JSON.stringify(value) ?? 'missing'}`, async () => {
      const env = { ...baseEnv, [key]: value };
      const allowed = ['staging', ' staging ', 'STAGING'].includes(value);
      let queried = false;
      const result = await getStagingLoadTestTarget(env, async () => {
        queried = true;
        return expectedDbIdentity;
      });
      assert.equal(result.loadTestAllowed, allowed);
      assert.equal(queried, allowed, 'blocked markers must not query the database');
      if (key !== 'DATABASE_ENVIRONMENT') {
        // The public endpoint uses this same staging predicate before DB access.
        assert.equal(isStagingQaEnvironment(env), allowed);
        assert.equal(isStagingNotificationSink(env), allowed);
        assert.equal(isQaVerificationCaptureEnabled(env), allowed);
        if (value === 'production' || value === ' PRODUCTION ') assert.equal(result.environment, 'production');
      } else {
        const production = value === 'production' || value === ' PRODUCTION ';
        assert.equal(result.databaseEnvironment, allowed ? 'staging' : production ? 'production' : 'unknown');
      }
    });
  }
}

test('boolean and non-secret QA mode markers accept whitespace and case variations consistently', async () => {
  const markers = {
    QA_LOAD_TEST_ALLOWED: 'true',
    QA_VERIFICATION_CAPTURE_ENABLED: 'true',
    NOTIFICATIONS_DISABLED: 'true',
    QA_NOTIFICATION_MODE: 'sink',
    SMS_PROVIDER: 'disabled',
    VERIFICATION_PROVIDER: 'email',
    QA_PAYMENT_MODE: 'ledger-only',
    PAYMENT_GATEWAY_ENABLED: 'false'
  };
  for (const [key, marker] of Object.entries(markers)) {
    for (const value of [marker, ` ${marker} `, marker.toUpperCase()]) {
      const env = { ...baseEnv, [key]: value };
      const result = await getStagingLoadTestTarget(env, async () => expectedDbIdentity);
      assert.equal(result.loadTestAllowed, true, key);
      assert.equal(result.payments, 'ledger-only');
      assert.equal(isStagingNotificationSink(env), true, key);
      assert.equal(isQaVerificationCaptureEnabled(env), true, key);
    }
  }
  const result = await getStagingLoadTestTarget({ ...baseEnv, QA_PAYMENT_MODE: ' DISABLED ' }, async () => expectedDbIdentity);
  assert.equal(result.loadTestAllowed, true);
  assert.equal(result.payments, 'disabled');
});

test('missing, false, and unknown QA markers still fail closed after normalization', async () => {
  for (const key of ['QA_LOAD_TEST_ALLOWED', 'QA_VERIFICATION_CAPTURE_ENABLED', 'NOTIFICATIONS_DISABLED', 'QA_NOTIFICATION_MODE', 'SMS_PROVIDER', 'VERIFICATION_PROVIDER', 'QA_PAYMENT_MODE']) {
    for (const value of [undefined, '', ' ', ' FALSE ', 'unknown', '1', 'yes', 'production']) {
      const env = { ...baseEnv, [key]: value };
      let queried = false;
      const result = await getStagingLoadTestTarget(env, async () => {
        queried = true;
        return expectedDbIdentity;
      });
      assert.equal(result.loadTestAllowed, false, key);
      assert.equal(queried, false, key);
    }
  }
});

test('normalization preserves exact credential and database identity comparisons', async () => {
  const token = '  MixedCase-Synthetic-Capture-Token-Only  ';
  const env = { ...baseEnv, APP_ENV: ' STAGING ', QA_VERIFICATION_CAPTURE_TOKEN: token };
  const original = JSON.stringify(env);
  assert.equal(isValidQaVerificationCaptureToken(token, env), true);
  assert.equal(isValidQaVerificationCaptureToken(token.trim(), env), false);
  assert.equal(isValidQaVerificationCaptureToken(token.toLowerCase(), env), false);
  const result = await getStagingLoadTestTarget(env, async () => expectedDbIdentity);
  assert.equal(result.loadTestAllowed, true);
  assert.equal(JSON.stringify(env) === original, true, 'environment values must not be mutated');
  for (const key of ['QA_EXPECTED_DATABASE_NAME', 'QA_EXPECTED_DATABASE_SCHEMA', 'QA_EXPECTED_DATABASE_ROLE', 'QA_LOAD_TEST_TARGET_ID']) {
    const blocked = await getStagingLoadTestTarget({ ...env, [key]: ` ${env[key]} ` }, async () => expectedDbIdentity);
    assert.equal(blocked.loadTestAllowed, false, 'identity pins remain exact');
  }
  for (const key of ['DATABASE_URL', 'DIRECT_URL']) {
    const blocked = await getStagingLoadTestTarget({ ...env, [key]: env[key].replace('neondb', 'NEONDB') }, async () => expectedDbIdentity);
    assert.equal(blocked.loadTestAllowed, false, 'URL identity remains case sensitive');
  }
  const blocked = await getStagingLoadTestTarget({ ...env, PAYMENT_GATEWAY_ENABLED: ' TRUE ' }, async () => expectedDbIdentity);
  assert.equal(blocked.loadTestAllowed, false, 'enabled payment gateways remain blocked');
  const configuredSecret = await getStagingLoadTestTarget({ ...env, STRIPE_SECRET_KEY: ' ' }, async () => expectedDbIdentity);
  assert.equal(configuredSecret.loadTestAllowed, false, 'configured payment credentials must not be trimmed away');
});

test('missing, false, unknown, unsafe notification, or unsafe payment markers fail closed before DB inspection', async () => {
  const blockedCases = [
    [{ APP_ENV: '' }, 'environment_not_staging'],
    [{ QA_LOAD_TEST_TARGET_ID: '' }, 'target_id_missing_or_invalid'],
    [{ QA_LOAD_TEST_ALLOWED: 'false' }, 'load_test_not_explicitly_allowed'],
    [{ DATABASE_ENVIRONMENT: 'unknown' }, 'database_environment_not_staging'],
    [{ QA_NOTIFICATION_MODE: 'external' }, 'external_notifications_not_safely_sunk'],
    [{ NOTIFICATIONS_DISABLED: 'false' }, 'external_notifications_not_safely_sunk'],
    [{ SMS_PROVIDER: 'transport' }, 'external_notifications_not_safely_sunk'],
    [{ QA_VERIFICATION_CAPTURE_ENABLED: 'false' }, 'qa_verification_capture_not_safely_configured'],
    [{ QA_PAYMENT_MODE: 'sandbox' }, 'external_payments_not_disabled'],
    [{ PAYMENT_PROVIDER: 'stripe' }, 'external_payments_not_disabled'],
    [{ STRIPE_SECRET_KEY: 'never-print-this-fixture' }, 'external_payments_not_disabled']
  ];
  for (const [override, reason] of blockedCases) {
    let queried = false;
    const result = await getStagingLoadTestTarget({ ...baseEnv, ...override }, async () => { queried = true; return expectedDbIdentity; });
    assert.equal(result.loadTestAllowed, false, reason);
    assert.ok(result.reasons.includes(reason));
    assert.equal(queried, false, 'unsafe config must not query the database');
  }
});

test('production stays blocked even if every load-test flag is accidentally enabled', async () => {
  for (const env of [
    { ...baseEnv, APP_ENV: 'production', DEPLOYMENT_ENV: 'production' },
    { ...baseEnv, APP_ENV: 'staging', DEPLOYMENT_ENV: 'production' },
    { ...baseEnv, APP_ENV: 'production', DEPLOYMENT_ENV: 'staging' }
  ]) {
    const result = await getStagingLoadTestTarget(env, async () => { throw new Error('must not query'); });
    assert.equal(result.environment, 'production');
    assert.equal(result.loadTestAllowed, false);
    assert.ok(result.reasons.includes('environment_not_staging'));
  }
});

test('pinned production database target is rejected before any DB query', async () => {
  const env = {
    ...baseEnv,
    DIRECT_URL: 'postgresql://synthetic:fixture@ep-purple-brook-b5g403vw.c-7.us-east-2.aws.neon.tech/neondb?schema=public&sslmode=verify-full',
    DATABASE_URL: 'postgresql://synthetic:fixture@ep-purple-brook-b5g403vw-pooler.c-7.us-east-2.aws.neon.tech/neondb?schema=public&sslmode=verify-full'
  };
  let queried = false;
  const result = await getStagingLoadTestTarget(env, async () => { queried = true; return expectedDbIdentity; });
  assert.equal(result.loadTestAllowed, false);
  assert.ok(result.reasons.includes('production_database_target'));
  assert.equal(queried, false);
});

test('connected DB name/schema/role mismatch blocks authorization', async () => {
  const result = await getStagingLoadTestTarget(baseEnv, async () => ({ ...expectedDbIdentity, role: 'other_role' }));
  assert.equal(result.loadTestAllowed, false);
  assert.ok(result.reasons.includes('connected_database_identity_mismatch'));
});

test('notification sink is explicitly staging-only', () => {
  assert.equal(isStagingNotificationSink(baseEnv), true);
  assert.equal(isStagingNotificationSink({ ...baseEnv, APP_ENV: 'production', DEPLOYMENT_ENV: 'production' }), false);
});

test('verification capture requires explicit staging QA, email verification, a safe sink, and synthetic registration identity', async () => {
  clearQaVerificationCapturesForTests();
  assert.equal(isQaVerificationCaptureEnabled(baseEnv), true);
  assert.equal(isValidQaVerificationCaptureToken(baseEnv.QA_VERIFICATION_CAPTURE_TOKEN, baseEnv), true);
  assert.equal(isValidQaVerificationCaptureToken('wrong-token-value-that-is-long-enough', baseEnv), false);
  assert.equal(isQaVerificationCaptureEnabled({ ...baseEnv, APP_ENV: 'production' }), false);
  assert.equal(isQaVerificationCaptureEnabled({ ...baseEnv, QA_LOAD_TEST_ALLOWED: 'false' }), false);
  assert.equal(isQaVerificationCaptureEnabled({ ...baseEnv, VERIFICATION_PROVIDER: 'development' }), false);

  const challengeId = '123e4567-e89b-42d3-a456-426614174000';
  const recipient = 'qa-20261101-a1b2c3d4+patient-001@example.invalid';
  const expiresAt = new Date(Date.now() + 60_000);
  const findValidChallenge = async () => ({
    id: challengeId, type: 'REGISTRATION_EMAIL', targetNormalized: recipient,
    usedAt: null, expiresAt,
    user: { email: recipient, username: recipient, role: 'PATIENT', status: 'PENDING_VERIFICATION' }
  });
  assert.equal(await captureQaVerificationCode({ env: baseEnv, challengeId, recipient, code: '123456', findValidChallenge }), true);
  assert.equal(peekQaVerificationCapture(challengeId).recipient, recipient);
  assert.equal(consumeQaVerificationCapture(challengeId).code, '123456');
  assert.equal(consumeQaVerificationCapture(challengeId), null, 'capture is one-time');

  assert.equal(await captureQaVerificationCode({ env: baseEnv, challengeId, recipient: 'person@example.com', code: '123456', findValidChallenge }), false);
  const activeUserChallenge = await findValidChallenge();
  assert.equal(await captureQaVerificationCode({
    env: baseEnv, challengeId, recipient, code: '123456',
    findValidChallenge: async () => ({ ...activeUserChallenge, user: { ...activeUserChallenge.user, status: 'ACTIVE' } })
  }), false);

  const expiryNow = Date.now();
  const expiringChallenge = { ...(await findValidChallenge()), expiresAt: new Date(expiryNow + 1000) };
  assert.equal(await captureQaVerificationCode({
    env: baseEnv, challengeId, recipient, code: '123456', now: expiryNow,
    findValidChallenge: async () => expiringChallenge
  }), true);
  assert.equal(peekQaVerificationCapture(challengeId, expiryNow + 1001), null, 'capture expires before challenge can outlive it');
  clearQaVerificationCapturesForTests();
});

test('runner rejects frontend, production, missing and mismatched API origin pins', () => {
  assert.throws(() => validateStagingApiOrigin({ QA_API_ORIGIN: 'https://clinic-staging-web.onrender.com', QA_EXPECTED_API_ORIGIN: 'https://clinic-staging-web.onrender.com', QA_EXPECTED_TARGET_ID: baseEnv.QA_LOAD_TEST_TARGET_ID }), StagingQaGateError);
  assert.throws(() => validateStagingApiOrigin({ QA_API_ORIGIN: 'https://clinic-api.onrender.com', QA_EXPECTED_API_ORIGIN: 'https://clinic-api.onrender.com', QA_EXPECTED_TARGET_ID: baseEnv.QA_LOAD_TEST_TARGET_ID }), StagingQaGateError);
  assert.throws(() => validateStagingApiOrigin({ QA_API_ORIGIN: 'https://clinic-staging-api.onrender.com', QA_EXPECTED_API_ORIGIN: '', QA_EXPECTED_TARGET_ID: baseEnv.QA_LOAD_TEST_TARGET_ID }), StagingQaGateError);
  assert.throws(() => validateStagingApiOrigin({ QA_API_ORIGIN: 'https://clinic-staging-api.onrender.com/path', QA_EXPECTED_API_ORIGIN: 'https://clinic-staging-api.onrender.com/path', QA_EXPECTED_TARGET_ID: baseEnv.QA_LOAD_TEST_TARGET_ID }), StagingQaGateError);
});

test('runner validates API health JSON and every target safety property before passing', async () => {
  const env = {
    QA_API_ORIGIN: 'https://clinic-staging-api.onrender.com',
    QA_EXPECTED_API_ORIGIN: 'https://clinic-staging-api.onrender.com',
    QA_EXPECTED_TARGET_ID: baseEnv.QA_LOAD_TEST_TARGET_ID,
    QA_VERIFICATION_CAPTURE_TOKEN: baseEnv.QA_VERIFICATION_CAPTURE_TOKEN
  };
  const calls = [];
  const fetchImpl = async url => {
    calls.push(url);
    if (url.endsWith('/api/health')) return jsonResponse({ status: 'alive' });
    if (url.endsWith('/api/health/ready')) return jsonResponse({ status: 'healthy' });
    return jsonResponse({
      service: 'clinic-api', environment: 'staging', loadTestAllowed: true,
      databaseEnvironment: 'staging', databaseIdentity: 'verified', notifications: 'sink',
      verificationCapture: 'enabled', payments: 'ledger-only', targetId: env.QA_EXPECTED_TARGET_ID, reasons: []
    });
  };
  const result = await verifyStagingQaGate({ env, fetchImpl });
  assert.equal(result.gate, 'PASS');
  assert.deepEqual(calls.map(url => new URL(url).pathname), ['/api/health/load-test-target', '/api/health', '/api/health/ready']);
});

test('runner blocks before network access if the protected capture credential is missing', async () => {
  let requested = false;
  const env = {
    QA_API_ORIGIN: 'https://clinic-staging-api.onrender.com',
    QA_EXPECTED_API_ORIGIN: 'https://clinic-staging-api.onrender.com',
    QA_EXPECTED_TARGET_ID: baseEnv.QA_LOAD_TEST_TARGET_ID
  };
  await assert.rejects(verifyStagingQaGate({ env, fetchImpl: async () => { requested = true; } }), StagingQaGateError);
  assert.equal(requested, false);
});

test('QA runner retrieves verification codes only after a passing pinned gate without echoing its token', async () => {
  const secret = 'runner-capture-token-fixture-not-real-secret';
  const env = {
    QA_API_ORIGIN: 'https://clinic-staging-api.onrender.com',
    QA_EXPECTED_API_ORIGIN: 'https://clinic-staging-api.onrender.com',
    QA_EXPECTED_TARGET_ID: baseEnv.QA_LOAD_TEST_TARGET_ID,
    QA_VERIFICATION_CAPTURE_TOKEN: secret
  };
  const challengeId = '123e4567-e89b-42d3-a456-426614174000';
  let request;
  const code = await fetchQaVerificationCode({
    env,
    gateResult: { gate: 'PASS', apiOrigin: env.QA_API_ORIGIN, targetId: env.QA_EXPECTED_TARGET_ID },
    challengeId,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return jsonResponse({ challengeId, code: '654321', expiresAt: new Date(Date.now() + 60_000).toISOString() });
    }
  });
  assert.equal(code, '654321');
  assert.equal(request.options.headers.Authorization, `Bearer ${secret}`);
  await assert.rejects(fetchQaVerificationCode({ env, gateResult: { gate: 'BLOCKED' }, challengeId }), StagingQaGateError);
});

test('runner refuses frontend HTML, unsafe identity fields, and never echoes secret values', async () => {
  const sentinel = 'fixture-secret-never-output';
  const env = {
    QA_API_ORIGIN: 'https://clinic-staging-api.onrender.com',
    QA_EXPECTED_API_ORIGIN: 'https://clinic-staging-api.onrender.com',
    QA_EXPECTED_TARGET_ID: baseEnv.QA_LOAD_TEST_TARGET_ID,
    DATABASE_URL: `postgresql://qa:${sentinel}@stage.invalid/db`
  };
  await assert.rejects(verifyStagingQaGate({ env, fetchImpl: async () => jsonResponse('<html>frontend shell</html>', 200, 'text/html') }), StagingQaGateError);
  const result = stagingLoadTestPreflight({ ...baseEnv, ...env, QA_LOAD_TEST_ALLOWED: 'false' });
  const publicSummary = safeQaEnvironmentSummary({ ...result, service: 'clinic-api' });
  assert.equal(JSON.stringify(result).includes(sentinel), false);
  assert.equal(JSON.stringify(publicSummary).includes(sentinel), false);
  assert.equal(JSON.stringify(publicSummary).includes('DATABASE_URL'), false);
});
