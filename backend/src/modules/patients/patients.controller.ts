import {
  Controller,
  Get,
  Post,
  Patch,
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
import { PatientsService } from './patients.service.js';
import { Roles, PolicyRoles } from '../../common/decorators/roles.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';

const require = createRequire(import.meta.url);
const { STRUCTURED_PATIENT_NAME_FIELDS, structuredPatientNameSchema } = require('../../utils/patientName.js');
const { patientDateOfBirthSchema } = require('../../utils/patientOnboarding.js');

const patientCreationSchema = structuredPatientNameSchema
  .extend({
    gender: z.enum(['MALE', 'FEMALE']),
    dateOfBirth: patientDateOfBirthSchema,
    nationalId: z.string().trim().max(30).optional(),
    phone: z.string().trim().min(7).max(30),
    addressStateId: z.coerce.number().int().min(1).max(18),
    addressDetails: z.string().trim().max(300).optional(),
    emergencyContact: z.string().trim().max(150).optional(),
    nationalIdAttachmentPath: z.string().max(300).optional(),
    insuranceAttachmentPath: z.string().max(300).optional(),
  })
  .strict();

const patientCorrectionSchema = structuredPatientNameSchema
  .partial()
  .extend({
    addressStateId: z.coerce.number().int().min(1).max(18).optional(),
    addressDetails: z.string().trim().max(300).nullable().optional(),
    emergencyContact: z.string().trim().min(1).max(150).optional(),
  })
  .strict()
  .superRefine((body: any, ctx: any) => {
    if (!Object.keys(body).length) {
      ctx.addIssue({ code: 'custom', message: 'At least one profile field is required.' });
    }
    if (STRUCTURED_PATIENT_NAME_FIELDS.some((field: string) => body[field] !== undefined)) {
      for (const field of STRUCTURED_PATIENT_NAME_FIELDS) {
        if (body[field] === undefined) {
          ctx.addIssue({
            code: 'custom',
            path: [field],
            message: 'A name correction requires all four Arabic and English components.',
          });
        }
      }
    }
  });

@Controller('patients')
export class PatientsController {
  constructor(private readonly patientsService: PatientsService) {}

  @Get('search')
  @PolicyRoles('ADMIN', 'RECEPTIONIST')
  @HttpCode(HttpStatus.OK)
  async search(
    @Query('q') q: string,
    @Query('limit') limitStr?: string,
  ) {
    const parsedLimit = limitStr ? parseInt(limitStr, 10) : 20;
    const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 50) : 20;
    if (!q || q.trim().length < 2 || q.trim().length > 120) {
      throw new HttpException(
        { code: 'PATIENT_SEARCH_INVALID', message: 'Patient search parameters are invalid.' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return this.patientsService.search(q.trim(), limit);
  }

  @Get()
  @PolicyRoles('ADMIN', 'RECEPTIONIST')
  @HttpCode(HttpStatus.OK)
  async findAll(@Query('limit') limitStr?: string) {
    const parsedLimit = limitStr ? parseInt(limitStr, 10) : 50;
    const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 100) : 50;
    return this.patientsService.findAll(limit);
  }

  @Post()
  @Roles('ADMIN', 'RECEPTIONIST')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body(new ZodValidationPipe(patientCreationSchema)) body: any,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    if (Object.hasOwn(body || {}, 'fileNumber') || Object.hasOwn(body || {}, 'mrn')) {
      throw new HttpException(
        {
          code: 'PATIENT_IDENTITY_FIELD_FORBIDDEN',
          message: 'Patient file identity fields cannot be supplied by the client.',
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return this.patientsService.create(body, user.id, req.ip);
  }

  @Patch(':id')
  @PolicyRoles('ADMIN', 'RECEPTIONIST')
  @HttpCode(HttpStatus.OK)
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(patientCorrectionSchema)) body: any,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.patientsService.update(id, body, user.id, req.ip);
  }

  @Get(':id/history')
  @PolicyRoles('DOCTOR')
  @HttpCode(HttpStatus.OK)
  async getHistory(
    @Param('id') id: string,
    @CurrentUser() user: any,
  ) {
    return this.patientsService.getHistory(id, user);
  }

  @Get(':id/profile')
  @PolicyRoles('ADMIN', 'RECEPTIONIST', 'DOCTOR')
  @HttpCode(HttpStatus.OK)
  async getProfile(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Res() res: Response,
  ) {
    try {
      const profile = await this.patientsService.getProfile(id, user);
      if (!profile) {
        // Express parity: bare string error body.
        return res.status(HttpStatus.NOT_FOUND).json({ error: 'Patient not found.' });
      }
      return res.status(HttpStatus.OK).json(profile);
    } catch (error: any) {
      // Envelope errors (403) and clinical decryption failures are shaped by
      // the shared exception filter, exactly as on the Express route.
      if (error instanceof HttpException || error?.code === 'CLINICAL_DATA_UNREADABLE' || error?.name === 'ClinicalDataDecryptionError') {
        throw error;
      }
      console.error('Fetch patient profile error:', error);
      return res
        .status(HttpStatus.INTERNAL_SERVER_ERROR)
        .json({ error: 'Failed to retrieve patient profile.' });
    }
  }

  @Get(':id')
  @PolicyRoles('ADMIN', 'RECEPTIONIST', 'DOCTOR')
  @HttpCode(HttpStatus.OK)
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: any,
  ) {
    return this.patientsService.findOne(id, user);
  }
}
