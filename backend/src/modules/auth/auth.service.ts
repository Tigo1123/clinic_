import {
  Injectable,
  BadRequestException,
  HttpException,
  InternalServerErrorException,
  UnauthorizedException,
  ForbiddenException,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { PrismaService } from '../../database/prisma.service.js';
import { signAccessToken } from '../../services/accessTokens.js';
import { createMfaChallenge, MfaError } from '../../services/mfa.js';
import { lockAccount } from '../../services/verification.js';
import { logger } from '../../utils/logger.js';
import { normalizeEmail, normalizePhone } from '../../utils/identity.js';
import { lockPatientIdentity } from '../../utils/patientOnboarding.js';
import { normalizePatientPhone } from '../../utils/patientIdentity.js';
import { structuredPatientName } from '../../utils/patientName.js';

export const STAFF_ROLES = ['ADMIN', 'RECEPTIONIST', 'DOCTOR', 'PHARMACIST', 'LAB_TECH'];

function invalidCredentials() {
  return new UnauthorizedException({ error: 'Invalid username or password.' });
}

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async login(body: { username: string; password: string }, ip = 'unknown', requestId?: string) {
    try {
      return await this.authenticate(body, ip, requestId);
    } catch (error) {
      // Deliberate HTTP responses thrown below pass through unchanged.
      if (error instanceof HttpException) throw error;
      if (error instanceof MfaError && error.code === 'MFA_CREDENTIALS_CHANGED') {
        logger.security('auth.mfa_challenge_rejected', { requestId, reason: 'credentials_changed', ip });
        throw new UnauthorizedException({ error: { code: error.code, message: error.message } });
      }
      console.error('Login error:', error);
      throw new InternalServerErrorException({ error: 'Internal server error during authentication.' });
    }
  }

  private async authenticate(body: { username: string; password: string }, ip: string, requestId?: string) {
    const { username, password } = body;

    if (!username || !password) {
      throw new BadRequestException({ error: 'Username and password are required.' });
    }

    // 1. Resolve the identifier exactly as src/routes/auth.js does: exact username,
    // normalized email, normalized phone. Two or more matches are ambiguous.
    const normalizedEmail = username.includes('@') ? normalizeEmail(username) : null;
    const normalizedPhone = normalizePhone(username);
    const candidates = await this.prisma.user.findMany({
      where: {
        OR: [
          { username },
          ...(normalizedEmail
            ? [
                { email: normalizedEmail },
                { username: { equals: normalizedEmail, mode: 'insensitive' as const } },
              ]
            : []),
          ...(normalizedPhone ? [{ phoneNormalized: normalizedPhone }] : []),
        ],
      },
      select: { id: true },
      take: 2,
    });

    if (candidates.length > 1) {
      logger.security('auth.login_failed', { requestId, reason: 'ambiguous_identifier', ip });
      throw invalidCredentials();
    }

    const user = candidates.length === 1
      ? await this.prisma.user.findUnique({
        where: { id: candidates[0].id },
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
          phoneVerifiedAt: true,
        },
      })
      : null;

    if (!user) {
      logger.security('auth.login_failed', { requestId, reason: 'invalid_credentials', ip });
      throw invalidCredentials();
    }

    // 2. Verify password
    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      logger.security('auth.login_failed', { requestId, userId: user.id, reason: 'invalid_credentials', ip });
      throw invalidCredentials();
    }

    // 3. Check account status
    if (user.status === 'PENDING_VERIFICATION') {
      logger.security('auth.login_blocked', { requestId, userId: user.id, reason: 'pending_verification', ip });
      throw new ForbiddenException({
        error: 'Your account is not verified yet.',
        code: 'ACCOUNT_PENDING_VERIFICATION',
      });
    }

    if (user.status !== 'ACTIVE') {
      logger.security('auth.login_blocked', { requestId, userId: user.id, reason: 'inactive', ip });
      throw new ForbiddenException({
        error: 'Your account is deactivated. Contact Admin.',
        code: 'ACCOUNT_INACTIVE',
      });
    }

    // 4. Enforce MFA for enrolled staff
    if (STAFF_ROLES.includes(user.role)) {
      const mfaConfiguration = await this.prisma.mfaConfiguration.findUnique({
        where: { userId: user.id },
        select: { state: true },
      });
      const hasActiveMfa = user.mfaEnabled && mfaConfiguration?.state === 'ACTIVE';
      const hasInconsistentMfaState = user.mfaEnabled !== (mfaConfiguration?.state === 'ACTIVE');

      if (hasInconsistentMfaState) {
        logger.security('auth.mfa_configuration_invalid', { requestId, userId: user.id, ip });
        throw new ForbiddenException({
          error: 'Multi-factor authentication is unavailable for this account. Contact Admin.',
          code: 'MFA_CONFIGURATION_INVALID',
        });
      }

      if (hasActiveMfa) {
        const challenge = await createMfaChallenge(user.id, user.authVersion, 'LOGIN', ip);
        logger.security('auth.mfa_challenge_created', { requestId, userId: user.id, ip });
        return {
          mfaRequired: true,
          challengeToken: challenge.token,
          expiresAt: challenge.expiresAt,
        };
      }
    }

    // 5. Resolve role-specific profile linkage. A valid PATIENT account may
    // authenticate without a linked Patient record; the frontend routes it into
    // the linkage recovery flow.
    let doctorDetails: any = null;
    let patientDetails: { id: string } | null = null;

    if (user.role === 'DOCTOR') {
      doctorDetails = await this.prisma.doctor.findUnique({
        where: { userId: user.id },
      });
    }

    if (user.role === 'PATIENT') {
      patientDetails = await this.prisma.patient.findUnique({
        where: { userId: user.id },
        select: { id: true },
      });

      // Self-heal legacy/orphan patient accounts created before automatic
      // Patient linkage was completed reliably.
      if (!patientDetails) {
        patientDetails = await this.healPatientLinkage(user, ip);
      }
    }

    // 6. Sign JWT
    const token = signAccessToken({
      id: user.id,
      username: user.username,
      role: user.role,
      authVersion: user.authVersion,
      doctorId: doctorDetails ? doctorDetails.id : null,
    });

    logger.security('auth.login_succeeded', { requestId, userId: user.id, role: user.role, ip });

    return {
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
        patientLinked: user.role === 'PATIENT' ? Boolean(patientDetails) : null,
        patientId: user.role === 'PATIENT' ? patientDetails?.id || null : null,
        email: user.email,
        phone: user.phoneNormalized,
      },
    };
  }

  /**
   * Port of the PATIENT self-heal branch in src/routes/auth.js. Creates or links
   * the Patient record inside one locked transaction. Failures are logged and
   * leave the account unlinked, exactly as the Express handler does.
   */
  private async healPatientLinkage(
    user: { id: string; authVersion: number; phoneNormalized: string | null },
    ip: string,
  ): Promise<{ id: string } | null> {
    const registration = await this.prisma.patientRegistration.findUnique({
      where: { userId: user.id },
    });

    if (!registration || !user.phoneNormalized) return null;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const current = await lockAccount(tx, user.id);
        if (!current || current.status !== 'ACTIVE' || current.authVersion !== user.authVersion) return null;
        await lockPatientIdentity(tx, { phone: current.phoneNormalized, dateOfBirth: registration.dateOfBirth, nationalId: undefined });
        const existing = await tx.patient.findUnique({ where: { userId: user.id }, select: { id: true } });
        if (existing) return existing;
        const candidates = await tx.patient.findMany({
          where: { dateOfBirth: registration.dateOfBirth },
          select: { id: true, phone: true, userId: true },
        });
        const normalizedMatches = candidates.filter((patient) =>
          normalizePatientPhone(patient.phone) === normalizePatientPhone(current.phoneNormalized));
        if (!normalizedMatches.length) {
          const created = await tx.patient.create({
            data: {
              userId: user.id,
              fullNameAr: registration.fullNameAr,
              fullNameEn: registration.fullNameEn,
              ...(structuredPatientName(registration) || {}),
              gender: registration.gender,
              dateOfBirth: registration.dateOfBirth,
              phone: current.phoneNormalized,
              addressStateId: registration.addressStateId,
              emergencyContact: 'Self',
            },
            select: { id: true, fileNumber: true },
          });
          await tx.tenantAuditLog.create({
            data: {
              userId: user.id,
              action: 'PATIENT_LOGIN_SELF_HEALED',
              details: `Created missing patient record ${created.id} during authenticated login recovery.`,
              ipAddress: ip || 'unknown',
            },
          });
          await tx.tenantAuditLog.create({
            data: {
              userId: user.id,
              action: 'PATIENT_FILE_CREATED',
              details: JSON.stringify({ patientId: created.id, fileNumber: created.fileNumber, context: 'PATIENT_LOGIN_SELF_HEAL' }),
              ipAddress: ip || 'unknown',
            },
          });
          return created;
        }
        if (normalizedMatches.length === 1 && !normalizedMatches[0].userId && current.phoneVerifiedAt) {
          const linked = await tx.patient.updateMany({
            where: { id: normalizedMatches[0].id, userId: null },
            data: { userId: user.id },
          });
          if (linked.count === 1) {
            await tx.tenantAuditLog.create({
              data: {
                userId: user.id,
                action: 'PATIENT_LOGIN_SELF_HEALED',
                details: `Linked orphan patient account to existing patient record ${normalizedMatches[0].id} during login recovery.`,
                ipAddress: ip || 'unknown',
              },
            });
            return { id: normalizedMatches[0].id };
          }
        }
        return null;
      });
    } catch (recoveryError) {
      console.error('Patient login self-heal error:', recoveryError);
      return null;
    }
  }

  async logout(user: { id: string; av: number }) {
    await this.prisma.user.updateMany({
      where: { id: user.id, authVersion: user.av },
      data: { authVersion: { increment: 1 } },
    });
  }

  async changePassword(
    authUser: { id: string; av: number },
    body: { currentPassword: string; newPassword: string },
    ip = 'unknown',
    requestId?: string,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: authUser.id },
      select: {
        id: true,
        role: true,
        status: true,
        passwordHash: true,
        authVersion: true,
        mustChangePassword: true,
      },
    });

    if (!user || user.status !== 'ACTIVE' || user.authVersion !== authUser.av) {
      throw new UnauthorizedException({
        error: {
          code: 'SESSION_REVOKED',
          message: 'This session is no longer active.',
        },
      });
    }

    const currentMatches = await bcrypt.compare(body.currentPassword, user.passwordHash);
    if (!currentMatches) {
      throw new UnauthorizedException({
        error: {
          code: 'CURRENT_PASSWORD_INVALID',
          message: 'Current password is invalid.',
        },
      });
    }

    const newMatchesCurrent = await bcrypt.compare(body.newPassword, user.passwordHash);
    if (newMatchesCurrent) {
      throw new UnprocessableEntityException({
        error: {
          code: 'PASSWORD_REUSE_NOT_ALLOWED',
          message: 'New password must be different from the current password.',
        },
      });
    }

    const bcryptRounds = Number(process.env.BCRYPT_ROUNDS || 12);
    const newHash = await bcrypt.hash(body.newPassword, bcryptRounds);

    try {
      await this.prisma.$transaction(async (tx) => {
        const current = await tx.user.findUnique({
          where: { id: user.id },
          select: { authVersion: true, role: true, status: true },
        });

        if (
          !current ||
          current.authVersion !== user.authVersion ||
          current.role !== user.role ||
          current.status !== 'ACTIVE'
        ) {
          throw new Error('PASSWORD_CHANGE_CONFLICT');
        }

        await tx.user.update({
          where: { id: user.id },
          data: {
            passwordHash: newHash,
            lastPasswordChange: new Date(),
            mustChangePassword: false,
            authVersion: { increment: 1 },
          },
        });

        await tx.tenantAuditLog.create({
          data: {
            userId: user.id,
            action: 'USER_PASSWORD_CHANGED',
            details: JSON.stringify({
              role: user.role,
              clearedMustChangePassword: user.mustChangePassword,
            }),
            ipAddress: ip,
          },
        });
      });
    } catch (err: any) {
      if (err?.message === 'PASSWORD_CHANGE_CONFLICT') {
        throw new ConflictException({
          error: {
            code: 'PASSWORD_CHANGE_CONFLICT',
            message: 'Account security state changed. Sign in again.',
          },
        });
      }
      throw err;
    }

    logger.security('auth.user_password_changed', {
      requestId,
      userId: user.id,
      role: user.role,
      ip,
    });

    return {
      success: true,
      message: 'Password changed. Sign in again.',
    };
  }
}
