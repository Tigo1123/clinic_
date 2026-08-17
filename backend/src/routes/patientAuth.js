import express from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import { z } from 'zod';
import prisma from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { allowRoles, ROLES } from '../middleware/policies.js';
import { validate } from '../middleware/validate.js';
import { normalizeEmail, normalizePhone } from '../utils/identity.js';
import { createVerificationChallenge, consumeVerificationChallenge } from '../services/verification.js';
import { ApiError, sendError } from '../utils/apiError.js';
import { rateLimits } from '../config.js';
import { getClinicDateString } from '../utils/clinicTime.js';

const router = express.Router();
const limiter = (limit) => rateLimit({ windowMs: rateLimits.windowMs, limit, standardHeaders: 'draft-7', legacyHeaders: false, handler: (req, res) => sendError(res, 429, 'RATE_LIMITED', 'Too many attempts. Please try again later.') });
const registrationLimiter = limiter(rateLimits.registration);
const verificationLimiter = limiter(rateLimits.verification);
const claimLimiter = limiter(rateLimits.claim);
const passwordSchema = z.string().min(10).max(200).regex(/[A-Z]/, 'Password requires an uppercase letter.').regex(/[a-z]/, 'Password requires a lowercase letter.').regex(/\d/, 'Password requires a number.');
const bcryptRounds = Number(process.env.BCRYPT_ROUNDS || 12);

async function audit(userId, action, details, req) {
  await prisma.tenantAuditLog.create({ data: { userId, action, details, ipAddress: req.ip || 'unknown' } });
}

async function matchingPatients(phoneNormalized, dateOfBirth) {
  const candidates = await prisma.patient.findMany({ where: { dateOfBirth }, select: { id: true, phone: true, userId: true } });
  return candidates.filter((patient) => normalizePhone(patient.phone) === phoneNormalized);
}

router.post('/register', registrationLimiter, validate(z.object({
  fullName: z.string().trim().min(2).max(150), fullNameAr: z.string().trim().min(2).max(150).optional(),
  fullNameEn: z.string().trim().min(2).max(150).optional(), phone: z.string().trim().min(7).max(30),
  email: z.string().trim().email().max(254), dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  gender: z.enum(['MALE', 'FEMALE']), password: passwordSchema, addressStateId: z.coerce.number().int().min(1).max(18).optional()
})), async (req, res, next) => {
  let createdUserId;
  try {
    const phoneNormalized = normalizePhone(req.body.phone);
    const email = normalizeEmail(req.body.email);
    if (!phoneNormalized) return sendError(res, 422, 'PHONE_INVALID', 'Phone number is invalid.');
    if (req.body.dateOfBirth >= getClinicDateString()) return sendError(res, 422, 'INVALID_DATE_OF_BIRTH', 'Date of birth must be in the past.');
    if (await prisma.user.findUnique({ where: { phoneNormalized } })) return sendError(res, 409, 'PHONE_ALREADY_REGISTERED', 'An account already exists for this phone number.');
    if (email && await prisma.user.findUnique({ where: { email } })) return sendError(res, 409, 'EMAIL_ALREADY_REGISTERED', 'An account already exists for this email.');
    const passwordHash = await bcrypt.hash(req.body.password, bcryptRounds);
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({ data: {
        username: email || phoneNormalized, email, phoneNormalized, passwordHash, role: ROLES.PATIENT,
        status: 'PENDING_VERIFICATION', preferredLanguage: 'en'
      } });
      await tx.patientRegistration.create({ data: {
        userId: created.id, fullNameAr: req.body.fullNameAr || req.body.fullName,
        fullNameEn: req.body.fullNameEn || req.body.fullName, gender: req.body.gender,
        dateOfBirth: req.body.dateOfBirth, addressStateId: req.body.addressStateId || Number(process.env.DEFAULT_STATE_ID || 1)
      } });
      return created;
    });
    createdUserId = user.id;
    const verificationType = process.env.VERIFICATION_PROVIDER === 'email' ? 'EMAIL' : 'PHONE';
    const verificationTarget = verificationType === 'EMAIL' ? email : phoneNormalized;
    if (!verificationTarget) throw new ApiError(422, 'VERIFICATION_TARGET_MISSING', 'Email is required when email verification is configured.');
    const { challenge, developmentCode } = await createVerificationChallenge(user, verificationType, verificationTarget);
    await audit(user.id, 'PATIENT_ACCOUNT_REGISTRATION', 'Patient online account registration started.', req);
    return res.status(201).json({ state: 'VERIFICATION_REQUIRED', userId: user.id, challengeId: challenge.id, ...(developmentCode ? { developmentCode } : {}) });
  } catch (error) {
    if (createdUserId) await prisma.user.delete({ where: { id: createdUserId } }).catch(() => {});
    if (error.code === 'P2002') return sendError(res, 409, 'ACCOUNT_ALREADY_EXISTS', 'An account already exists for this identity.');
    next(error);
  }
});

