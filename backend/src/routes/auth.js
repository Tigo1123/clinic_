import express from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../db.js';
import { authenticate, checkRoles } from '../middleware/auth.js';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { sendError } from '../utils/apiError.js';
import { normalizeEmail, normalizePhone } from '../utils/identity.js';
import { rateLimits } from '../config.js';
import { logger } from '../utils/logger.js';
import { signAccessToken } from '../services/accessTokens.js';
import { consumeTotp, createMfaChallenge, MfaError } from '../services/mfa.js';
import { passwordSchema } from '../utils/passwordPolicy.js';
import { createAdminResetLimiter, createLoginLimiter, markSensitiveResponse } from '../utils/edgeSecurity.js';
import { clinicDayBounds } from '../utils/clinicTime.js';

const bcryptRounds = Number(process.env.BCRYPT_ROUNDS || 12);

import { lockPatientIdentity } from '../utils/patientOnboarding.js';
import { normalizePatientPhone } from '../utils/patientIdentity.js';
import { structuredPatientName } from '../utils/patientName.js';
import { lockAccount } from '../services/verification.js';

const router = express.Router();
router.use((req, res, next) => { markSensitiveResponse(res); next(); });
// Account-wide logout. A concurrent/repeated request cannot bump a newer
// generation: the update is conditional on the authenticated generation.
router.post('/logout', authenticate, async (req, res, next) => {
  try {
    await prisma.user.updateMany({ where: { id: req.user.id, authVersion: req.user.av }, data: { authVersion: { increment: 1 } } });
    return res.status(204).end();
  } catch (error) { next(error); }
});
export const STAFF_ROLES = ['ADMIN', 'RECEPTIONIST', 'DOCTOR', 'PHARMACIST', 'LAB_TECH'];
const DOCTOR_CREATION_FIELDS = ['fullNameAr', 'fullNameEn', 'specialtyId', 'consultationFee'];

