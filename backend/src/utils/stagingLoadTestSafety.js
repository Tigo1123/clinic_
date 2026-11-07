import { createHash } from 'node:crypto';
import { isQaVerificationCaptureEnabled } from './qaVerificationCaptureConfig.js';
import { isStagingQaEnvironment, normalizeQaMarker } from './qaEnvironmentMarkers.js';

// These fingerprints are pinned in scripts/provision-first-admin.js and identify
// the reviewed Neon database targets without exposing or comparing credentials.
const PRODUCTION_DATABASE_FINGERPRINT = 'c9f8bb593c61b80e';
const STAGING_DATABASE_FINGERPRINT = '36b1790f3b5c2037';
const TARGET_ID_PATTERN = /^[a-zA-Z0-9_-]{12,80}$/;
const ROLE_PATTERN = /^[A-Za-z_][A-Za-z0-9_$-]{0,62}$/;
const EXTERNAL_PAYMENT_CONFIG_KEYS = [
  'PAYMENT_PROVIDER', 'PAYMENT_GATEWAY', 'PAYMENT_GATEWAY_ENABLED', 'PAYMENT_GATEWAY_URL',
  'PAYMENT_API_URL', 'PAYMENT_API_KEY', 'PAYMENT_SECRET_KEY', 'PAYMENT_WEBHOOK_SECRET',
  'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_WEBHOOK_ID',
  'FAWRY_API_KEY', 'BANKAK_API_KEY', 'PAYSTACK_SECRET_KEY', 'FLUTTERWAVE_SECRET_KEY',
  'PESAPAL_CONSUMER_KEY', 'DPO_COMPANY_TOKEN', 'SQUARE_ACCESS_TOKEN',
  'CHECKOUT_SECRET_KEY', 'CHECKOUT_API_KEY'
];

function databaseUrl(value) {
  try {
    const url = new URL(value || '');
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) return null;
    if (!url.hostname || url.username === '' || url.password === '') return null;
    if (['schema', 'sslmode', 'options'].some(key => url.searchParams.getAll(key).length > 1)) return null;
    return url;
  } catch {
    return null;
  }
}

function databaseFingerprint(url) {
  if (!url) return null;
  const schema = url.searchParams.get('schema') || 'public';
  return createHash('sha256')
    .update(`${url.hostname.toLowerCase()}//${url.pathname.slice(1)}/${schema}`)
    .digest('hex')
    .slice(0, 16);
}

function unpool(hostname) {
  return hostname.replace(/-pooler(?=\.)/i, '');
}

function hasExternalPaymentConfiguration(env) {
  return EXTERNAL_PAYMENT_CONFIG_KEYS.some(key => {
    const value = env[key];
    if (!value) return false;
    return !(key.endsWith('_ENABLED') && normalizeQaMarker(value) === 'false');
  });
}

export function isStagingNotificationSink(env = process.env) {
  return isStagingQaEnvironment(env)
    && normalizeQaMarker(env.QA_NOTIFICATION_MODE) === 'sink';
}

function identityResult({ environment, databaseEnvironment, targetId, reasons, databaseIdentity = 'unverified', notifications = 'unsafe', payments = 'unsafe', verificationCapture = 'disabled' }) {
  const loadTestAllowed = reasons.length === 0
    && databaseIdentity === 'verified'
    && notifications === 'sink'
    && verificationCapture === 'enabled'
    && ['disabled', 'ledger-only'].includes(payments);
  return {
    service: 'clinic-api',
    environment,
    loadTestAllowed,
    databaseEnvironment,
    databaseIdentity,
    notifications,
    verificationCapture,
    payments,
    targetId: TARGET_ID_PATTERN.test(targetId || '') ? targetId : null,
    reasons: [...new Set(reasons)]
  };
}

