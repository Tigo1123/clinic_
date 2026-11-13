import {
  Controller,
  Post,
  Delete,
  Body,
  HttpCode,
  HttpException,
  HttpStatus,
  Req,
  UseGuards,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common';
import { Request } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { PrismaService } from '../../database/prisma.service.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { PolicyRoles } from '../../common/decorators/roles.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { ExpressMiddlewareGuard, PreAuthMiddleware } from '../../common/guards/express-middleware.guard.js';
import {
  MfaError,
  verifyTotpLoginChallenge,
  verifyRecoveryLoginChallenge,
  startMfaEnrollment,
  confirmMfaEnrollment,
  generateRecoveryCodes,
  hashRecoveryCodes,
  consumeTotp,
  consumeRecoveryCode,
} from '../../services/mfa.js';
import { signAccessToken } from '../../services/accessTokens.js';
import { logger } from '../../utils/logger.js';
import { sendError } from '../../utils/apiError.js';
import { rateLimits } from '../../config.js';
import { STAFF_ROLES } from './auth.service.js';

// Same schemas as src/routes/mfa.js.
const currentPasswordSchema = z.string().min(1).max(200);
const codeSchema = z.string().regex(/^\d{6}$/);

const loginVerificationSchema = z.object({
  challengeToken: z.string().trim().min(40).max(200),
  code: codeSchema,
}).strict();

const recoveryLoginSchema = z.object({
  challengeToken: z.string().trim().min(40).max(200),
  recoveryCode: z.string().trim().min(1).max(64),
}).strict();

const enrollSchema = z.object({ currentPassword: currentPasswordSchema }).strict();

const confirmSchema = z.object({ code: codeSchema }).strict();

const proofSchema = z.object({
  currentPassword: currentPasswordSchema,
  totpCode: codeSchema.optional(),
  recoveryCode: z.string().trim().min(20).max(30).optional(),
}).strict().refine(
  (body) => Boolean(body.totpCode) !== Boolean(body.recoveryCode),
  { message: 'Provide either a TOTP code or a recovery code.' },
);

// Created once at module scope. Express shares one mfaLimiter instance (one
// store) across the verify routes and every authenticated MFA route, so the
// same guard instance is reused here.
const mfaLimiter = rateLimit({
  windowMs: rateLimits.windowMs,
  limit: rateLimits.verification,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res) => sendError(res, 429, 'MFA_RATE_LIMITED', 'Too many MFA attempts. Please try again later.'),
});
const MfaRateLimitGuard = ExpressMiddlewareGuard(mfaLimiter);

/** Maps the service's MfaError onto the same status and envelope as src/routes/mfa.js. */
function rethrowMfaError(error: unknown): never {
  if (error instanceof MfaError) {
    throw new HttpException({ error: { code: error.code, message: error.message } }, error.status);
  }
  throw error;
}

function publicStaffUser(user: any) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    preferredLanguage: user.preferredLanguage,
    mfaEnabled: true,
    mustChangePassword: user.mustChangePassword,
    doctorId: user.doctor?.id || null,
    doctorName: user.doctor?.fullNameEn || null,
    patientLinked: null,
    patientId: null,
    email: user.email,
    phone: user.phoneNormalized,
  };
}

