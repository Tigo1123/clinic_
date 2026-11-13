import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpException, HttpStatus } from '@nestjs/common';
import bcrypt from 'bcryptjs';

test('NestJS Phase 5: Admin, Doctors, and Scheduling Modules resolve from AppModule', async () => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://localhost:5433/clinic_test';
  process.env.SOCKET_REVOCATION_DATABASE_URL = 'postgresql://localhost:5433/clinic_test';
  process.env.JWT_SECRET = 'test-jwt-secret-at-least-thirty-two-characters';
  process.env.MEDICAL_ENCRYPTION_KEY = 'test-medical-key-separate-at-least-thirty-two';

  const { AppModule } = await import('../dist/app.module.js');
  const { NestFactory } = await import('@nestjs/core');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  assert.ok(app, 'ApplicationContext should be instantiated');

  const { AdminDoctorsService } = await import('../dist/modules/admin-doctors/admin-doctors.service.js');
  const adminDoctorsService = app.get(AdminDoctorsService);
  assert.ok(adminDoctorsService, 'AdminDoctorsService should resolve from DI');

  const { AdminDoctorsController } = await import('../dist/modules/admin-doctors/admin-doctors.controller.js');
  const adminDoctorsController = app.get(AdminDoctorsController);
  assert.ok(adminDoctorsController, 'AdminDoctorsController should resolve from DI');

  const { AdminSchedulingService } = await import('../dist/modules/admin-scheduling/admin-scheduling.service.js');
  const adminSchedulingService = app.get(AdminSchedulingService);
  assert.ok(adminSchedulingService, 'AdminSchedulingService should resolve from DI');

  const { AdminSchedulingController } = await import('../dist/modules/admin-scheduling/admin-scheduling.controller.js');
  const adminSchedulingController = app.get(AdminSchedulingController);
  assert.ok(adminSchedulingController, 'AdminSchedulingController should resolve from DI');

  const { AdminService } = await import('../dist/modules/admin/admin.service.js');
  const adminService = app.get(AdminService);
  assert.ok(adminService, 'AdminService should resolve from DI');

  const { AdminController } = await import('../dist/modules/admin/admin.controller.js');
  const adminController = app.get(AdminController);
  assert.ok(adminController, 'AdminController should resolve from DI');

  const { StaffUsersController } = await import('../dist/modules/admin/staff-users.controller.js');
  const staffUsersController = app.get(StaffUsersController);
  assert.ok(staffUsersController, 'StaffUsersController should resolve from DI');

  await app.close();
});

