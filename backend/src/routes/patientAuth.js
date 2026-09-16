import crypto from 'crypto';
import express from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import prisma from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { allowRoles, ROLES } from '../middleware/policies.js';
import { validate } from '../middleware/validate.js';
import { normalizeEmail, normalizePhone } from '../utils/identity.js';
import { createVerificationChallenge, consumeVerificationChallenge, registrationPurpose, invalidateChallenges, verificationUnavailable } from '../services/verification.js';
import { ApiError, sendError } from '../utils/apiError.js';
import { rateLimits } from '../config.js';
import { getClinicDateString } from '../utils/clinicTime.js';
import { passwordSchema } from '../utils/passwordPolicy.js';
import { markSensitiveResponse } from '../utils/edgeSecurity.js';
import { structuredPatientName, structuredPatientNameSchema } from '../utils/patientName.js';

import { normalizePatientPhone } from '../utils/patientIdentity.js';
import { lockPatientIdentity, patientDateOfBirthSchema, patientIdentitySummary } from '../utils/patientOnboarding.js';
import { resolveGooglePatientIdentity } from '../services/googlePatientIdentity.js';

const router = express.Router();
router.use((req, res, next) => { markSensitiveResponse(res); next(); });
const limiter = (limit) => rateLimit({ windowMs: rateLimits.windowMs, limit, standardHeaders: 'draft-7', legacyHeaders: false, handler: (req, res) => sendError(res, 429, 'RATE_LIMITED', 'Too many attempts. Please try again later.') });
const registrationLimiter = limiter(rateLimits.registration);
const verificationLimiter = limiter(rateLimits.verification);
const claimLimiter = limiter(rateLimits.claim);
const bcryptRounds = Number(process.env.BCRYPT_ROUNDS || 12);
const verificationResendCooldownMs = 60 * 1000;

async function audit(userId, action, details, req, db = prisma) {
  await db.tenantAuditLog.create({ data: { userId, action, details, ipAddress: req.ip || 'unknown' } });
}

async function matchingPatients(phoneNormalized, dateOfBirth, db = prisma) {
  const candidates = await db.patient.findMany({ where: { dateOfBirth }, select: { id: true, phone: true, userId: true } });
  return candidates.filter((patient) => normalizePatientPhone(patient.phone) === phoneNormalized);
}

