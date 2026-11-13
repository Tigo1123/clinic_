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
} from '@nestjs/common';
import { Request } from 'express';
import { createRequire } from 'node:module';
import { PharmacyService } from './pharmacy.service.js';
import { PolicyRoles } from '../../common/decorators/roles.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';

const require = createRequire(import.meta.url);
const {
  formularyIdParamsSchema,
  formularySearchSchema,
  inventoryPageSchema,
  inventoryReceiptSchema,
  pharmacistMedicineCreateSchema,
  pharmacistMedicineMetadataSchema,
} = require('../../utils/medicineManagement.js');

@Controller('pharmacy')
export class PharmacyController {
  constructor(private readonly pharmacyService: PharmacyService) {}

  @Get('formulary')
  @PolicyRoles('PHARMACIST', 'ADMIN')
  @HttpCode(HttpStatus.OK)
  async getFormulary(
    @Query(new ZodValidationPipe(formularySearchSchema)) query: any,
  ) {
    return this.pharmacyService.getFormulary(query);
  }

  @Get('formulary/:id')
  @PolicyRoles('PHARMACIST', 'ADMIN')
  @HttpCode(HttpStatus.OK)
  async getFormularyById(
    @Param(new ZodValidationPipe(formularyIdParamsSchema)) params: { id: string },
  ) {
    return this.pharmacyService.getFormularyById(params.id);
  }

  @Post('formulary')
  @PolicyRoles('PHARMACIST')
  @HttpCode(HttpStatus.CREATED)
  async createFormulary(
    @Body(new ZodValidationPipe(pharmacistMedicineCreateSchema)) body: any,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.pharmacyService.createFormulary(body, user, req.ip);
  }

  @Patch('formulary/:id/metadata')
  @PolicyRoles('PHARMACIST')
  @HttpCode(HttpStatus.OK)
  async updateFormularyMetadata(
    @Param(new ZodValidationPipe(formularyIdParamsSchema)) params: { id: string },
    @Body(new ZodValidationPipe(pharmacistMedicineMetadataSchema)) body: any,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.pharmacyService.updateFormularyMetadata(params.id, body, user, req.ip);
  }

  @Get('formulary/:id/batches')
  @PolicyRoles('PHARMACIST', 'ADMIN')
  @HttpCode(HttpStatus.OK)
  async getBatches(
    @Param(new ZodValidationPipe(formularyIdParamsSchema)) params: { id: string },
    @Query(new ZodValidationPipe(inventoryPageSchema)) query: any,
  ) {
    return this.pharmacyService.getBatches(params.id, query);
  }

  @Post('formulary/:id/batches')
  @PolicyRoles('PHARMACIST')
  @HttpCode(HttpStatus.CREATED)
  async createBatch(
    @Param(new ZodValidationPipe(formularyIdParamsSchema)) params: { id: string },
    @Body(new ZodValidationPipe(inventoryReceiptSchema)) body: any,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.pharmacyService.createBatch(params.id, body, user, req.ip);
  }

  @Get('formulary/:id/movements')
  @PolicyRoles('PHARMACIST', 'ADMIN')
  @HttpCode(HttpStatus.OK)
  async getMovements(
    @Param(new ZodValidationPipe(formularyIdParamsSchema)) params: { id: string },
    @Query(new ZodValidationPipe(inventoryPageSchema)) query: any,
  ) {
    return this.pharmacyService.getMovements(params.id, query);
  }

  @Get('prescriptions/:id/payment-state')
  @PolicyRoles('PHARMACIST', 'ADMIN')
  @HttpCode(HttpStatus.OK)
  async getPrescriptionPaymentState(
    @Param('id') id: string,
  ) {
    return this.pharmacyService.getPrescriptionPaymentState(id);
  }
}
