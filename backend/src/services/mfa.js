import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import * as OTPAuth from 'otpauth';
import prisma from '../db.js';
import { decryptMfaSecret, encryptMfaSecret } from './mfaCrypto.js';

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

export function generateTotpEnrollment(label) {
  const secret = new OTPAuth.Secret({ size: 20 }).base32;
  const totp = createTotp(secret, label);
  return { secret, otpauthUri: totp.toString() };
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
  const { secret, otpauthUri } = generateTotpEnrollment(user.username);
  const expiresAt = new Date(Date.now() + ENROLLMENT_MINUTES * 60 * 1000);
  const secretEncrypted = encryptMfaSecret(secret, user.id);
  await prisma.$transaction([
    prisma.mfaConfiguration.upsert({
      where: { userId: user.id },
      create: { userId: user.id, secretEncrypted, state: 'PENDING', enrollmentExpiresAt: expiresAt },
      update: { secretEncrypted, state: 'PENDING', enrollmentExpiresAt: expiresAt, lastTotpStep: null }
    }),
    prisma.tenantAuditLog.create({
      data: { userId: user.id, action: 'MFA_ENROLLMENT_STARTED', details: 'Staff MFA enrollment started.', ipAddress }
    })
  ]);
  return { secret, otpauthUri, expiresAt };
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

export async function createMfaChallenge(userId, purpose = 'LOGIN') {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + CHALLENGE_MINUTES * 60 * 1000);
  const challenge = await prisma.$transaction(async (tx) => {
    await tx.mfaChallenge.updateMany({
      where: { userId, purpose, usedAt: null },
      data: { usedAt: now }
    });
    return tx.mfaChallenge.create({
      data: { userId, purpose, tokenHash: challengeTokenHash(token), expiresAt, maxAttempts: CHALLENGE_MAX_ATTEMPTS },
      select: { id: true, expiresAt: true }
    });
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

export async function recordMfaChallengeFailure(challengeId, now = new Date()) {
  const updated = await prisma.mfaChallenge.updateMany({
    where: { id: challengeId, usedAt: null, expiresAt: { gt: now }, attemptCount: { lt: CHALLENGE_MAX_ATTEMPTS } },
    data: { attemptCount: { increment: 1 } }
  });
  return updated.count === 1;
}

export async function consumeMfaChallenge(challengeId, userId, now = new Date()) {
  const consumed = await prisma.mfaChallenge.updateMany({
    where: {
      id: challengeId, userId, usedAt: null, expiresAt: { gt: now },
      attemptCount: { lt: CHALLENGE_MAX_ATTEMPTS }
    },
    data: { usedAt: now }
  });
  return consumed.count === 1;
}
