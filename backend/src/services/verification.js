import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import prisma from '../db.js';
import { sendEmail } from '../utils/notifications.js';
import { ApiError } from '../utils/apiError.js';

export const registrationPurpose = () => process.env.VERIFICATION_PROVIDER === 'email' ? 'REGISTRATION_EMAIL' : 'REGISTRATION_PHONE';
const invalid = () => new ApiError(422, 'VERIFICATION_INVALID', 'Verification request is invalid or already used.');
export async function lockAccount(tx, userId) {
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
  return tx.user.findUnique({ where: { id: userId } });
}
export async function invalidateChallenges(tx, userId) {
  await tx.verificationChallenge.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } });
}
export async function createVerificationChallenge(user, type, targetNormalized) {
  const code = String(crypto.randomInt(100000, 1000000));
  const codeHash = await bcrypt.hash(code, 10);
  const challenge = await prisma.$transaction(async (tx) => {
    const current = await lockAccount(tx, user.id);
    if (!current || current.authVersion !== user.authVersion || current.role !== 'PATIENT') throw invalid();
    if (type === 'PROFILE_PHONE_CHANGE' && (!current.email || !current.emailVerifiedAt)) throw invalid();
    const registration = type.startsWith('REGISTRATION_');
    if (registration ? current.status !== 'PENDING_VERIFICATION' : current.status !== 'ACTIVE') throw invalid();
    if (!['REGISTRATION_EMAIL', 'REGISTRATION_PHONE', 'EMAIL', 'PHONE', 'PASSWORD_RESET', 'PROFILE_EMAIL_CHANGE', 'PROFILE_PHONE_CHANGE'].includes(type)) throw invalid();
    if (!type.startsWith('PROFILE_') && targetNormalized !== (type.endsWith('PHONE') ? current.phoneNormalized : current.email)) throw invalid();
    if (type !== 'PASSWORD_RESET') await tx.verificationChallenge.updateMany({ where: { userId: user.id, type, usedAt: null }, data: { usedAt: new Date() } });
    return tx.verificationChallenge.create({ data: { userId: user.id, type, targetNormalized, authVersion: current.authVersion, codeHash, expiresAt: new Date(Date.now() + 600000) } });
  });
  if (process.env.VERIFICATION_PROVIDER === 'development' && process.env.NODE_ENV !== 'production') return { challenge, developmentCode: code };
  if (!type.endsWith('PHONE')) {
    const sent = await sendEmail({ to: type === 'PROFILE_PHONE_CHANGE' ? user.email : targetNormalized, subject: 'Confirm your patient account request', text: `Your verification code is ${code}. It expires in 10 minutes.` });
    if (sent) return { challenge };
  }
  await prisma.verificationChallenge.update({ where: { id: challenge.id }, data: { usedAt: new Date() } });
  throw new ApiError(503, 'VERIFICATION_DELIVERY_FAILED', 'Verification could not be delivered.');
}

// Lock order: account, then challenges. Return failures from the transaction so
// failed-code attempts commit; throwing inside it would roll back the budget.
export async function consumeVerificationChallenge({ challengeId, code, purpose, userId, authVersion, currentPassword, transition }) {
  if (!purpose || typeof transition !== 'function') throw invalid();
  const candidate = await prisma.verificationChallenge.findUnique({ where: { id: challengeId }, select: { userId: true } });
  if (!candidate || (userId && candidate.userId !== userId)) throw invalid();
  const result = await prisma.$transaction(async (tx) => {
    const user = await lockAccount(tx, candidate.userId);
    const challenge = await tx.verificationChallenge.findUnique({ where: { id: challengeId } });
    if (!user || !challenge || challenge.type !== purpose || challenge.usedAt || user.role !== 'PATIENT' || challenge.authVersion === null || challenge.authVersion !== user.authVersion || (authVersion !== undefined && authVersion !== user.authVersion)) return { error: invalid() };
    if (purpose === 'PROFILE_PHONE_CHANGE' && (!user.email || !user.emailVerifiedAt)) return { error: invalid() };
    const registration = purpose.startsWith('REGISTRATION_');
    if (registration ? user.status !== 'PENDING_VERIFICATION' : user.status !== 'ACTIVE') return { error: invalid() };
    if (!purpose.startsWith('PROFILE_') && challenge.targetNormalized !== (purpose.endsWith('PHONE') ? user.phoneNormalized : user.email)) return { error: invalid() };
    if (purpose === 'PROFILE_EMAIL_CHANGE' && (!currentPassword || !await bcrypt.compare(currentPassword, user.passwordHash))) return { error: new ApiError(401, 'REAUTHENTICATION_FAILED', 'Current credentials are invalid.') };
    if (challenge.expiresAt <= new Date()) return { error: new ApiError(422, 'VERIFICATION_EXPIRED', 'Verification challenge has expired.') };
    if (challenge.attemptCount >= challenge.maxAttempts) return { error: new ApiError(429, 'VERIFICATION_ATTEMPTS_EXCEEDED', 'Verification attempt limit exceeded.') };
    const valid = await bcrypt.compare(String(code), challenge.codeHash);
    await tx.verificationChallenge.update({ where: { id: challenge.id }, data: { attemptCount: { increment: 1 } } });
    if (!valid) return { error: new ApiError(422, 'VERIFICATION_CODE_INCORRECT', 'Verification code is incorrect.') };
    if (challenge.expiresAt <= new Date()) return { error: new ApiError(422, 'VERIFICATION_EXPIRED', 'Verification challenge has expired.') };
    await tx.verificationChallenge.update({ where: { id: challenge.id }, data: { usedAt: new Date() } });
    return { value: await transition(tx, { ...challenge, user }) };
  }, { timeout: 15000 });
  if (result.error) throw result.error;
  return result.value;
}
