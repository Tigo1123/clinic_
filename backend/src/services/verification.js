import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import prisma from '../db.js';
import { sendEmail } from '../utils/notifications.js';
import { ApiError } from '../utils/apiError.js';

const EXPIRY_MINUTES = 10;

export async function createVerificationChallenge(user, type, targetNormalized) {
  const code = String(crypto.randomInt(100000, 1000000));
  const codeHash = await bcrypt.hash(code, 10);
  const challenge = await prisma.verificationChallenge.create({
    data: { userId: user.id, type, targetNormalized, codeHash, expiresAt: new Date(Date.now() + EXPIRY_MINUTES * 60000) }
  });
  const provider = process.env.VERIFICATION_PROVIDER;
  let developmentCode;
  if (provider === 'development' && process.env.NODE_ENV !== 'production') {
    developmentCode = code;
  } else if (provider === 'email' && type === 'EMAIL') {
    const sent = await sendEmail({ to: targetNormalized, subject: 'Verify your patient account', text: `Your verification code is ${code}. It expires in ${EXPIRY_MINUTES} minutes.` });
    if (!sent) throw new ApiError(503, 'VERIFICATION_DELIVERY_FAILED', 'Verification could not be delivered.');
  } else {
    throw new ApiError(503, 'VERIFICATION_PROVIDER_UNAVAILABLE', 'A verification provider is not configured for this identity.');
  }
  return { challenge, developmentCode };
}

export async function consumeVerificationChallenge(challengeId, code) {
  const challenge = await prisma.verificationChallenge.findUnique({ where: { id: challengeId }, include: { user: true } });
  if (!challenge || challenge.usedAt) throw new ApiError(422, 'VERIFICATION_INVALID', 'Verification challenge is invalid or already used.');
  if (challenge.expiresAt <= new Date()) throw new ApiError(422, 'VERIFICATION_EXPIRED', 'Verification challenge has expired.');
  if (challenge.attemptCount >= challenge.maxAttempts) throw new ApiError(429, 'VERIFICATION_ATTEMPTS_EXCEEDED', 'Verification attempt limit exceeded.');
  const valid = await bcrypt.compare(String(code), challenge.codeHash);
  if (!valid) {
    await prisma.verificationChallenge.update({ where: { id: challenge.id }, data: { attemptCount: { increment: 1 } } });
    throw new ApiError(422, 'VERIFICATION_CODE_INCORRECT', 'Verification code is incorrect.');
  }
  const consumed = await prisma.$transaction(async (tx) => {
    const claimed = await tx.verificationChallenge.updateMany({
      where: { id: challenge.id, usedAt: null },
      data: { usedAt: new Date() }
    });
    if (claimed.count !== 1) return false;
    await tx.user.update({ where: { id: challenge.userId }, data: {
      status: 'ACTIVE',
      ...(challenge.type === 'PHONE' ? { phoneVerifiedAt: new Date() } : { emailVerifiedAt: new Date() })
    } });
    return true;
  });
  if (!consumed) throw new ApiError(422, 'VERIFICATION_INVALID', 'Verification challenge is invalid or already used.');
  return challenge;
}