function isUsernameUniqueViolation(error) {
  if (error?.code !== 'P2002') return false;

  const target = error.meta?.target;
  if (Array.isArray(target)) {
    return target.length === 1 && String(target[0]).toLowerCase() === 'username';
  }
  if (typeof target !== 'string') return false;

  const normalizedTarget = target.replace(/["'`\s]/g, '').toLowerCase();
  return normalizedTarget === 'username'
    || normalizedTarget === 'user_username_key'
    || normalizedTarget.endsWith('.user_username_key');
}

const staffCreationSchema = z.preprocess((input) => {
  if (!input || typeof input !== 'object' || Array.isArray(input) || input.role === 'DOCTOR') return input;
  const normalized = { ...input };
  for (const field of DOCTOR_CREATION_FIELDS) delete normalized[field];
  return normalized;
}, z.object({
  username: z.string().trim().email().max(254),
  password: passwordSchema,
  role: z.enum(STAFF_ROLES),
  preferredLanguage: z.enum(['ar', 'en']).optional(),
  fullNameAr: z.string().trim().min(1, 'Arabic full name cannot be empty.').max(150).optional(),
  fullNameEn: z.string().trim().min(1, 'English full name cannot be empty.').max(150).optional(),
  specialtyId: z.string().uuid().optional(),
  consultationFee: z.coerce.number().int().positive().max(1_000_000_000).optional()
}));

const staffPasswordResetSchema = z.object({
  newPassword: passwordSchema,
  currentAdminPassword: z.string().min(1).max(200),
  mfaCode: z.string().regex(/^\d{6}$/).optional()
}).strict();
const passwordChangeSchema = z.object({ currentPassword: z.string().min(1).max(200), newPassword: passwordSchema }).strict();

const loginLimiter = createLoginLimiter({ windowMs: rateLimits.windowMs, limit: rateLimits.login });
const adminResetLimiter = createAdminResetLimiter({ windowMs: rateLimits.windowMs, limit: rateLimits.adminReset });

const auditLogQuerySchema = z.object({
  search: z.string().trim().max(120).optional().default(''),
  action: z.string().trim().regex(/^[A-Z0-9_:.-]+$/).max(100).optional(),
  role: z.enum([...STAFF_ROLES, 'PATIENT']).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional().default(1),
  pageSize: z.coerce.number().int().min(10).max(50).optional().default(25)
}).strict().refine(({ from, to }) => !from || !to || from <= to, {
  path: ['to'], message: 'The end date must not be before the start date.'
});

const AUDIT_TARGET_FIELDS = Object.freeze([
  ['patientId', 'PATIENT'], ['appointmentId', 'APPOINTMENT'], ['doctorId', 'DOCTOR'],
  ['labOrderId', 'LAB_ORDER'], ['labOrderItemId', 'LAB_ORDER_ITEM'], ['invoiceId', 'INVOICE'],
  ['prescriptionId', 'PRESCRIPTION'], ['drugId', 'MEDICINE'], ['batchId', 'INVENTORY_BATCH'],
  ['userId', 'USER'], ['entityId', 'ENTITY']
]);

function safeStructuredAuditDetails(details) {
  try {
    const value = JSON.parse(details);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { summary: details, target: null };
    const targetEntry = AUDIT_TARGET_FIELDS.find(([field]) => typeof value[field] === 'string');
    const targetFields = new Set(AUDIT_TARGET_FIELDS.map(([field]) => field));
    const safeValues = Object.fromEntries(Object.entries(value).filter(([key, item]) =>
      !targetFields.has(key)
      && !/(password|hash|secret|token|otp|recovery|clinicalNotes|diagnosis|treatment|symptoms)/i.test(key)
      && ['string', 'number', 'boolean'].includes(typeof item)
    ));
    return {
      summary: JSON.stringify(safeValues),
      target: targetEntry ? { type: targetEntry[1], id: value[targetEntry[0]] } : null
    };
  } catch {
    const containsSensitiveMaterial = /(password(?:Hash)?|mfaSecret|recoveryCode|accessToken|refreshToken|Bearer\s+[A-Za-z0-9._-]+|eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/i.test(details);
    return { summary: containsSensitiveMaterial ? '[Sensitive audit detail redacted]' : details, target: null };
  }
}

/**
 * POST /api/auth/login
 * Authenticates user credentials and signs a JWT.
 */
router.post('/login', loginLimiter, validate(z.object({
  username: z.string().trim().min(3).max(254),
  password: z.string().min(1).max(200)
})), async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  try {
    // 1. Fetch user from DB
    const normalizedEmail = username.includes('@') ? normalizeEmail(username) : null;
    const normalizedPhone = normalizePhone(username);
    const candidateIds = await prisma.user.findMany({
      where: { OR: [
        { username },
        ...(normalizedEmail ? [
          { email: normalizedEmail },
          { username: { equals: normalizedEmail, mode: 'insensitive' } }
        ] : []),
        ...(normalizedPhone ? [{ phoneNormalized: normalizedPhone }] : [])
      ] },
      select: { id: true },
      take: 2
    });

    if (candidateIds.length > 1) {
      logger.security('auth.login_failed', { requestId: req.id, reason: 'ambiguous_identifier', ip: req.ip });
      return res.status(401).json({ error: 'Invalid username or password.' });
    }
    const user = candidateIds.length === 1
      ? await prisma.user.findUnique({
        where: { id: candidateIds[0].id },
        select: {
          id: true,
          username: true,
          passwordHash: true,
          role: true,
          status: true,
          authVersion: true,
          mustChangePassword: true,
          mfaEnabled: true,
          preferredLanguage: true,
          email: true,
          phoneNormalized: true,
          phoneVerifiedAt: true
        }
      })
      : null;

    if (!user) {
      logger.security('auth.login_failed', { requestId: req.id, reason: 'invalid_credentials', ip: req.ip });
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    // 3. Verify password
    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      logger.security('auth.login_failed', { requestId: req.id, userId: user.id, reason: 'invalid_credentials', ip: req.ip });
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    // 2. Check account status
    if (user.status === 'PENDING_VERIFICATION') {
      logger.security('auth.login_blocked', {
        requestId: req.id,
        userId: user.id,
        reason: 'pending_verification',
        ip: req.ip
      });

      return res.status(403).json({
        error: 'Your account is not verified yet.',
        code: 'ACCOUNT_PENDING_VERIFICATION'
      });
    }

    if (user.status !== 'ACTIVE') {
      logger.security('auth.login_blocked', {
        requestId: req.id,
        userId: user.id,
        reason: 'inactive',
        ip: req.ip
      });

      return res.status(403).json({
        error: 'Your account is deactivated. Contact Admin.',
        code: 'ACCOUNT_INACTIVE'
      });
    }

    // 4. Enforce the second authentication factor for enrolled staff before
    // resolving profiles or issuing a normal application access token.
    if (STAFF_ROLES.includes(user.role)) {
      const mfaConfiguration = await prisma.mfaConfiguration.findUnique({
        where: { userId: user.id },
        select: { state: true }
      });
      const hasActiveMfa = user.mfaEnabled && mfaConfiguration?.state === 'ACTIVE';
      const hasInconsistentMfaState = user.mfaEnabled !== (mfaConfiguration?.state === 'ACTIVE');

      if (hasInconsistentMfaState) {
        logger.security('auth.mfa_configuration_invalid', { requestId: req.id, userId: user.id, ip: req.ip });
        return res.status(403).json({
          error: 'Multi-factor authentication is unavailable for this account. Contact Admin.',
          code: 'MFA_CONFIGURATION_INVALID'
        });
      }

      if (hasActiveMfa) {
        const challenge = await createMfaChallenge(user.id, user.authVersion, 'LOGIN', req.ip || 'unknown');
        logger.security('auth.mfa_challenge_created', { requestId: req.id, userId: user.id, ip: req.ip });
        return markSensitiveResponse(res).json({
          mfaRequired: true,
          challengeToken: challenge.token,
          expiresAt: challenge.expiresAt
        });
      }
    }

    // 5. Resolve role-specific profile linkage.
    //
    // Authentication and medical-record linkage are intentionally separate:
    // a valid PATIENT account may authenticate even if a legacy patient
    // record has not yet been linked. The frontend can then route that user
    // into the secure linkage recovery flow instead of opening the portal
    // and failing later with PATIENT_RECORD_NOT_LINKED.
    let doctorDetails = null;
    let patientDetails = null;

    if (user.role === 'DOCTOR') {
      doctorDetails = await prisma.doctor.findUnique({
        where: { userId: user.id }
      });
    }

    if (user.role === 'PATIENT') {
      patientDetails = await prisma.patient.findUnique({
        where: { userId: user.id },
        select: {
          id: true
        }
      });

      // Self-heal legacy/orphan patient accounts created before
      // automatic Patient linkage was completed reliably.
      if (!patientDetails) {
        const registration = await prisma.patientRegistration.findUnique({
          where: { userId: user.id }
        });

        if (registration && user.phoneNormalized) {
          try {
            patientDetails = await prisma.$transaction(async (tx) => {
              const current = await lockAccount(tx, user.id);
              if (!current || current.status !== 'ACTIVE' || current.authVersion !== user.authVersion) return null;
              await lockPatientIdentity(tx, { phone: current.phoneNormalized, dateOfBirth: registration.dateOfBirth });
              const existing = await tx.patient.findUnique({ where: { userId: user.id }, select: { id: true } });
              if (existing) return existing;
              const candidates = await tx.patient.findMany({ where: { dateOfBirth: registration.dateOfBirth }, select: { id: true, phone: true, userId: true } });
              const normalizedMatches = candidates.filter((patient) => normalizePatientPhone(patient.phone) === normalizePatientPhone(current.phoneNormalized));
              if (!normalizedMatches.length) {
                const created = await tx.patient.create({ data: {
                  userId: user.id, fullNameAr: registration.fullNameAr, fullNameEn: registration.fullNameEn,
                  ...(structuredPatientName(registration) || {}),
                  gender: registration.gender, dateOfBirth: registration.dateOfBirth, phone: current.phoneNormalized,
                  addressStateId: registration.addressStateId, emergencyContact: 'Self'
                }, select: { id: true, fileNumber: true } });
                await tx.tenantAuditLog.create({ data: { userId: user.id, action: 'PATIENT_LOGIN_SELF_HEALED', details: `Created missing patient record ${created.id} during authenticated login recovery.`, ipAddress: req.ip || 'unknown' } });
                await tx.tenantAuditLog.create({ data: { userId: user.id, action: 'PATIENT_FILE_CREATED', details: JSON.stringify({ patientId: created.id, fileNumber: created.fileNumber, context: 'PATIENT_LOGIN_SELF_HEAL' }), ipAddress: req.ip || 'unknown' } });
                return created;
              }
              if (normalizedMatches.length === 1 && !normalizedMatches[0].userId && current.phoneVerifiedAt) {
                const linked = await tx.patient.updateMany({ where: { id: normalizedMatches[0].id, userId: null }, data: { userId: user.id } });
                if (linked.count === 1) {
                  await tx.tenantAuditLog.create({ data: { userId: user.id, action: 'PATIENT_LOGIN_SELF_HEALED', details: `Linked orphan patient account to existing patient record ${normalizedMatches[0].id} during login recovery.`, ipAddress: req.ip || 'unknown' } });
                  return { id: normalizedMatches[0].id };
                }
              }
              return null;
            });
          } catch (recoveryError) {
            console.error('Patient login self-heal error:', recoveryError);
          }
        }
      }
    }

    // 6. Sign JWT
    const token = signAccessToken({
      id: user.id,
      username: user.username,
      role: user.role,
      authVersion: user.authVersion,
      doctorId: doctorDetails ? doctorDetails.id : null
    });

    // 7. Return response
    logger.security('auth.login_succeeded', { requestId: req.id, userId: user.id, role: user.role, ip: req.ip });
    return markSensitiveResponse(res).json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        preferredLanguage: user.preferredLanguage,
        mfaEnabled: user.mfaEnabled,
        mustChangePassword: user.mustChangePassword,
        doctorId: doctorDetails ? doctorDetails.id : null,
        doctorName: doctorDetails ? doctorDetails.fullNameEn : null,
        patientLinked:
          user.role === 'PATIENT'
            ? Boolean(patientDetails)
            : null,
        patientId:
          user.role === 'PATIENT'
            ? patientDetails?.id || null
            : null,
        email: user.email,
        phone: user.phoneNormalized
      }
    });

  } catch (error) {
    if (error instanceof MfaError && error.code === 'MFA_CREDENTIALS_CHANGED') {
      logger.security('auth.mfa_challenge_rejected', { requestId: req.id, reason: 'credentials_changed', ip: req.ip });
      return sendError(res, 401, error.code, error.message);
    }
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Internal server error during authentication.' });
  }
});

