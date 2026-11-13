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
import { LaboratoryService } from './laboratory.service.js';
import { PolicyRoles } from '../../common/decorators/roles.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';

const labResultSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative().safe(),
    resultValue: z.string().trim().min(1).max(2000),
    referenceRangeMin: z.coerce.number().optional(),
    referenceRangeMax: z.coerce.number().optional(),
    isOutOfRange: z.boolean().optional(),
    fileAttachmentPath: z.string().max(300).optional(),
  })
  .strict();

@Controller('records')
@PolicyRoles('LAB_TECH')
export class LaboratoryController {
  constructor(private readonly laboratoryService: LaboratoryService) {}

  @Get('lab-order-items/pending-review')
  @HttpCode(HttpStatus.OK)
  async getPendingReviews() {
    return this.laboratoryService.getPendingReviews();
  }

  @Post('lab-order-items/:id/review')
  @HttpCode(HttpStatus.OK)
  async reviewItem(
    @Param('id') id: string,
    @Body() body: any,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.laboratoryService.reviewItem(id, body, user, req.ip);
  }

  @Get('lab-orders/pending')
  @HttpCode(HttpStatus.OK)
  async getPendingOrders() {
    return this.laboratoryService.getPendingOrders();
  }

  @Get('lab-orders/history')
  @HttpCode(HttpStatus.OK)
  async getOrderHistory() {
    return this.laboratoryService.getOrderHistory();
  }

  @Put('lab-orders/:id/collect-sample')
  @HttpCode(HttpStatus.OK)
  async collectSample(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.laboratoryService.collectSample(id, user, req.ip);
  }

  @Put('lab-orders/items/:id/results')
  @HttpCode(HttpStatus.OK)
  async logResults(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(labResultSchema)) body: any,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.laboratoryService.logResults(id, body, user, req.ip);
  }

  @Put('lab-orders/:id/release')
  @HttpCode(HttpStatus.OK)
  async releaseResults(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.laboratoryService.releaseResults(id, user, req.ip);
  }
}
