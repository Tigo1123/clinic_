import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';
import { SpecialtiesService } from './specialties.service.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';

const specialtySchema = z
  .object({
    code: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(60),
    nameAr: z.string().trim().min(1).max(100),
    nameEn: z.string().trim().min(1).max(100),
    active: z.boolean().optional(),
  })
  .strict();

const specialtyUpdateSchema = specialtySchema
  .omit({ code: true })
  .extend({ code: specialtySchema.shape.code.optional() })
  .strict();

const idParamSchema = z.object({
  id: z.string().uuid(),
});

@Controller('specialties')
@Roles('ADMIN')
export class SpecialtiesController {
  constructor(private readonly specialtiesService: SpecialtiesService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async findAll() {
    return this.specialtiesService.findAll();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body(new ZodValidationPipe(specialtySchema)) body: z.infer<typeof specialtySchema>,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.specialtiesService.create(body, user.id, req.ip);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(specialtyUpdateSchema))
    body: z.infer<typeof specialtyUpdateSchema>,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.specialtiesService.update(id, body, user.id, req.ip);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    await this.specialtiesService.delete(params.id, user.id, req.ip);
  }
}
