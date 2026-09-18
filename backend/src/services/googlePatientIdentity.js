import prisma from '../db.js';
import { ROLES } from '../middleware/policies.js';
import { ApiError } from '../utils/apiError.js';
import { normalizeEmail } from '../utils/identity.js';
import { signAccessToken } from './accessTokens.js';
import { verifyGoogleCredential } from './googleIdentity.js';
import { generateOnboardingCapability, hashOnboardingCapability, GOOGLE_ONBOARDING_CAPABILITY_TTL_MS } from './externalAuthCapability.js';

const GOOGLE_PROVIDER = 'GOOGLE';
const GOOGLE_SIGN_IN_CONFLICT = () => new ApiError(409, 'GOOGLE_SIGN_IN_CONFLICT', 'Google sign-in cannot be used for this account.');
const GOOGLE_LINKED_ACCOUNT_INELIGIBLE = () => new ApiError(403, 'GOOGLE_SIGN_IN_UNAVAILABLE', 'Google sign-in cannot be used for this account.');
const GOOGLE_ONBOARDING_BUSY = () => new ApiError(409, 'GOOGLE_ONBOARDING_BUSY', 'Google sign-in is already being processed. Please try again.');

function safePatientUser(user, patient) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    preferredLanguage: user.preferredLanguage,
    mfaEnabled: user.mfaEnabled,
    mustChangePassword: user.mustChangePassword,
    doctorId: null,
    doctorName: null,
    patientLinked: Boolean(patient),
    patientId: patient?.id || null,
    email: user.email,
    phone: user.phoneNormalized
  };
}

async function authenticateLinkedPatient(identity, db) {
  const linked = await db.userExternalIdentity.findUnique({
    where: { provider_providerSubject: { provider: GOOGLE_PROVIDER, providerSubject: identity.providerSubject } },
    include: {
      user: {
        select: {
          id: true, username: true, email: true, phoneNormalized: true, role: true, status: true,
          authVersion: true, preferredLanguage: true, mfaEnabled: true, mustChangePassword: true,
          patient: { select: { id: true } }
        }
      }
    }
  });
  if (!linked) return null;
  if (linked.user.role !== ROLES.PATIENT || linked.user.status !== 'ACTIVE') throw GOOGLE_LINKED_ACCOUNT_INELIGIBLE();

  const token = signAccessToken({
    id: linked.user.id,
    username: linked.user.username,
    role: linked.user.role,
    authVersion: linked.user.authVersion
  });
  return { status: 'AUTHENTICATED', token, user: safePatientUser(linked.user, linked.user.patient) };
}

async function findEmailUsers(email, db) {
  return db.user.findMany({
    where: {
      OR: [
        { email },
        { username: { equals: email, mode: 'insensitive' } }
      ]
    },
    orderBy: { id: 'asc' },
    take: 2,
    select: {
      id: true, role: true, status: true, email: true, username: true,
      pendingPatientRegistration: { select: { userId: true } }
    }
  });
}

async function createOrRotatePending(identity, db, now, onPendingLockAcquired) {
  const rawCapability = generateOnboardingCapability();
  const capabilityHash = hashOnboardingCapability(rawCapability);
  const expiresAt = new Date(now.getTime() + GOOGLE_ONBOARDING_CAPABILITY_TTL_MS);
  const lockKey = `${GOOGLE_PROVIDER}:${identity.providerSubject}`;

  return db.$transaction(async (tx) => {
    const [{ acquired }] = await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(hashtextextended(${lockKey}, 0)) AS acquired`;
    if (!acquired) throw GOOGLE_ONBOARDING_BUSY();
    if (onPendingLockAcquired) await onPendingLockAcquired();

    await tx.pendingExternalAuth.upsert({
      where: { provider_providerSubject: { provider: GOOGLE_PROVIDER, providerSubject: identity.providerSubject } },
      create: {
        provider: GOOGLE_PROVIDER,
        providerSubject: identity.providerSubject,
        verifiedEmail: identity.email,
        capabilityHash,
        expiresAt,
        consumedAt: null
      },
      update: {
        verifiedEmail: identity.email,
        capabilityHash,
        expiresAt,
        consumedAt: null
      }
    });

    return { status: 'ONBOARDING_REQUIRED', onboardingToken: rawCapability };
  });
}

export async function resolveGooglePatientIdentity({ credential, verifyCredential = verifyGoogleCredential, db = prisma, now = new Date(), onPendingLockAcquired } = {}) {
  const identity = await verifyCredential(credential);
  if (!identity || identity.provider !== GOOGLE_PROVIDER || typeof identity.providerSubject !== 'string' || !identity.providerSubject.trim() || typeof identity.email !== 'string' || !identity.email.trim()) {
    throw new ApiError(401, 'GOOGLE_CREDENTIAL_INVALID', 'Google sign-in could not be verified.');
  }
  const normalizedIdentity = {
    provider: GOOGLE_PROVIDER,
    providerSubject: identity.providerSubject,
    email: normalizeEmail(identity.email)
  };

  const linkedResult = await authenticateLinkedPatient(normalizedIdentity, db);
  if (linkedResult) return linkedResult;

  const matchingUsers = await findEmailUsers(normalizedIdentity.email, db);
  if (matchingUsers.length > 1) throw GOOGLE_SIGN_IN_CONFLICT();
  const matchedUser = matchingUsers[0];

  if (matchedUser) {
    if (matchedUser.role !== ROLES.PATIENT) throw GOOGLE_SIGN_IN_CONFLICT();
    if (matchedUser.status === 'PENDING_VERIFICATION' && matchedUser.pendingPatientRegistration) {
      return { status: 'REGISTRATION_PENDING' };
    }
    return { status: 'ACCOUNT_LINK_REQUIRED' };
  }

  return createOrRotatePending(normalizedIdentity, db, now, onPendingLockAcquired);
}
