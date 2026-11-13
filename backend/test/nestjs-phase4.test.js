import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpException, HttpStatus } from '@nestjs/common';

test('NestJS Phase 4: Catalogs and Specialties Modules resolve from AppModule', async () => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://localhost:5433/clinic_test';
  process.env.SOCKET_REVOCATION_DATABASE_URL = 'postgresql://localhost:5433/clinic_test';
  process.env.JWT_SECRET = 'test-jwt-secret-at-least-thirty-two-characters';
  process.env.MEDICAL_ENCRYPTION_KEY = 'test-medical-key-separate-at-least-thirty-two';

  const { AppModule } = await import('../dist/app.module.js');
  const { NestFactory } = await import('@nestjs/core');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  assert.ok(app, 'ApplicationContext should be instantiated');

  const { SpecialtiesService } = await import('../dist/modules/specialties/specialties.service.js');
  const specialtiesService = app.get(SpecialtiesService);
  assert.ok(specialtiesService, 'SpecialtiesService should resolve from DI');

  const { SpecialtiesController } = await import('../dist/modules/specialties/specialties.controller.js');
  const specialtiesController = app.get(SpecialtiesController);
  assert.ok(specialtiesController, 'SpecialtiesController should resolve from DI');

  const { CatalogsService } = await import('../dist/modules/catalogs/catalogs.service.js');
  const catalogsService = app.get(CatalogsService);
  assert.ok(catalogsService, 'CatalogsService should resolve from DI');

  const { CatalogsController } = await import('../dist/modules/catalogs/catalogs.controller.js');
  const catalogsController = app.get(CatalogsController);
  assert.ok(catalogsController, 'CatalogsController should resolve from DI');

  await app.close();
});

test('SpecialtiesService: create asserts unique names and handles duplicate code', async () => {
  const { SpecialtiesService } = await import('../dist/modules/specialties/specialties.service.js');

  let lockedKey = '';
  const mockPrisma = {
    $transaction: async (fn) => {
      const tx = {
        $queryRaw: async (strings, ...values) => {
          lockedKey = values[0];
          return [{ locked: true }];
        },
        specialty: {
          findMany: async () => [{ nameAr: 'طب الأطفال', nameEn: 'Pediatrics' }],
          create: async ({ data, select }) => ({ id: 'new-spec-id', ...data }),
        },
        tenantAuditLog: {
          create: async () => ({ id: 'audit-1' }),
        },
      };
      return fn(tx);
    },
  };

  const service = new SpecialtiesService(mockPrisma);

  // 1. Should reject duplicate normalized name
  await assert.rejects(
    async () => {
      await service.create(
        { code: 'pediatrics-2', nameAr: '  طب الأطفال  ', nameEn: 'pediatrics' },
        'user-1',
        '127.0.0.1',
      );
    },
    (err) => {
      assert.ok(err instanceof HttpException);
      assert.equal(err.getStatus(), HttpStatus.CONFLICT);
      const res = err.getResponse();
      assert.equal(res.code, 'SPECIALTY_NAME_EXISTS');
      return true;
    },
  );

  // 2. Should handle Prisma P2002 error with SPECIALTY_CODE_EXISTS
  const mockPrismaDuplicateCode = {
    $transaction: async (fn) => {
      const tx = {
        $queryRaw: async () => [{ locked: true }],
        specialty: {
          findMany: async () => [],
          create: async () => {
            const err = new Error('Unique constraint');
            err.code = 'P2002';
            throw err;
          },
        },
      };
      return fn(tx);
    },
  };

  const serviceDuplicateCode = new SpecialtiesService(mockPrismaDuplicateCode);
  await assert.rejects(
    async () => {
      await serviceDuplicateCode.create(
        { code: 'cardio', nameAr: 'طب القلب', nameEn: 'Cardiology' },
        'user-1',
      );
    },
    (err) => {
      assert.ok(err instanceof HttpException);
      assert.equal(err.getStatus(), HttpStatus.CONFLICT);
      assert.equal(err.getResponse().code, 'SPECIALTY_CODE_EXISTS');
      return true;
    },
  );
});

test('SpecialtiesService: delete enforces protection and doctor references', async () => {
  const { SpecialtiesService } = await import('../dist/modules/specialties/specialties.service.js');

  // Test 1: Deletion protected specialty throws SPECIALTY_REFERENCED
  const mockProtected = {
    $transaction: async (fn) => {
      const tx = {
        $queryRaw: async () => [{ locked: true }],
        specialty: {
          findUnique: async () => ({
            id: 'spec-1',
            nameEn: 'General',
            nameAr: 'عام',
            deletionProtected: true,
          }),
        },
        doctor: {
          findFirst: async () => null,
        },
      };
      return fn(tx);
    },
  };

  const serviceProtected = new SpecialtiesService(mockProtected);
  await assert.rejects(
    async () => {
      await serviceProtected.delete('spec-1', 'admin-1');
    },
    (err) => {
      assert.ok(err instanceof HttpException);
      assert.equal(err.getStatus(), HttpStatus.CONFLICT);
      assert.equal(err.getResponse().code, 'SPECIALTY_REFERENCED');
      return true;
    },
  );

  // Test 2: Missing specialty throws SPECIALTY_NOT_FOUND (404)
  const mockMissing = {
    $transaction: async (fn) => {
      const tx = {
        $queryRaw: async () => [{ locked: true }],
        specialty: {
          findUnique: async () => null,
        },
      };
      return fn(tx);
    },
  };

  const serviceMissing = new SpecialtiesService(mockMissing);
  await assert.rejects(
    async () => {
      await serviceMissing.delete('non-existent-id', 'admin-1');
    },
    (err) => {
      assert.ok(err instanceof HttpException);
      assert.equal(err.getStatus(), HttpStatus.NOT_FOUND);
      assert.equal(err.getResponse().code, 'SPECIALTY_NOT_FOUND');
      return true;
    },
  );

  // Test 3: Specialty with assigned doctor throws SPECIALTY_REFERENCED (409)
  const mockWithDoctor = {
    $transaction: async (fn) => {
      const tx = {
        $queryRaw: async () => [{ locked: true }],
        specialty: {
          findUnique: async () => ({
            id: 'spec-2',
            nameEn: 'Surgery',
            nameAr: 'جراحة',
            deletionProtected: false,
          }),
        },
        doctor: {
          findFirst: async () => ({ id: 'doc-1' }),
        },
      };
      return fn(tx);
    },
  };

  const serviceWithDoctor = new SpecialtiesService(mockWithDoctor);
  await assert.rejects(
    async () => {
      await serviceWithDoctor.delete('spec-2', 'admin-1');
    },
    (err) => {
      assert.ok(err instanceof HttpException);
      assert.equal(err.getStatus(), HttpStatus.CONFLICT);
      assert.equal(err.getResponse().code, 'SPECIALTY_REFERENCED');
      return true;
    },
  );
});

