import bcrypt from 'bcryptjs';
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

export async function linkGooglePatientIdentity({
  userId,
  currentPassword,
  credential,
  verifyCredential = verifyGoogleCredential,
  db = prisma,
  now = new Date()
} = {}) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      passwordHash: true,
      status: true,
      role: true
    }
  });

  if (!user || user.status !== 'ACTIVE' || user.role !== ROLES.PATIENT) {
    throw new ApiError(401, 'REAUTHENTICATION_FAILED', 'Current credentials are invalid.');
  }

  if (!currentPassword || !user.passwordHash || !await bcrypt.compare(currentPassword, user.passwordHash)) {
    throw new ApiError(401, 'REAUTHENTICATION_FAILED', 'Current credentials are invalid.');
  }

  const identity = await verifyCredential(credential);
  if (
    !identity ||
    identity.provider !== GOOGLE_PROVIDER ||
    typeof identity.providerSubject !== 'string' ||
    !identity.providerSubject.trim() ||
    typeof identity.email !== 'string' ||
    !identity.email.trim()
  ) {
    throw new ApiError(401, 'GOOGLE_CREDENTIAL_INVALID', 'Google credential could not be verified.');
  }

  const normalizedGoogleEmail = normalizeEmail(identity.email);
  const normalizedUserEmail = normalizeEmail(user.email);

  if (normalizedGoogleEmail !== normalizedUserEmail) {
    throw new ApiError(409, 'GOOGLE_EMAIL_MISMATCH', 'Google account email does not match clinic account email.');
  }

  const existingSubject = await db.userExternalIdentity.findUnique({
    where: {
      provider_providerSubject: {
        provider: GOOGLE_PROVIDER,
        providerSubject: identity.providerSubject
      }
    }
  });
  if (existingSubject) {
    throw new ApiError(409, 'GOOGLE_IDENTITY_ALREADY_LINKED', 'This Google account is already linked to another patient.');
  }

  const existingUserLink = await db.userExternalIdentity.findFirst({
    where: {
      userId,
      provider: GOOGLE_PROVIDER
    }
  });
  if (existingUserLink) {
    throw new ApiError(409, 'GOOGLE_ALREADY_LINKED', 'A Google account is already linked to this account.');
  }

  try {
    const created = await db.userExternalIdentity.create({
      data: {
        userId,
        provider: GOOGLE_PROVIDER,
        providerSubject: identity.providerSubject,
        normalizedEmailAtLink: normalizedGoogleEmail,
        createdAt: now
      }
    });

    return {
      success: true,
      googleAccount: {
        linked: true,
        email: created.normalizedEmailAtLink,
        linkedAt: created.createdAt
      }
    };
  } catch (error) {
    if (error.code === 'P2002') {
      const target = error.meta?.target || [];
      if (target.includes('providerSubject') || target.includes('provider_providerSubject')) {
        throw new ApiError(409, 'GOOGLE_IDENTITY_ALREADY_LINKED', 'This Google account is already linked to another patient.');
      }
      if (target.includes('userId') || target.includes('userId_provider')) {
        throw new ApiError(409, 'GOOGLE_ALREADY_LINKED', 'A Google account is already linked to this account.');
      }
      throw new ApiError(409, 'GOOGLE_IDENTITY_CONFLICT', 'External identity conflict.');
    }
    throw error;
  }
}

export async function unlinkGooglePatientIdentity({
  userId,
  currentPassword,
  db = prisma
} = {}) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      passwordHash: true,
      status: true,
      role: true
    }
  });

  if (!user || user.status !== 'ACTIVE' || user.role !== ROLES.PATIENT) {
    throw new ApiError(401, 'REAUTHENTICATION_FAILED', 'Current credentials are invalid.');
  }

  if (!currentPassword || !user.passwordHash || !await bcrypt.compare(currentPassword, user.passwordHash)) {
    throw new ApiError(401, 'REAUTHENTICATION_FAILED', 'Current credentials are invalid.');
  }

  const existingLink = await db.userExternalIdentity.findFirst({
    where: {
      userId,
      provider: GOOGLE_PROVIDER
    }
  });

  if (!existingLink) {
    throw new ApiError(404, 'GOOGLE_NOT_LINKED', 'No Google account is currently linked.');
  }

  if (!user.passwordHash) {
    throw new ApiError(400, 'PRIMARY_AUTH_REQUIRED', 'Cannot unlink Google account without a password.');
  }

  await db.userExternalIdentity.delete({
    where: { id: existingLink.id }
  });

  return {
    success: true,
    googleAccount: {
      linked: false
    }
  };
}
