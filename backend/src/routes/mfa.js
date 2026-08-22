import express from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import prisma from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { allowRoles, ROLES } from '../middleware/policies.js';
import { validate } from '../middleware/validate.js';
import { sendError } from '../utils/apiError.js';
import { rateLimits } from '../config.js';
import {
  MfaError,
  confirmMfaEnrollment,
  consumeMfaChallenge,
  consumeRecoveryCode,
  consumeTotp,
  findMfaChallenge,
  generateRecoveryCodes,
  hashRecoveryCodes,
  recordMfaChallengeFailure,
  startMfaEnrollment,
  verifyRecoveryLoginChallenge
} from '../services/mfa.js';
import { signAccessToken } from '../services/accessTokens.js';
import { logger } from '../utils/logger.js';

const router = express.Router();
const STAFF_ROLES = [ROLES.ADMIN, ROLES.RECEPTIONIST, ROLES.DOCTOR, ROLES.LAB_TECH, ROLES.PHARMACIST];
const mfaLimiter = rateLimit({
  windowMs: rateLimits.windowMs,
  limit: rateLimits.verification,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res) => sendError(res, 429, 'MFA_RATE_LIMITED', 'Too many MFA attempts. Please try again later.')
});

const currentPasswordSchema = z.string().min(1).max(200);
const codeSchema = z.string().regex(/^\d{6}$/);
const loginVerificationSchema = z.object({
  challengeToken: z.string().trim().min(40).max(200),
  code: codeSchema
}).strict();
const recoveryLoginSchema = z.object({
  challengeToken: z.string().trim().min(40).max(200),
  recoveryCode: z.string().trim().min(1).max(64)
}).strict();
const proofSchema = z.object({
  currentPassword: currentPasswordSchema,
  totpCode: codeSchema.optional(),
  recoveryCode: z.string().trim().min(20).max(30).optional()
}).strict().refine(
  (body) => Boolean(body.totpCode) !== Boolean(body.recoveryCode),
  { message: 'Provide either a TOTP code or a recovery code.' }
);

async function audit(req, action, details) {
  await prisma.tenantAuditLog.create({
    data: { userId: req.user.id, action, details, ipAddress: req.ip || 'unknown' }
  });
}

async function loadStaffUser(req) {
  return prisma.user.findUnique({
    where: { id: req.user.id },
    select: {
      id: true,
      username: true,
      role: true,
      status: true,
      passwordHash: true,
      mfaEnabled: true,
      mfaConfiguration: { select: { state: true } }
    }
  });
}

async function verifyManagementProof(user, body) {
  if (!await bcrypt.compare(body.currentPassword, user.passwordHash)) return false;
  if (body.totpCode) return consumeTotp(user.id, body.totpCode);
  return consumeRecoveryCode(user.id, body.recoveryCode);
}

function handleMfaError(res, error) {
  if (error instanceof MfaError) return sendError(res, error.status, error.code, error.message);
  throw error;
}

