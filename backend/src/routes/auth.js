import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../db.js';
import { authenticate, checkRoles } from '../middleware/auth.js';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { sendError } from '../utils/apiError.js';
import { normalizeEmail, normalizePhone } from '../utils/identity.js';
import { rateLimits } from '../config.js';
import { logger } from '../utils/logger.js';

const bcryptRounds = Number(process.env.BCRYPT_ROUNDS || 12);

const router = express.Router();
const STAFF_ROLES = ['ADMIN', 'RECEPTIONIST', 'DOCTOR', 'PHARMACIST', 'LAB_TECH'];
const loginLimiter = rateLimit({
  windowMs: rateLimits.windowMs,
  limit: rateLimits.login,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res) => sendError(res, 429, 'LOGIN_RATE_LIMITED', 'Too many login attempts. Please try again later.')
});

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
    const user = await prisma.user.findFirst({ where: { OR: [
      { username }, ...(normalizedEmail ? [{ email: normalizedEmail }, { username: normalizedEmail }] : []),
      ...(normalizedPhone ? [{ phoneNormalized: normalizedPhone }] : [])
    ] } });

    if (!user) {
      logger.security('auth.login_failed', { requestId: req.id, reason: 'invalid_credentials', ip: req.ip });
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

    // 3. Verify password
    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      logger.security('auth.login_failed', { requestId: req.id, userId: user.id, reason: 'invalid_credentials', ip: req.ip });
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    // 4. Resolve role-specific profile linkage.
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
          const candidates = await prisma.patient.findMany({
            where: {
              dateOfBirth: registration.dateOfBirth
            },
            select: {
              id: true,
              phone: true,
              userId: true
            }
          });

          const normalizedMatches = candidates.filter(
            (patient) =>
              normalizePhone(patient.phone) ===
              normalizePhone(user.phoneNormalized)
          );

          if (normalizedMatches.length === 0) {
            try {
              const createdPatient = await prisma.patient.create({
                data: {
                  userId: user.id,
                  fullNameAr: registration.fullNameAr,
                  fullNameEn: registration.fullNameEn,
                  gender: registration.gender,
                  dateOfBirth: registration.dateOfBirth,
                  phone: user.phoneNormalized,
                  addressStateId: registration.addressStateId,
                  emergencyContact: 'Self'
                },
                select: {
                  id: true
                }
              });

              patientDetails = createdPatient;

              await prisma.tenantAuditLog.create({
                data: {
                  userId: user.id,
                  action: 'PATIENT_LOGIN_SELF_HEALED',
                  details: `Created missing patient record ${createdPatient.id} during authenticated login recovery.`,
                  ipAddress: req.ip || 'unknown'
                }
              });
            } catch (recoveryError) {
              console.error('Patient login self-heal create error:', recoveryError);
            }
          } else if (
            normalizedMatches.length === 1 &&
            !normalizedMatches[0].userId &&
            user.phoneVerifiedAt
          ) {
            try {
              const linked = await prisma.patient.updateMany({
                where: {
                  id: normalizedMatches[0].id,
                  userId: null
                },
                data: {
                  userId: user.id
                }
              });

              if (linked.count === 1) {
                patientDetails = {
                  id: normalizedMatches[0].id
                };

                await prisma.tenantAuditLog.create({
                  data: {
                    userId: user.id,
                    action: 'PATIENT_LOGIN_SELF_HEALED',
                    details: `Linked orphan patient account to existing patient record ${normalizedMatches[0].id} during login recovery.`,
                    ipAddress: req.ip || 'unknown'
                  }
                });
              }
            } catch (recoveryError) {
              console.error('Patient login self-heal link error:', recoveryError);
            }
          }
        }
      }
    }

    // 5. Sign JWT
    const token = jwt.sign(
      {
        id: user.id,
        username: user.username,
        role: user.role,
        doctorId: doctorDetails ? doctorDetails.id : null
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );

    // 6. Return response
    logger.security('auth.login_succeeded', { requestId: req.id, userId: user.id, role: user.role, ip: req.ip });
    return res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        preferredLanguage: user.preferredLanguage,
        mfaEnabled: user.mfaEnabled,
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
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Internal server error during authentication.' });
  }
});

/**
 * GET /api/auth/audit-logs
 * Returns system audit logs. Only accessible by ADMIN.
 */
