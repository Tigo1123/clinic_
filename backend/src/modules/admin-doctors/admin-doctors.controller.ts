import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';
import { AdminDoctorsService } from './admin-doctors.service.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';

const doctorUpdateSchema = z
  .object({
    fullNameAr: z.string().trim().min(1).max(150).optional(),
    fullNameEn: z.string().trim().min(1).max(150).optional(),
    specialtyId: z.string().uuid().nullable().optional(),
    consultationFee: z.coerce.number().int().positive().max(1_000_000_000).optional(),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  })
  .strict();

@Controller('admin/doctors')
@Roles('ADMIN')
export class AdminDoctorsController {
  constructor(private readonly adminDoctorsService: AdminDoctorsService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async findAll() {
    return this.adminDoctorsService.findAll();
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  async findOne(@Param('id') id: string) {
    return this.adminDoctorsService.findOne(id);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(doctorUpdateSchema)) body: z.infer<typeof doctorUpdateSchema>,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.adminDoctorsService.update(id, body, user.id, req.ip);
  }
}
