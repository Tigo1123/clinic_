import {
  Controller,
  Get,
  Patch,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  Req,
  Res,
  UseGuards,
  HttpException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { z } from 'zod';
import { PatientPortalService, BookingInput } from './patient-portal.service.js';
import { OwnedPatientGuard, OwnedPatient } from './owned-patient.guard.js';
import { PolicyRoles } from '../../common/decorators/roles.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { markSensitiveResponse } from '../../utils/edgeSecurity.js';
import { DATE_PATTERN, TIME_PATTERN } from '../../utils/scheduling.js';

const bookingSchema = z.object({
  doctorId: z.string().uuid(),
  appointmentDate: z.string().regex(DATE_PATTERN),
  appointmentTime: z.string().regex(TIME_PATTERN),
});

const profileUpdateSchema = z
  .object({
    addressStateId: z.coerce.number().int().min(1).max(18).optional(),
    addressDetails: z.string().trim().max(300).nullable().optional(),
    emergencyContact: z.string().trim().min(2).max(150).optional(),
    bloodType: z
      .enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'])
      .nullable()
      .optional(),
    preferredLanguage: z.enum(['ar', 'en']).optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0);

const emailChangeRequestSchema = z
  .object({
    email: z.string().trim().email().max(254),
    currentPassword: z.string().min(1).max(200),
  })
  .strict();

const emailChangeVerifySchema = z
  .object({
    challengeId: z.string().uuid(),
    code: z.string().regex(/^\d{6}$/),
    currentPassword: z.string().min(1).max(200),
  })
  .strict();

const phoneChangeRequestSchema = z
  .object({
    phone: z.string().trim().min(7).max(30),
  })
  .strict();

const phoneChangeVerifySchema = z
  .object({
    challengeId: z.string().uuid(),
    code: z.string().regex(/^\d{6}$/),
  })
  .strict();

const googleLinkSchema = z
  .object({
    credential: z.string().trim().min(1).max(20000),
    currentPassword: z.string().min(1).max(200),
  })
  .strict();

const googleUnlinkSchema = z
  .object({
    currentPassword: z.string().min(1).max(200),
  })
  .strict();

@Controller('patient')
@UseGuards(OwnedPatientGuard)
@PolicyRoles('PATIENT')
export class PatientPortalController {
  constructor(private readonly patientPortalService: PatientPortalService) {}

  @Get('me')
  @HttpCode(HttpStatus.OK)
  async getMe(
    @CurrentUser() user: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    markSensitiveResponse(res);
    return this.patientPortalService.getMe(user.id);
  }

  @Patch('me')
  @HttpCode(HttpStatus.OK)
  async updateMe(
    @Body() rawBody: any,
    @CurrentUser() user: any,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    markSensitiveResponse(res);
    if (Object.hasOwn(rawBody || {}, 'fileNumber') || Object.hasOwn(rawBody || {}, 'mrn')) {
      throw new HttpException(
        {
          code: 'PATIENT_IDENTITY_FIELD_FORBIDDEN',
          message: 'Patient file identity fields cannot be changed.',
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const body = profileUpdateSchema.parse(rawBody);
    return this.patientPortalService.updateMe(user.id, body, req.ip);
  }

  @Post('me/email-change/request')
  @HttpCode(HttpStatus.CREATED)
  async requestEmailChange(
    @Body(new ZodValidationPipe(emailChangeRequestSchema))
    body: z.infer<typeof emailChangeRequestSchema>,
    @CurrentUser() user: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    markSensitiveResponse(res);
    return this.patientPortalService.requestEmailChange(user.id, user.av, body);
  }

  @Post('me/email-change/verify')
  @HttpCode(HttpStatus.OK)
  async verifyEmailChange(
    @Body(new ZodValidationPipe(emailChangeVerifySchema))
    body: z.infer<typeof emailChangeVerifySchema>,
    @CurrentUser() user: any,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    markSensitiveResponse(res);
    return this.patientPortalService.verifyEmailChange(user.id, user.av, body, req.ip);
  }

  @Post('me/phone-change/request')
  @HttpCode(HttpStatus.CREATED)
  async requestPhoneChange(
    @Body(new ZodValidationPipe(phoneChangeRequestSchema))
    body: z.infer<typeof phoneChangeRequestSchema>,
    @CurrentUser() user: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    markSensitiveResponse(res);
    return this.patientPortalService.requestPhoneChange(user.id, user.av, body.phone);
  }

  @Post('me/phone-change/verify')
  @HttpCode(HttpStatus.OK)
  async verifyPhoneChange(
    @Body(new ZodValidationPipe(phoneChangeVerifySchema))
    body: z.infer<typeof phoneChangeVerifySchema>,
    @CurrentUser() user: any,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    markSensitiveResponse(res);
    return this.patientPortalService.verifyPhoneChange(user.id, user.av, body, req.ip);
  }

  @Post('me/external-identities/google/link')
  @HttpCode(HttpStatus.OK)
  async linkGoogle(
    @Body(new ZodValidationPipe(googleLinkSchema))
    body: z.infer<typeof googleLinkSchema>,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.patientPortalService.linkGoogle(user.id, body, req.ip);
  }

  @Delete('me/external-identities/google')
  @HttpCode(HttpStatus.OK)
  async unlinkGoogle(
    @Body(new ZodValidationPipe(googleUnlinkSchema))
    body: z.infer<typeof googleUnlinkSchema>,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.patientPortalService.unlinkGoogle(user.id, body, req.ip);
  }

  @Get('doctors')
  @HttpCode(HttpStatus.OK)
  async listDoctors(@Res({ passthrough: true }) res: Response) {
    markSensitiveResponse(res);
    return this.patientPortalService.listDoctors();
  }

  @Get('specialties')
  @HttpCode(HttpStatus.OK)
  async listSpecialties(@Res({ passthrough: true }) res: Response) {
    markSensitiveResponse(res);
    return this.patientPortalService.listSpecialties();
  }

  @Get('doctors/:id')
  @HttpCode(HttpStatus.OK)
  async getDoctor(
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    markSensitiveResponse(res);
    return this.patientPortalService.getDoctor(id);
  }

  @Get('appointments')
  @HttpCode(HttpStatus.OK)
  async listAppointments(
    @Query('group') group: unknown,
    @OwnedPatient() patient: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    markSensitiveResponse(res);
    return this.patientPortalService.listAppointments(patient.id, group);
  }

  @Get('appointments/:id')
  @HttpCode(HttpStatus.OK)
  async getAppointment(
    @Param('id') id: string,
    @OwnedPatient() patient: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    markSensitiveResponse(res);
    return this.patientPortalService.getAppointment(patient.id, id);
  }

  @Post('appointments')
  @HttpCode(HttpStatus.CREATED)
  async bookAppointment(
    @Body(new ZodValidationPipe(bookingSchema)) body: BookingInput,
    @OwnedPatient() patient: any,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    markSensitiveResponse(res);
    return this.patientPortalService.bookAppointment(patient, body, req.ip);
  }

  @Post('appointments/:id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancelAppointment(
    @Param('id') id: string,
    @OwnedPatient() patient: any,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    markSensitiveResponse(res);
    return this.patientPortalService.cancelAppointment(patient, id, req.ip);
  }

  @Put('appointments/:id/reschedule')
  @HttpCode(HttpStatus.OK)
  async rescheduleAppointment(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(bookingSchema)) body: BookingInput,
    @OwnedPatient() patient: any,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    markSensitiveResponse(res);
    return this.patientPortalService.rescheduleAppointment(patient, id, body, req.ip);
  }

  @Get('lab-results')
  @HttpCode(HttpStatus.OK)
  async listLabResults(
    @OwnedPatient() patient: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    markSensitiveResponse(res);
    return this.patientPortalService.listLabResults(patient.id);
  }

  @Get('prescriptions')
  @HttpCode(HttpStatus.OK)
  async listPrescriptions(
    @OwnedPatient() patient: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    markSensitiveResponse(res);
    return this.patientPortalService.listPrescriptions(patient.id);
  }

  @Get('medical-records')
  @HttpCode(HttpStatus.OK)
  async listMedicalRecords(
    @OwnedPatient() patient: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    markSensitiveResponse(res);
    return this.patientPortalService.listMedicalRecords(patient.id);
  }

  @Get('medical-records/:id')
  @HttpCode(HttpStatus.OK)
  async getMedicalRecord(
    @Param('id') id: string,
    @OwnedPatient() patient: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    markSensitiveResponse(res);
    return this.patientPortalService.getMedicalRecord(patient.id, id);
  }
}