router.get('/audit-logs', authenticate, checkRoles('ADMIN'), async (req, res) => {
  try {
    const logs = await prisma.tenantAuditLog.findMany({
      orderBy: { timestamp: 'desc' },
      take: 100
    });
    return res.json(logs);
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
router.post('/users', authenticate, checkRoles('ADMIN'), validate(z.object({
  username: z.string().trim().email().max(254),
  password: z.string().min(10).max(200),
  role: z.enum(STAFF_ROLES),
  preferredLanguage: z.enum(['ar', 'en']).optional(),
  fullNameAr: z.string().trim().min(1).max(150).optional(),
  fullNameEn: z.string().trim().min(1).max(150).optional(),
  specialtyAr: z.string().trim().min(1).max(150).optional(),
  specialtyEn: z.string().trim().min(1).max(150).optional(),
  consultationFee: z.coerce.number().positive().optional()
})), async (req, res) => {
  const { username, password, role, preferredLanguage } = req.body;

  if (!username || !password || !role) {
    return res.status(400).json({ error: 'Username, password, and role are required.' });
  }

  try {
    const existing = await prisma.user.findUnique({
      where: { username }
    });

    if (existing) {
      return res.status(409).json({ error: 'Username is already registered.' });
    }

    const passwordHash = await bcrypt.hash(password, bcryptRounds);

    const newUser = await prisma.user.create({
      data: {
        username,
        passwordHash,
        role,
        preferredLanguage: preferredLanguage || 'ar',
        status: 'ACTIVE'
      }
    });

    if (role === 'DOCTOR') {
      const docSchedule = JSON.stringify([
        { day: 'Sunday', startTime: '09:00', endTime: '15:00', slotDurationInMinutes: 15 },
        { day: 'Monday', startTime: '09:00', endTime: '15:00', slotDurationInMinutes: 15 },
        { day: 'Tuesday', startTime: '09:00', endTime: '15:00', slotDurationInMinutes: 15 },
        { day: 'Wednesday', startTime: '09:00', endTime: '15:00', slotDurationInMinutes: 15 },
        { day: 'Thursday', startTime: '09:00', endTime: '15:00', slotDurationInMinutes: 15 },
        { day: 'Friday', startTime: '09:00', endTime: '15:00', slotDurationInMinutes: 15 },
        { day: 'Saturday', startTime: '09:00', endTime: '15:00', slotDurationInMinutes: 15 }
      ]);

      await prisma.doctor.create({
        data: {
          userId: newUser.id,
          fullNameAr: req.body.fullNameAr || `د. ${username.split('@')[0]}`,
          fullNameEn: req.body.fullNameEn || `Dr. ${username.split('@')[0]}`,
          specialtyAr: req.body.specialtyAr || 'طب عام',
          specialtyEn: req.body.specialtyEn || 'General Medicine',
          consultationFee: req.body.consultationFee ? parseFloat(req.body.consultationFee) : 20000.00,
          weeklySchedule: docSchedule,
          status: 'ACTIVE'
        }
      });
    }

    await prisma.tenantAuditLog.create({
      data: {
        userId: req.user.id,
        action: 'USER_CREATION',
        details: `Created new staff user: ${username} with role ${role}`,
        ipAddress: req.ip || '127.0.0.1'
      }
    });

    return res.status(201).json({
      success: true,
      message: 'Staff user created successfully.',
      user: {
        id: newUser.id,
        username: newUser.username,
        role: newUser.role,
        status: newUser.status
      }
    });
  } catch (error) {
    console.error('Create staff user error:', error);
    return res.status(500).json({ error: 'Failed to create staff user.' });
  }
});

/**
 * PUT /api/auth/users/:id/status
 * Toggles status of a staff member. Only accessible by ADMIN.
 */
router.put('/users/:id/status', authenticate, checkRoles('ADMIN'), validate(z.object({ status: z.enum(['ACTIVE', 'INACTIVE']) })), async (req, res) => {
  const { status } = req.body;
  try {
    const updated = await prisma.user.update({
      where: { id: req.params.id },
      data: { status },
      select: { id: true, username: true, role: true, status: true, preferredLanguage: true, createdAt: true }
    });

    await prisma.tenantAuditLog.create({
      data: {
        userId: req.user.id,
        action: 'USER_STATUS_CHANGE',
        details: `Changed status of user ${updated.username} to ${status}`,
        ipAddress: req.ip || '127.0.0.1'
      }
    });

    return res.json(updated);
  } catch (error) {
    console.error('Toggle staff status error:', error);
    return res.status(500).json({ error: 'Failed to update staff user status.' });
  }
});

export default router;
