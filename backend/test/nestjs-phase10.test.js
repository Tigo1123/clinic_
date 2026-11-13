import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpException, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

test('NestJS Phase 10: BillingModule and BillingController resolve from AppModule', async () => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://localhost:5433/clinic_test';
  process.env.SOCKET_REVOCATION_DATABASE_URL = 'postgresql://localhost:5433/clinic_test';
  process.env.JWT_SECRET = 'test-jwt-secret-at-least-thirty-two-characters';
  process.env.MEDICAL_ENCRYPTION_KEY = 'test-medical-key-separate-at-least-thirty-two';

  const { AppModule } = await import('../dist/app.module.js');
  const { NestFactory } = await import('@nestjs/core');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  assert.ok(app, 'ApplicationContext should be instantiated');

  const { BillingService } = await import('../dist/modules/billing/billing.service.js');
  const billingService = app.get(BillingService);
  assert.ok(billingService, 'BillingService should resolve from DI');

  const { BillingController } = await import('../dist/modules/billing/billing.controller.js');
  const billingController = app.get(BillingController);
  assert.ok(billingController, 'BillingController should resolve from DI');

  await app.close();
});

test('BillingController: Crucial invariant GET /api/billing/services is @Public()', async () => {
  const { BillingController } = await import('../dist/modules/billing/billing.controller.js');
  const { IS_PUBLIC_KEY } = await import('../dist/common/decorators/public.decorator.js');

  const reflector = new Reflector();
  const isPublic = reflector.get(IS_PUBLIC_KEY, BillingController.prototype.getServices);
  assert.equal(isPublic, true, 'GET /api/billing/services must be decorated with @Public()');
});

test('BillingService: Insurance preview calculates patient share with exact basis points', async () => {
  const { BillingService } = await import('../dist/modules/billing/billing.service.js');

  const mockPrisma = {
    patient: {
      findUnique: async ({ where }) => {
        if (where.id === 'patient-1') return { id: 'patient-1', status: 'ACTIVE' };
        return null;
      },
    },
    appointment: {
      findUnique: async () => ({
        id: 'appt-1',
        patientId: 'patient-1',
        doctor: {
          status: 'ACTIVE',
          consultationFee: 5000,
        },
      }),
    },
    insuranceCompany: {
      findUnique: async () => ({
        id: 'ins-1',
        labelAr: 'شركة التأمين',
        labelEn: 'Insurance Co',
        copayPercentage: '20.00',
      }),
    },
  };

  const service = new BillingService(mockPrisma, { emitQueueUpdate: () => {} });

  const preview = await service.getInsurancePreview({
    patientId: 'patient-1',
    insuranceCompanyId: 'ins-1',
    invoiceType: 'CONSULTATION',
    appointmentId: 'appt-1',
  });

  // 5000 SDG consultation fee with 20% patient copay:
  // patientShare = 5000 * 0.20 = 1000 SDG
  // insuranceCoverage = 5000 - 1000 = 4000 SDG
  assert.equal(preview.grossTotalSdg, 5000);
  assert.equal(preview.patientShareSdg, 1000);
  assert.equal(preview.insuranceCoverageSdg, 4000);
  assert.equal(preview.copayPercentage, 20);
  assert.equal(preview.eligibilityModel, 'COMPANY_LEVEL_ONLY');
});

test('BillingService: Invoice generation rejects direct PHARMACY invoice creation and unsupported fields', async () => {
  const { BillingService } = await import('../dist/modules/billing/billing.service.js');

  const service = new BillingService({}, { emitQueueUpdate: () => {} });

  // 1. Direct PHARMACY invoice blocked (403 PHARMACY_INVOICE_SYSTEM_OWNED)
  await assert.rejects(
    async () =>
      service.createInvoice(
        { patientId: 'patient-1', invoiceType: 'PHARMACY' },
        { id: 'user-1' },
        '127.0.0.1',
      ),
    (err) => {
      assert.ok(err instanceof HttpException);
      assert.equal(err.getStatus(), HttpStatus.FORBIDDEN);
      assert.equal(err.getResponse().code, 'PHARMACY_INVOICE_SYSTEM_OWNED');
      return true;
    },
  );

  // 2. Unexpected fields rejected (422 INVOICE_FIELDS_INVALID)
  await assert.rejects(
    async () =>
      service.createInvoice(
        { patientId: 'patient-1', invoiceType: 'CONSULTATION', customInjectedField: 'hack' },
        { id: 'user-1' },
        '127.0.0.1',
      ),
    (err) => {
      assert.ok(err instanceof HttpException);
      assert.equal(err.getStatus(), HttpStatus.UNPROCESSABLE_ENTITY);
      assert.equal(err.getResponse().code, 'INVOICE_FIELDS_INVALID');
      return true;
    },
  );
});

