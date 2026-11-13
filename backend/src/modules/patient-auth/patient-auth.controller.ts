import {
  Controller,
  Post,
  Param,
  Body,
  Res,
  HttpCode,
  HttpStatus,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { createRequire } from 'node:module';
import { PatientAuthService } from './patient-auth.service.js';
import { ExpressMiddlewareGuard, PreAuthMiddleware } from '../../common/guards/express-middleware.guard.js';
import { PolicyRoles } from '../../common/decorators/roles.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { passwordSchema } from '../../utils/passwordPolicy.js';
import { rateLimits } from '../../config.js';

const require = createRequire(import.meta.url);
const { structuredPatientNameSchema } = require('../../utils/patientName.js');
const { patientDateOfBirthSchema } = require('../../utils/patientOnboarding.js');
const { sendError } = require('../../utils/apiError.js');

// Same config and 429 envelope as src/routes/patientAuth.js. One instance per
// limiter, shared by every route that used it in Express, so counters match.
const limiter = (limit: number) =>
  rateLimit({
    windowMs: rateLimits.windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req: Request, res: Response) =>
      sendError(res, 429, 'RATE_LIMITED', 'Too many attempts. Please try again later.'),
  });
const registrationLimiter = limiter(rateLimits.registration);
const verificationLimiter = limiter(rateLimits.verification);
const claimLimiter = limiter(rateLimits.claim);
const registrationRateLimitGuard = ExpressMiddlewareGuard(registrationLimiter);
const verificationRateLimitGuard = ExpressMiddlewareGuard(verificationLimiter);
const claimRateLimitGuard = ExpressMiddlewareGuard(claimLimiter);

