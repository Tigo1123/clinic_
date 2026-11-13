import {
  Controller,
  Get,
  Patch,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';
import { AdminService } from './admin.service.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';

const priceUpdateSchema = z
  .object({
    priceSdg: z.number().int().positive().max(1_000_000_000),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  })
  .strict();

@Controller('admin')
@Roles('ADMIN')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('pricing')
  @HttpCode(HttpStatus.OK)
  async getPricing() {
    return this.adminService.getPricing();
  }

  @Patch('pricing/doctors/:id')
  @HttpCode(HttpStatus.OK)
  async updateDoctorPrice(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(priceUpdateSchema)) body: any,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.adminService.updateDoctorPrice(id, body, user.id, req.ip);
  }

  @Patch('pricing/services/:id')
  @HttpCode(HttpStatus.OK)
  async updateServicePrice(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(priceUpdateSchema)) body: any,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.adminService.updateServicePrice(id, body, user.id, req.ip);
  }

  @Patch('pricing/medicines/:id')
  @HttpCode(HttpStatus.OK)
  async updateMedicinePrice(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(priceUpdateSchema)) body: any,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.adminService.updateMedicinePrice(id, body, user.id, req.ip);
  }

  @Get('analytics')
  @HttpCode(HttpStatus.OK)
  async getAnalytics() {
    return this.adminService.getAnalytics();
  }
}