router.post('/verify', mfaLimiter, validate(loginVerificationSchema), async (req, res, next) => {
  try {
    const challenge = await findMfaChallenge(req.body.challengeToken);
    if (!challenge) {
      logger.security('auth.mfa_verification_rejected', { requestId: req.id, reason: 'invalid_or_expired_challenge', ip: req.ip });
      return sendError(res, 401, 'MFA_CHALLENGE_INVALID', 'The MFA challenge is invalid or expired.');
    }

    const user = await prisma.user.findUnique({
      where: { id: challenge.userId },
      select: {
        id: true,
        username: true,
        role: true,
        status: true,
        preferredLanguage: true,
        email: true,
        phoneNormalized: true,
        mfaEnabled: true,
        mfaConfiguration: { select: { state: true } },
        doctor: { select: { id: true, fullNameEn: true } }
      }
    });
    const isStaff = user && STAFF_ROLES.includes(user.role);
    if (!isStaff || user.status !== 'ACTIVE' || !user.mfaEnabled || user.mfaConfiguration?.state !== 'ACTIVE') {
      await consumeMfaChallenge(challenge.id, challenge.userId);
      logger.security('auth.mfa_verification_rejected', { requestId: req.id, userId: challenge.userId, reason: 'account_not_eligible', ip: req.ip });
      return sendError(res, 401, 'MFA_CHALLENGE_INVALID', 'The MFA challenge is invalid or expired.');
    }

    if (!await consumeTotp(user.id, req.body.code)) {
      const failureRecorded = await recordMfaChallengeFailure(challenge.id, new Date(), req.ip || 'unknown');
      logger.security('auth.mfa_verification_failed', { requestId: req.id, userId: user.id, ip: req.ip });
      if (!failureRecorded || !await findMfaChallenge(req.body.challengeToken)) {
        return sendError(res, 401, 'MFA_CHALLENGE_INVALID', 'The MFA challenge is invalid or expired.');
      }
      return sendError(res, 401, 'MFA_CODE_INVALID', 'The authenticator code is invalid.');
    }

    const consumed = await consumeMfaChallenge(challenge.id, user.id, new Date(), req.ip || 'unknown');
    if (!consumed) {
      logger.security('auth.mfa_verification_rejected', { requestId: req.id, userId: user.id, reason: 'challenge_replayed', ip: req.ip });
      return sendError(res, 401, 'MFA_CHALLENGE_INVALID', 'The MFA challenge is invalid or expired.');
    }

    const token = signAccessToken({
      id: user.id,
      username: user.username,
      role: user.role,
      doctorId: user.doctor?.id || null
    });
    logger.security('auth.mfa_verification_succeeded', { requestId: req.id, userId: user.id, role: user.role, ip: req.ip });
    return res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        preferredLanguage: user.preferredLanguage,
        mfaEnabled: true,
        doctorId: user.doctor?.id || null,
        doctorName: user.doctor?.fullNameEn || null,
        patientLinked: null,
        patientId: null,
        email: user.email,
        phone: user.phoneNormalized
      }
    });
  } catch (error) { next(error); }
});

router.post('/recovery/verify', mfaLimiter, validate(recoveryLoginSchema), async (req, res, next) => {
  try {
    const result = await verifyRecoveryLoginChallenge(
      req.body.challengeToken,
      req.body.recoveryCode,
      STAFF_ROLES,
      new Date(),
      req.ip || 'unknown'
    );
    if (result.status !== 'SUCCESS') {
      logger.security('auth.mfa_recovery_login_failed', {
        requestId: req.id,
        userId: result.user?.id,
        reason: result.status === 'INVALID' ? 'MFA_RECOVERY_INVALID' : 'MFA_CHALLENGE_INVALID',
        method: 'RECOVERY_CODE',
        ip: req.ip
      });
      return sendError(
        res,
        401,
        result.status === 'INVALID' ? 'MFA_RECOVERY_INVALID' : 'MFA_CHALLENGE_INVALID',
        'The recovery code or MFA challenge is invalid.'
      );
    }

    const { user } = result;
    const token = signAccessToken({
      id: user.id,
      username: user.username,
      role: user.role,
      doctorId: user.doctor?.id || null
    });
    logger.security('auth.mfa_recovery_login_succeeded', {
      requestId: req.id, userId: user.id, role: user.role, method: 'RECOVERY_CODE', ip: req.ip
    });
    return res.json({
      token,
      authenticationMethod: 'RECOVERY_CODE',
      user: {
        id: user.id, username: user.username, role: user.role,
        preferredLanguage: user.preferredLanguage, mfaEnabled: true,
        doctorId: user.doctor?.id || null, doctorName: user.doctor?.fullNameEn || null,
        patientLinked: null, patientId: null, email: user.email, phone: user.phoneNormalized
      }
    });
  } catch (error) { next(error); }
});

router.use(authenticate, allowRoles(...STAFF_ROLES), mfaLimiter);