test('CatalogsService: createService validates uniqueness and computes USD price', async () => {
  const { CatalogsService } = await import('../dist/modules/catalogs/catalogs.service.js');

  let createdData = null;
  let auditLog = null;
  const mockPrisma = {
    $transaction: async (fn) => {
      const tx = {
        $queryRaw: async () => [{ locked: true }],
        clinicalService: {
          findMany: async () => [],
          create: async ({ data }) => {
            createdData = data;
            return {
              id: 'svc-1',
              code: data.code,
              labelAr: data.labelAr,
              labelEn: data.labelEn,
              category: data.category,
              status: data.status,
              baseFeeSdg: data.baseFeeSdg,
              updatedAt: new Date('2026-01-01'),
            };
          },
        },
        tenantAuditLog: {
          create: async ({ data }) => {
            auditLog = data;
            return { id: 'audit-1' };
          },
        },
      };
      return fn(tx);
    },
  };

  const service = new CatalogsService(mockPrisma);
  const result = await service.createService(
    {
      code: 'cbc-test',
      labelAr: 'فحص دم كامل',
      labelEn: 'Complete Blood Count',
      category: 'LABORATORY',
      priceSdg: '15000',
      status: 'ACTIVE',
    },
    'admin-1',
    '127.0.0.1',
  );

  assert.equal(result.id, 'svc-1');
  assert.equal(result.code, 'cbc-test');
  assert.equal(result.priceSdg, '15000');
  assert.equal(createdData.baseFeeSdg.toString(), '15000');
  assert.equal(createdData.baseFeeUsd.toString(), '10'); // 15000 / 1500 = 10
  assert.equal(auditLog.action, 'CATALOG_SERVICE_CREATED');
});

test('CatalogsService: updateService requires price for ACTIVE service', async () => {
  const { CatalogsService } = await import('../dist/modules/catalogs/catalogs.service.js');

  const mockPrisma = {
    $transaction: async (fn) => {
      const tx = {
        $queryRaw: async () => [{ locked: true }],
        clinicalService: {
          findMany: async () => [],
          findUniqueOrThrow: async () => ({
            id: 'svc-inactive',
            code: 'test-svc',
            labelAr: 'خدمة',
            labelEn: 'Service',
            category: 'CLINICAL_PROCEDURE',
            status: 'INACTIVE',
            baseFeeSdg: null,
          }),
        },
      };
      return fn(tx);
    },
  };

  const service = new CatalogsService(mockPrisma);

  // Activating service without price should throw 422 CATALOG_PRICE_REQUIRED
  await assert.rejects(
    async () => {
      await service.updateService(
        'svc-inactive',
        { status: 'ACTIVE' },
        'admin-1',
      );
    },
    (err) => {
      assert.ok(err instanceof HttpException);
      assert.equal(err.getStatus(), HttpStatus.UNPROCESSABLE_ENTITY); // 422
      assert.equal(err.getResponse().code, 'CATALOG_PRICE_REQUIRED');
      return true;
    },
  );
});

test('CatalogsService: payment methods list and update', async () => {
  const { CatalogsService } = await import('../dist/modules/catalogs/catalogs.service.js');

  let updatedRow = null;
  let auditRow = null;
  const mockPrisma = {
    paymentMethod: {
      findMany: async () => [
        { code: 'BANKAK', labelAr: 'بنكك', labelEn: 'Bankak', active: true },
        { code: 'CASH', labelAr: 'نقداً', labelEn: 'Cash', active: true },
      ],
    },
    $transaction: async (fn) => {
      const tx = {
        $queryRaw: async () => [{ locked: true }],
        paymentMethod: {
          update: async ({ where, data }) => {
            updatedRow = { code: where.code, ...data };
            return updatedRow;
          },
        },
        tenantAuditLog: {
          create: async ({ data }) => {
            auditRow = data;
            return { id: 'audit-pm' };
          },
        },
      };
      return fn(tx);
    },
  };

  const service = new CatalogsService(mockPrisma);
  const list = await service.listPaymentMethods();
  assert.equal(list.length, 2);
  assert.equal(list[0].code, 'BANKAK');

  const updated = await service.updatePaymentMethod(
    'CASH',
    { active: false },
    'admin-1',
    '10.0.0.1',
  );
  assert.equal(updated.code, 'CASH');
  assert.equal(updated.active, false);
  assert.equal(auditRow.action, 'PAYMENT_METHOD_CONFIGURED');
});