test('AdminDoctorsService: findOne, update with specialty check and audit logging', async () => {
  const { AdminDoctorsService } = await import('../dist/modules/admin-doctors/admin-doctors.service.js');

  let updatedData = null;
  let auditLog = null;
  const mockPrisma = {
    doctor: {
      findUnique: async ({ where }) => {
        if (where.id === 'doc-missing') return null;
        return {
          id: 'doc-1',
          userId: 'user-doc-1',
          fullNameAr: 'د. علي',
          fullNameEn: 'Dr. Ali',
          specialtyAr: 'أطفال',
          specialtyEn: 'Pediatrics',
          specialtyId: 'spec-1',
          consultationFee: 5000,
          status: 'ACTIVE',
          schedules: [{ id: 'sched-1', active: true }],
          weeklySchedule: '[]',
          updatedAt: new Date('2026-01-01'),
          user: { id: 'user-doc-1', username: 'ali@clinic.test', status: 'ACTIVE' },
        };
      },
    },
    $transaction: async (fn) => {
      const tx = {
        $queryRaw: async () => [{ locked: true }],
        doctor: {
          findUnique: async () => ({
            id: 'doc-1',
            userId: 'user-doc-1',
            specialtyId: 'spec-1',
            specialty: { id: 'spec-1', nameAr: 'أطفال', nameEn: 'Pediatrics' },
          }),
          update: async ({ data }) => {
            updatedData = data;
            return {
              id: 'doc-1',
              userId: 'user-doc-1',
              fullNameAr: data.fullNameAr || 'د. علي',
              fullNameEn: data.fullNameEn || 'Dr. Ali',
              specialtyAr: data.specialtyAr || 'أطفال',
              specialtyEn: data.specialtyEn || 'Pediatrics',
              specialtyId: data.specialtyId || 'spec-1',
              consultationFee: data.consultationFee || 5000,
              status: data.status || 'ACTIVE',
              schedules: [{ id: 'sched-1', active: true }],
              weeklySchedule: '[]',
              updatedAt: new Date('2026-01-01'),
              user: { id: 'user-doc-1', username: 'ali@clinic.test', status: 'ACTIVE' },
            };
          },
        },
        specialty: {
          findFirst: async ({ where }) => {
            if (where.id === 'spec-inactive') return null;
            return { id: where.id, nameAr: 'باطنية', nameEn: 'Internal Medicine', active: true };
          },
        },
        user: {
          findUnique: async () => ({ status: 'ACTIVE' }),
          update: async () => ({ id: 'user-doc-1' }),
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

  const service = new AdminDoctorsService(mockPrisma);

  // 1. findOne missing throws 404 DOCTOR_NOT_FOUND
  await assert.rejects(
    async () => service.findOne('doc-missing'),
    (err) => {
      assert.ok(err instanceof HttpException);
      assert.equal(err.getStatus(), HttpStatus.NOT_FOUND);
      assert.equal(err.getResponse().code, 'DOCTOR_NOT_FOUND');
      return true;
    },
  );

  // 2. findOne found returns DTO with hasSchedule=true
  const doc = await service.findOne('doc-1');
  assert.equal(doc.id, 'doc-1');
  assert.equal(doc.hasSchedule, true);
  assert.equal(doc.account.username, 'ali@clinic.test');

  // 3. update with invalid/inactive specialty throws 422 SPECIALTY_INACTIVE_OR_NOT_FOUND
  await assert.rejects(
    async () => service.update('doc-1', { specialtyId: 'spec-inactive' }, 'admin-1'),
    (err) => {
      assert.ok(err instanceof HttpException);
      assert.equal(err.getStatus(), HttpStatus.UNPROCESSABLE_ENTITY);
      assert.equal(err.getResponse().code, 'SPECIALTY_INACTIVE_OR_NOT_FOUND');
      return true;
    },
  );

  // 4. update consultationFee updates and audits
  const updated = await service.update('doc-1', { consultationFee: 7500 }, 'admin-1', '10.0.0.1');
  assert.equal(updated.consultationFee, 7500);
  assert.equal(auditLog.action, 'DOCTOR_PROFILE_UPDATED');
});

test('AdminService: Staff user creation, reset-password, and status toggle', async () => {
  const { AdminService } = await import('../dist/modules/admin/admin.service.js');

  let createdUser = null;
  let createdDoctor = null;
  let auditLog = null;
  const adminPasswordHash = await bcrypt.hash('AdminPassword@123', 10);

  const mockPrisma = {
    user: {
      findFirst: async ({ where }) => {
        if (where.username?.equals === 'existing@clinic.test') {
          return { id: 'existing-id', username: 'existing@clinic.test' };
        }
        return null;
      },
      findUnique: async ({ where }) => {
        if (where.id === 'admin-id') {
          return {
            id: 'admin-id',
            role: 'ADMIN',
            status: 'ACTIVE',
            authVersion: 1,
            passwordHash: adminPasswordHash,
            mfaEnabled: false,
          };
        }
        if (where.id === 'target-staff-id') {
          return {
            id: 'target-staff-id',
            role: 'RECEPTIONIST',
            status: 'ACTIVE',
            authVersion: 1,
          };
        }
        return null;
      },
    },
    $transaction: async (fn) => {
      const tx = {
        $queryRaw: async () => [{ locked: true }],
        user: {
          create: async ({ data }) => {
            createdUser = data;
            return { id: 'new-user-id', ...data };
          },
          findUnique: async ({ where }) => ({
            id: where.id,
            // The service re-checks the acting admin inside the transaction.
            role: where.id === 'admin-id' ? 'ADMIN' : 'RECEPTIONIST',
            mfaEnabled: false,
            status: 'ACTIVE',
            authVersion: 1,
            username: 'recep@clinic.test',
          }),
          update: async ({ data }) => ({
            id: 'target-staff-id',
            username: 'recep@clinic.test',
            role: 'RECEPTIONIST',
            status: data.status || 'ACTIVE',
            mustChangePassword: data.mustChangePassword ?? false,
          }),
        },
        doctor: {
          create: async ({ data }) => {
            createdDoctor = data;
            return { id: 'new-doc-id', ...data };
          },
          findUnique: async () => null,
        },
        specialty: {
          findFirst: async () => ({ id: 'spec-1', nameAr: 'عام', nameEn: 'General', active: true }),
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

  const service = new AdminService(mockPrisma);

  // 1. Duplicate username throws 409 USERNAME_ALREADY_REGISTERED
  await assert.rejects(
    async () =>
      service.createStaffUser(
        { username: 'existing@clinic.test', password: 'Password@123', role: 'RECEPTIONIST' },
        'admin-id',
      ),
    (err) => {
      assert.ok(err instanceof HttpException);
      assert.equal(err.getStatus(), HttpStatus.CONFLICT);
      assert.equal(err.getResponse().code, 'USERNAME_ALREADY_REGISTERED');
      return true;
    },
  );

  // 2. Doctor creation requires specialtyId and consultationFee
  await assert.rejects(
    async () =>
      service.createStaffUser(
        { username: 'newdoc@clinic.test', password: 'Password@123', role: 'DOCTOR' },
        'admin-id',
      ),
    (err) => {
      assert.ok(err instanceof HttpException);
      assert.equal(err.getStatus(), HttpStatus.UNPROCESSABLE_ENTITY);
      assert.equal(err.getResponse().code, 'DOCTOR_CONFIGURATION_REQUIRED');
      return true;
    },
  );

  // 3. Successful doctor creation
  const created = await service.createStaffUser(
    {
      username: 'newdoc@clinic.test',
      password: 'Password@123',
      role: 'DOCTOR',
      specialtyId: 'spec-1',
      consultationFee: 10000,
      fullNameEn: 'Dr. New',
      fullNameAr: 'د. جديد',
    },
    'admin-id',
    1,
    '127.0.0.1',
  );
  assert.equal(created.success, true);
  assert.equal(createdUser.mustChangePassword, true);
  assert.equal(createdDoctor.consultationFee, 10000);
  assert.equal(auditLog.action, 'USER_CREATION');

  // 4. Admin self-reset rejected with 409 ADMIN_SELF_RESET_UNSUPPORTED
  await assert.rejects(
    async () =>
      service.resetStaffPassword(
        'admin-id',
        { currentAdminPassword: 'AdminPassword@123', newPassword: 'NewPassword@123' },
        'admin-id',
        1,
      ),
    (err) => {
      assert.ok(err instanceof HttpException);
      assert.equal(err.getStatus(), HttpStatus.CONFLICT);
      assert.equal(err.getResponse().code, 'ADMIN_SELF_RESET_UNSUPPORTED');
      return true;
    },
  );

  // 5. Staff password reset with wrong admin password throws 401 ADMIN_REAUTHENTICATION_FAILED
  await assert.rejects(
    async () =>
      service.resetStaffPassword(
        'target-staff-id',
        { currentAdminPassword: 'WrongPassword@123', newPassword: 'NewPassword@123' },
        'admin-id',
        1,
      ),
    (err) => {
      assert.ok(err instanceof HttpException);
      assert.equal(err.getStatus(), HttpStatus.UNAUTHORIZED);
      assert.equal(err.getResponse().code, 'ADMIN_REAUTHENTICATION_FAILED');
      return true;
    },
  );

  // 6. Valid staff password reset succeeds
  const resetRes = await service.resetStaffPassword(
    'target-staff-id',
    { currentAdminPassword: 'AdminPassword@123', newPassword: 'NewPassword@123' },
    'admin-id',
    1,
    '127.0.0.1',
  );
  assert.equal(resetRes.success, true);
  assert.equal(auditLog.action, 'STAFF_PASSWORD_RESET_BY_ADMIN');

  // 7. Toggle status updates status and audits
  const toggled = await service.toggleStaffStatus('target-staff-id', 'INACTIVE', 'admin-id', '127.0.0.1');
  assert.equal(toggled.status, 'INACTIVE');
  assert.equal(auditLog.action, 'USER_STATUS_CHANGE');
});
