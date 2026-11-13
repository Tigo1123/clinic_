import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';
import { CatalogsService } from './catalogs.service.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { money } from '../../common/utils/money.js';

const label = z.string().trim().min(1).max(150).regex(/^[^\u0000-\u001f\u007f]+$/u);
const code = z.string().trim().toLowerCase().min(1).max(60).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const categories = ['CONSULTATION', 'LABORATORY', 'RADIOLOGY', 'CLINICAL_PROCEDURE'] as const;
const price = z
  .union([
    z.string().regex(/^[1-9]\d{0,9}$/),
    z.number().int().positive().max(1_000_000_000),
  ])
  .refine((value) => money(value).lte('1000000000'), 'Price exceeds the supported range.');

const createSchema = z
  .object({
    code,
    labelAr: label,
    labelEn: label,
    category: z.enum(categories),
    priceSdg: price,
    status: z.enum(['ACTIVE', 'INACTIVE']).default('INACTIVE'),
  })
  .strict();

const updateSchema = createSchema
  .omit({ category: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'No changes supplied.');

const pageSchema = z
  .object({
    search: z.string().trim().max(100).default(''),
    category: z.enum(categories).optional(),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

const idSchema = z.object({ id: z.string().uuid() });

const paymentMethodParamsSchema = z.object({
  code: z.enum(['CASH', 'CARD', 'BANKAK', 'FAWRY']),
});

const paymentMethodUpdateSchema = z
  .object({
    labelAr: label.optional(),
    labelEn: label.optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0);

@Controller('admin/catalog')
@Roles('ADMIN')
export class CatalogsController {
  constructor(private readonly catalogsService: CatalogsService) {}

  @Get('services')
  @HttpCode(HttpStatus.OK)
  async listServices(
    @Query(new ZodValidationPipe(pageSchema)) query: z.infer<typeof pageSchema>,
  ) {
    return this.catalogsService.listServices(query);
  }

  @Post('services')
  @HttpCode(HttpStatus.CREATED)
  async createService(
    @Body(new ZodValidationPipe(createSchema)) body: z.infer<typeof createSchema>,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.catalogsService.createService(body, user.id, req.ip);
  }

  @Patch('services/:id')
  @HttpCode(HttpStatus.OK)
  async updateService(
    @Param(new ZodValidationPipe(idSchema)) params: { id: string },
    @Body(new ZodValidationPipe(updateSchema)) body: z.infer<typeof updateSchema>,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.catalogsService.updateService(params.id, body, user.id, req.ip);
  }

  @Get('payment-methods')
  @HttpCode(HttpStatus.OK)
  async listPaymentMethods() {
    return this.catalogsService.listPaymentMethods();
  }

  @Patch('payment-methods/:code')
  @HttpCode(HttpStatus.OK)
  async updatePaymentMethod(
    @Param(new ZodValidationPipe(paymentMethodParamsSchema)) params: { code: string },
    @Body(new ZodValidationPipe(paymentMethodUpdateSchema))
    body: z.infer<typeof paymentMethodUpdateSchema>,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.catalogsService.updatePaymentMethod(params.code, body, user.id, req.ip);
  }
}
