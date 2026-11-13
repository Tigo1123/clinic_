import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Query,
  Body,
  HttpCode,
  HttpStatus,
  Req,
  Res,
  HttpException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { z } from 'zod';
import { createRequire } from 'node:module';
import { AppointmentsService } from './appointments.service.js';
import { PolicyRoles } from '../../common/decorators/roles.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { markSensitiveResponse } from '../../utils/edgeSecurity.js';

const require = createRequire(import.meta.url);
const {
  DATE_PATTERN,
  TIME_PATTERN,
} = require('../../utils/scheduling.js');
const { structuredPatientNameSchema } = require('../../utils/patientName.js');
const { patientDateOfBirthSchema } = require('../../utils/patientOnboarding.js');

const appointmentStatuses = [
  'PENDING',
  'SCHEDULED',
  'CONFIRMED',
  'CHECKED_IN',
  'IN_CONSULTATION',
  'WAITING_LAB',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
] as const;

const slotsQuerySchema = z
  .object({
    doctorId: z.string().uuid(),
    date: z.string().regex(DATE_PATTERN),
  })
  .strict();

const bookingSchema = structuredPatientNameSchema
  .extend({
    doctorId: z.string().uuid(),
    appointmentDate: z.string().regex(DATE_PATTERN),
    appointmentTime: z.string().regex(TIME_PATTERN),
    gender: z.enum(['MALE', 'FEMALE']),
    dateOfBirth: patientDateOfBirthSchema,
    nationalId: z.string().trim().max(30).optional(),
    phone: z.string().trim().min(7).max(30),
    addressStateId: z.coerce.number().int().min(1).max(18),
    otpCode: z.string().length(6),
  })
  .strict();

const walkInPatientSchema = structuredPatientNameSchema
  .extend({
    gender: z.enum(['MALE', 'FEMALE']),
    dateOfBirth: patientDateOfBirthSchema,
    nationalId: z.string().trim().max(30).optional(),
    phone: z.string().trim().min(7).max(30),
    addressStateId: z.coerce.number().int().min(1).max(18),
    addressDetails: z.string().trim().max(300).optional(),
    emergencyContact: z.string().trim().max(150).optional(),
  })
  .strict();

const walkInSchema = z
  .object({
    mode: z.enum(['EXISTING', 'NEW']),
    patientId: z.string().uuid().optional(),
    doctorId: z.string().uuid(),
    appointmentDate: z.string().regex(DATE_PATTERN),
    appointmentTime: z.string().regex(TIME_PATTERN),
    patient: walkInPatientSchema.optional(),
  })
  .superRefine((value: any, ctx: any) => {
    if (value.mode === 'EXISTING' && (!value.patientId || value.patient)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['patientId'],
        message: 'Existing walk-ins require a patientId only.',
      });
    }
    if (value.mode === 'NEW' && (value.patientId || !value.patient)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['patient'],
        message: 'New walk-ins require patient registration details only.',
      });
    }
  })
  .strict();

const statusUpdateSchema = z
  .object({
    status: z.enum(appointmentStatuses),
  })
  .strict();

@Controller('appointments')
export class AppointmentsController {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  @Get('slots')
  @Public()
  @HttpCode(HttpStatus.OK)
  async getSlots(
    @Query(new ZodValidationPipe(slotsQuerySchema)) query: { doctorId: string; date: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    if (typeof res?.set === 'function') markSensitiveResponse(res);
    return this.appointmentsService.getSlots(query.doctorId, query.date);
  }

  @Post('otp/request')
  @Public()
  @HttpCode(HttpStatus.OK)
  async requestOtp(
    @Body() body: { phone?: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    if (typeof res?.set === 'function') markSensitiveResponse(res);
    return this.appointmentsService.requestOtp(body?.phone || '');
  }

  @Post('book')
  @Public()
  @HttpCode(HttpStatus.CREATED)
  async book(
    @Body(new ZodValidationPipe(bookingSchema)) body: any,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (typeof res?.set === 'function') markSensitiveResponse(res);
    if (Object.hasOwn(body || {}, 'fileNumber') || Object.hasOwn(body || {}, 'mrn')) {
      throw new HttpException(
        {
          code: 'PATIENT_IDENTITY_FIELD_FORBIDDEN',
          message: 'Patient file identity fields cannot be supplied by the client.',
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return this.appointmentsService.book(body, req.ip);
  }

  @Get('pending')
  @PolicyRoles('ADMIN', 'RECEPTIONIST')
  @HttpCode(HttpStatus.OK)
  async getPending() {
    return this.appointmentsService.getPending();
  }

  @Post('walk-in')
  @PolicyRoles('ADMIN', 'RECEPTIONIST')
  @HttpCode(HttpStatus.CREATED)
  async createWalkIn(
    @Body(new ZodValidationPipe(walkInSchema)) body: any,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    if (
      Object.hasOwn(body || {}, 'fileNumber') ||
      Object.hasOwn(body || {}, 'mrn') ||
      Object.hasOwn(body?.patient || {}, 'fileNumber') ||
      Object.hasOwn(body?.patient || {}, 'mrn')
    ) {
      throw new HttpException(
        {
          code: 'PATIENT_IDENTITY_FIELD_FORBIDDEN',
          message: 'Patient file identity fields cannot be supplied by the client.',
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return this.appointmentsService.createWalkIn(body, user.id, req.ip);
  }

  @Get('queue/:doctorId')
  @PolicyRoles('ADMIN', 'RECEPTIONIST', 'DOCTOR')
  @HttpCode(HttpStatus.OK)
  async getQueue(
    @Param('doctorId') doctorId: string,
    @Query('date') date: string | undefined,
    @CurrentUser() user: any,
  ) {
    return this.appointmentsService.getQueue(doctorId, date, user);
  }

  @Put(':id/status')
  @PolicyRoles('ADMIN', 'RECEPTIONIST', 'DOCTOR')
  @HttpCode(HttpStatus.OK)
  async updateStatus(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(statusUpdateSchema)) body: { status: string },
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.appointmentsService.updateStatus(id, body.status, user, req.ip);
  }

  @Post(':id/override')
  @PolicyRoles('ADMIN', 'RECEPTIONIST')
  @HttpCode(HttpStatus.OK)
  async applyOverride(
    @Param('id') id: string,
    @Body() body: any,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.appointmentsService.applyOverride(id, body?.justification, user.id, req.ip);
  }

  @Post(':id/transfer')
  @PolicyRoles('ADMIN', 'RECEPTIONIST')
  @HttpCode(HttpStatus.OK)
  async transfer(
    @Param('id') id: string,
    @Body() body: any,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.appointmentsService.transfer(id, body?.targetDoctorId, user.id, req.ip);
  }

  @Get('doctors')
  @Public()
  @HttpCode(HttpStatus.OK)
  async getDoctors() {
    return this.appointmentsService.getDoctors();
  }
}
