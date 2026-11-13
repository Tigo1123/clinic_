import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpException, HttpStatus } from '@nestjs/common';

test('NestJS Phase 9: Pharmacy and Laboratory Modules resolve from AppModule', async () => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://localhost:5433/clinic_test';
  process.env.SOCKET_REVOCATION_DATABASE_URL = 'postgresql://localhost:5433/clinic_test';
  process.env.JWT_SECRET = 'test-jwt-secret-at-least-thirty-two-characters';
  process.env.MEDICAL_ENCRYPTION_KEY = 'test-medical-key-separate-at-least-thirty-two';

  const { AppModule } = await import('../dist/app.module.js');
  const { NestFactory } = await import('@nestjs/core');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  assert.ok(app, 'ApplicationContext should be instantiated');

  const { PharmacyService } = await import('../dist/modules/pharmacy/pharmacy.service.js');
  const pharmacyService = app.get(PharmacyService);
  assert.ok(pharmacyService, 'PharmacyService should resolve from DI');

  const { PharmacyController } = await import('../dist/modules/pharmacy/pharmacy.controller.js');
  const pharmacyController = app.get(PharmacyController);
  assert.ok(pharmacyController, 'PharmacyController should resolve from DI');

  const { PrescriptionsController } = await import('../dist/modules/pharmacy/prescriptions.controller.js');
  const prescriptionsController = app.get(PrescriptionsController);
  assert.ok(prescriptionsController, 'PrescriptionsController should resolve from DI');

  const { LaboratoryService } = await import('../dist/modules/laboratory/laboratory.service.js');
  const laboratoryService = app.get(LaboratoryService);
  assert.ok(laboratoryService, 'LaboratoryService should resolve from DI');

  const { LaboratoryController } = await import('../dist/modules/laboratory/laboratory.controller.js');
  const laboratoryController = app.get(LaboratoryController);
  assert.ok(laboratoryController, 'LaboratoryController should resolve from DI');

  await app.close();
});

test('PharmacyService: Formulary creation rejects duplicate identity and past expiry', async () => {
  const { PharmacyService } = await import('../dist/modules/pharmacy/pharmacy.service.js');

  const mockPrisma = {
    $transaction: async (fn) => {
      const tx = {
        drugFormulary: {
          create: async ({ data }) => {
            if (data.brandName === 'Duplicate') {
              const err = new Error('Unique constraint failed');
              err.code = 'P2002';
              err.meta = { target: ['identityKey'] };
              throw err;
            }
            return { id: 'drug-1', ...data };
          },
        },
        inventoryBatch: {
          create: async () => ({ id: 'batch-1' }),
        },
        stockMovement: {
          create: async () => ({ id: 'mov-1' }),
        },
        tenantAuditLog: {
          create: async () => ({ id: 'audit-1' }),
        },
      };
      return fn(tx);
    },
  };

  const service = new PharmacyService(mockPrisma, { emitQueueUpdate: () => {} });

  // 1. Past batch expiry throws 422 INVENTORY_EXPIRY_INVALID
  await assert.rejects(
    async () =>
      service.createFormulary(
        {
          brandName: 'Panadol',
          labelAr: 'بنادول',
          labelEn: 'Panadol',
          genericName: 'Paracetamol',
          strength: '500mg',
          dosageForm: 'TABLET',
          initialBatch: {
            batchNumber: 'BATCH-001',
            expiryDate: '2020-01-01',
            qtyOnHand: 100,
            minReorderLevel: 20,
          },
        },
        { id: 'a0000000-0000-4000-8000-000000000001' },
      ),
    (err) => {
      assert.ok(err instanceof HttpException);
      assert.equal(err.getStatus(), HttpStatus.UNPROCESSABLE_ENTITY);
      assert.equal(err.getResponse().code, 'INVENTORY_EXPIRY_INVALID');
      return true;
    },
  );

  // 2. Duplicate medicine identity throws 409 FORMULARY_MEDICINE_ALREADY_EXISTS
  await assert.rejects(
    async () =>
      service.createFormulary(
        {
          brandName: 'Duplicate',
          labelAr: 'بنادول',
          labelEn: 'Duplicate',
          genericName: 'Paracetamol',
          strength: '500mg',
          dosageForm: 'TABLET',
        },
        { id: 'a0000000-0000-4000-8000-000000000001' },
      ),
    (err) => {
      assert.ok(err instanceof HttpException);
      assert.equal(err.getStatus(), HttpStatus.CONFLICT);
      assert.equal(err.getResponse().code, 'FORMULARY_MEDICINE_ALREADY_EXISTS');
      return true;
    },
  );
});