const offlineVerificationDisabled = () => process.env.VERIFICATION_PROVIDER === 'disabled';
const claimFailure = () => new ApiError(422, 'CLAIM_VERIFICATION_FAILED', 'Claim verification failed.');
const requestedAddressStateId = (value) => value ?? Number(process.env.DEFAULT_STATE_ID || 1);
async function resolveAddressStateId(client, addressStateId) {
  const state = await client.state.findUnique({ where: { id: addressStateId }, select: { id: true } });
  if (!state) throw new ApiError(422, 'INVALID_ADDRESS_STATE', 'The selected address state is unavailable.');
  return state.id;
}
// 12 and 24 random bytes encode to exactly 16 and 32 base64url characters.
// Keep generation, parsing, and request validation on this one format.
const CLAIM_PUBLIC_ID_BYTES = 12;
const CLAIM_SECRET_BYTES = 24;
const CLAIM_CREDENTIAL_PATTERN = /^[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{32}$/;
const claimCredentialSchema = z.string().regex(CLAIM_CREDENTIAL_PATTERN);
function parseClaimCredential(code) {
  if (!CLAIM_CREDENTIAL_PATTERN.test(String(code))) return null;
  const [publicId, secret] = String(code).split('.');
  return { publicId, secret };
}

async function consumeClaimCredential(tx, { credential, patientId, dateOfBirth }) {
  const parsed = parseClaimCredential(credential);
  if (!parsed) return { error: claimFailure() };
  const claim = await tx.patientClaimCode.findUnique({
    where: { publicId: parsed.publicId },
    include: { patient: { select: { id: true, userId: true, dateOfBirth: true } }, createdBy: { select: { status: true, role: true, authVersion: true } } }
  });
  if (!claim || claim.patientId !== patientId || claim.patient.userId || claim.patient.dateOfBirth !== dateOfBirth ||
      claim.usedAt || claim.expiresAt <= new Date() || claim.attemptCount >= claim.maxAttempts ||
      claim.issuerAuthVersion === null || claim.createdBy.status !== 'ACTIVE' ||
      ![ROLES.ADMIN, ROLES.RECEPTIONIST].includes(claim.createdBy.role) || claim.createdBy.authVersion !== claim.issuerAuthVersion) {
    return { error: claimFailure() };
  }
  const valid = await bcrypt.compare(parsed.secret, claim.codeHash);
  if (!valid) {
    await tx.patientClaimCode.updateMany({ where: { id: claim.id, usedAt: null, attemptCount: { lt: claim.maxAttempts } }, data: { attemptCount: { increment: 1 } } });
    return { error: claimFailure() };
  }
  const consumed = await tx.patientClaimCode.updateMany({
    where: { id: claim.id, usedAt: null, expiresAt: { gt: new Date() }, attemptCount: { lt: claim.maxAttempts } },
    data: { usedAt: new Date() }
  });
  return consumed.count === 1 ? { claim } : { error: claimFailure() };
}

router.post('/register', registrationLimiter, validate(structuredPatientNameSchema.extend({
  phone: z.string().trim().min(7).max(30),
  email: z.string().trim().email().max(254), dateOfBirth: patientDateOfBirthSchema,
  gender: z.enum(['MALE', 'FEMALE']), password: passwordSchema, addressStateId: z.coerce.number().int().min(1).max(18).optional()
}).strict()), async (req, res, next) => {
  let createdUserId;
  try {
    if (offlineVerificationDisabled()) throw verificationUnavailable();
    const addressStateId = requestedAddressStateId(req.body.addressStateId);
    const phoneNormalized = normalizePatientPhone(req.body.phone);
    const email = normalizeEmail(req.body.email);
    if (!phoneNormalized) return sendError(res, 422, 'PHONE_INVALID', 'Phone number is invalid.');
    if (req.body.dateOfBirth >= getClinicDateString()) return sendError(res, 422, 'INVALID_DATE_OF_BIRTH', 'Date of birth must be in the past.');
    if (await prisma.user.findUnique({ where: { phoneNormalized } })) return sendError(res, 409, 'PHONE_ALREADY_REGISTERED', 'An account already exists for this phone number.');
    if (email && await prisma.user.findFirst({ where: { OR: [{ email: { equals: email, mode: 'insensitive' } }, { username: { equals: email, mode: 'insensitive' } }] } })) return sendError(res, 409, 'EMAIL_ALREADY_REGISTERED', 'An account already exists for this email.');
    const passwordHash = await bcrypt.hash(req.body.password, bcryptRounds);
    const user = await prisma.$transaction(async (tx) => {
      const resolvedAddressStateId = await resolveAddressStateId(tx, addressStateId);
      const created = await tx.user.create({ data: {
        username: email || phoneNormalized, email, phoneNormalized, passwordHash, role: ROLES.PATIENT,
        status: 'PENDING_VERIFICATION', preferredLanguage: 'en'
      } });
      const name = structuredPatientName(req.body);
      await tx.patientRegistration.create({ data: {
        userId: created.id, ...name, gender: req.body.gender,
        dateOfBirth: req.body.dateOfBirth, addressStateId: resolvedAddressStateId
      } });
      return created;
    });
    createdUserId = user.id;
    const verificationType = registrationPurpose();
    const verificationTarget = verificationType.endsWith('EMAIL') ? email : phoneNormalized;
    if (!verificationTarget) throw new ApiError(422, 'VERIFICATION_TARGET_MISSING', 'Email is required when email verification is configured.');
    const { challenge, developmentCode } = await createVerificationChallenge(user, verificationType, verificationTarget);
    await audit(user.id, 'PATIENT_ACCOUNT_REGISTRATION', 'Patient online account registration started.', req);
    return markSensitiveResponse(res).status(201).json({ state: 'VERIFICATION_REQUIRED', identity: patientIdentitySummary({ ...structuredPatientName(req.body), gender: req.body.gender, dateOfBirth: req.body.dateOfBirth, phone: phoneNormalized, addressStateId }), challengeId: challenge.id, ...(developmentCode ? { developmentCode } : {}) });
  } catch (error) {
    if (createdUserId) await prisma.user.delete({ where: { id: createdUserId } }).catch(() => {});
    if (error.code === 'P2002') {
      const target = error.meta?.target || [];
      if (target.includes('phoneNormalized')) return sendError(res, 409, 'PHONE_ALREADY_REGISTERED', 'An account already exists for this phone number.');
      if (target.includes('email') || target.includes('username')) return sendError(res, 409, 'EMAIL_ALREADY_REGISTERED', 'An account already exists for this email.');
      return sendError(res, 409, 'ACCOUNT_ALREADY_EXISTS', 'An account already exists for this identity.');
    }
    next(error);
  }
});

router.post('/google/verify', verificationLimiter, validate(z.object({
  credential: z.string().trim().min(1).max(20000)
}).strict()), async (req, res, next) => {
  try {
    const result = await resolveGooglePatientIdentity({ credential: req.body.credential });
    const status = ['ACCOUNT_LINK_REQUIRED', 'REGISTRATION_PENDING'].includes(result.status) ? 409 : 200;
    return markSensitiveResponse(res).status(status).json(result);
  } catch (error) {
    return next(error);
  }
});

router.post('/verify', verificationLimiter, validate(z.object({ challengeId: z.string().uuid(), code: z.string().regex(/^\d{6}$/) }).strict()), async (req, res, next) => {
  try {
    const result = await consumeVerificationChallenge({ challengeId: req.body.challengeId, code: req.body.code, purpose: registrationPurpose(), transition: async (tx, challenge) => {
      const linkedPatient = await tx.patient.findUnique({ where: { userId: challenge.userId } });
      if (linkedPatient) return { state: 'VERIFIED', patient: patientIdentitySummary(linkedPatient) };
      const registration = await tx.patientRegistration.findUnique({ where: { userId: challenge.userId } });
      if (!registration) throw new ApiError(409, 'REGISTRATION_STATE_INVALID', 'Registration details are unavailable.');
      const addressStateId = await resolveAddressStateId(tx, registration.addressStateId);
      await tx.user.update({ where: { id: challenge.userId }, data: { status: 'ACTIVE', ...(challenge.type.endsWith('PHONE') ? { phoneVerifiedAt: new Date() } : { emailVerifiedAt: new Date() }) } });
    await lockPatientIdentity(tx, { phone: challenge.user.phoneNormalized, dateOfBirth: registration.dateOfBirth });
    const matches = await matchingPatients(challenge.user.phoneNormalized, registration.dateOfBirth, tx);
    if (matches.some((patient) => patient.userId)) {
      await audit(challenge.userId, 'PATIENT_CLAIM_REJECTED', 'Matching patient record is already claimed.', req, tx);
      return ({ state: 'MANUAL_REVIEW_REQUIRED' });
    }
    if (matches.length === 0) {
      const patient = await tx.patient.create({ data: {
        userId: challenge.userId, fullNameAr: registration.fullNameAr, fullNameEn: registration.fullNameEn,
        firstNameAr: registration.firstNameAr, fatherNameAr: registration.fatherNameAr,
        grandfatherNameAr: registration.grandfatherNameAr, familyNameAr: registration.familyNameAr,
        firstNameEn: registration.firstNameEn, fatherNameEn: registration.fatherNameEn,
        grandfatherNameEn: registration.grandfatherNameEn, familyNameEn: registration.familyNameEn,
        gender: registration.gender, dateOfBirth: registration.dateOfBirth, phone: challenge.user.phoneNormalized,
        addressStateId, emergencyContact: 'Self'
      } });
      await audit(challenge.userId, 'PATIENT_FILE_CREATED', JSON.stringify({ patientId: patient.id, fileNumber: patient.fileNumber, context: 'ONLINE_VERIFICATION' }), req, tx);
      await audit(challenge.userId, 'PATIENT_RECORD_CREATED', `Created patient record ${patient.id} for verified account.`, req, tx);
      return ({ state: 'CLAIMED', patient: patientIdentitySummary(patient) });
    }
    if (matches.length === 1) {
      const matchedPatient = matches[0];

      // Linking an EXISTING medical record requires verified ownership
      // of the phone number used for phone + DOB matching.
      //
      // Email verification is sufficient for creating a brand-new empty
      // Patient record, but it must never grant access to an existing
      // clinical record based on an unverified phone number.
      const verifiedUser = await tx.user.findUnique({
        where: {
          id: challenge.userId
        },
        select: {
          phoneVerifiedAt: true
        }
      });

      if (!verifiedUser?.phoneVerifiedAt) {
        await audit(
          challenge.userId,
          'PATIENT_AUTO_LINK_REJECTED',
          'Automatic linkage to an existing patient record requires a verified phone number.',
          req, tx
        );

        return ({
          state: 'MANUAL_REVIEW_REQUIRED',
          reason: 'VERIFIED_PHONE_REQUIRED'
        });
      }

      // Auto-link only when the matching patient record is still unclaimed.
      // The match is already constrained by normalized phone + date of birth.
      const linked = await tx.patient.updateMany({
        where: {
          id: matchedPatient.id,
          userId: null
        },
        data: {
          userId: challenge.userId
        }
      });

      if (linked.count !== 1) {
        await audit(
          challenge.userId,
          'PATIENT_AUTO_LINK_CONFLICT',
          'Matching patient record could not be auto-linked because ownership changed.',
          req, tx
        );

        return ({ state: 'MANUAL_REVIEW_REQUIRED' });
      }

      await audit(
        challenge.userId,
        'PATIENT_RECORD_AUTO_LINKED',
        `Automatically linked verified account to existing patient record ${matchedPatient.id}.`,
        req, tx
      );

      return ({ state: 'CLAIMED', patient: patientIdentitySummary(await tx.patient.findUnique({ where: { id: matchedPatient.id } })) });
    }

    await audit(
      challenge.userId,
      'PATIENT_CLAIM_AMBIGUOUS',
      'Multiple patient records matched verified identity and date of birth.',
      req, tx
    );

    return ({ state: 'AMBIGUOUS_MATCH' });
    } });
    return res.json(result);
  } catch (error) { next(error); }
});
router.post(
  '/verification/resend',
  verificationLimiter,
  validate(z.object({
    challengeId: z.string().uuid()
  })),
  async (req, res, next) => {
    try {
      const previousChallenge = await prisma.verificationChallenge.findUnique({
        where: { id: req.body.challengeId },
        include: { user: true }
      });

      if (!previousChallenge || previousChallenge.usedAt || previousChallenge.type !== registrationPurpose() || previousChallenge.authVersion !== previousChallenge.user.authVersion) {
        return sendError(
          res,
          422,
          'VERIFICATION_INVALID',
          'Verification challenge is invalid or already used.'
        );
      }

      if (previousChallenge.user.status !== 'PENDING_VERIFICATION') {
        return sendError(
          res,
          409,
          'ACCOUNT_ALREADY_VERIFIED',
          'This account is already verified.'
        );
      }

      const verificationType = registrationPurpose();

      const target =
        verificationType.endsWith('EMAIL')
          ? previousChallenge.user.email
          : previousChallenge.user.phoneNormalized;

      if (!target) {
        return sendError(
          res,
          422,
          'VERIFICATION_TARGET_MISSING',
          'Verification target is unavailable.'
        );
      }

      const { challenge, developmentCode } =
        await createVerificationChallenge(
          previousChallenge.user,
          verificationType,
          target,
          { cooldownMs: verificationResendCooldownMs }
        );

      await audit(
        previousChallenge.user.id,
        'PATIENT_VERIFICATION_RESENT',
        'Patient verification code resent.',
        req
      );

      return markSensitiveResponse(res).status(201).json({
        state: 'VERIFICATION_REQUIRED',
        challengeId: challenge.id,
        ...(developmentCode ? { developmentCode } : {})
      });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  '/verification/resend-by-identity',
  verificationLimiter,
  validate(z.object({
    identity: z.string().trim().min(3).max(254),
    password: z.string().min(1).max(200)
  })),
  async (req, res, next) => {
    try {
      const identity = req.body.identity.trim();
      const normalizedEmail = identity.includes('@')
        ? normalizeEmail(identity)
        : null;
      const normalizedPhone = normalizePhone(identity);

      const user = await prisma.user.findFirst({
        where: {
          OR: [
            { username: identity },
            ...(normalizedEmail
              ? [
                  { email: normalizedEmail },
                  { username: normalizedEmail }
                ]
              : []),
            ...(normalizedPhone
              ? [{ phoneNormalized: normalizedPhone }]
              : [])
          ]
        }
      });

      if (!user) {
        return sendError(
          res,
          401,
          'INVALID_CREDENTIALS',
          'Invalid username or password.'
        );
      }

      const passwordValid = await bcrypt.compare(
        req.body.password,
        user.passwordHash
      );

      if (!passwordValid) {
        return sendError(
          res,
          401,
          'INVALID_CREDENTIALS',
          'Invalid username or password.'
        );
      }

      if (user.role !== ROLES.PATIENT) {
        return sendError(
          res,
          403,
          'PATIENT_ACCOUNT_REQUIRED',
          'A patient account is required.'
        );
      }

      if (user.status !== 'PENDING_VERIFICATION') {
        return sendError(
          res,
          409,
          'ACCOUNT_NOT_PENDING_VERIFICATION',
          'This account does not require verification.'
        );
      }

      const verificationType = registrationPurpose();

      const target =
        verificationType.endsWith('EMAIL')
          ? user.email
          : user.phoneNormalized;

      if (!target) {
        return sendError(
          res,
          422,
          'VERIFICATION_TARGET_MISSING',
          'Verification target is unavailable.'
        );
      }

      const { challenge, developmentCode } =
        await createVerificationChallenge(
          user,
          verificationType,
          target,
          { cooldownMs: verificationResendCooldownMs }
        );

      await audit(
        user.id,
        'PATIENT_VERIFICATION_RESENT',
        'Patient requested a new account verification code.',
        req
      );

      return markSensitiveResponse(res).status(201).json({
        state: 'VERIFICATION_REQUIRED',
        challengeId: challenge.id,
        ...(developmentCode ? { developmentCode } : {})
      });
    } catch (error) {
      next(error);
    }
  }
);


router.post(
  '/forgot-password',
  verificationLimiter,
  validate(z.object({
    email: z.string().trim().email().max(254)
  })),
  async (req, res, next) => {
    try {
      // This is deliberately non-generic in offline mode: a generic "sent"
      // response would be a false delivery claim. It reveals no account state.
      if (offlineVerificationDisabled()) throw verificationUnavailable();
      const email = normalizeEmail(req.body.email);

      const genericResponse = {
        success: true,
        message: 'If an account exists for this email, a password reset code has been sent.'
      };

      const user = await prisma.user.findUnique({
        where: { email }
      });

      // Do not reveal whether the email exists.
      if (!user || user.role !== ROLES.PATIENT || user.status !== 'ACTIVE') {
        return res.json({ ...genericResponse, challengeId: crypto.randomUUID() });
      }

      let issued;
      try {
        issued = await createVerificationChallenge(user, 'PASSWORD_RESET', email);
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        // Delivery and concurrent identity changes must not disclose existence.
        return res.json({ ...genericResponse, challengeId: crypto.randomUUID() });
      }
      const { challenge, developmentCode } = issued;

      await audit(
        user.id,
        'PATIENT_PASSWORD_RESET_REQUESTED',
        'Patient requested a password reset code.',
        req
      );

      return markSensitiveResponse(res).json({
        ...genericResponse,
        challengeId: challenge.id,
        ...(process.env.VERIFICATION_PROVIDER === 'development' &&
        process.env.NODE_ENV !== 'production'
          ? { developmentCode }
          : {})
      });
    } catch (error) {
      next(error);
    }
  }
);


router.post(
  '/reset-password',
  verificationLimiter,
  validate(z.object({
    challengeId: z.string().uuid(),
    code: z.string().regex(/^\d{6}$/),
    newPassword: passwordSchema
  })),
  async (req, res, next) => {
    try {
      const passwordHash = await bcrypt.hash(req.body.newPassword, bcryptRounds);
      await consumeVerificationChallenge({ challengeId: req.body.challengeId, code: req.body.code, purpose: 'PASSWORD_RESET', transition: async (tx, challenge) => {
        await tx.user.update({ where: { id: challenge.userId }, data: { passwordHash, lastPasswordChange: new Date(), authVersion: { increment: 1 } } });
        await invalidateChallenges(tx, challenge.userId);
        await audit(challenge.userId, 'PATIENT_PASSWORD_RESET_COMPLETED', 'Patient password was reset successfully.', req, tx);
      } });

      return res.json({
        success: true,
        message: 'Password reset successfully.'
      });
    } catch (error) {
      if (error instanceof ApiError && error.code?.startsWith('VERIFICATION_')) error.code = error.code.replace('VERIFICATION_', 'PASSWORD_RESET_');
      next(error);
    }
  }
);

router.post('/verification/verify', verificationLimiter, authenticate, allowRoles(ROLES.PATIENT), validate(z.object({ challengeId: z.string().uuid(), code: z.string().regex(/^\d{6}$/), type: z.enum(['PHONE', 'EMAIL']) }).strict()), async (req, res, next) => {
  try {
    await consumeVerificationChallenge({ ...req.body, purpose: req.body.type, userId: req.user.id, authVersion: req.user.av, transition: (tx, challenge) => tx.user.update({ where: { id: challenge.userId }, data: req.body.type === 'PHONE' ? { phoneVerifiedAt: new Date() } : { emailVerifiedAt: new Date() }, select: { id: true } }) });
    return res.json({ state: 'VERIFIED' });
  } catch (error) { next(error); }
});

router.post('/verification/request', verificationLimiter, authenticate, allowRoles(ROLES.PATIENT), validate(z.object({ type: z.enum(['PHONE', 'EMAIL']) })), async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const target = req.body.type === 'PHONE' ? user.phoneNormalized : user.email;
    if (!target) return sendError(res, 422, 'VERIFICATION_TARGET_MISSING', `No ${req.body.type.toLowerCase()} is configured for this account.`);
    const { challenge, developmentCode } = await createVerificationChallenge(user, req.body.type, target);
    return markSensitiveResponse(res).status(201).json({ state: 'VERIFICATION_REQUIRED', challengeId: challenge.id, ...(developmentCode ? { developmentCode } : {}) });
  } catch (error) { next(error); }
});

/**
 * POST /api/patient-auth/link/recover
 *
 * Safely repairs legacy PATIENT accounts that are ACTIVE but are not linked
 * to a Patient record.
 *
 * Automatic recovery is intentionally strict:
 * - account must already be authenticated as PATIENT
 * - account must have a verified phone number
 * - patient match requires normalized verified phone + exact date of birth
 * - exactly one unclaimed Patient record must match
 * - ownership can never be overwritten
 *
 * When automatic recovery is unsafe or impossible, the endpoint returns a
 * manual-review state. The existing receptionist/admin Claim Code workflow
 * remains the secure fallback.
 */
router.post(
  '/link/recover',
  claimLimiter,
  authenticate,
  allowRoles(ROLES.PATIENT),
  validate(
    z.object({
      dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
    })
  ),
  async (req, res, next) => {
    try {
      // -----------------------------------------------------
      // 1. Idempotent success if already linked.
      // -----------------------------------------------------
      const existingPatient = await prisma.patient.findUnique({
        where: {
          userId: req.user.id
        },
        select: {
          id: true
        }
      });

      if (existingPatient) {
        return res.json({
          state: 'LINKED',
          patientId: existingPatient.id,
          recovered: false
        });
      }

      // -----------------------------------------------------
      // 2. Load the authenticated patient account.
      // -----------------------------------------------------
      const user = await prisma.user.findUnique({
        where: {
          id: req.user.id
        },
        select: {
          id: true,
          role: true,
          status: true,
          phoneNormalized: true,
          phoneVerifiedAt: true
        }
      });

      if (!user) {
        return sendError(
          res,
          404,
          'USER_NOT_FOUND',
          'User account not found.'
        );
      }

      if (user.role !== ROLES.PATIENT) {
        return sendError(
          res,
          403,
          'PATIENT_ACCOUNT_REQUIRED',
          'A patient account is required.'
        );
      }

      if (user.status !== 'ACTIVE') {
        return sendError(
          res,
          403,
          'ACCOUNT_NOT_ACTIVE',
          'The patient account must be active before record recovery.'
        );
      }

      // -----------------------------------------------------
      // 3. Automatic linkage requires VERIFIED phone identity.
      //
      // Email verification alone is not enough because Patient records
      // currently carry phone + DOB as the stable matching attributes.
      // -----------------------------------------------------
      if (!user.phoneNormalized || !user.phoneVerifiedAt) {
        await audit(
          user.id,
          'PATIENT_LINK_RECOVERY_REJECTED',
          'Automatic patient linkage recovery requires a verified phone number.',
          req
        );

        return res.json({
          state: 'MANUAL_REVIEW_REQUIRED',
          reason: 'VERIFIED_PHONE_REQUIRED'
        });
      }

      // -----------------------------------------------------
      // 4. Match using exact DOB + normalized verified phone.
      // -----------------------------------------------------
      const matches = await matchingPatients(
        user.phoneNormalized,
        req.body.dateOfBirth
      );

      if (matches.length === 0) {
        await audit(
          user.id,
          'PATIENT_LINK_RECOVERY_NO_MATCH',
          'No patient record matched verified phone and supplied date of birth.',
          req
        );

        return res.json({
          state: 'MANUAL_REVIEW_REQUIRED',
          reason: 'NO_MATCH'
        });
      }

      if (matches.length > 1) {
        await audit(
          user.id,
          'PATIENT_LINK_RECOVERY_AMBIGUOUS',
          'Multiple patient records matched verified phone and supplied date of birth.',
          req
        );

        return res.json({
          state: 'AMBIGUOUS_MATCH',
          reason: 'MULTIPLE_MATCHES'
        });
      }

      const patient = matches[0];

      // -----------------------------------------------------
      // 5. Never steal ownership from another patient account.
      // -----------------------------------------------------
      if (patient.userId) {
        await audit(
          user.id,
          'PATIENT_LINK_RECOVERY_CONFLICT',
          'Matching patient record is already linked to another account.',
          req
        );

        return res.json({
          state: 'MANUAL_REVIEW_REQUIRED',
          reason: 'ALREADY_CLAIMED'
        });
      }

      // -----------------------------------------------------
      // 6. Atomic ownership claim.
      //
      // updateMany + userId:null protects against concurrent claims.
      // -----------------------------------------------------
      const linked = await prisma.patient.updateMany({
        where: {
          id: patient.id,
          userId: null
        },
        data: {
          userId: user.id
        }
      });

      if (linked.count !== 1) {
        await audit(
          user.id,
          'PATIENT_LINK_RECOVERY_CONFLICT',
          'Patient linkage changed concurrently before recovery completed.',
          req
        );

        return res.json({
          state: 'MANUAL_REVIEW_REQUIRED',
          reason: 'LINK_CONFLICT'
        });
      }

      await audit(
        user.id,
        'PATIENT_LINK_RECOVERED',
        `Recovered legacy patient account linkage to patient record ${patient.id}.`,
        req
      );

      return res.json({
        state: 'LINKED',
        patientId: patient.id,
        recovered: true
      });
    } catch (error) {
      next(error);
    }
  }
);

router.post('/claim', claimLimiter, authenticate, allowRoles(ROLES.PATIENT), validate(z.object({ code: claimCredentialSchema, dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })), async (req, res, next) => {
  try {
    if (await prisma.patient.findUnique({ where: { userId: req.user.id } })) return sendError(res, 409, 'PATIENT_ALREADY_LINKED', 'Account is already linked to a patient record.');
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const matches = await matchingPatients(user.phoneNormalized, req.body.dateOfBirth);
    if (matches.length !== 1 || matches[0].userId) {
      await audit(user.id, 'PATIENT_CLAIM_REJECTED', 'Patient claim did not resolve to one available record.', req);
      return res.json({ state: matches.length > 1 ? 'AMBIGUOUS_MATCH' : 'MANUAL_REVIEW_REQUIRED' });
    }
    const linked = await prisma.$transaction(async (tx) => {
      const result = await consumeClaimCredential(tx, { credential: req.body.code, patientId: matches[0].id, dateOfBirth: req.body.dateOfBirth });
      if (result.error) return false;
      const updated = await tx.patient.updateMany({ where: { id: matches[0].id, userId: null }, data: { userId: user.id } });
      if (updated.count !== 1) return false;
      return true;
    });
    if (!linked) {
      await audit(user.id, 'PATIENT_CLAIM_REJECTED', 'Patient claim credential was rejected or ownership changed.', req);
      return sendError(res, 422, 'CLAIM_VERIFICATION_FAILED', 'Claim verification failed.');
    }
    await audit(user.id, 'PATIENT_RECORD_CLAIMED', `Claimed existing patient record ${matches[0].id}.`, req);
    return res.json({ state: 'CLAIMED' });
  } catch (error) { next(error); }
});

// Offline clinic-assisted activation: reception verifies identity in person,
// issues a high-entropy credential, then the patient sets a local password.
// Phone/email verification fields intentionally remain null: no channel was
// proven by this flow.
router.post('/offline-activation', claimLimiter, validate(z.object({
  code: claimCredentialSchema, dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  password: passwordSchema, email: z.string().trim().email().max(254).optional()
}).strict()), async (req, res, next) => {
  try {
    if (!offlineVerificationDisabled()) return sendError(res, 409, 'OFFLINE_ACTIVATION_UNAVAILABLE', 'Clinic-assisted activation is not available while online verification is enabled.');
    const parsed = parseClaimCredential(req.body.code);
    if (!parsed) throw claimFailure();
    const preliminary = await prisma.patientClaimCode.findUnique({ where: { publicId: parsed.publicId }, select: { patientId: true } });
    if (!preliminary) throw claimFailure();
    const email = req.body.email ? normalizeEmail(req.body.email) : null;
    const passwordHash = await bcrypt.hash(req.body.password, bcryptRounds);
    const result = await prisma.$transaction(async (tx) => {
      const patient = await tx.patient.findUnique({ where: { id: preliminary.patientId } });
      if (!patient || patient.userId) return { error: claimFailure() };
      const consumed = await consumeClaimCredential(tx, { credential: req.body.code, patientId: patient.id, dateOfBirth: req.body.dateOfBirth });
      if (consumed.error) return { error: consumed.error };
      const phoneNormalized = normalizePhone(patient.phone);
      if (!phoneNormalized) return { error: claimFailure() };
      const user = await tx.user.create({ data: {
        username: email || phoneNormalized, email, phoneNormalized, passwordHash,
        role: ROLES.PATIENT, status: 'ACTIVE', preferredLanguage: 'en'
      } });
      const linked = await tx.patient.updateMany({ where: { id: patient.id, userId: null }, data: { userId: user.id } });
      if (linked.count !== 1) throw new ApiError(409, 'PATIENT_ALREADY_CLAIMED', 'Patient record was claimed by another account.');
      return { userId: user.id, patientId: patient.id, patient: patientIdentitySummary(patient) };
    });
    if (result.error) throw result.error;
    await audit(result.userId, 'PATIENT_OFFLINE_ACTIVATION_COMPLETED', `Clinic-assisted activation linked patient record ${result.patientId}.`, req);
    return markSensitiveResponse(res).status(201).json({ state: 'ACTIVATED', patient: result.patient });
  } catch (error) {
    if (error.code === 'P2002') return sendError(res, 409, 'ACCOUNT_ALREADY_EXISTS', 'An account already exists for this identity.');
    if (error instanceof ApiError && error.code === 'CLAIM_VERIFICATION_FAILED') await audit(null, 'PATIENT_OFFLINE_ACTIVATION_REJECTED', 'Offline activation credential was rejected.', req).catch(() => {});
    next(error);
  }
});

router.post('/claims/:patientId/code', authenticate, allowRoles(ROLES.ADMIN, ROLES.RECEPTIONIST), async (req, res, next) => {
  try {
    const patient = await prisma.patient.findUnique({ where: { id: req.params.patientId } });
    if (!patient) return sendError(res, 404, 'PATIENT_NOT_FOUND', 'Patient not found.');
    if (patient.userId) return sendError(res, 409, 'PATIENT_ALREADY_CLAIMED', 'Patient record is already linked.');
    const publicId = crypto.randomBytes(CLAIM_PUBLIC_ID_BYTES).toString('base64url');
    const secret = crypto.randomBytes(CLAIM_SECRET_BYTES).toString('base64url');
    const code = `${publicId}.${secret}`;
    await prisma.$transaction(async (tx) => {
      await tx.patientClaimCode.updateMany({ where: { patientId: patient.id, usedAt: null }, data: { usedAt: new Date() } });
      await tx.patientClaimCode.create({ data: { patientId: patient.id, publicId, codeHash: await bcrypt.hash(secret, 10), expiresAt: new Date(Date.now() + 30 * 60000), createdById: req.user.id, issuerAuthVersion: req.user.av } });
    });
    await audit(req.user.id, 'PATIENT_CLAIM_CODE_ISSUED', `Issued claim code for patient ${patient.id}.`, req);
    return markSensitiveResponse(res).status(201).json({ code, expiresInMinutes: 30 });
  } catch (error) { next(error); }
});

export default router;
