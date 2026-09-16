import bcrypt from 'bcryptjs';
import prisma from '../db.js';
import { ROLES } from '../middleware/policies.js';
import { ApiError } from '../utils/apiError.js';
import { normalizeEmail } from '../utils/identity.js';
import { structuredPatientName } from '../utils/patientName.js';
import { normalizePatientPhone } from '../utils/patientIdentity.js';
import { patientIdentitySummary } from '../utils/patientOnboarding.js';
import { createVerificationChallengeRecord } from './verification.js';
import { hashOnboardingCapability } from './externalAuthCapability.js';
import { assertPhoneVerificationAvailable, sendPhoneVerificationCode } from './phoneVerification.js';

const GOOGLE_PROVIDER = 'GOOGLE';
const bcryptRounds = Number(process.env.BCRYPT_ROUNDS || 12);
const invalidCapability = () => new ApiError(422, 'GOOGLE_ONBOARDING_INVALID', 'This Google onboarding session is invalid or expired.');
const conflict = (code = 'GOOGLE_SIGN_IN_CONFLICT') => new ApiError(409, code, code === 'REGISTRATION_PENDING' ? 'A patient registration is already pending.' : 'Google sign-in cannot be used for this account.');

function pendingSelect() {
  return { id: true, provider: true, providerSubject: true, verifiedEmail: true, capabilityHash: true, expiresAt: true, consumedAt: true };
}

function assertPending(pending, now) {
  if (!pending || pending.provider !== GOOGLE_PROVIDER || pending.consumedAt || pending.expiresAt <= now) throw invalidCapability();
}

async function findEmailUsers(email, tx) {
  return tx.user.findMany({
    where: { OR: [{ email }, { username: { equals: email, mode: 'insensitive' } }] },
    orderBy: { id: 'asc' },
    take: 2,
    select: { id: true, role: true, status: true, pendingPatientRegistration: { select: { userId: true } } }
  });
}

export async function completeGooglePatientOnboarding({ onboardingToken, fields, db = prisma, now = new Date(), phoneDelivery = sendPhoneVerificationCode } = {}) {
  // Google already proves email ownership. Phone verification is the only
  // remaining registration challenge and must have an available provider.
  assertPhoneVerificationAvailable();
  const capabilityHash = hashOnboardingCapability(onboardingToken);
  const phoneNormalized = normalizePatientPhone(fields.phone);
  if (!phoneNormalized) throw new ApiError(422, 'PHONE_INVALID', 'Phone number is invalid.');
  const passwordHash = await bcrypt.hash(fields.password, bcryptRounds);

  return db.$transaction(async (tx) => {
    const pendingByHash = await tx.pendingExternalAuth.findUnique({ where: { capabilityHash }, select: pendingSelect() });
    assertPending(pendingByHash, now);
    const lockKey = `${pendingByHash.provider}:${pendingByHash.providerSubject}`;
    const [{ acquired }] = await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(hashtextextended(${lockKey}, 0)) AS acquired`;
    if (!acquired) throw new ApiError(409, 'GOOGLE_ONBOARDING_BUSY', 'Google sign-in is already being processed. Please try again.');

    const pending = await tx.pendingExternalAuth.findUnique({ where: { capabilityHash }, select: pendingSelect() });
    assertPending(pending, now);

    const linked = await tx.userExternalIdentity.findUnique({
      where: { provider_providerSubject: { provider: GOOGLE_PROVIDER, providerSubject: pending.providerSubject } },
      select: { id: true }
    });
    if (linked) throw conflict();

    const email = normalizeEmail(pending.verifiedEmail);
    const matchingUsers = await findEmailUsers(email, tx);
    if (matchingUsers.length > 1) throw conflict();
    if (matchingUsers[0]) {
      if (matchingUsers[0].role !== ROLES.PATIENT) throw conflict();
      if (matchingUsers[0].status === 'PENDING_VERIFICATION' && matchingUsers[0].pendingPatientRegistration) throw conflict('REGISTRATION_PENDING');
      throw conflict('ACCOUNT_LINK_REQUIRED');
    }
    if (await tx.user.findUnique({ where: { phoneNormalized }, select: { id: true } })) {
      throw new ApiError(409, 'PHONE_ALREADY_REGISTERED', 'An account already exists for this phone number.');
    }

    const addressStateId = fields.addressStateId ?? Number(process.env.DEFAULT_STATE_ID || 1);
    const state = await tx.state.findUnique({ where: { id: addressStateId }, select: { id: true } });
    if (!state) throw new ApiError(422, 'INVALID_ADDRESS_STATE', 'The selected address state is unavailable.');

    const user = await tx.user.create({
      data: {
        username: email,
        email,
        phoneNormalized,
        passwordHash,
        role: ROLES.PATIENT,
        status: 'PENDING_VERIFICATION',
        preferredLanguage: 'en',
        emailVerifiedAt: now
      }
    });
    const name = structuredPatientName(fields);
    await tx.patientRegistration.create({
      data: { userId: user.id, ...name, gender: fields.gender, dateOfBirth: fields.dateOfBirth, addressStateId: state.id }
    });
    await tx.userExternalIdentity.create({
      data: { userId: user.id, provider: GOOGLE_PROVIDER, providerSubject: pending.providerSubject, normalizedEmailAtLink: email }
    });
    const verificationType = 'REGISTRATION_PHONE';
    const verificationTarget = phoneNormalized;
    const verification = await createVerificationChallengeRecord(tx, user, verificationType, verificationTarget);
    const consumed = await tx.pendingExternalAuth.updateMany({
      where: { id: pending.id, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now }
    });
    if (consumed.count !== 1) throw invalidCapability();

    return {
      state: 'VERIFICATION_REQUIRED',
      identity: patientIdentitySummary({ ...name, gender: fields.gender, dateOfBirth: fields.dateOfBirth, phone: phoneNormalized, addressStateId: state.id }),
      challengeId: verification.challenge.id,
      _delivery: { destination: verificationTarget, code: verification.code, purpose: verificationType }
    };
  }, { timeout: 15000 }).then(async ({ _delivery, ...result }) => {
    try {
      const delivery = await phoneDelivery(_delivery);
      return { ...result, ...(delivery.developmentCode ? { developmentCode: delivery.developmentCode } : {}) };
    } catch (error) {
      if (error?.code === 'VERIFICATION_UNAVAILABLE' || error?.code === 'VERIFICATION_DELIVERY_FAILED') throw error;
      throw new ApiError(503, 'VERIFICATION_DELIVERY_FAILED', 'Verification could not be delivered.');
    }
  });
}
