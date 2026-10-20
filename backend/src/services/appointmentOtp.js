import { randomUUID } from 'node:crypto';

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

// This is the existing public-booking OTP store, extracted so the endpoint
// and its lifecycle rules share one testable implementation.
const challenges = new Map();

export function issueAppointmentOtp(phone, code, now = Date.now()) {
  for (const [key, challenge] of challenges) {
    if (challenge.expiresAt <= now) challenges.delete(key);
  }
  const existing = challenges.get(phone);
  if (existing?.reservationToken) {
    return {
      issued: false,
      reason: 'RESERVATION_IN_PROGRESS',
      retryAfterSeconds: Math.max(1, Math.ceil((existing.expiresAt - now) / 1000))
    };
  }
  if (existing && existing.expiresAt > now && existing.issuedAt + OTP_RESEND_COOLDOWN_MS > now) {
    return { issued: false, retryAfterSeconds: Math.ceil((existing.issuedAt + OTP_RESEND_COOLDOWN_MS - now) / 1000) };
  }
  challenges.set(phone, { code, issuedAt: now, expiresAt: now + OTP_TTL_MS, attempts: 0, reservationToken: null });
  return { issued: true };
}

export function reserveAppointmentOtp(phone, code, now = Date.now()) {
  const challenge = challenges.get(phone);
  if (!challenge || challenge.expiresAt <= now) {
    if (challenge?.expiresAt <= now) challenges.delete(phone);
    return { valid: false };
  }
  if (challenge.attempts >= OTP_MAX_ATTEMPTS || challenge.reservationToken || challenge.consumed) return { valid: false };
  if (challenge.code !== code) {
    challenge.attempts += 1;
    if (challenge.attempts >= OTP_MAX_ATTEMPTS) challenge.code = null;
    return { valid: false };
  }
  const reservationToken = randomUUID();
  challenge.reservationToken = reservationToken;
  return { valid: true, reservationToken };
}

export function finishAppointmentOtp(phone, reservationToken, { consumed, now = Date.now() } = {}) {
  const challenge = challenges.get(phone);
  if (!challenge || !reservationToken || challenge.reservationToken !== reservationToken) return false;
  if (challenge.expiresAt <= now) {
    challenges.delete(phone);
    return false;
  }
  challenge.reservationToken = null;
  if (consumed) {
    challenge.code = null;
    challenge.consumed = true;
    return true;
  }
  return true;
}

export function clearAppointmentOtpsForTests() {
  challenges.clear();
}