/**
 * GET /api/auth/audit-logs
 * Returns system audit logs. Only accessible by ADMIN.
 */
router.get('/audit-logs', authenticate, checkRoles('ADMIN'), validate(auditLogQuerySchema, 'query'), async (req, res) => {
  try {
    const { search, action, role, from, to, page, pageSize } = req.query;
    const actorWhere = {
      ...(role && { role }),
      ...(search && { OR: [
        { username: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { doctor: { is: { OR: [
          { fullNameAr: { contains: search, mode: 'insensitive' } },
          { fullNameEn: { contains: search, mode: 'insensitive' } }
        ] } } },
        { patient: { is: { OR: [
          { fullNameAr: { contains: search, mode: 'insensitive' } },
          { fullNameEn: { contains: search, mode: 'insensitive' } }
        ] } } }
      ] })
    };
    const filterActors = Boolean(role || search);
    const actorIds = filterActors
      ? (await prisma.user.findMany({ where: actorWhere, select: { id: true } })).map(({ id }) => id)
      : [];
    const timestamp = {
      ...(from && { gte: clinicDayBounds(from).start }),
      ...(to && { lt: clinicDayBounds(to).end })
    };
    const where = {
      ...(action && { action }),
      ...(filterActors && { userId: { in: actorIds } }),
      ...((from || to) && { timestamp })
    };
    const [total, logs] = await prisma.$transaction([
      prisma.tenantAuditLog.count({ where }),
      prisma.tenantAuditLog.findMany({
        where,
        select: { id: true, userId: true, action: true, details: true, ipAddress: true, timestamp: true },
        orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize
      })
    ]);
    const users = logs.length
      ? await prisma.user.findMany({
        where: { id: { in: [...new Set(logs.map(({ userId }) => userId).filter(Boolean))] } },
        select: {
          id: true, username: true, email: true, role: true,
          doctor: { select: { fullNameAr: true, fullNameEn: true } },
          patient: { select: { fullNameAr: true, fullNameEn: true } }
        }
      })
      : [];
    const usersById = new Map(users.map((user) => [user.id, user]));
    return res.json({
      items: logs.map((log) => {
        const actor = usersById.get(log.userId);
        const safeDetails = safeStructuredAuditDetails(log.details);
        return {
          id: log.id,
          action: log.action,
          details: safeDetails.summary,
          target: safeDetails.target,
          ipAddress: log.ipAddress,
          timestamp: log.timestamp,
          actor: actor ? {
            id: actor.id,
            username: actor.username,
            email: actor.email,
            role: actor.role,
            displayNameAr: actor.doctor?.fullNameAr || actor.patient?.fullNameAr || null,
            displayNameEn: actor.doctor?.fullNameEn || actor.patient?.fullNameEn || null
          } : null
        };
      }),
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
      filters: { actions: await prisma.tenantAuditLog.findMany({ distinct: ['action'], select: { action: true }, orderBy: { action: 'asc' }, take: 200 }) }
    });
  } catch (error) {
    console.error('Fetch audit logs error:', error);
    return res.status(500).json({ error: 'Failed to retrieve system audit logs.' });
  }
});

/**
 * GET /api/auth/users
 * Returns list of all staff members. Only accessible by ADMIN.
 */
router.get('/users', authenticate, checkRoles('ADMIN'), async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      where: { role: { in: STAFF_ROLES } },
      select: {
        id: true,
        username: true,
        role: true,
        status: true,
        preferredLanguage: true,
        createdAt: true
      },
      orderBy: { createdAt: 'desc' }
    });
    return res.json(users);
  } catch (error) {
    console.error('Fetch staff users error:', error);
    return res.status(500).json({ error: 'Failed to retrieve staff users.' });
  }
});

