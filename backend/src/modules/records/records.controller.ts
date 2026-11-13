import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';
import { RecordsService } from './records.service.js';
import { Roles, PolicyRoles } from '../../common/decorators/roles.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';

const encounterCreationSchema = z
  .object({
    patientId: z.string().uuid(),
    appointmentId: z.string().uuid(),
    symptoms: z.string().max(5000).optional(),
    diagnosis: z.string().trim().max(5000).optional(),
    treatment: z.string().max(5000).optional(),
    clinicalNotes: z.string().max(10000).optional(),
    vitalSigns: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
    prescribedDrugs: z
      .array(
        z
          .object({
            drugId: z.string().uuid().optional(),
            customDrugName: z.string().trim().min(1).max(200).optional(),
            dosage: z.string().min(1).max(200),
            duration: z.string().min(1).max(200),
            instructionsAr: z.string().max(1000).optional(),
            instructionsEn: z.string().max(1000).optional(),
            qtyPrescribed: z.coerce.number().int().positive(),
          })
          .refine(
            (drug) => Boolean(drug.drugId) !== Boolean(drug.customDrugName),
            { message: 'Provide either drugId or customDrugName, but not both.' },
          ),
      )
      .max(50)
      .optional(),
    orderedServices: z.array(z.string().uuid()).max(50).optional(),
    customTests: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
    attachmentPath: z.string().max(300).optional(),
  })
  .strict();

const encounterFinalizeSchema = z
  .object({
    diagnosis: z.string().trim().min(1).max(5000),
    treatment: z.string().max(5000).optional(),
    clinicalNotes: z.string().max(10000).optional(),
    vitalSigns: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
    prescribedDrugs: z
      .array(
        z
          .object({
            drugId: z.string().uuid().optional(),
            customDrugName: z.string().trim().min(1).max(200).optional(),
            dosage: z.string().min(1).max(200),
            duration: z.string().min(1).max(200),
            instructionsAr: z.string().max(1000).optional(),
            instructionsEn: z.string().max(1000).optional(),
            qtyPrescribed: z.coerce.number().int().positive(),
          })
          .refine(
            (drug) => Boolean(drug.drugId) !== Boolean(drug.customDrugName),
            { message: 'Provide either drugId or customDrugName, but not both.' },
          ),
      )
      .max(50)
      .optional(),
  })
  .strict();

const bypassSchema = z
  .object({
    patientId: z.string().uuid(),
    justification: z.string().trim().min(20, 'Patient ID and a detailed justification (min 20 characters) are required.'),
  })
  .strict();

const sendSummarySchema = z.object({}).strict();

@Controller('records')
export class RecordsController {
  constructor(private readonly recordsService: RecordsService) {}

  @Post()
  @Roles('DOCTOR')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body(new ZodValidationPipe(encounterCreationSchema)) body: any,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.recordsService.createEncounter(body, user, req.ip);
  }

  @Put(':id/finalize')
  @Roles('DOCTOR')
  @HttpCode(HttpStatus.OK)
  async finalize(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(encounterFinalizeSchema)) body: any,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.recordsService.finalizeEncounter(id, body, user, req.ip);
  }

  @Post('bypass')
  @Roles('DOCTOR')
  @HttpCode(HttpStatus.OK)
  async bypass(
    @Body(new ZodValidationPipe(bypassSchema)) body: any,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.recordsService.applyBypass(body.patientId, body.justification, user, req.ip);
  }

  @Get('drugs')
  @PolicyRoles('DOCTOR', 'PHARMACIST')
  @HttpCode(HttpStatus.OK)
  async getDrugs(@CurrentUser() user: any) {
    return this.recordsService.getDrugs(user);
  }

  @Get(':id/summary')
  @PolicyRoles('DOCTOR')
  @HttpCode(HttpStatus.OK)
  async getSummary(
    @Param('id') id: string,
    @CurrentUser() user: any,
  ) {
    return this.recordsService.getSummary(id, user);
  }

  @Post(':id/send-summary')
  @PolicyRoles('DOCTOR')
  @HttpCode(HttpStatus.OK)
  async sendSummary(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(sendSummarySchema)) _body: any,
    @CurrentUser() user: any,
  ) {
    return this.recordsService.sendSummary(id, user);
  }
}
