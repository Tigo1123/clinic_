import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Query,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { z } from 'zod';
import { AdminService } from './admin.service.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';

const auditLogRoles = ['ADMIN', 'RECEPTIONIST', 'DOCTOR', 'PHARMACIST', 'LAB_TECH', 'PATIENT'] as const;

const auditLogQuerySchema = z
  .object({
    search: z.string().trim().max(120).optional().default(''),
    action: z.string().trim().regex(/^[A-Z0-9_:.-]+$/).max(100).optional(),
    role: z.enum(auditLogRoles).optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    page: z.coerce.number().int().min(1).max(10_000).optional().default(1),
    pageSize: z.coerce.number().int().min(10).max(50).optional().default(25),
  })
  .strict()
  .refine(({ from, to }) => !from || !to || from <= to, {
    path: ['to'],
    message: 'The end date must not be before the start date.',
  });

@Controller('auth/audit-logs')
@Roles('ADMIN')
export class AuditLogsController {
  constructor(private readonly adminService: AdminService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async list(
    @Query(new ZodValidationPipe(auditLogQuerySchema)) query: any,
    @Res() res: Response,
  ) {
    try {
      const body = await this.adminService.listAuditLogs(query);
      return res.status(HttpStatus.OK).json(body);
    } catch (error) {
      console.error('Fetch audit logs error:', error);
      // Express parity: bare string error body, not the standard envelope.
      return res
        .status(HttpStatus.INTERNAL_SERVER_ERROR)
        .json({ error: 'Failed to retrieve system audit logs.' });
    }
  }
}