/**
 * POST /api/auth/users
 * Registers a new staff member. Only accessible by ADMIN.
 */
router.post('/users', authenticate, checkRoles('ADMIN'), validate(staffCreationSchema), async (req, res) => {
  const { password, role, preferredLanguage } = req.body;
  const username = normalizeEmail(req.body.username);

  if (!username || !password || !role) {
    return res.status(400).json({ error: 'Username, password, and role are required.' });
  }
  if (role === 'DOCTOR' && (req.body.consultationFee == null || !req.body.specialtyId)) {
    return sendError(res, 422, 'DOCTOR_CONFIGURATION_REQUIRED', 'A consultation fee and active specialty are required for a doctor account.');
  }

  try {
    const existing = await prisma.user.findFirst({
      where: { username: { equals: username, mode: 'insensitive' } }
    });

    if (existing) {
      return sendError(res, 409, 'USERNAME_ALREADY_REGISTERED', 'Username is already registered.');
    }

    const passwordHash = await bcrypt.hash(password, bcryptRounds);

    const newUser = await prisma.$transaction(async (tx) => {
      const createdUser = await tx.user.create({
        data: {
          username,
          passwordHash,
          role,
          preferredLanguage: preferredLanguage || 'ar',
          status: 'ACTIVE',
          mustChangePassword: true
        }
      });

      if (role === 'DOCTOR') {
        const specialty = await tx.specialty.findFirst({ where: { id: req.body.specialtyId, active: true } });
        if (!specialty) throw Object.assign(new Error('Active specialty not found.'), { status: 422, code: 'SPECIALTY_INACTIVE_OR_NOT_FOUND' });
        const docSchedule = JSON.stringify([
          { day: 'Sunday', startTime: '09:00', endTime: '15:00', slotDurationInMinutes: 15 },
          { day: 'Monday', startTime: '09:00', endTime: '15:00', slotDurationInMinutes: 15 },
          { day: 'Tuesday', startTime: '09:00', endTime: '15:00', slotDurationInMinutes: 15 },
          { day: 'Wednesday', startTime: '09:00', endTime: '15:00', slotDurationInMinutes: 15 },
          { day: 'Thursday', startTime: '09:00', endTime: '15:00', slotDurationInMinutes: 15 },
          { day: 'Friday', startTime: '09:00', endTime: '15:00', slotDurationInMinutes: 15 },
          { day: 'Saturday', startTime: '09:00', endTime: '15:00', slotDurationInMinutes: 15 }
        ]);

        await tx.doctor.create({
          data: {
            userId: createdUser.id,
            fullNameAr: req.body.fullNameAr || `د. ${username.split('@')[0]}`,
            fullNameEn: req.body.fullNameEn || `Dr. ${username.split('@')[0]}`,
            specialtyId: specialty.id,
            specialtyAr: specialty.nameAr,
            specialtyEn: specialty.nameEn,
            consultationFee: req.body.consultationFee,
            weeklySchedule: docSchedule,
            status: 'ACTIVE'
          }
        });
      }

      await tx.tenantAuditLog.create({
        data: {
          userId: req.user.id,
          action: 'USER_CREATION',
          details: `Created new staff user: ${username} with role ${role}`,
          ipAddress: req.ip || '127.0.0.1'
        }
      });

      return createdUser;
    });

    return res.status(201).json({
      success: true,
      message: 'Staff user created successfully.',
      user: {
        id: newUser.id,
        username: newUser.username,
        role: newUser.role,
        status: newUser.status,
        mustChangePassword: newUser.mustChangePassword
      }
    });
  } catch (error) {
    if (error?.code === 'SPECIALTY_INACTIVE_OR_NOT_FOUND') {
      return sendError(res, 422, 'SPECIALTY_INACTIVE_OR_NOT_FOUND', 'The selected specialty is not available.');
    }
    if (isUsernameUniqueViolation(error)) {
      return sendError(res, 409, 'USERNAME_ALREADY_REGISTERED', 'Username is already registered.');
    }
    logger.error('auth.staff_creation_failed', { requestId: req.id, error });
    return sendError(res, 500, 'STAFF_CREATION_FAILED', 'Failed to create staff user.');
  }
});

