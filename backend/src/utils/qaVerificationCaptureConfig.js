import { timingSafeEqual } from 'node:crypto';
import { isStagingQaEnvironment, normalizeQaMarker } from './qaEnvironmentMarkers.js';

export const isSyntheticQaEmail = value => typeof value === 'string'
  && /^qa-\d{8}-[a-f0-9]{8}\+patient-\d{3}@example\.invalid$/i.test(value);

function configured(env) {
  return isStagingQaEnvironment(env)
    && normalizeQaMarker(env.QA_LOAD_TEST_ALLOWED) === 'true'
    && normalizeQaMarker(env.QA_VERIFICATION_CAPTURE_ENABLED) === 'true'
    && String(env.QA_VERIFICATION_CAPTURE_TOKEN || '').length >= 32
    && normalizeQaMarker(env.VERIFICATION_PROVIDER) === 'email'
    && normalizeQaMarker(env.QA_NOTIFICATION_MODE) === 'sink'
    && normalizeQaMarker(env.NOTIFICATIONS_DISABLED) === 'true'
    && normalizeQaMarker(env.SMS_PROVIDER) === 'disabled';
}

export function readQaCaptureStorageKey(env = process.env) {
  const key = env.QA_VERIFICATION_CAPTURE_STORAGE_KEY;
  // Never trim/normalize credentials or derive this key from other app secrets.
  const reused = [env.MEDICAL_ENCRYPTION_KEY, env.MFA_ENCRYPTION_KEY, env.JWT_SECRET, env.QA_VERIFICATION_CAPTURE_TOKEN].includes(key);
  return typeof key === 'string' && /^[a-fA-F0-9]{64}$/.test(key) && !reused ? Buffer.from(key, 'hex') : null;
}

export function validateQaVerificationCaptureStorage(env = process.env) {
  if (configured(env) && !readQaCaptureStorageKey(env)) {
    throw new Error('QA_VERIFICATION_CAPTURE_STORAGE_KEY must be a dedicated 64-character hexadecimal key when staging QA capture is enabled.');
  }
}

export function isQaVerificationCaptureEnabled(env = process.env) {
  return configured(env) && Boolean(readQaCaptureStorageKey(env));
}

export function isValidQaVerificationCaptureToken(supplied, env = process.env) {
  const expected = env.QA_VERIFICATION_CAPTURE_TOKEN;
  if (!isQaVerificationCaptureEnabled(env) || typeof supplied !== 'string' || typeof expected !== 'string') return false;
  const suppliedBytes = Buffer.from(supplied), expectedBytes = Buffer.from(expected);
  return suppliedBytes.length === expectedBytes.length && suppliedBytes.length >= 32
    && timingSafeEqual(suppliedBytes, expectedBytes);
}
