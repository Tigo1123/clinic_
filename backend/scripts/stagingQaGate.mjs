const TARGET_ID_PATTERN = /^[a-zA-Z0-9_-]{12,80}$/;
const CHALLENGE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DENIED_HOSTS = new Set([
  'clinic-staging-web.onrender.com',
  'clinic-api.onrender.com',
  'clinic-web.onrender.com'
]);

export class StagingQaGateError extends Error {
  constructor(code) {
    super(code);
    this.name = 'StagingQaGateError';
    this.code = code;
  }
}

export function validateStagingApiOrigin(env = process.env) {
  const actual = env.QA_API_ORIGIN;
  const expected = env.QA_EXPECTED_API_ORIGIN;
  let actualUrl;
  let expectedUrl;
  try { actualUrl = new URL(actual); expectedUrl = new URL(expected); } catch {
    throw new StagingQaGateError('api_origin_missing_or_invalid');
  }
  const canonical = value => value.href === `${value.origin}/` && !value.username && !value.password;
  if (!canonical(actualUrl) || !canonical(expectedUrl) || actualUrl.protocol !== 'https:' || expectedUrl.protocol !== 'https:') {
    throw new StagingQaGateError('api_origin_must_be_https_origin');
  }
  if (actualUrl.origin !== expectedUrl.origin) throw new StagingQaGateError('api_origin_does_not_match_pin');
  if (DENIED_HOSTS.has(actualUrl.hostname.toLowerCase()) || /(^|[-.])prod(?:uction)?([-.]|$)/i.test(actualUrl.hostname)) {
    throw new StagingQaGateError('api_origin_is_not_an_allowed_staging_api');
  }
  if (!TARGET_ID_PATTERN.test(env.QA_EXPECTED_TARGET_ID || '')) throw new StagingQaGateError('expected_target_id_missing_or_invalid');
  return actualUrl.origin;
}

async function getJson(fetchImpl, origin, path) {
  let response;
  try { response = await fetchImpl(`${origin}${path}`, { method: 'GET', headers: { Accept: 'application/json' }, redirect: 'error', cache: 'no-store' }); } catch {
    throw new StagingQaGateError('api_request_failed');
  }
  if (!response.ok) throw new StagingQaGateError(`api_${path.split('/').at(-1)}_not_ready`);
  if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    throw new StagingQaGateError('api_returned_non_json');
  }
  try { return await response.json(); } catch {
    throw new StagingQaGateError('api_returned_invalid_json');
  }
}

export async function verifyStagingQaGate({ env = process.env, fetchImpl = fetch } = {}) {
  const origin = validateStagingApiOrigin(env);
  if (typeof env.QA_VERIFICATION_CAPTURE_TOKEN !== 'string' || env.QA_VERIFICATION_CAPTURE_TOKEN.length < 32) {
    throw new StagingQaGateError('qa_capture_credential_missing');
  }
  // Identity is requested first so an accidentally configured frontend URL is
  // rejected before any readiness follow-up. No workflow request is made here.
  const target = await getJson(fetchImpl, origin, '/api/health/load-test-target');
  if (target.service !== 'clinic-api') throw new StagingQaGateError('api_service_identity_mismatch');
  if (target.environment !== 'staging' || target.loadTestAllowed !== true) throw new StagingQaGateError('target_not_explicitly_staging_and_enabled');
  if (target.targetId !== env.QA_EXPECTED_TARGET_ID) throw new StagingQaGateError('target_id_mismatch');
  if (target.databaseEnvironment !== 'staging' || target.databaseIdentity !== 'verified') throw new StagingQaGateError('staging_database_identity_unverified');
  if (target.notifications !== 'sink') throw new StagingQaGateError('external_notifications_not_sunk');
  if (target.verificationCapture !== 'enabled') throw new StagingQaGateError('qa_verification_capture_not_enabled');
  if (!['disabled', 'ledger-only'].includes(target.payments)) throw new StagingQaGateError('external_payments_not_disabled');
  if (!Array.isArray(target.reasons) || target.reasons.length !== 0) throw new StagingQaGateError('target_reports_safety_reasons');

  const live = await getJson(fetchImpl, origin, '/api/health');
  if (live.status !== 'alive') throw new StagingQaGateError('api_liveness_check_failed');
  const ready = await getJson(fetchImpl, origin, '/api/health/ready');
  if (ready.status !== 'healthy') throw new StagingQaGateError('api_readiness_check_failed');

  return { apiOrigin: origin, environment: 'staging', targetId: target.targetId, gate: 'PASS' };
}

