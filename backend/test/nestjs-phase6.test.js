import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpException, HttpStatus } from '@nestjs/common';

test('NestJS Phase 6: PatientAuth, Patients, and PatientPortal Modules resolve from AppModule', async () => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://localhost:5433/clinic_test';
  process.env.SOCKET_REVOCATION_DATABASE_URL = 'postgresql://localhost:5433/clinic_test';
  process.env.JWT_SECRET = 'test-jwt-secret-at-least-thirty-two-characters';
  process.env.MEDICAL_ENCRYPTION_KEY = 'test-medical-key-separate-at-least-thirty-two';

  const { AppModule } = await import('../dist/app.module.js');
  const { NestFactory } = await import('@nestjs/core');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  assert.ok(app, 'ApplicationContext should be instantiated');

  const { PatientAuthService } = await import('../dist/modules/patient-auth/patient-auth.service.js');
  const patientAuthService = app.get(PatientAuthService);
  assert.ok(patientAuthService, 'PatientAuthService should resolve from DI');

  const { PatientAuthController } = await import('../dist/modules/patient-auth/patient-auth.controller.js');
  const patientAuthController = app.get(PatientAuthController);
  assert.ok(patientAuthController, 'PatientAuthController should resolve from DI');

  const { PatientsService } = await import('../dist/modules/patients/patients.service.js');
  const patientsService = app.get(PatientsService);
  assert.ok(patientsService, 'PatientsService should resolve from DI');

  const { PatientsController } = await import('../dist/modules/patients/patients.controller.js');
  const patientsController = app.get(PatientsController);
  assert.ok(patientsController, 'PatientsController should resolve from DI');

  const { PatientPortalService } = await import('../dist/modules/patient-portal/patient-portal.service.js');
  const patientPortalService = app.get(PatientPortalService);
  assert.ok(patientPortalService, 'PatientPortalService should resolve from DI');

  const { PatientPortalController } = await import('../dist/modules/patient-portal/patient-portal.controller.js');
  const patientPortalController = app.get(PatientPortalController);
  assert.ok(patientPortalController, 'PatientPortalController should resolve from DI');

  await app.close();
});