export function stagingLoadTestPreflight(env = process.env) {
  const environment = isStagingQaEnvironment(env)
    ? 'staging'
    : normalizeQaMarker(env.DEPLOYMENT_ENV) === 'production' || normalizeQaMarker(env.APP_ENV) === 'production'
      ? 'production'
      : 'unknown';
  const databaseMarker = normalizeQaMarker(env.DATABASE_ENVIRONMENT);
  const databaseEnvironment = ['staging', 'production'].includes(databaseMarker)
    ? databaseMarker
    : 'unknown';
  const reasons = [];

  // A production declaration always wins, even if an operator mistakenly sets
  // staging's opt-in flag on the production service.
  if (environment !== 'staging') reasons.push('environment_not_staging');
  if (normalizeQaMarker(env.QA_LOAD_TEST_ALLOWED) !== 'true') reasons.push('load_test_not_explicitly_allowed');
  if (databaseEnvironment !== 'staging') reasons.push('database_environment_not_staging');
  if (!TARGET_ID_PATTERN.test(env.QA_LOAD_TEST_TARGET_ID || '')) reasons.push('target_id_missing_or_invalid');
  if (!/^[A-Za-z_][A-Za-z0-9_$-]{0,62}$/.test(env.QA_EXPECTED_DATABASE_NAME || '')) reasons.push('expected_database_name_missing_or_invalid');
  if (!/^[A-Za-z_][A-Za-z0-9_$-]{0,62}$/.test(env.QA_EXPECTED_DATABASE_SCHEMA || '')) reasons.push('expected_database_schema_missing_or_invalid');
  if (!ROLE_PATTERN.test(env.QA_EXPECTED_DATABASE_ROLE || '')) reasons.push('expected_database_role_missing_or_invalid');

  const runtimeUrl = databaseUrl(env.DATABASE_URL);
  const directUrl = databaseUrl(env.DIRECT_URL);
  const expectedDatabase = env.QA_EXPECTED_DATABASE_NAME;
  const expectedSchema = env.QA_EXPECTED_DATABASE_SCHEMA;
  if (!runtimeUrl || !directUrl) reasons.push('database_url_invalid');
  if (runtimeUrl && directUrl) {
    const directSchema = directUrl.searchParams.get('schema') || 'public';
    const runtimeSchema = runtimeUrl.searchParams.get('schema') || 'public';
    const directFingerprint = databaseFingerprint(directUrl);
    if (directFingerprint === PRODUCTION_DATABASE_FINGERPRINT) reasons.push('production_database_target');
    else if (directFingerprint !== STAGING_DATABASE_FINGERPRINT) reasons.push('database_target_not_pinned_staging');
    if (unpool(runtimeUrl.hostname).toLowerCase() !== directUrl.hostname.toLowerCase()) reasons.push('runtime_database_target_mismatch');
    if (directUrl.pathname.slice(1) !== expectedDatabase || runtimeUrl.pathname.slice(1) !== expectedDatabase) reasons.push('database_name_mismatch');
    if (directSchema !== expectedSchema || runtimeSchema !== expectedSchema) reasons.push('database_schema_mismatch');
  }
  if (normalizeQaMarker(env.QA_NOTIFICATION_MODE) !== 'sink'
      || normalizeQaMarker(env.NOTIFICATIONS_DISABLED) !== 'true'
      || normalizeQaMarker(env.SMS_PROVIDER) !== 'disabled') reasons.push('external_notifications_not_safely_sunk');
  const notifications = reasons.includes('external_notifications_not_safely_sunk') ? 'unsafe' : 'sink';

  const verificationCapture = isQaVerificationCaptureEnabled(env) ? 'enabled' : 'disabled';
  if (verificationCapture !== 'enabled') reasons.push('qa_verification_capture_not_safely_configured');

  const paymentMode = normalizeQaMarker(env.QA_PAYMENT_MODE);
  if (!['disabled', 'ledger-only'].includes(paymentMode) || hasExternalPaymentConfiguration(env)) reasons.push('external_payments_not_disabled');
  const payments = reasons.includes('external_payments_not_disabled') ? 'unsafe' : paymentMode;

  return {
    environment,
    databaseEnvironment,
    targetId: env.QA_LOAD_TEST_TARGET_ID,
    reasons,
    notifications,
    verificationCapture,
    payments,
    canInspectDatabase: reasons.length === 0,
    expectedDatabase,
    expectedSchema,
    expectedRole: env.QA_EXPECTED_DATABASE_ROLE
  };
}

export async function getStagingLoadTestTarget(env = process.env, queryDatabaseIdentity) {
  const preflight = stagingLoadTestPreflight(env);
  if (!preflight.canInspectDatabase) {
    return identityResult({ ...preflight, databaseIdentity: 'unverified' });
  }
  if (typeof queryDatabaseIdentity !== 'function') {
    return identityResult({ ...preflight, reasons: ['database_identity_query_unavailable'] });
  }

  let identity;
  try {
    identity = await queryDatabaseIdentity();
  } catch {
    return identityResult({ ...preflight, reasons: ['database_identity_query_failed'] });
  }
  const matches = identity?.database === preflight.expectedDatabase
    && identity?.schema === preflight.expectedSchema
    && identity?.role === preflight.expectedRole;
  if (!matches) return identityResult({ ...preflight, reasons: ['connected_database_identity_mismatch'] });
  return identityResult({ ...preflight, databaseIdentity: 'verified', reasons: [] });
}

export function safeQaEnvironmentSummary(target) {
  return {
    service: target.service,
    environment: target.environment,
    loadTestAllowed: target.loadTestAllowed,
    databaseEnvironment: target.databaseEnvironment,
    databaseIdentity: target.databaseIdentity,
    notifications: target.notifications,
    verificationCapture: target.verificationCapture,
    payments: target.payments,
    targetId: target.targetId,
    reasons: target.reasons
  };
}
