import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import * as OTPAuth from 'otpauth';
import prisma from '../db.js';
import { decryptMfaSecret, encryptMfaSecret, fingerprintMfaSecret } from './mfaCrypto.js';
import { logger } from '../utils/logger.js';

const ENROLLMENT_MINUTES = 10;
const CHALLENGE_MINUTES = 5;
const CHALLENGE_MAX_ATTEMPTS = 5;
const RECOVERY_CODE_COUNT = 10;
const RECOVERY_BCRYPT_ROUNDS = 10;
const TOTP_PERIOD_SECONDS = 30;
const TOTP_WINDOW = 1;

export class MfaError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'MfaError';
    this.status = status;
    this.code = code;
  }
}

function totpIssuer() {
  return process.env.MFA_TOTP_ISSUER || 'Clinic Management System';
}

function createTotp(secret, label) {
  return new OTPAuth.TOTP({
    issuer: totpIssuer(),
    label,
    algorithm: 'SHA1',
    digits: 6,
    period: TOTP_PERIOD_SECONDS,
    secret: OTPAuth.Secret.fromBase32(secret)
  });
}

export function buildTotpEnrollment(secret, label) {
  const totp = createTotp(secret, label);
  return { secret, otpauthUri: totp.toString() };
}

export function generateTotpEnrollment(label) {
  return buildTotpEnrollment(new OTPAuth.Secret({ size: 20 }).base32, label);
}

export function validateTotp(secret, code, timestamp = Date.now()) {
  if (!/^\d{6}$/.test(String(code))) return null;
  const delta = createTotp(secret, 'verification').validate({
    token: String(code),
    timestamp,
    window: TOTP_WINDOW
  });
  if (delta === null) return null;
  return BigInt(Math.floor(timestamp / (TOTP_PERIOD_SECONDS * 1000)) + delta);
}

export function generateRecoveryCodes() {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const value = crypto.randomBytes(10).toString('hex').toUpperCase();
    return `${value.slice(0, 5)}-${value.slice(5, 10)}-${value.slice(10, 15)}-${value.slice(15, 20)}`;
  });
}

function normalizeRecoveryCode(code) {
  return String(code || '').replace(/[^A-Fa-f0-9]/g, '').toUpperCase();
}

export async function hashRecoveryCodes(codes) {
  return Promise.all(codes.map((code) => bcrypt.hash(normalizeRecoveryCode(code), RECOVERY_BCRYPT_ROUNDS)));
}

export async function consumeRecoveryCode(userId, code) {
  const normalized = normalizeRecoveryCode(code);
  if (normalized.length !== 20) return false;
  const candidates = await prisma.mfaRecoveryCode.findMany({
    where: { userId, usedAt: null },
    select: { id: true, codeHash: true }
  });
  for (const candidate of candidates) {
    if (await bcrypt.compare(normalized, candidate.codeHash)) {
      const consumed = await prisma.mfaRecoveryCode.updateMany({
        where: { id: candidate.id, userId, usedAt: null },
        data: { usedAt: new Date() }
      });
      return consumed.count === 1;
    }
  }
  return false;
}