// Separate fail-closed gate for the disposable local runner. It never accepts a
// remote origin and independently verifies the local PostgreSQL identity.
export async function verifyLocalQaGate({ env = process.env, fetchImpl = fetch, databaseProbe,
  expectedDatabaseName = env.QA_LOCAL_DATABASE_NAME,
  expectedDatabaseRole = env.QA_LOCAL_DATABASE_ROLE,
  initialPreflight = true } = {}) {
  const apiPort = Number(env.QA_LOCAL_API_PORT);
  const dbPort = Number(env.QA_LOCAL_DB_PORT);
  const expectedOrigin = `http://127.0.0.1:${apiPort}`;
  if (!Number.isInteger(apiPort) || apiPort < 1024 || apiPort > 65535
      || !Number.isInteger(dbPort) || dbPort < 1024 || dbPort > 65535
      || !/^[a-z][a-z0-9_]{2,62}$/.test(expectedDatabaseName || '')
      || !/^[a-z][a-z0-9_]{2,62}$/.test(expectedDatabaseRole || '')) {
    throw new StagingQaGateError('local_configuration_unsafe');
  }
  if (env.QA_LOCAL_EXECUTION !== 'true' || !['development', 'test'].includes(env.NODE_ENV)
      || !['local', 'development', 'test'].includes(env.APP_ENV)
      || !['local', 'development', 'test'].includes(env.DEPLOYMENT_ENV)
      || !['local', 'test'].includes(env.DATABASE_ENVIRONMENT)
      || env.QA_API_ORIGIN !== expectedOrigin || env.QA_EXPECTED_API_ORIGIN !== expectedOrigin) {
    throw new StagingQaGateError('local_configuration_unsafe');
  }
  let url;
  try { url = new URL(env.DATABASE_URL || ''); } catch { throw new StagingQaGateError('local_database_unavailable'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== '127.0.0.1'
      || url.port !== String(dbPort) || url.pathname !== `/${expectedDatabaseName}` || url.username !== expectedDatabaseRole
      || env.DIRECT_URL !== env.DATABASE_URL || env.SOCKET_REVOCATION_DATABASE_URL !== env.DATABASE_URL) {
    throw new StagingQaGateError('local_database_unsafe');
  }
  if (env.NOTIFICATIONS_DISABLED !== 'true' || env.SMS_PROVIDER !== 'disabled'
      || env.VERIFICATION_PROVIDER !== 'development' || env.PHONE_VERIFICATION_PROVIDER !== 'development') {
    throw new StagingQaGateError('local_notifications_configuration_unsafe');
  }
  if (env.QA_PAYMENT_MODE !== 'disabled') throw new StagingQaGateError('local_payment_configuration_unsafe');
  const enabledSmtp = Object.keys(env).some(key => key.startsWith('SMTP_') && Boolean(env[key]));
  if (enabledSmtp) throw new StagingQaGateError('local_smtp_configuration_unsafe');
  const paymentKeys = ['PAYMENT_PROVIDER', 'PAYMENT_GATEWAY', 'PAYMENT_GATEWAY_ENABLED', 'PAYMENT_GATEWAY_URL',
    'PAYMENT_API_URL', 'PAYMENT_API_KEY', 'PAYMENT_SECRET_KEY', 'PAYMENT_WEBHOOK_SECRET', 'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_WEBHOOK_ID', 'FAWRY_API_KEY', 'BANKAK_API_KEY',
    'PAYSTACK_SECRET_KEY', 'FLUTTERWAVE_SECRET_KEY', 'PESAPAL_CONSUMER_KEY', 'DPO_COMPANY_TOKEN', 'SQUARE_ACCESS_TOKEN'];
  if (paymentKeys.some(key => env[key] && !(key.endsWith('_ENABLED') && String(env[key]).trim().toLowerCase() === 'false'))) {
    throw new StagingQaGateError('local_payment_configuration_unsafe');
  }
  if (typeof databaseProbe !== 'function') throw new StagingQaGateError('local_database_unavailable');
  let identity;
  try { identity = await databaseProbe(); } catch { throw new StagingQaGateError('local_database_unavailable'); }
  if (identity?.database !== expectedDatabaseName || identity?.schema !== 'public' || identity?.role !== expectedDatabaseRole
      || (initialPreflight && identity?.patientCount !== 0)) {
    throw new StagingQaGateError('local_database_identity_mismatch');
  }
  const live = await getJson(fetchImpl, expectedOrigin, '/api/health');
  if (live.status !== 'alive') throw new StagingQaGateError('api_liveness_check_failed');
  const ready = await getJson(fetchImpl, expectedOrigin, '/api/health/ready');
  if (ready.status !== 'healthy') throw new StagingQaGateError('api_readiness_check_failed');
  return { apiOrigin: expectedOrigin, environment: 'local', targetId: 'clinic-local-disposable', gate: 'PASS' };
}

export async function verifyQaCaptureAuthentication({ gateResult, env = process.env, fetchImpl = fetch } = {}) {
  const origin = validateStagingApiOrigin(env);
  if (gateResult?.gate !== 'PASS' || gateResult.apiOrigin !== origin || gateResult.targetId !== env.QA_EXPECTED_TARGET_ID) {
    throw new StagingQaGateError('staging_gate_pass_required_for_capture');
  }
  const token = env.QA_VERIFICATION_CAPTURE_TOKEN;
  if (typeof token !== 'string' || token.length < 32) throw new StagingQaGateError('qa_capture_credential_missing');
  let response;
  try {
    response = await fetchImpl(`${origin}/api/qa/verification-capture-auth-check`, {
      method: 'GET', headers: { Authorization: `Bearer ${token}` }, redirect: 'error', cache: 'no-store'
    });
  } catch {
    throw new StagingQaGateError('qa_capture_authentication_failed');
  }
  if (response.status !== 204) throw new StagingQaGateError('qa_capture_authentication_failed');
  return true;
}

export async function fetchQaVerificationCode({ gateResult, challengeId, env = process.env, fetchImpl = fetch } = {}) {
  const origin = validateStagingApiOrigin(env);
  if (gateResult?.gate !== 'PASS' || gateResult.apiOrigin !== origin || gateResult.targetId !== env.QA_EXPECTED_TARGET_ID) {
    throw new StagingQaGateError('staging_gate_pass_required_for_capture');
  }
  if (!CHALLENGE_ID_PATTERN.test(challengeId || '')) throw new StagingQaGateError('challenge_id_invalid');
  const token = env.QA_VERIFICATION_CAPTURE_TOKEN;
  if (typeof token !== 'string' || token.length < 32) throw new StagingQaGateError('qa_capture_credential_missing');

  let response;
  try {
    response = await fetchImpl(`${origin}/api/qa/verification-capture/${challengeId}`, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      redirect: 'error',
      cache: 'no-store'
    });
  } catch {
    throw new StagingQaGateError('qa_capture_request_failed');
  }
  if (!response.ok) throw new StagingQaGateError('qa_capture_unavailable');
  if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    throw new StagingQaGateError('qa_capture_returned_non_json');
  }
  let payload;
  try { payload = await response.json(); } catch {
    throw new StagingQaGateError('qa_capture_returned_invalid_json');
  }
  const expiresAt = Date.parse(payload?.expiresAt);
  if (payload?.challengeId !== challengeId || !/^\d{6}$/.test(payload?.code || '') || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw new StagingQaGateError('qa_capture_payload_invalid');
  }
  return payload.code;
}