router.post('/enroll', validate(z.object({ currentPassword: currentPasswordSchema }).strict()), async (req, res, next) => {
  try {
    const user = await loadStaffUser(req);
    if (!user || user.status !== 'ACTIVE') return sendError(res, 401, 'SESSION_REVOKED', 'This session is no longer active.');
    if (!await bcrypt.compare(req.body.currentPassword, user.passwordHash)) {
      return sendError(res, 401, 'MFA_REAUTH_FAILED', 'Current credentials are invalid.');
    }
    if (user.mfaEnabled || user.mfaConfiguration?.state === 'ACTIVE') {
      return sendError(res, 409, 'MFA_ALREADY_ENABLED', 'MFA is already enabled.');
    }
    const enrollment = await startMfaEnrollment(user, req.ip || 'unknown');
    return res.status(201).json({
      state: 'PENDING',
      secret: enrollment.secret,
      otpauthUri: enrollment.otpauthUri,
      expiresAt: enrollment.expiresAt
    });
  } catch (error) {
    if (error instanceof MfaError) return handleMfaError(res, error);
    next(error);
  }
});

router.post('/enroll/confirm', validate(z.object({ code: codeSchema }).strict()), async (req, res, next) => {
  try {
    const recoveryCodes = await confirmMfaEnrollment(req.user.id, req.body.code, Date.now(), req.ip || 'unknown');
    return res.json({ state: 'ENABLED', recoveryCodes });
  } catch (error) {
    if (error instanceof MfaError) {
      await audit(req, 'MFA_ENROLLMENT_FAILED', `Staff MFA enrollment confirmation failed: ${error.code}.`);
      logger.security('auth.mfa_enrollment_verification_failed', {
        requestId: req.id,
        userId: req.user.id,
        reason: error.code,
        algorithm: 'SHA1',
        digits: 6,
        periodSeconds: 30,
        windowSteps: 1,
        serverTimeStep: Math.floor(Date.now() / 30_000),
        ip: req.ip
      });
      return handleMfaError(res, error);
    }
    next(error);
  }
});

router.post('/recovery/regenerate', validate(proofSchema), async (req, res, next) => {
  try {
    const user = await loadStaffUser(req);
    if (!user?.mfaEnabled || user.mfaConfiguration?.state !== 'ACTIVE') {
      return sendError(res, 409, 'MFA_NOT_ENABLED', 'MFA is not enabled.');
    }
    if (!await verifyManagementProof(user, req.body)) {
      return sendError(res, 401, 'MFA_REAUTH_FAILED', 'Current credentials or MFA proof are invalid.');
    }
    const recoveryCodes = generateRecoveryCodes();
    const recoveryHashes = await hashRecoveryCodes(recoveryCodes);
    await prisma.$transaction(async (tx) => {
      await tx.mfaRecoveryCode.deleteMany({ where: { userId: user.id } });
      await tx.mfaRecoveryCode.createMany({ data: recoveryHashes.map((codeHash) => ({ userId: user.id, codeHash })) });
      await tx.tenantAuditLog.create({
        data: { userId: user.id, action: 'MFA_RECOVERY_CODES_REGENERATED', details: 'Staff MFA recovery codes regenerated.', ipAddress: req.ip || 'unknown' }
      });
    });
    return res.json({ recoveryCodes });
  } catch (error) { next(error); }
});

router.delete('/', validate(proofSchema), async (req, res, next) => {
  try {
    const user = await loadStaffUser(req);
    if (!user?.mfaEnabled || user.mfaConfiguration?.state !== 'ACTIVE') {
      return sendError(res, 409, 'MFA_NOT_ENABLED', 'MFA is not enabled.');
    }
    if (!await verifyManagementProof(user, req.body)) {
      return sendError(res, 401, 'MFA_REAUTH_FAILED', 'Current credentials or MFA proof are invalid.');
    }
    await prisma.$transaction(async (tx) => {
      await tx.mfaChallenge.deleteMany({ where: { userId: user.id } });
      await tx.mfaRecoveryCode.deleteMany({ where: { userId: user.id } });
      await tx.mfaConfiguration.delete({ where: { userId: user.id } });
      await tx.user.update({ where: { id: user.id }, data: { mfaEnabled: false } });
      await tx.tenantAuditLog.create({
        data: { userId: user.id, action: 'MFA_DISABLED', details: 'Staff MFA disabled by the account owner.', ipAddress: req.ip || 'unknown' }
      });
    });
    return res.json({ state: 'DISABLED' });
  } catch (error) { next(error); }
});

export default router;