const CLAIM_CREDENTIAL_PATTERN = /^[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{32}$/;
const claimCredentialSchema = z.string().regex(CLAIM_CREDENTIAL_PATTERN);

const patientRegistrationFieldsSchema = structuredPatientNameSchema
  .extend({
    phone: z.string().trim().min(7).max(30),
    email: z.string().trim().email().max(254),
    dateOfBirth: patientDateOfBirthSchema,
    gender: z.enum(['MALE', 'FEMALE']),
    password: passwordSchema,
    addressStateId: z.coerce.number().int().min(1).max(18).optional(),
  })
  .strict();

const googlePatientCompletionSchema = structuredPatientNameSchema
  .extend({
    onboardingToken: z.string().trim().min(1).max(200),
    phone: z.string().trim().min(7).max(30),
    dateOfBirth: patientDateOfBirthSchema,
    gender: z.enum(['MALE', 'FEMALE']),
    password: passwordSchema,
    addressStateId: z.coerce.number().int().min(1).max(18).optional(),
  })
  .strict();

const verifySchema = z
  .object({
    challengeId: z.string().uuid(),
    code: z.string().regex(/^\d{6}$/),
  })
  .strict();

const claimSchema = z.object({
  code: claimCredentialSchema,
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const offlineActivationSchema = z
  .object({
    code: claimCredentialSchema,
    dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    password: passwordSchema,
    email: z.string().trim().email().max(254).optional(),
  })
  .strict();

const forgotPasswordSchema = z.object({
  email: z.string().trim().email().max(254),
});

const resetPasswordSchema = z.object({
  challengeId: z.string().uuid(),
  code: z.string().regex(/^\d{6}$/),
  newPassword: passwordSchema,
});

const resendSchema = z.object({
  challengeId: z.string().uuid(),
});

const resendByIdentitySchema = z.object({
  identity: z.string().trim().min(3).max(254),
  password: z.string().min(1).max(200),
});

const contactVerifySchema = z
  .object({
    challengeId: z.string().uuid(),
    code: z.string().regex(/^\d{6}$/),
    type: z.enum(['PHONE', 'EMAIL']),
  })
  .strict();

const contactRequestSchema = z.object({
  type: z.enum(['PHONE', 'EMAIL']),
});

const linkRecoverSchema = z.object({
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

@Controller('patient-auth')
export class PatientAuthController {
  constructor(private readonly patientAuthService: PatientAuthService) {}

  @Public()
  @UseGuards(registrationRateLimitGuard)
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(
    @Body(new ZodValidationPipe(patientRegistrationFieldsSchema)) body: any,
    @Req() req: Request,
  ) {
    return this.patientAuthService.register(body, req.ip);
  }

  @Public()
  @UseGuards(verificationRateLimitGuard)
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  async verify(
    @Body(new ZodValidationPipe(verifySchema)) body: { challengeId: string; code: string },
    @Req() req: Request,
  ) {
    return this.patientAuthService.verify(body, req.ip);
  }

  @Public()
  @UseGuards(verificationRateLimitGuard)
  @Post('google/verify')
  async verifyGoogle(
    @Body(new ZodValidationPipe(z.object({ credential: z.string().trim().min(1).max(20000) }).strict()))
    body: { credential: string },
    @Res() res: Response,
  ) {
    const { status, result } = await this.patientAuthService.verifyGoogle(body.credential);
    return res.status(status).json(result);
  }

  @Public()
  @UseGuards(registrationRateLimitGuard)
  @Post('google/complete')
  @HttpCode(HttpStatus.CREATED)
  async completeGoogle(
    @Body(new ZodValidationPipe(googlePatientCompletionSchema)) body: any,
  ) {
    return this.patientAuthService.completeGoogle(body);
  }

  @PreAuthMiddleware(claimLimiter)
  @PolicyRoles('PATIENT')
  @Post('claim')
  @HttpCode(HttpStatus.OK)
  async claim(
    @Body(new ZodValidationPipe(claimSchema)) body: { code: string; dateOfBirth: string },
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.patientAuthService.claim(user.id, body, req.ip);
  }

  // Offline clinic-assisted activation: reception verifies identity in person,
  // issues a high-entropy credential, then the patient sets a local password.
  @Public()
  @UseGuards(claimRateLimitGuard)
  @Post('offline-activation')
  @HttpCode(HttpStatus.CREATED)
  async offlineActivation(
    @Body(new ZodValidationPipe(offlineActivationSchema)) body: any,
    @Req() req: Request,
  ) {
    return this.patientAuthService.offlineActivation(body, req.ip);
  }

  @Post('claims/:patientId/code')
  @PolicyRoles('ADMIN', 'RECEPTIONIST')
  @HttpCode(HttpStatus.CREATED)
  async issueClaimCode(
    @Param('patientId') patientId: string,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.patientAuthService.issueClaimCode(patientId, user, req.ip);
  }

  @Public()
  @UseGuards(verificationRateLimitGuard)
  @Post('verification/resend')
  @HttpCode(HttpStatus.CREATED)
  async resendVerification(
    @Body(new ZodValidationPipe(resendSchema)) body: { challengeId: string },
    @Req() req: Request,
  ) {
    return this.patientAuthService.resendRegistrationChallenge(body.challengeId, req.ip);
  }

  @Public()
  @UseGuards(verificationRateLimitGuard)
  @Post('verification/resend-by-identity')
  @HttpCode(HttpStatus.CREATED)
  async resendVerificationByIdentity(
    @Body(new ZodValidationPipe(resendByIdentitySchema)) body: { identity: string; password: string },
    @Req() req: Request,
  ) {
    return this.patientAuthService.resendByIdentity(body, req.ip);
  }

  @PreAuthMiddleware(verificationLimiter)
  @PolicyRoles('PATIENT')
  @Post('verification/verify')
  @HttpCode(HttpStatus.OK)
  async verifyContact(
    @Body(new ZodValidationPipe(contactVerifySchema)) body: { challengeId: string; code: string; type: 'PHONE' | 'EMAIL' },
    @CurrentUser() user: any,
  ) {
    return this.patientAuthService.verifyContact(user, body);
  }

  @PreAuthMiddleware(verificationLimiter)
  @PolicyRoles('PATIENT')
  @Post('verification/request')
  @HttpCode(HttpStatus.CREATED)
  async requestVerification(
    @Body(new ZodValidationPipe(contactRequestSchema)) body: { type: 'PHONE' | 'EMAIL' },
    @CurrentUser() user: any,
  ) {
    return this.patientAuthService.requestContactVerification(user.id, body.type);
  }

  @Public()
  @UseGuards(verificationRateLimitGuard)
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(
    @Body(new ZodValidationPipe(forgotPasswordSchema)) body: { email: string },
    @Req() req: Request,
  ) {
    return this.patientAuthService.forgotPassword(body, req.ip);
  }

  @Public()
  @UseGuards(verificationRateLimitGuard)
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(
    @Body(new ZodValidationPipe(resetPasswordSchema)) body: { challengeId: string; code: string; newPassword: string },
    @Req() req: Request,
  ) {
    return this.patientAuthService.resetPassword(body, req.ip);
  }

  // Safely repairs legacy PATIENT accounts that are ACTIVE but not linked to a
  // Patient record. Automatic recovery is strict; unsafe cases return
  // MANUAL_REVIEW_REQUIRED and the Claim Code workflow remains the fallback.
  @PreAuthMiddleware(claimLimiter)
  @PolicyRoles('PATIENT')
  @Post('link/recover')
  @HttpCode(HttpStatus.OK)
  async recoverLink(
    @Body(new ZodValidationPipe(linkRecoverSchema)) body: { dateOfBirth: string },
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.patientAuthService.recoverLink(user.id, body.dateOfBirth, req.ip);
  }
}
