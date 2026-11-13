import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';
import { PharmacyService } from './pharmacy.service.js';
import { PolicyRoles } from '../../common/decorators/roles.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';

const unavailableSchema = z
  .object({
    reason: z.enum(['OUT_OF_STOCK', 'NOT_IN_FORMULARY', 'DOCTOR_REVIEW_REQUIRED', 'OTHER']),
    note: z.string().trim().max(500).optional().nullable(),
  })
  .strict();

const dispenseSchema = z
  .object({
    items: z
      .array(
        z.object({
          prescribedDrugId: z.string().uuid(),
          qtyToDispense: z.coerce.number().int().positive(),
        }),
      )
      .min(1)
      .max(100),
  })
  .strict();

@Controller('records')
export class PrescriptionsController {
  constructor(private readonly pharmacyService: PharmacyService) {}

  @Get('prescriptions/pending')
  @PolicyRoles('PHARMACIST')
  @HttpCode(HttpStatus.OK)
  async getPendingPrescriptions() {
    return this.pharmacyService.getPendingPrescriptions();
  }

  @Get('prescriptions/history')
  @PolicyRoles('PHARMACIST')
  @HttpCode(HttpStatus.OK)
  async getPrescriptionHistory() {
    return this.pharmacyService.getPrescriptionHistory();
  }

  @Post('prescribed-drugs/:id/unavailable')
  @PolicyRoles('PHARMACIST')
  @HttpCode(HttpStatus.OK)
  async markUnavailable(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(unavailableSchema)) body: any,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.pharmacyService.markMedicationUnavailable(id, body, user, req.ip);
  }

  @Post('prescriptions/:id/dispense')
  @PolicyRoles('PHARMACIST')
  @HttpCode(HttpStatus.OK)
  async dispense(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(dispenseSchema)) body: any,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.pharmacyService.dispensePrescription(id, body, user, req.ip);
  }

  @Get('medication-reviews/pending')
  @PolicyRoles('PHARMACIST')
  @HttpCode(HttpStatus.OK)
  async getPendingMedicationReviews() {
    return this.pharmacyService.getPendingMedicationReviews();
  }

  @Post('prescribed-drugs/:id/pharmacy-review')
  @PolicyRoles('PHARMACIST')
  @HttpCode(HttpStatus.OK)
  async reviewMedication(
    @Param('id') id: string,
    @Body() body: any,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.pharmacyService.reviewMedication(id, body, user, req.ip);
  }
}