@Controller('auth/mfa')
export class MfaController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @PreAuthMiddleware(mfaLimiter)
  async verifyTotp(
    @Body(new ZodValidationPipe(loginVerificationSchema)) body: z.infer<typeof loginVerificationSchema>,
    @Req() req: Request & { id?: string },
  ) {
    try {
      const result = await verifyTotpLoginChallenge(
        body.challengeToken,
        body.code,
        STAFF_ROLES,
        new Date(),
        req.ip || 'unknown',
      );

      if (result.status !== 'SUCCESS' || !result.user) {
        throw new UnauthorizedException({
          error: {
            code: result.status === 'INVALID' ? 'MFA_CODE_INVALID' : 'MFA_CHALLENGE_INVALID',
            message: result.status === 'INVALID'
              ? 'The authenticator code is invalid.'
              : 'The MFA challenge is invalid or expired.',
          },
        });
      }

      const user = result.user as any;
      const token = signAccessToken({
        id: user.id,
        username: user.username,
        role: user.role,
        authVersion: user.authVersion,
        doctorId: (user.doctor?.id || null) as any,
      });

      logger.security('auth.mfa_verification_succeeded', {
        requestId: req.id,
        userId: user.id,
        role: user.role,
        ip: req.ip,
      });

      return { token, user: publicStaffUser(user) };
    } catch (error) {
      rethrowMfaError(error);
    }
  }

  @Public()
  @Post('recovery/verify')
  @HttpCode(HttpStatus.OK)
  @PreAuthMiddleware(mfaLimiter)
  async verifyRecovery(
    @Body(new ZodValidationPipe(recoveryLoginSchema)) body: z.infer<typeof recoveryLoginSchema>,
    @Req() req: Request & { id?: string },
  ) {
    try {
      const result = await verifyRecoveryLoginChallenge(
        body.challengeToken,
        body.recoveryCode,
        STAFF_ROLES,
        new Date(),
        req.ip || 'unknown',
      );

      if (result.status !== 'SUCCESS' || !result.user) {
        logger.security('auth.mfa_recovery_login_failed', {
          requestId: req.id,
          userId: result.user?.id,
          reason: result.status === 'INVALID' ? 'MFA_RECOVERY_INVALID' : 'MFA_CHALLENGE_INVALID',
          method: 'RECOVERY_CODE',
          ip: req.ip,
        });

        throw new UnauthorizedException({
          error: {
            code: result.status === 'INVALID' ? 'MFA_RECOVERY_INVALID' : 'MFA_CHALLENGE_INVALID',
            message: 'The recovery code or MFA challenge is invalid.',
          },
        });
      }

      const user = result.user as any;
      const token = signAccessToken({
        id: user.id,
        username: user.username,
        role: user.role,
        authVersion: user.authVersion,
        doctorId: (user.doctor?.id || null) as any,
      });

      logger.security('auth.mfa_recovery_login_succeeded', {
        requestId: req.id,
        userId: user.id,
        role: user.role,
        method: 'RECOVERY_CODE',
        ip: req.ip,
      });

      return {
        token,
        authenticationMethod: 'RECOVERY_CODE',
        user: publicStaffUser(user),
      };
    } catch (error) {
      rethrowMfaError(error);
    }
  }

  @PolicyRoles(...STAFF_ROLES)
  @UseGuards(MfaRateLimitGuard)
  @Post('enroll')
  @HttpCode(HttpStatus.CREATED)
  async enroll(
    @CurrentUser() authUser: any,
    @Body(new ZodValidationPipe(enrollSchema)) body: z.infer<typeof enrollSchema>,
    @Req() req: Request,
  ) {
    try {
      const user = await this.loadStaffUser(authUser.id);
      if (!user || user.status !== 'ACTIVE' || user.authVersion !== authUser.av) {
        throw new UnauthorizedException({
          error: { code: 'SESSION_REVOKED', message: 'This session is no longer active.' },
        });
      }

      if (!(await bcrypt.compare(body.currentPassword, user.passwordHash))) {
        throw new UnauthorizedException({
          error: { code: 'MFA_REAUTH_FAILED', message: 'Current credentials are invalid.' },
        });
      }

      if (user.mfaEnabled || user.mfaConfiguration?.state === 'ACTIVE') {
        throw new ConflictException({
          error: { code: 'MFA_ALREADY_ENABLED', message: 'MFA is already enabled.' },
        });
      }

      const enrollment = await startMfaEnrollment(user, req.ip || 'unknown');
      return {
        state: 'PENDING',
        secret: enrollment.secret,
        otpauthUri: enrollment.otpauthUri,
        expiresAt: enrollment.expiresAt,
      };
    } catch (error) {
      rethrowMfaError(error);
    }
  }

  @PolicyRoles(...STAFF_ROLES)
  @UseGuards(MfaRateLimitGuard)
  @Post('enroll/confirm')
  @HttpCode(HttpStatus.OK)
  async confirmEnrollment(
    @CurrentUser() authUser: any,
    @Body(new ZodValidationPipe(confirmSchema)) body: z.infer<typeof confirmSchema>,
    @Req() req: Request & { id?: string },
  ) {
    try {
      const recoveryCodes = await confirmMfaEnrollment(
        authUser.id,
        body.code,
        Date.now(),
        req.ip || 'unknown',
        authUser.av,
      );
      return { state: 'ENABLED', recoveryCodes };
    } catch (error) {
      if (error instanceof MfaError) {
        await this.prisma.tenantAuditLog.create({
          data: {
            userId: authUser.id,
            action: 'MFA_ENROLLMENT_FAILED',
            details: `Staff MFA enrollment confirmation failed: ${error.code}.`,
            ipAddress: req.ip || 'unknown',
          },
        });
        logger.security('auth.mfa_enrollment_verification_failed', {
          requestId: req.id,
          userId: authUser.id,
          reason: error.code,
          algorithm: 'SHA1',
          digits: 6,
          periodSeconds: 30,
          windowSteps: 1,
          serverTimeStep: Math.floor(Date.now() / 30_000),
          ip: req.ip,
        });
      }
      rethrowMfaError(error);
    }
  }

  @PolicyRoles(...STAFF_ROLES)
  @UseGuards(MfaRateLimitGuard)
  @Post('recovery/regenerate')
  @HttpCode(HttpStatus.OK)
  async regenerateRecoveryCodes(
    @CurrentUser() authUser: any,
    @Body(new ZodValidationPipe(proofSchema)) body: z.infer<typeof proofSchema>,
    @Req() req: Request,
  ) {
    try {
      const user = await this.loadStaffUser(authUser.id);
      if (!user?.mfaEnabled || user.authVersion !== authUser.av || user.mfaConfiguration?.state !== 'ACTIVE') {
        throw new ConflictException({
          error: { code: 'MFA_NOT_ENABLED', message: 'MFA is not enabled.' },
        });
      }

      if (!(await this.verifyManagementProof(user, body))) {
        throw new UnauthorizedException({
          error: { code: 'MFA_REAUTH_FAILED', message: 'Current credentials or MFA proof are invalid.' },
        });
      }

      const recoveryCodes = generateRecoveryCodes();
      const recoveryHashes = await hashRecoveryCodes(recoveryCodes);

      await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${user.id} FOR UPDATE`;
        const current = await tx.user.findUnique({ where: { id: user.id } });
        if (!current || current.status !== 'ACTIVE' || current.authVersion !== user.authVersion) {
          throw new MfaError(401, 'MFA_CREDENTIALS_CHANGED', 'Credentials changed. Sign in again.');
        }
        await tx.user.update({ where: { id: user.id }, data: { authVersion: { increment: 1 } } });
        await tx.mfaRecoveryCode.deleteMany({ where: { userId: user.id } });
        await tx.mfaRecoveryCode.createMany({
          data: recoveryHashes.map((codeHash: string) => ({ userId: user.id, codeHash })),
        });
        await tx.tenantAuditLog.create({
          data: {
            userId: user.id,
            action: 'MFA_RECOVERY_CODES_REGENERATED',
            details: 'Staff MFA recovery codes regenerated.',
            ipAddress: req.ip || 'unknown',
          },
        });
      });

      return { recoveryCodes };
    } catch (error) {
      rethrowMfaError(error);
    }
  }

  @PolicyRoles(...STAFF_ROLES)
  @UseGuards(MfaRateLimitGuard)
  @Delete()
  @HttpCode(HttpStatus.OK)
  async disable(
    @CurrentUser() authUser: any,
    @Body(new ZodValidationPipe(proofSchema)) body: z.infer<typeof proofSchema>,
    @Req() req: Request,
  ) {
    try {
      const user = await this.loadStaffUser(authUser.id);
      if (!user?.mfaEnabled || user.authVersion !== authUser.av || user.mfaConfiguration?.state !== 'ACTIVE') {
        throw new ConflictException({
          error: { code: 'MFA_NOT_ENABLED', message: 'MFA is not enabled.' },
        });
      }

      if (!(await this.verifyManagementProof(user, body))) {
        throw new UnauthorizedException({
          error: { code: 'MFA_REAUTH_FAILED', message: 'Current credentials or MFA proof are invalid.' },
        });
      }

      await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${user.id} FOR UPDATE`;
        const current = await tx.user.findUnique({ where: { id: user.id } });
        if (!current || current.status !== 'ACTIVE' || current.authVersion !== user.authVersion) {
          throw new MfaError(401, 'MFA_CREDENTIALS_CHANGED', 'Credentials changed. Sign in again.');
        }
        await tx.mfaChallenge.deleteMany({ where: { userId: user.id } });
        await tx.mfaRecoveryCode.deleteMany({ where: { userId: user.id } });
        await tx.mfaConfiguration.delete({ where: { userId: user.id } });
        await tx.user.update({
          where: { id: user.id },
          data: { mfaEnabled: false, authVersion: { increment: 1 } },
        });
        await tx.tenantAuditLog.create({
          data: {
            userId: user.id,
            action: 'MFA_DISABLED',
            details: 'Staff MFA disabled by the account owner.',
            ipAddress: req.ip || 'unknown',
          },
        });
      });

      return { state: 'DISABLED' };
    } catch (error) {
      rethrowMfaError(error);
    }
  }

  private loadStaffUser(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        role: true,
        status: true,
        passwordHash: true,
        authVersion: true,
        mfaEnabled: true,
        mfaConfiguration: { select: { state: true, updatedAt: true } },
      },
    });
  }

  private async verifyManagementProof(
    user: { id: string; passwordHash: string },
    body: { currentPassword: string; totpCode?: string; recoveryCode?: string },
  ): Promise<boolean> {
    if (!(await bcrypt.compare(body.currentPassword, user.passwordHash))) return false;
    if (body.totpCode) return consumeTotp(user.id, body.totpCode);
    return consumeRecoveryCode(user.id, body.recoveryCode);
  }
}