router.post('/change-password', authenticate, validate(passwordChangeSchema), async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { id: true, role: true, status: true, passwordHash: true, authVersion: true, mustChangePassword: true } });
    if (!user || user.status !== 'ACTIVE' || user.authVersion !== req.user.av) return sendError(res, 401, 'SESSION_REVOKED', 'This session is no longer active.');
    if (!await bcrypt.compare(req.body.currentPassword, user.passwordHash)) return sendError(res, 401, 'CURRENT_PASSWORD_INVALID', 'Current password is invalid.');
    if (await bcrypt.compare(req.body.newPassword, user.passwordHash)) return sendError(res, 422, 'PASSWORD_REUSE_NOT_ALLOWED', 'New password must be different from the current password.');
    const passwordHash = await bcrypt.hash(req.body.newPassword, bcryptRounds);
    await prisma.$transaction(async (tx) => {
      const current = await tx.user.findUnique({ where: { id: user.id }, select: { authVersion: true, role: true, status: true } });
      if (!current || current.authVersion !== user.authVersion || current.role !== user.role || current.status !== 'ACTIVE') throw new Error('PASSWORD_CHANGE_CONFLICT');
      await tx.user.update({ where: { id: user.id }, data: { passwordHash, lastPasswordChange: new Date(), mustChangePassword: false, authVersion: { increment: 1 } } });
      await tx.tenantAuditLog.create({ data: { userId: user.id, action: 'USER_PASSWORD_CHANGED', details: JSON.stringify({ role: user.role, clearedMustChangePassword: user.mustChangePassword }), ipAddress: req.ip || 'unknown' } });
    });
    logger.security('auth.user_password_changed', { requestId: req.id, userId: user.id, role: user.role, ip: req.ip });
    return res.json({ success: true, message: 'Password changed. Sign in again.' });
  } catch (error) {
    if (error?.message === 'PASSWORD_CHANGE_CONFLICT') return sendError(res, 409, 'PASSWORD_CHANGE_CONFLICT', 'Account security state changed. Sign in again.');
    return next(error);
  }
});