test('BillingService: Payments enforce Idempotency-Key, role boundaries, and emit realtime update', async () => {
  const { BillingService } = await import('../dist/modules/billing/billing.service.js');

  let emittedPayload = null;
  const mockRealtime = {
    emitQueueUpdate: (payload) => {
      emittedPayload = payload;
    },
  };

  const invoiceRecord = {
    id: 'inv-1',
    patientId: 'patient-1',
    appointmentId: 'appt-1',
    invoiceType: 'CONSULTATION',
    totalAmountSdg: 5000,
    invoiceExchangeRate: 1500,
    paymentStatus: 'UNPAID',
    ledgerVersion: 0,
    payments: [],
    refunds: [],
    insuranceClaim: null,
  };

  const mockPrisma = {
    $transaction: async (fn) => {
      const tx = {
        $queryRaw: async () => [{ id: 'user-1' }],
        user: {
          findUnique: async () => ({
            id: 'user-1',
            role: 'RECEPTIONIST',
            status: 'ACTIVE',
            authVersion: 1,
          }),
        },
        invoice: {
          findUnique: async () => invoiceRecord,
          updateMany: async () => ({ count: 1 }),
          update: async ({ data }) => {
            Object.assign(invoiceRecord, data);
            return invoiceRecord;
          },
        },
        paymentOperation: {
          findUnique: async () => null,
          create: async ({ data }) => ({ id: 'op-1', ...data }),
        },
        paymentMethod: {
          count: async () => 1,
        },
        payment: {
          findUnique: async () => null,
          create: async ({ data }) => ({ id: 'pay-1', ...data }),
        },
        tenantAuditLog: {
          create: async () => ({ id: 'audit-1' }),
        },
      };
      return fn(tx);
    },
    paymentOperation: {
      findUnique: async () => null,
    },
    appointment: {
      findUnique: async () => ({ id: 'appt-1', doctorId: 'doc-1' }),
    },
  };

  const service = new BillingService(mockPrisma, mockRealtime);

  // 1. Missing or short idempotency key rejected (400 IDEMPOTENCY_KEY_REQUIRED)
  await assert.rejects(
    async () =>
      service.recordPayment(
        'inv-1',
        { payments: [{ amountSdg: 5000, paymentMethod: 'CASH' }] },
        { id: 'user-1', role: 'RECEPTIONIST', av: 1 },
        '127.0.0.1',
        'short',
      ),
    (err) => {
      assert.ok(err instanceof HttpException);
      assert.equal(err.getStatus(), HttpStatus.BAD_REQUEST);
      assert.equal(err.getResponse().code, 'IDEMPOTENCY_KEY_REQUIRED');
      return true;
    },
  );

  // 2. Successful payment transitions to PAID and emits queue event
  const result = await service.recordPayment(
    'inv-1',
    { payments: [{ amountSdg: 5000, paymentMethod: 'CASH' }] },
    { id: 'user-1', role: 'RECEPTIONIST', av: 1 },
    '127.0.0.1',
    'idemp-valid-key-12345',
  );

  assert.equal(result.paymentStatus, 'PAID');
  assert.equal(result.totalPaidSdg, 5000);
  assert.equal(result.remainingBalanceSdg, 0);

  assert.ok(emittedPayload);
  assert.equal(emittedPayload.type, 'CONSULTATION_PAYMENT_UPDATE');
  assert.equal(emittedPayload.appointmentId, 'appt-1');
  assert.equal(emittedPayload.paymentStatus, 'PAID');
});

test('BillingService: Refund is blocked if patient has entered consultation', async () => {
  const { BillingService } = await import('../dist/modules/billing/billing.service.js');

  const mockPrisma = {
    invoice: {
      findUnique: async () => ({
        id: 'inv-1',
        invoiceType: 'CONSULTATION',
        appointment: {
          status: 'IN_CONSULTATION',
        },
      }),
    },
    payment: { findUnique: async () => null },
    refund: { findUnique: async () => null },
  };

  const service = new BillingService(mockPrisma, { emitQueueUpdate: () => {} });

  await assert.rejects(
    async () =>
      service.processRefund(
        'inv-1',
        { amountSdg: 1000, refundMethod: 'CASH' },
        { id: 'user-1' },
        '127.0.0.1',
      ),
    (err) => {
      assert.ok(err instanceof HttpException);
      assert.equal(err.getStatus(), HttpStatus.FORBIDDEN);
      return true;
    },
  );
});