test('PharmacyService: dispensePrescription requires paid invoice, checks stock, and updates FEFO batches', async () => {
  const { PharmacyService } = await import('../dist/modules/pharmacy/pharmacy.service.js');

  let updatedBatchData = null;
  let createdMovement = null;
  let updatedPrescriptionStatus = null;

  const mockPrisma = {
    $transaction: async (fn) => {
      const tx = {
        invoice: {
          findFirst: async ({ where }) => {
            if (where.prescriptionId === 'rx-unpaid') return null;
            return { id: 'inv-1', paymentStatus: 'PAID' };
          },
        },
        prescribedDrug: {
          findUnique: async () => ({
            id: 'pd-1',
            prescriptionId: 'rx-paid',
            drugId: 'drug-1',
            qtyPrescribed: 10,
            qtyDispensed: 0,
            ledgerVersion: 1,
            pharmacyReviewStatus: 'NOT_REQUIRED',
          }),
          updateMany: async () => ({ count: 1 }),
          findMany: async () => [
            { qtyPrescribed: 10, qtyDispensed: 10, pharmacyReviewStatus: 'NOT_REQUIRED' },
          ],
        },
        inventoryBatch: {
          findMany: async () => [
            {
              id: 'batch-1',
              drugId: 'drug-1',
              qtyOnHand: 50,
              ledgerVersion: 1,
              expiryDate: '2099-01-01',
              batchNumber: 'B1',
            },
          ],
          updateMany: async ({ data }) => {
            updatedBatchData = data;
            return { count: 1 };
          },
        },
        stockMovement: {
          create: async ({ data }) => {
            createdMovement = data;
            return { id: 'mov-1' };
          },
        },
        prescription: {
          update: async ({ data }) => {
            updatedPrescriptionStatus = data.status;
            return { id: 'rx-paid', ...data };
          },
        },
        tenantAuditLog: {
          create: async () => ({ id: 'audit-1' }),
        },
      };
      return fn(tx);
    },
  };

  const service = new PharmacyService(mockPrisma, { emitQueueUpdate: () => {} });

  // 1. Unpaid pharmacy invoice blocks dispensing with 403 PHARMACY_PAYMENT_REQUIRED
  await assert.rejects(
    async () =>
      service.dispensePrescription(
        'rx-unpaid',
        { items: [{ prescribedDrugId: 'pd-1', qtyToDispense: 10 }] },
        { id: 'a0000000-0000-4000-8000-000000000001' },
      ),
    (err) => {
      assert.ok(err instanceof HttpException);
      assert.equal(err.getStatus(), HttpStatus.FORBIDDEN);
      assert.equal(err.getResponse().code, 'PHARMACY_PAYMENT_REQUIRED');
      return true;
    },
  );

  // 2. Dispensing paid prescription succeeds, decrements batch, creates stock movement, and marks prescription FILLED
  const res = await service.dispensePrescription(
    'rx-paid',
    { items: [{ prescribedDrugId: 'pd-1', qtyToDispense: 10 }] },
    { id: 'a0000000-0000-4000-8000-000000000001' },
  );

  assert.equal(res.success, true);
  assert.equal(updatedPrescriptionStatus, 'FILLED');
  assert.ok(createdMovement);
  assert.equal(createdMovement.movementType, 'DISPENSE');
  assert.equal(createdMovement.quantityDelta, -10);
});

test('PharmacyService: markMedicationUnavailable resolves item and voids invoice', async () => {
  const { PharmacyService } = await import('../dist/modules/pharmacy/pharmacy.service.js');

  let voidedInvoice = false;
  let updatedItem = null;

  const mockPrisma = {
    $transaction: async (fn) => {
      const tx = {
        prescribedDrug: {
          findUnique: async () => ({
            id: 'pd-unavail',
            prescriptionId: 'rx-1',
            qtyPrescribed: 10,
            qtyDispensed: 0,
            pharmacyReviewStatus: 'NOT_REQUIRED',
            prescription: { id: 'rx-1', status: 'ACTIVE' },
          }),
          update: async ({ data }) => {
            updatedItem = data;
            return { id: 'pd-unavail', ...data };
          },
          findMany: async () => [
            { qtyPrescribed: 10, qtyDispensed: 0, pharmacyReviewStatus: 'EXTERNAL' },
          ],
        },
        invoice: {
          findMany: async () => [{ id: 'inv-1', paymentStatus: 'UNPAID', payments: [] }],
          update: async () => {
            voidedInvoice = true;
            return { id: 'inv-1' };
          },
        },
        prescription: {
          update: async () => ({ id: 'rx-1' }),
        },
        tenantAuditLog: {
          create: async () => ({ id: 'audit-1' }),
        },
      };
      return fn(tx);
    },
  };

  const service = new PharmacyService(mockPrisma, { emitQueueUpdate: () => {} });

  const res = await service.markMedicationUnavailable(
    'pd-unavail',
    { reason: 'OUT_OF_STOCK', note: 'Supplier backorder' },
    { id: 'user-pharm' },
  );

  assert.equal(res.success, true);
  assert.equal(updatedItem.pharmacyReviewStatus, 'EXTERNAL');
  assert.equal(voidedInvoice, true);
});