/**
 * POST /api/auth/users/:id/reset-password
 * Resets an existing staff member's password after strong ADMIN reauthentication.
 * Self-reset is deliberately unsupported so the acting ADMIN session is never
 * ambiguously invalidated during an administrative action.
 */
router.post('/users/:id/reset-password', authenticate, checkRoles('ADMIN'), adminResetLimiter, validate(staffPasswordResetSchema), async (req, res) => {
  if (req.params.id === req.user.id) {
    return sendError(res, 409, 'ADMIN_SELF_RESET_UNSUPPORTED', 'Use the dedicated administrator recovery process to reset your own password.');
  }

  try {
    const actor = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        role: true,
        status: true,
        authVersion: true,
        passwordHash: true,
        mfaEnabled: true,
        mfaConfiguration: { select: { state: true, updatedAt: true } }
      }
    });
    if (!actor || actor.role !== 'ADMIN' || actor.status !== 'ACTIVE' || actor.authVersion !== req.user.av) {
      return sendError(res, 401, 'ADMIN_REAUTHENTICATION_FAILED', 'Administrator reauthentication failed.');
    }
    if (!await bcrypt.compare(req.body.currentAdminPassword, actor.passwordHash)) {
      return sendError(res, 401, 'ADMIN_REAUTHENTICATION_FAILED', 'Administrator reauthentication failed.');
    }

    const hasActiveMfa = actor.mfaEnabled && actor.mfaConfiguration?.state === 'ACTIVE';
    const hasInconsistentMfaState = actor.mfaEnabled !== (actor.mfaConfiguration?.state === 'ACTIVE');
    if (hasInconsistentMfaState) {
      return sendError(res, 403, 'MFA_CONFIGURATION_INVALID', 'Multi-factor authentication is unavailable for this administrator account.');
    }
    if (hasActiveMfa && (!req.body.mfaCode || !await consumeTotp(actor.id, req.body.mfaCode))) {
      return sendError(res, 401, 'ADMIN_REAUTHENTICATION_FAILED', 'Administrator reauthentication failed.');
    }

    const reauthenticatedSecurityState = await prisma.user.findUnique({
      where: { id: actor.id },
      select: {
        mfaEnabled: true,
        mfaConfiguration: { select: { state: true, updatedAt: true } }
      }
    });
    if (
      !reauthenticatedSecurityState
      || reauthenticatedSecurityState.mfaEnabled !== actor.mfaEnabled
      || reauthenticatedSecurityState.mfaConfiguration?.state !== actor.mfaConfiguration?.state
      || (!hasActiveMfa && reauthenticatedSecurityState.mfaConfiguration?.updatedAt?.getTime()
        !== actor.mfaConfiguration?.updatedAt?.getTime())
    ) {
      return sendError(res, 401, 'ADMIN_REAUTHENTICATION_FAILED', 'Administrator reauthentication failed.');
    }

    const target = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: { id: true, username: true, role: true, status: true, authVersion: true }
    });
    if (!target) {
      return sendError(res, 404, 'STAFF_USER_NOT_FOUND', 'Staff user was not found.');
    }
    if (!STAFF_ROLES.includes(target.role)) {
      return sendError(res, 422, 'STAFF_PASSWORD_RESET_UNSUPPORTED', 'Password reset through this endpoint is limited to staff accounts.');
    }

    const passwordHash = await bcrypt.hash(req.body.newPassword, bcryptRounds);
    const changedAt = new Date();
    const updated = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" IN (${actor.id}, ${target.id}) ORDER BY "id" FOR UPDATE`;
      const currentActor = await tx.user.findUnique({
        where: { id: actor.id },
        select: {
          role: true,
          status: true,
          authVersion: true,
          mfaEnabled: true,
          mfaConfiguration: { select: { state: true, updatedAt: true } }
        }
      });
      const currentTarget = await tx.user.findUnique({
        where: { id: target.id },
        select: { role: true, authVersion: true }
      });
      if (
        !currentActor
        || currentActor.role !== 'ADMIN'
        || currentActor.status !== 'ACTIVE'
        || currentActor.authVersion !== actor.authVersion
        || currentActor.mfaEnabled !== reauthenticatedSecurityState.mfaEnabled
        || currentActor.mfaConfiguration?.state !== reauthenticatedSecurityState.mfaConfiguration?.state
        || currentActor.mfaConfiguration?.updatedAt?.getTime()
          !== reauthenticatedSecurityState.mfaConfiguration?.updatedAt?.getTime()
      ) {
        throw new Error('ADMIN_REAUTHENTICATION_STATE_CHANGED');
      }
      if (
        !currentTarget
        || !STAFF_ROLES.includes(currentTarget.role)
        || currentTarget.role !== target.role
        || currentTarget.authVersion !== target.authVersion
      ) {
        throw new Error('STAFF_RESET_TARGET_STATE_CHANGED');
      }

      const resetUser = await tx.user.update({
        where: { id: target.id },
        data: {
          passwordHash,
          lastPasswordChange: changedAt,
          mustChangePassword: true,
          authVersion: { increment: 1 }
        },
        select: { id: true, username: true, role: true, status: true }
      });
      await tx.tenantAuditLog.create({
        data: {
          userId: actor.id,
          action: 'STAFF_PASSWORD_RESET_BY_ADMIN',
          details: `Administrator reset credentials for staff user ${target.id} with role ${currentTarget.role}.`,
          ipAddress: req.ip || 'unknown'
        }
      });
      return resetUser;
    });

    logger.security('auth.staff_password_reset', {
      requestId: req.id,
      actorUserId: actor.id,
      targetUserId: updated.id,
      targetRole: updated.role,
      ip: req.ip
    });
    return res.json({ success: true, user: updated });
  } catch (error) {
    if (error?.message === 'ADMIN_REAUTHENTICATION_STATE_CHANGED') {
      return sendError(res, 401, 'ADMIN_REAUTHENTICATION_FAILED', 'Administrator reauthentication failed.');
    }
    if (error?.message === 'STAFF_RESET_TARGET_STATE_CHANGED') {
      return sendError(res, 409, 'STAFF_PASSWORD_RESET_CONFLICT', 'Staff account changed during password reset. Please retry.');
    }
    logger.error('auth.staff_password_reset_failed', { requestId: req.id, error });
    return sendError(res, 500, 'STAFF_PASSWORD_RESET_FAILED', 'Failed to reset staff password.');
  }
});