router.post('/verify', verificationLimiter, validate(z.object({ challengeId: z.string().uuid(), code: z.string().regex(/^\d{6}$/) })), async (req, res, next) => {
  try {
    const challenge = await consumeVerificationChallenge(req.body.challengeId, req.body.code);
    const registration = await prisma.patientRegistration.findUnique({ where: { userId: challenge.userId } });
    if (!registration) {
      const linkedPatient = await prisma.patient.findUnique({ where: { userId: challenge.userId } });
      if (linkedPatient) return res.json({ state: 'VERIFIED' });
      throw new ApiError(409, 'REGISTRATION_STATE_INVALID', 'Registration details are unavailable.');
    }
    const matches = await matchingPatients(challenge.user.phoneNormalized, registration.dateOfBirth);
    if (matches.some((patient) => patient.userId)) {
      await audit(challenge.userId, 'PATIENT_CLAIM_REJECTED', 'Matching patient record is already claimed.', req);
      return res.json({ state: 'MANUAL_REVIEW_REQUIRED' });
    }
    if (matches.length === 0) {
      const patient = await prisma.patient.create({ data: {
        userId: challenge.userId, fullNameAr: registration.fullNameAr, fullNameEn: registration.fullNameEn,
        gender: registration.gender, dateOfBirth: registration.dateOfBirth, phone: challenge.user.phoneNormalized,
        addressStateId: registration.addressStateId, emergencyContact: 'Self'
      } });
      await audit(challenge.userId, 'PATIENT_RECORD_CREATED', `Created patient record ${patient.id} for verified account.`, req);
      return res.json({ state: 'CLAIMED' });
    }
    if (matches.length === 1) {
      const matchedPatient = matches[0];

      // Linking an EXISTING medical record requires verified ownership
      // of the phone number used for phone + DOB matching.
      //
      // Email verification is sufficient for creating a brand-new empty
      // Patient record, but it must never grant access to an existing
      // clinical record based on an unverified phone number.
      const verifiedUser = await prisma.user.findUnique({
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
          req
        );

        return res.json({
          state: 'MANUAL_REVIEW_REQUIRED',
          reason: 'VERIFIED_PHONE_REQUIRED'
        });
      }

      // Auto-link only when the matching patient record is still unclaimed.
      // The match is already constrained by normalized phone + date of birth.
      const linked = await prisma.patient.updateMany({
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
          req
        );

        return res.json({ state: 'MANUAL_REVIEW_REQUIRED' });
      }

      await audit(
        challenge.userId,
        'PATIENT_RECORD_AUTO_LINKED',
        `Automatically linked verified account to existing patient record ${matchedPatient.id}.`,
        req
      );

      return res.json({ state: 'CLAIMED' });
    }

    await audit(
      challenge.userId,
      'PATIENT_CLAIM_AMBIGUOUS',
      'Multiple patient records matched verified identity and date of birth.',
      req
    );

    return res.json({ state: 'AMBIGUOUS_MATCH' });
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

      if (!previousChallenge || previousChallenge.usedAt) {
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

      const verificationType =
        process.env.VERIFICATION_PROVIDER === 'email'
          ? 'EMAIL'
          : previousChallenge.type;

      const target =
        verificationType === 'EMAIL'
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
          target
        );

      await audit(
        previousChallenge.user.id,
        'PATIENT_VERIFICATION_RESENT',
        'Patient verification code resent.',
        req
      );

      return res.status(201).json({
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

      const verificationType =
        process.env.VERIFICATION_PROVIDER === 'email'
          ? 'EMAIL'
          : 'PHONE';

      const target =
        verificationType === 'EMAIL'
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
          target
        );

      await audit(
        user.id,
        'PATIENT_VERIFICATION_RESENT',
        'Patient requested a new account verification code.',
        req
      );

      return res.status(201).json({
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
      const email = normalizeEmail(req.body.email);

      const genericResponse = {
        success: true,
        message: 'If an account exists for this email, a password reset code has been sent.'
      };

      const user = await prisma.user.findUnique({
        where: { email }
      });

      // Do not reveal whether the email exists.
      if (!user || user.role !== ROLES.PATIENT) {
        return res.json(genericResponse);
      }

      const code = String(crypto.randomInt(100000, 1000000));
      const codeHash = await bcrypt.hash(code, 10);

      const challenge = await prisma.verificationChallenge.create({
        data: {
          userId: user.id,
          type: 'PASSWORD_RESET',
          targetNormalized: email,
          codeHash,
          expiresAt: new Date(Date.now() + 10 * 60 * 1000)
        }
      });

      const developmentMode =
        process.env.VERIFICATION_PROVIDER === 'development' &&
        process.env.NODE_ENV !== 'production';

      if (!developmentMode) {
        const { sendEmail } = await import('../utils/notifications.js');

        const sent = await sendEmail({
          to: email,
          subject: 'Reset your patient account password',
          text: `Your password reset code is ${code}. It expires in 10 minutes.`
        });

        if (!sent) {
          await prisma.verificationChallenge.delete({
            where: { id: challenge.id }
          }).catch(() => {});

          return sendError(
            res,
            503,
            'PASSWORD_RESET_DELIVERY_FAILED',
            'Password reset email could not be delivered.'
          );
        }
      }

      await audit(
        user.id,
        'PATIENT_PASSWORD_RESET_REQUESTED',
        'Patient requested a password reset code.',
        req
      );

      return res.json({
        ...genericResponse,
        challengeId: challenge.id,
        ...(process.env.VERIFICATION_PROVIDER === 'development' &&
        process.env.NODE_ENV !== 'production'
          ? { developmentCode: code }
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
      const challenge = await prisma.verificationChallenge.findUnique({
        where: { id: req.body.challengeId },
        include: { user: true }
      });

      if (
        !challenge ||
        challenge.type !== 'PASSWORD_RESET' ||
        challenge.usedAt
      ) {
        return sendError(
          res,
          422,
          'PASSWORD_RESET_INVALID',
          'Password reset request is invalid or already used.'
        );
      }

      if (challenge.expiresAt <= new Date()) {
        return sendError(
          res,
          422,
          'PASSWORD_RESET_EXPIRED',
          'Password reset code has expired.'
        );
      }

      if (challenge.attemptCount >= challenge.maxAttempts) {
        return sendError(
          res,
          429,
          'PASSWORD_RESET_ATTEMPTS_EXCEEDED',
          'Password reset attempt limit exceeded.'
        );
      }

      const valid = await bcrypt.compare(
        String(req.body.code),
        challenge.codeHash
      );

      if (!valid) {
        await prisma.verificationChallenge.update({
          where: { id: challenge.id },
          data: {
            attemptCount: { increment: 1 }
          }
        });

        return sendError(
          res,
          422,
          'PASSWORD_RESET_CODE_INCORRECT',
          'Password reset code is incorrect.'
        );
      }

      const passwordHash = await bcrypt.hash(
        req.body.newPassword,
        bcryptRounds
      );

      const changedAt = new Date();

      const updated = await prisma.$transaction(async (tx) => {
        const consumed = await tx.verificationChallenge.updateMany({
          where: {
            id: challenge.id,
            usedAt: null
          },
          data: {
            usedAt: changedAt
          }
        });

        if (consumed.count !== 1) {
          return false;
        }

        await tx.user.update({
          where: { id: challenge.userId },
          data: {
            passwordHash,
            lastPasswordChange: changedAt
          }
        });

        return true;
      });

      if (!updated) {
        return sendError(
          res,
          422,
          'PASSWORD_RESET_INVALID',
          'Password reset request is invalid or already used.'
        );
      }

      await audit(
        challenge.userId,
        'PATIENT_PASSWORD_RESET_COMPLETED',
        'Patient password was reset successfully.',
        req
      );

      return res.json({
        success: true,
        message: 'Password reset successfully.'
      });
    } catch (error) {
      next(error);
    }
  }
);

router.post('/verification/request', verificationLimiter, authenticate, allowRoles(ROLES.PATIENT), validate(z.object({ type: z.enum(['PHONE', 'EMAIL']) })), async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const target = req.body.type === 'PHONE' ? user.phoneNormalized : user.email;
    if (!target) return sendError(res, 422, 'VERIFICATION_TARGET_MISSING', `No ${req.body.type.toLowerCase()} is configured for this account.`);
    const { challenge, developmentCode } = await createVerificationChallenge(user, req.body.type, target);
    return res.status(201).json({ state: 'VERIFICATION_REQUIRED', challengeId: challenge.id, ...(developmentCode ? { developmentCode } : {}) });
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

router.post('/claim', claimLimiter, authenticate, allowRoles(ROLES.PATIENT), validate(z.object({ code: z.string().min(6).max(20), dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })), async (req, res, next) => {
  try {
    if (await prisma.patient.findUnique({ where: { userId: req.user.id } })) return sendError(res, 409, 'PATIENT_ALREADY_LINKED', 'Account is already linked to a patient record.');
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const matches = await matchingPatients(user.phoneNormalized, req.body.dateOfBirth);
    if (matches.length !== 1 || matches[0].userId) {
      await audit(user.id, 'PATIENT_CLAIM_REJECTED', 'Patient claim did not resolve to one available record.', req);
      return res.json({ state: matches.length > 1 ? 'AMBIGUOUS_MATCH' : 'MANUAL_REVIEW_REQUIRED' });
    }
    const claim = await prisma.patientClaimCode.findFirst({ where: { patientId: matches[0].id, usedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } });
    if (!claim || !(await bcrypt.compare(req.body.code, claim.codeHash))) {
      const currentOwner = await prisma.patient.findUnique({ where: { id: matches[0].id }, select: { userId: true } });
      if (currentOwner?.userId) return sendError(res, 409, 'PATIENT_ALREADY_CLAIMED', 'Patient record was claimed by another account.');
      await audit(user.id, 'PATIENT_CLAIM_REJECTED', 'Patient claim code verification failed.', req);
      return sendError(res, 422, 'CLAIM_VERIFICATION_FAILED', 'Claim verification failed.');
    }
    const linked = await prisma.$transaction(async (tx) => {
      const updated = await tx.patient.updateMany({ where: { id: matches[0].id, userId: null }, data: { userId: user.id } });
      if (updated.count !== 1) return false;
      await tx.patientClaimCode.update({ where: { id: claim.id }, data: { usedAt: new Date() } });
      return true;
    });
    if (!linked) return sendError(res, 409, 'PATIENT_ALREADY_CLAIMED', 'Patient record was claimed by another account.');
    await audit(user.id, 'PATIENT_RECORD_CLAIMED', `Claimed existing patient record ${matches[0].id}.`, req);
    return res.json({ state: 'CLAIMED' });
  } catch (error) { next(error); }
});

router.post('/claims/:patientId/code', authenticate, allowRoles(ROLES.ADMIN, ROLES.RECEPTIONIST), async (req, res, next) => {
  try {
    const patient = await prisma.patient.findUnique({ where: { id: req.params.patientId } });
    if (!patient) return sendError(res, 404, 'PATIENT_NOT_FOUND', 'Patient not found.');
    if (patient.userId) return sendError(res, 409, 'PATIENT_ALREADY_CLAIMED', 'Patient record is already linked.');
    const code = crypto.randomBytes(6).toString('base64url').toUpperCase();
    await prisma.patientClaimCode.create({ data: { patientId: patient.id, codeHash: await bcrypt.hash(code, 10), expiresAt: new Date(Date.now() + 30 * 60000), createdById: req.user.id } });
    await audit(req.user.id, 'PATIENT_CLAIM_CODE_ISSUED', `Issued claim code for patient ${patient.id}.`, req);
    return res.status(201).json({ code, expiresInMinutes: 30 });
  } catch (error) { next(error); }
});

export default router;
