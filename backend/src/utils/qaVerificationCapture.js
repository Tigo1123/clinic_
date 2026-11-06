import { timingSafeEqual } from 'node:crypto';
import { isStagingQaEnvironment, normalizeQaMarker } from './qaEnvironmentMarkers.js';

const QA_EMAIL = /^qa-\d{8}-[a-f0-9]{8}\+patient-\d{3}@example\.invalid$/i;
const CHALLENGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CODE = /^\d{6}$/;
const CAPTURE_TTL_MS = 5 * 60 * 1000;
const MAX_CAPTURES = 256;
const captures = new Map();

export function isSyntheticQaEmail(value) {
  return typeof value === 'string' && QA_EMAIL.test(value);
}

export function isQaVerificationCaptureEnabled(env = process.env) {
  return isStagingQaEnvironment(env)
    && normalizeQaMarker(env.QA_LOAD_TEST_ALLOWED) === 'true'
    && normalizeQaMarker(env.QA_VERIFICATION_CAPTURE_ENABLED) === 'true'
    && String(env.QA_VERIFICATION_CAPTURE_TOKEN || '').length >= 32
    && normalizeQaMarker(env.VERIFICATION_PROVIDER) === 'email'
    && normalizeQaMarker(env.QA_NOTIFICATION_MODE) === 'sink'
    && normalizeQaMarker(env.NOTIFICATIONS_DISABLED) === 'true'
    && normalizeQaMarker(env.SMS_PROVIDER) === 'disabled';
}

export function isValidQaVerificationCaptureToken(supplied, env = process.env) {
  const expected = env.QA_VERIFICATION_CAPTURE_TOKEN;
  if (!isQaVerificationCaptureEnabled(env) || typeof supplied !== 'string' || typeof expected !== 'string') return false;
  const suppliedBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected);
  return suppliedBytes.length === expectedBytes.length
    && suppliedBytes.length >= 32
    && timingSafeEqual(suppliedBytes, expectedBytes);
}

function purgeExpired(now) {
  for (const [id, capture] of captures) {
    if (capture.expiresAt <= now) {
      clearTimeout(capture.timer);
      captures.delete(id);
    }
  }
}

export async function captureQaVerificationCode({
  env = process.env,
  challengeId,
  recipient,
  code,
  findValidChallenge,
  now = Date.now()
}) {
  if (!isQaVerificationCaptureEnabled(env)
      || !CHALLENGE_ID.test(challengeId || '')
      || !isSyntheticQaEmail(recipient)
      || !CODE.test(code || '')
      || typeof findValidChallenge !== 'function') return false;

  purgeExpired(now);
  if (captures.size >= MAX_CAPTURES) return false;

  let challenge;
  try {
    challenge = await findValidChallenge();
  } catch {
    return false;
  }
  const expiry = challenge?.expiresAt instanceof Date ? challenge.expiresAt.getTime() : NaN;
  if (challenge?.id !== challengeId
      || challenge?.type !== 'REGISTRATION_EMAIL'
      || challenge?.targetNormalized !== recipient
      || challenge?.usedAt
      || challenge?.user?.email !== recipient
      || challenge?.user?.username !== recipient
      || challenge?.user?.role !== 'PATIENT'
      || challenge?.user?.status !== 'PENDING_VERIFICATION'
      || !Number.isFinite(expiry)
      || expiry <= now) return false;

  purgeExpired(now);
  if (captures.size >= MAX_CAPTURES && !captures.has(challengeId)) return false;
  const previous = captures.get(challengeId);
  if (previous) clearTimeout(previous.timer);
  const expiresAt = Math.min(expiry, now + CAPTURE_TTL_MS);
  const timer = setTimeout(() => captures.delete(challengeId), Math.max(0, expiresAt - now));
  timer.unref?.();
  captures.set(challengeId, { recipient, code, expiresAt, timer });
  return true;
}

export function peekQaVerificationCapture(challengeId, now = Date.now()) {
  purgeExpired(now);
  const capture = captures.get(challengeId);
  return capture ? { recipient: capture.recipient, expiresAt: capture.expiresAt } : null;
}

export function consumeQaVerificationCapture(challengeId, now = Date.now()) {
  purgeExpired(now);
  const capture = captures.get(challengeId);
  if (!capture) return null;
  clearTimeout(capture.timer);
  captures.delete(challengeId);
  return { recipient: capture.recipient, code: capture.code, expiresAt: capture.expiresAt };
}

export function discardQaVerificationCapture(challengeId) {
  const capture = captures.get(challengeId);
  if (!capture) return;
  clearTimeout(capture.timer);
  captures.delete(challengeId);
}

export function clearQaVerificationCapturesForTests() {
  for (const capture of captures.values()) clearTimeout(capture.timer);
  captures.clear();
}
