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
  email: z.string().trim().email().max(254).optional(), dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
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
    if (matches.length === 1) return res.json({ state: 'MATCH_REQUIRES_VERIFICATION' });
    await audit(challenge.userId, 'PATIENT_CLAIM_AMBIGUOUS', 'Multiple patient records matched verified identity and date of birth.', req);
    return res.json({ state: 'AMBIGUOUS_MATCH' });
  } catch (error) { next(error); }
});

router.post('/verification/request', verificationLimiter, authenticate, allowRoles(ROLES.PATIENT), validate(z.object({ type: z.enum(['PHONE', 'EMAIL']) })), async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const target = req.body.type === 'PHONE' ? user.phoneNormalized : user.email;
    if (!target) return sendError(res, 422, 'VERIFICATION_TARGET_MISSING', `No ${req.body.type.toLowerCase()} is configured for this account.`);
    const { challenge, developmentCode } = await createVerificationChallenge(user, req.body.type, target);
    return res.status(201).json({ state: 'VERIFICATION_REQUIRED', challengeId: challenge.id, ...(developmentCode ? { developmentCode } : {}) });
  } catch (error) { next(error); }
});

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