test('PatientsService: create validates past DOB, detects duplicates, and generates fileNumber', async () => {
  const { PatientsService } = await import('../dist/modules/patients/patients.service.js');

  let createdPatientData = null;
  let auditLog = null;
  const mockPrisma = {
    $transaction: async (fn) => {
      const tx = {
        $queryRaw: async () => [{ locked: true }],
        patient: {
          findMany: async () => [], // No duplicate candidates
          create: async ({ data }) => {
            createdPatientData = data;
            return {
              id: 'patient-new-1',
              fileNumber: 'SHF-000123',
              ...data,
              addressState: { id: 1, labelAr: 'الخرطوم', labelEn: 'Khartoum' },
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

  const service = new PatientsService(mockPrisma);

  // 1. Future date of birth throws 422 INVALID_DATE_OF_BIRTH
  await assert.rejects(
    async () =>
      service.create(
        {
          gender: 'MALE',
          dateOfBirth: '2099-01-01',
          phone: '+249912345678',
          addressStateId: 1,
          firstNameAr: 'محمد',
          fatherNameAr: 'أحمد',
          grandfatherNameAr: 'علي',
          familyNameAr: 'عثمان',
          firstNameEn: 'Mohamed',
          fatherNameEn: 'Ahmed',
          grandfatherNameEn: 'Ali',
          familyNameEn: 'Osman',
        },
        'receptionist-1',
      ),
    (err) => {
      assert.ok(err instanceof HttpException);
      assert.equal(err.getStatus(), HttpStatus.UNPROCESSABLE_ENTITY);
      assert.equal(err.getResponse().code, 'INVALID_DATE_OF_BIRTH');
      return true;
    },
  );

  // 2. Successful creation generates fileNumber and logs audit
  const result = await service.create(
    {
      gender: 'MALE',
      dateOfBirth: '1995-05-15',
      phone: '+249912345678',
      addressStateId: 1,
      firstNameAr: 'محمد',
      fatherNameAr: 'أحمد',
      grandfatherNameAr: 'علي',
      familyNameAr: 'عثمان',
      firstNameEn: 'Mohamed',
      fatherNameEn: 'Ahmed',
      grandfatherNameEn: 'Ali',
      familyNameEn: 'Osman',
    },
    'receptionist-1',
    '127.0.0.1',
  );

  assert.equal(result.id, 'patient-new-1');
  assert.equal(result.fileNumber, 'SHF-000123');
  assert.equal(createdPatientData.gender, 'MALE');
  assert.equal(auditLog.action, 'PATIENT_FILE_CREATED');
});

test('PatientPortalService: getMe throws 409 if unlinked, returns profile with Google link info', async () => {
  const { PatientPortalService } = await import('../dist/modules/patient-portal/patient-portal.service.js');

  const mockPrisma = {
    patient: {
      findUnique: async ({ where }) => {
        if (where.userId === 'user-unlinked') return null;
        return {
          id: 'patient-1',
          userId: 'user-linked',
          fileNumber: 'SHF-000001',
          fullNameAr: 'محمد أحمد',
          fullNameEn: 'Mohamed Ahmed',
          gender: 'MALE',
          dateOfBirth: '1990-01-01',
          addressStateId: 1,
          emergencyContact: 'Self',
          bloodType: 'O+',
        };
      },
    },
    user: {
      findUnique: async () => ({
        email: 'patient@clinic.test',
        phoneNormalized: '+249912345678',
        emailVerifiedAt: new Date('2026-01-01'),
        phoneVerifiedAt: new Date('2026-01-01'),
        preferredLanguage: 'ar',
        externalIdentities: [
          { normalizedEmailAtLink: 'patient@gmail.com', createdAt: new Date('2026-01-01') },
        ],
      }),
    },
  };

  const service = new PatientPortalService(mockPrisma);

  // 1. Unlinked user throws 409 PATIENT_RECORD_NOT_LINKED
  await assert.rejects(
    async () => service.getMe('user-unlinked'),
    (err) => {
      assert.ok(err instanceof HttpException);
      assert.equal(err.getStatus(), HttpStatus.CONFLICT);
      assert.equal(err.getResponse().code, 'PATIENT_RECORD_NOT_LINKED');
      return true;
    },
  );

  // 2. Linked user returns complete profile
  const me = await service.getMe('user-linked');
  assert.equal(me.id, 'patient-1');
  assert.equal(me.fileNumber, 'SHF-000001');
  assert.equal(me.googleAccount.linked, true);
  assert.equal(me.googleAccount.email, 'patient@gmail.com');
});

test('PatientAuthService: issueClaimCode generates valid claim code', async () => {
  const { PatientAuthService } = await import('../dist/modules/patient-auth/patient-auth.service.js');

  let claimRecord = null;
  let auditLog = null;
  const mockPrisma = {
    patient: {
      findUnique: async ({ where }) => {
        if (where.id === 'patient-claimed') return { id: 'patient-claimed', userId: 'user-1' };
        if (where.id === 'patient-missing') return null;
        return { id: 'patient-unclaimed', userId: null };
      },
    },
    $transaction: async (fn) => {
      const tx = {
        patientClaimCode: {
          updateMany: async () => ({ count: 0 }),
          create: async ({ data }) => {
            claimRecord = data;
            return { id: 'claim-1', ...data };
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

  const service = new PatientAuthService(mockPrisma);

  // 1. Already claimed patient throws 409 PATIENT_ALREADY_CLAIMED
  await assert.rejects(
    async () => service.issueClaimCode('patient-claimed', { id: 'admin-1', av: 1 }),
    (err) => {
      assert.ok(err instanceof HttpException);
      assert.equal(err.getStatus(), HttpStatus.CONFLICT);
      assert.equal(err.getResponse().code, 'PATIENT_ALREADY_CLAIMED');
      return true;
    },
  );

  // 2. Unclaimed patient generates claim code
  const result = await service.issueClaimCode('patient-unclaimed', { id: 'admin-1', av: 1 }, '127.0.0.1');
  assert.ok(result.code);
  assert.equal(result.expiresInMinutes, 30);
  assert.match(result.code, /^[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{32}$/);
  assert.equal(auditLog.action, 'PATIENT_CLAIM_CODE_ISSUED');
});
