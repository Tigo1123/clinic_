import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  HttpCode,
  HttpException,
  HttpStatus,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { z } from 'zod';
import { AdminService } from './admin.service.js';
import { ExpressMiddlewareGuard } from '../../common/guards/express-middleware.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { passwordSchema } from '../../utils/passwordPolicy.js';
import { createAdminResetLimiter } from '../../utils/edgeSecurity.js';
import { rateLimits } from '../../config.js';

const adminResetLimiter = createAdminResetLimiter({
  windowMs: rateLimits.windowMs,
  limit: rateLimits.adminReset,
});

const staffCreationSchema = z.preprocess(
  (input: any) => {
    if (!input || typeof input !== 'object' || Array.isArray(input) || input.role === 'DOCTOR') {
      return input;
    }
    const normalized = { ...input };
    for (const field of ['fullNameAr', 'fullNameEn', 'specialtyId', 'consultationFee']) {
      delete normalized[field];
    }
    return normalized;
  },
  z.object({
    username: z.string().trim().email().max(254),
    password: passwordSchema,
    role: z.enum(['ADMIN', 'RECEPTIONIST', 'DOCTOR', 'PHARMACIST', 'LAB_TECH']),
    preferredLanguage: z.enum(['ar', 'en']).optional(),
    fullNameAr: z.string().trim().min(1, 'Arabic full name cannot be empty.').max(150).optional(),
    fullNameEn: z.string().trim().min(1, 'English full name cannot be empty.').max(150).optional(),
    specialtyId: z.string().uuid().optional(),
    consultationFee: z.coerce.number().int().positive().max(1_000_000_000).optional(),
  }),
);

const staffPasswordResetSchema = z
  .object({
    newPassword: passwordSchema,
    currentAdminPassword: z.string().min(1).max(200),
    mfaCode: z.string().regex(/^\d{6}$/).optional(),
  })
  .strict();

// Express parity: non-strict, unknown keys are stripped (not rejected).
const statusToggleSchema = z.object({
  status: z.enum(['ACTIVE', 'INACTIVE']),
});

@Controller('auth/users')
@Roles('ADMIN')
export class StaffUsersController {
  constructor(private readonly adminService: AdminService) {}

  // Express returns a bare `{ error: "<string>" }` on failure; the shared
  // exception filter reshapes HttpException bodies, so write these directly.
  @Get()
  @HttpCode(HttpStatus.OK)
  async listUsers(@Res() res: Response) {
    try {
      const users = await this.adminService.listStaffUsers();
      return res.status(HttpStatus.OK).json(users);
    } catch (error) {
      console.error('Fetch staff users error:', error);
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: 'Failed to retrieve staff users.' });
    }
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createUser(
    @Body(new ZodValidationPipe(staffCreationSchema)) body: any,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.adminService.createStaffUser(body, user.id, req.ip);
  }

  @Post(':id/reset-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ExpressMiddlewareGuard(adminResetLimiter))
  async resetPassword(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(staffPasswordResetSchema)) body: any,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.adminService.resetStaffPassword(id, body, user.id, user.av, req.ip);
  }

  @Post(':id/revoke-sessions')
  @HttpCode(HttpStatus.OK)
  async revokeSessions(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.adminService.revokeStaffSessions(id, user.id, req.ip);
  }

  @Put(':id/status')
  @HttpCode(HttpStatus.OK)
  async toggleStatus(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(statusToggleSchema)) body: { status: 'ACTIVE' | 'INACTIVE' },
    @CurrentUser() user: any,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    try {
      const updated = await this.adminService.toggleStaffStatus(id, body.status, user.id, req.ip);
      return res.status(HttpStatus.OK).json(updated);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      console.error('Toggle staff status error:', error);
      return res
        .status(HttpStatus.INTERNAL_SERVER_ERROR)
        .json({ error: 'Failed to update staff user status.' });
    }
  }
}
