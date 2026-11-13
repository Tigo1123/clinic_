import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  Req,
  Res,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { z } from 'zod';
import { BillingService } from './billing.service.js';
import { Roles, PolicyRoles } from '../../common/decorators/roles.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';

const PAYMENT_METHODS = ['CASH', 'CARD', 'BANKAK', 'FAWRY'] as const;

export const paymentRequestSchema = z
  .object({
    payments: z
      .array(
        z
          .object({
            amountSdg: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
            paymentMethod: z.enum(PAYMENT_METHODS),
            transactionReference: z
              .string()
              .trim()
              .min(1)
              .max(200)
              .regex(/^[^\u0000-\u001F\u007F]+$/)
              .nullable()
              .optional(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();

export const paymentInvoiceParamsSchema = z.object({ id: z.string().uuid() }).strict();

export const insurancePreviewSchema = z
  .object({
    patientId: z.string().uuid(),
    insuranceCompanyId: z.string().uuid().nullable().optional(),
    invoiceType: z.enum(['GENERAL', 'CONSULTATION']),
    appointmentId: z.string().uuid().nullable().optional(),
    items: z
      .array(
        z
          .object({
            serviceId: z.string().uuid(),
            quantity: z.number().int().positive().max(100),
          })
          .strict(),
      )
      .max(100)
      .optional(),
  })
  .strict();

@Controller('billing')
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Post('insurance-preview')
  @PolicyRoles('ADMIN', 'RECEPTIONIST')
  @HttpCode(HttpStatus.OK)
  async getInsurancePreview(
    @Body(new ZodValidationPipe(insurancePreviewSchema)) body: any,
  ) {
    return this.billingService.getInsurancePreview(body);
  }

  @Post('invoice')
  @PolicyRoles('ADMIN', 'RECEPTIONIST')
  async createInvoice(
    @Body() body: any,
    @CurrentUser() user: any,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.billingService.createInvoice(body, user, req.ip || 'unknown');
    res.status(result.existing ? HttpStatus.OK : HttpStatus.CREATED);
    return result;
  }

  @Post('invoice/:id/payments')
  @PolicyRoles('ADMIN', 'RECEPTIONIST', 'PHARMACIST')
  @HttpCode(HttpStatus.OK)
  async recordPayment(
    @Param(new ZodValidationPipe(paymentInvoiceParamsSchema)) params: { id: string },
    @Body(new ZodValidationPipe(paymentRequestSchema)) body: any,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    const idempotencyKey = req.get('Idempotency-Key')?.trim() || '';
    return this.billingService.recordPayment(params.id, body, user, req.ip || 'unknown', idempotencyKey);
  }

  @Post('invoice/:id/refund')
  @PolicyRoles('ADMIN', 'RECEPTIONIST')
  @HttpCode(HttpStatus.CREATED)
  async processRefund(
    @Param(new ZodValidationPipe(paymentInvoiceParamsSchema)) params: { id: string },
    @Body() body: any,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.billingService.processRefund(params.id, body, user, req.ip || 'unknown');
  }

  @Get('lab-orders/pending')
  @PolicyRoles('ADMIN', 'RECEPTIONIST')
  @HttpCode(HttpStatus.OK)
  async getPendingLabOrdersQueue() {
    return this.billingService.getPendingLabOrdersQueue();
  }

  @Get('prescriptions/pending')
  @PolicyRoles('ADMIN', 'RECEPTIONIST')
  @HttpCode(HttpStatus.OK)
  async getPendingPrescriptionsQueue() {
    return this.billingService.getPendingPrescriptionsQueue();
  }

  @Post('shift/reconcile')
  @PolicyRoles('ADMIN', 'RECEPTIONIST')
  @HttpCode(HttpStatus.OK)
  async reconcileShift(
    @Body() body: any,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.billingService.reconcileShift(body, user, req.ip || 'unknown');
  }

  @Get('payment-methods')
  @PolicyRoles('ADMIN', 'RECEPTIONIST', 'PHARMACIST')
  @HttpCode(HttpStatus.OK)
  async getPaymentMethods() {
    return this.billingService.getPaymentMethods();
  }

  @Get('services')
  @Public()
  @HttpCode(HttpStatus.OK)
  async getServices() {
    return this.billingService.getClinicalServices();
  }

  @Get('insurance-companies')
  @PolicyRoles('ADMIN', 'RECEPTIONIST')
  @HttpCode(HttpStatus.OK)
  async getInsuranceCompanies() {
    return this.billingService.getInsuranceCompanies();
  }

  @Get('analytics')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.OK)
  async getAnalytics() {
    return this.billingService.getAnalytics();
  }
}