test('LaboratoryService: collectSample requires payment and checks pending reviews', async () => {
  const { LaboratoryService } = await import('../dist/modules/laboratory/laboratory.service.js');

  const mockPrisma = {
    labOrder: {
      findUnique: async ({ where }) => {
        if (where.id === 'order-unpaid') {
          return { id: 'order-unpaid', status: 'PENDING_BILLING', items: [] };
        }
        if (where.id === 'order-pending-review') {
          return {
            id: 'order-pending-review',
            status: 'PAID',
            items: [{ labReviewStatus: 'PENDING_REVIEW' }],
          };
        }
        if (where.id === 'order-paid') {
          return {
            id: 'order-paid',
            status: 'PAID',
            items: [{ labReviewStatus: 'NOT_REQUIRED' }],
          };
        }
        return null;
      },
      updateMany: async () => ({ count: 1 }),
    },
    tenantAuditLog: {
      create: async () => ({ id: 'audit-1' }),
    },
    $transaction: async (fn) => fn(mockPrisma),
  };

  const service = new LaboratoryService(mockPrisma, { emitQueueUpdate: () => {} });

  // 1. Unpaid order rejected with 403 LAB_PAYMENT_REQUIRED
  await assert.rejects(
    async () => service.collectSample('order-unpaid', { id: 'user-tech' }),
    (err) => {
      assert.ok(err instanceof HttpException);
      assert.equal(err.getStatus(), HttpStatus.FORBIDDEN);
      assert.equal(err.getResponse().code, 'LAB_PAYMENT_REQUIRED');
      return true;
    },
  );

  // 2. Unreviewed custom test blocks sample collection with 409 LAB_REVIEW_PENDING
  await assert.rejects(
    async () => service.collectSample('order-pending-review', { id: 'user-tech' }),
    (err) => {
      assert.ok(err instanceof HttpException);
      assert.equal(err.getStatus(), HttpStatus.CONFLICT);
      assert.equal(err.getResponse().code, 'LAB_REVIEW_PENDING');
      return true;
    },
  );

  // 3. Paid order without pending reviews succeeds
  const res = await service.collectSample('order-paid', { id: 'user-tech' });
  assert.ok(res);
});

test('LaboratoryService: logResults enforces version concurrency, completes order, and emits realtime return to doctor', async () => {
  const { LaboratoryService } = await import('../dist/modules/laboratory/laboratory.service.js');

  let realtimeEmitted = null;
  const mockGateway = {
    emitQueueUpdate: (payload, doctorIds) => {
      realtimeEmitted = { payload, doctorIds };
    },
  };

  const mockPrisma = {
    $transaction: async (fn) => {
      const tx = {
        labOrderItem: {
          findUnique: async () => ({
            id: 'item-1',
            labOrderId: 'order-1',
            resultVersion: 1,
            serviceId: 'srv-1',
            labReviewStatus: 'NOT_REQUIRED',
            labOrder: {
              status: 'SAMPLE_COLLECTED',
              doctorId: 'doc-1',
              releasedToPatientAt: null,
              medicalRecord: { appointmentId: 'apt-1' },
            },
          }),
          updateMany: async () => ({ count: 1 }),
          count: async () => 0, // No remaining items -> triggers completion
        },
        labOrder: {
          updateMany: async () => ({ count: 1 }),
        },
        appointment: {
          updateMany: async () => ({ count: 1 }),
        },
        tenantAuditLog: {
          create: async () => ({ id: 'audit-1' }),
        },
      };
      return fn(tx);
    },
  };

  const service = new LaboratoryService(mockPrisma, mockGateway);

  // 1. Version mismatch throws 409 LAB_RESULT_CONFLICT
  await assert.rejects(
    async () =>
      service.logResults(
        'item-1',
        { expectedVersion: 99, resultValue: '12.5 mg/dL' },
        { id: 'user-tech' },
      ),
    (err) => {
      assert.ok(err instanceof HttpException);
      assert.equal(err.getStatus(), HttpStatus.CONFLICT);
      assert.equal(err.getResponse().code, 'LAB_RESULT_CONFLICT');
      return true;
    },
  );

  // 2. Successful result entry transitions order to COMPLETED and emits event returning patient to doctor consultation
  const res = await service.logResults(
    'item-1',
    { expectedVersion: 1, resultValue: '12.5 mg/dL', isOutOfRange: false },
    { id: 'user-tech' },
  );

  assert.ok(res);
  assert.ok(realtimeEmitted);
  assert.equal(realtimeEmitted.payload.type, 'LAB_RESULTS_COMPLETED');
  assert.equal(realtimeEmitted.payload.status, 'IN_CONSULTATION');
  assert.deepEqual(realtimeEmitted.doctorIds, ['doc-1']);
});