/**
 * POST /api/auth/users/:id/revoke-sessions
 * Ends every active session for a user without modifying credentials, status,
 * or role. Self-revocation is deliberately left to the account logout route.
 */
router.post('/users/:id/revoke-sessions', authenticate, checkRoles('ADMIN'), async (req, res, next) => {
  if (req.params.id === req.user.id) {
    return sendError(res, 409, 'ADMIN_SELF_SESSION_REVOCATION_UNSUPPORTED', 'Use logout to sign out your own sessions.');
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${req.params.id} FOR UPDATE`;
      const target = await tx.user.findUnique({
        where: { id: req.params.id },
        select: { id: true, username: true, role: true, status: true, authVersion: true }
      });
      if (!target) throw new Error('SESSION_REVOCATION_TARGET_NOT_FOUND');
      if (target.status !== 'ACTIVE') throw new Error('SESSION_REVOCATION_TARGET_INACTIVE');

      const revoked = await tx.user.update({
        where: { id: target.id },
        data: { authVersion: { increment: 1 } },
        select: { id: true, username: true, role: true, status: true, authVersion: true }
      });
      await tx.tenantAuditLog.create({
        data: {
          userId: req.user.id,
          action: 'USER_SESSIONS_REVOKED_BY_ADMIN',
          details: JSON.stringify({ userId: target.id, targetRole: target.role, previousAuthVersion: target.authVersion, authVersion: revoked.authVersion }),
          ipAddress: req.ip || 'unknown'
        }
      });
      return revoked;
    });

    logger.security('auth.user_sessions_revoked_by_admin', {
      requestId: req.id,
      actorUserId: req.user.id,
      targetUserId: updated.id,
      targetRole: updated.role,
      ip: req.ip
    });
    return res.json({ success: true, user: updated });
  } catch (error) {
    if (error?.message === 'SESSION_REVOCATION_TARGET_NOT_FOUND') {
      return sendError(res, 404, 'USER_NOT_FOUND', 'User was not found.');
    }
    if (error?.message === 'SESSION_REVOCATION_TARGET_INACTIVE') {
      return sendError(res, 409, 'USER_SESSION_REVOCATION_NOT_APPLICABLE', 'Inactive accounts do not have active sessions to revoke.');
    }
    return next(error);
  }
});

/**
 * PUT /api/auth/users/:id/status
 * Toggles status of a staff member. Only accessible by ADMIN.
 */
router.put('/users/:id/status', authenticate, checkRoles('ADMIN'), validate(z.object({ status: z.enum(['ACTIVE', 'INACTIVE']) })), async (req, res) => {
  const { status } = req.body;
  try {
    const updated = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${req.params.id} FOR UPDATE`;
      const current = await tx.user.findUnique({
        where: { id: req.params.id },
        select: { id: true, username: true, role: true, status: true, preferredLanguage: true, createdAt: true }
      });
      if (!current) throw new Error('STAFF_STATUS_TARGET_NOT_FOUND');
      if (!STAFF_ROLES.includes(current.role)) throw new Error('STAFF_STATUS_UNSUPPORTED');
      if (current.status === status) return current;

      const transitioned = await tx.user.update({
        where: { id: current.id },
        data: { status, authVersion: { increment: 1 } },
        select: { id: true, username: true, role: true, status: true, preferredLanguage: true, createdAt: true }
      });
      await tx.tenantAuditLog.create({
        data: {
          userId: req.user.id,
          action: 'USER_STATUS_CHANGE',
          details: `Changed status of user ${transitioned.username} to ${status}`,
          ipAddress: req.ip || '127.0.0.1'
        }
      });
      return transitioned;
    });

    return res.json(updated);
  } catch (error) {
    if (error?.message === 'STAFF_STATUS_UNSUPPORTED') {
      return sendError(res, 422, 'STAFF_STATUS_UNSUPPORTED', 'Status management through this endpoint is limited to staff accounts.');
    }
    console.error('Toggle staff status error:', error);
    return res.status(500).json({ error: 'Failed to update staff user status.' });
  }
});

export default router;
