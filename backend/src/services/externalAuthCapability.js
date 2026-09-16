import crypto from 'node:crypto';
import prisma from '../db.js';
import { ApiError } from '../utils/apiError.js';

export const GOOGLE_ONBOARDING_CAPABILITY_TTL_MS = 15 * 60 * 1000;
const CAPABILITY_BYTES = 32;
const CAPABILITY_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function generateOnboardingCapability() {
  return crypto.randomBytes(CAPABILITY_BYTES).toString('base64url');
}

export function hashOnboardingCapability(rawCapability) {
  if (typeof rawCapability !== 'string' || !CAPABILITY_PATTERN.test(rawCapability)) {
    throw new ApiError(422, 'ONBOARDING_CAPABILITY_INVALID', 'The onboarding capability is invalid.');
  }
  return crypto.createHash('sha256').update(rawCapability, 'utf8').digest('hex');
}

export async function lookupPendingExternalAuthCapability(rawCapability, db = prisma, now = new Date()) {
  const capabilityHash = hashOnboardingCapability(rawCapability);
  const pending = await db.pendingExternalAuth.findUnique({
    where: { capabilityHash },
    select: { id: true, provider: true, providerSubject: true, verifiedEmail: true, expiresAt: true, consumedAt: true }
  });
  if (!pending || pending.consumedAt || pending.expiresAt <= now) return null;
  return pending;
}