export async function startMfaEnrollment(user, ipAddress = 'unknown') {
  const enrollment = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${user.id} FOR UPDATE`;
    const existing = await tx.mfaConfiguration.findUnique({ where: { userId: user.id } });
    const now = new Date();

    if (existing?.state === 'PENDING' && existing.enrollmentExpiresAt > now) {
      const secret = decryptMfaSecret(existing.secretEncrypted, user.id);
      return { ...buildTotpEnrollment(secret, user.username), expiresAt: existing.enrollmentExpiresAt, reused: true };
    }
    if (existing?.state === 'ACTIVE') {
      throw new MfaError(409, 'MFA_ALREADY_ENABLED', 'MFA is already enabled.');
    }

    const generated = generateTotpEnrollment(user.username);
    const expiresAt = new Date(now.getTime() + ENROLLMENT_MINUTES * 60 * 1000);
    const secretEncrypted = encryptMfaSecret(generated.secret, user.id);
    await tx.mfaConfiguration.upsert({
      where: { userId: user.id },
      create: { userId: user.id, secretEncrypted, state: 'PENDING', enrollmentExpiresAt: expiresAt },
      update: { secretEncrypted, state: 'PENDING', enrollmentExpiresAt: expiresAt, lastTotpStep: null }
    });
    await tx.tenantAuditLog.create({
      data: { userId: user.id, action: 'MFA_ENROLLMENT_STARTED', details: 'Staff MFA enrollment started.', ipAddress }
    });
    return { ...generated, expiresAt, reused: false };
  });

  logger.security('auth.mfa_enrollment_secret_selected', {
    userId: user.id,
    source: enrollment.reused ? 'existing_pending' : 'new',
    enrollmentFingerprint: fingerprintMfaSecret(enrollment.secret, user.id),
    ip: ipAddress
  });
  return enrollment;
}

export async function confirmMfaEnrollment(userId, code, timestamp = Date.now(), ipAddress = 'unknown') {
  const configuration = await prisma.mfaConfiguration.findUnique({ where: { userId } });
  if (!configuration || configuration.state !== 'PENDING') {
    throw new MfaError(409, 'MFA_ENROLLMENT_NOT_PENDING', 'MFA enrollment is not pending.');
  }
  if (!configuration.enrollmentExpiresAt || configuration.enrollmentExpiresAt <= new Date(timestamp)) {
    throw new MfaError(422, 'MFA_ENROLLMENT_EXPIRED', 'MFA enrollment has expired.');
  }
  const secret = decryptMfaSecret(configuration.secretEncrypted, userId);
  logger.security('auth.mfa_enrollment_secret_loaded', {
    userId,
    enrollmentFingerprint: fingerprintMfaSecret(secret, userId),
    ip: ipAddress
  });
  const acceptedStep = validateTotp(secret, code, timestamp);
  if (acceptedStep === null) throw new MfaError(422, 'MFA_CODE_INVALID', 'The authenticator code is invalid.');

  const recoveryCodes = generateRecoveryCodes();
  const recoveryHashes = await hashRecoveryCodes(recoveryCodes);
  const enabledAt = new Date(timestamp);
  const enabled = await prisma.$transaction(async (tx) => {
    const claimed = await tx.mfaConfiguration.updateMany({
      where: { userId, state: 'PENDING', enrollmentExpiresAt: { gt: enabledAt } },
      data: { state: 'ACTIVE', enrollmentExpiresAt: null, lastTotpStep: acceptedStep }
    });
    if (claimed.count !== 1) return false;
    await tx.mfaRecoveryCode.deleteMany({ where: { userId } });
    await tx.mfaRecoveryCode.createMany({
      data: recoveryHashes.map((codeHash) => ({ userId, codeHash }))
    });
    await tx.user.update({ where: { id: userId }, data: { mfaEnabled: true } });
    await tx.tenantAuditLog.create({
      data: { userId, action: 'MFA_ENABLED', details: 'Staff MFA enrollment confirmed and enabled.', ipAddress }
    });
    return true;
  });
  if (!enabled) throw new MfaError(409, 'MFA_ENROLLMENT_CONFLICT', 'MFA enrollment was already processed.');
  return recoveryCodes;
}

export async function consumeTotp(userId, code, timestamp = Date.now()) {
  const configuration = await prisma.mfaConfiguration.findUnique({ where: { userId } });
  if (!configuration || configuration.state !== 'ACTIVE') return false;
  const secret = decryptMfaSecret(configuration.secretEncrypted, userId);
  const acceptedStep = validateTotp(secret, code, timestamp);
  if (acceptedStep === null) return false;
  const consumed = await prisma.mfaConfiguration.updateMany({
    where: {
      userId,
      state: 'ACTIVE',
      OR: [{ lastTotpStep: null }, { lastTotpStep: { lt: acceptedStep } }]
    },
    data: { lastTotpStep: acceptedStep }
  });
  return consumed.count === 1;
}

function challengeTokenHash(token) {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

export async function createMfaChallenge(userId, purpose = 'LOGIN', ipAddress = 'unknown') {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + CHALLENGE_MINUTES * 60 * 1000);
  const challenge = await prisma.$transaction(async (tx) => {
    await tx.mfaChallenge.updateMany({
      where: { userId, purpose, usedAt: null },
      data: { usedAt: now }
    });
    const created = await tx.mfaChallenge.create({
      data: { userId, purpose, tokenHash: challengeTokenHash(token), expiresAt, maxAttempts: CHALLENGE_MAX_ATTEMPTS },
      select: { id: true, expiresAt: true }
    });
    await tx.tenantAuditLog.create({
      data: { userId, action: 'MFA_CHALLENGE_CREATED', details: 'Staff login MFA challenge created.', ipAddress }
    });
    return created;
  });
  return { token, challengeId: challenge.id, expiresAt: challenge.expiresAt };
}

export async function findMfaChallenge(token, purpose = 'LOGIN', now = new Date()) {
  const challenge = await prisma.mfaChallenge.findUnique({
    where: { tokenHash: challengeTokenHash(String(token || '')) }
  });
  if (!challenge || challenge.purpose !== purpose || challenge.usedAt || challenge.expiresAt <= now) return null;
  if (challenge.attemptCount >= challenge.maxAttempts) return null;
  return challenge;
}

export async function recordMfaChallengeFailure(challengeId, now = new Date(), ipAddress = 'unknown') {
  return prisma.$transaction(async (tx) => {
    const updated = await tx.mfaChallenge.updateMany({
      where: { id: challengeId, usedAt: null, expiresAt: { gt: now }, attemptCount: { lt: CHALLENGE_MAX_ATTEMPTS } },
      data: { attemptCount: { increment: 1 } }
    });
    if (updated.count === 1) {
      const challenge = await tx.mfaChallenge.findUnique({ where: { id: challengeId }, select: { userId: true } });
      if (challenge) await tx.tenantAuditLog.create({
        data: { userId: challenge.userId, action: 'MFA_VERIFICATION_FAILED', details: 'Staff login MFA verification failed.', ipAddress }
      });
    }
    return updated.count === 1;
  });
}

export async function consumeMfaChallenge(challengeId, userId, now = new Date(), ipAddress = null) {
  return prisma.$transaction(async (tx) => {
    const consumed = await tx.mfaChallenge.updateMany({
      where: {
        id: challengeId, userId, usedAt: null, expiresAt: { gt: now },
        attemptCount: { lt: CHALLENGE_MAX_ATTEMPTS }
      },
      data: { usedAt: now }
    });
    if (consumed.count === 1 && ipAddress !== null) await tx.tenantAuditLog.create({
      data: { userId, action: 'MFA_VERIFICATION_SUCCEEDED', details: 'Staff login MFA verification succeeded.', ipAddress }
    });
    return consumed.count === 1;
  });
}

export async function verifyRecoveryLoginChallenge(token, recoveryCode, staffRoles, now = new Date(), ipAddress = 'unknown') {
  const tokenHash = challengeTokenHash(String(token || ''));
  const submittedCode = String(recoveryCode || '').trim();
  const wellFormed = /^[A-Fa-f0-9]{5}(?:-?[A-Fa-f0-9]{5}){3}$/.test(submittedCode);
  const normalized = wellFormed ? normalizeRecoveryCode(submittedCode) : null;

  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw`SELECT "id" FROM "MfaChallenge" WHERE "tokenHash" = ${tokenHash} FOR UPDATE`;
    if (locked.length !== 1) return { status: 'CHALLENGE_INVALID' };

    const challenge = await tx.mfaChallenge.findUnique({ where: { tokenHash } });
    if (!challenge || challenge.purpose !== 'LOGIN' || challenge.usedAt || challenge.expiresAt <= now || challenge.attemptCount >= challenge.maxAttempts) {
      return { status: 'CHALLENGE_INVALID' };
    }

    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${challenge.userId} FOR UPDATE`;
    const user = await tx.user.findUnique({
      where: { id: challenge.userId },
      select: {
        id: true, username: true, role: true, status: true, preferredLanguage: true,
        email: true, phoneNormalized: true, mfaEnabled: true,
        mfaConfiguration: { select: { state: true } },
        doctor: { select: { id: true, fullNameEn: true } }
      }
    });
    if (!user || !staffRoles.includes(user.role) || user.status !== 'ACTIVE' || !user.mfaEnabled || user.mfaConfiguration?.state !== 'ACTIVE') {
      await tx.mfaChallenge.update({ where: { id: challenge.id }, data: { usedAt: now } });
      await tx.tenantAuditLog.create({
        data: { userId: challenge.userId, action: 'MFA_RECOVERY_LOGIN_FAILED', details: 'Recovery-code login rejected because the account was not eligible.', ipAddress }
      });
      return { status: 'CHALLENGE_INVALID' };
    }

    // Serialize recovery attempts for this user. This makes the code check and
    // consumption one atomic operation even when different valid challenges
    // concurrently submit the same recovery code.
    await tx.$queryRaw`SELECT "id" FROM "MfaRecoveryCode" WHERE "userId" = ${user.id} AND "usedAt" IS NULL FOR UPDATE`;
    const candidates = await tx.mfaRecoveryCode.findMany({
      where: { userId: user.id, usedAt: null },
      select: { id: true, codeHash: true }
    });
    let matchedId = null;
    if (normalized) {
      for (const candidate of candidates) {
        if (await bcrypt.compare(normalized, candidate.codeHash)) {
          matchedId = candidate.id;
          break;
        }
      }
    }

    if (!matchedId) {
      const updated = await tx.mfaChallenge.update({
        where: { id: challenge.id },
        data: { attemptCount: { increment: 1 } },
        select: { attemptCount: true, maxAttempts: true }
      });
      await tx.tenantAuditLog.create({
        data: { userId: user.id, action: 'MFA_RECOVERY_LOGIN_FAILED', details: 'Recovery-code login verification failed.', ipAddress }
      });
      return { status: updated.attemptCount >= updated.maxAttempts ? 'CHALLENGE_INVALID' : 'INVALID' };
    }

    const recoveryConsumed = await tx.mfaRecoveryCode.updateMany({
      where: { id: matchedId, userId: user.id, usedAt: null },
      data: { usedAt: now }
    });
    const challengeConsumed = await tx.mfaChallenge.updateMany({
      where: { id: challenge.id, userId: user.id, usedAt: null, expiresAt: { gt: now }, attemptCount: { lt: challenge.maxAttempts } },
      data: { usedAt: now }
    });
    if (recoveryConsumed.count !== 1 || challengeConsumed.count !== 1) {
      throw new Error('Atomic recovery-code login consumption failed.');
    }
    await tx.tenantAuditLog.create({
      data: { userId: user.id, action: 'MFA_RECOVERY_LOGIN_SUCCEEDED', details: 'Staff login completed with a recovery code.', ipAddress }
    });
    return { status: 'SUCCESS', user };
  });
}
