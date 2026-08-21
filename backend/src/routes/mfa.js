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
  consumeRecoveryCode,
  consumeTotp,
  generateRecoveryCodes,
  hashRecoveryCodes,
  startMfaEnrollment
} from '../services/mfa.js';

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
  } catch (error) { next(error); }
});

router.post('/enroll/confirm', validate(z.object({ code: codeSchema }).strict()), async (req, res, next) => {
  try {
    const recoveryCodes = await confirmMfaEnrollment(req.user.id, req.body.code, Date.now(), req.ip || 'unknown');
    return res.json({ state: 'ENABLED', recoveryCodes });
  } catch (error) {
    if (error instanceof MfaError) {
      await audit(req, 'MFA_ENROLLMENT_FAILED', `Staff MFA enrollment confirmation failed: ${error.code}.`);
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
