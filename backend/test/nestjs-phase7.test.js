import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpException, HttpStatus } from '@nestjs/common';

test('NestJS Phase 7: Appointments Module resolves from AppModule', async () => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://localhost:5433/clinic_test';
  process.env.SOCKET_REVOCATION_DATABASE_URL = 'postgresql://localhost:5433/clinic_test';
  process.env.JWT_SECRET = 'test-jwt-secret-at-least-thirty-two-characters';
  process.env.MEDICAL_ENCRYPTION_KEY = 'test-medical-key-separate-at-least-thirty-two';

  const { AppModule } = await import('../dist/app.module.js');
  const { NestFactory } = await import('@nestjs/core');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  assert.ok(app, 'ApplicationContext should be instantiated');

  const { AppointmentsService } = await import('../dist/modules/appointments/appointments.service.js');
  const appointmentsService = app.get(AppointmentsService);
  assert.ok(appointmentsService, 'AppointmentsService should resolve from DI');

  const { AppointmentsController } = await import('../dist/modules/appointments/appointments.controller.js');
  const appointmentsController = app.get(AppointmentsController);
  assert.ok(appointmentsController, 'AppointmentsController should resolve from DI');

  await app.close();
});

test('AppointmentsService: getSlots validates past date and doctor existence', async () => {
  const { AppointmentsService } = await import('../dist/modules/appointments/appointments.service.js');

  const mockPrisma = {
    doctor: {
      findUnique: async ({ where }) => {
        if (where.id === 'doc-inactive') {
          return { id: 'doc-inactive', status: 'INACTIVE' };
        }
        if (where.id === 'doc-active') {
          return {
            id: 'doc-active',
            status: 'ACTIVE',
            user: { status: 'ACTIVE' },
            specialtyId: null,
            scheduleConfig: JSON.stringify({
              days: [0, 1, 2, 3, 4, 5, 6],
              start: '09:00',
              end: '17:00',
              slotDuration: 30,
            }),
          };
        }
        return null;
      },
    },
    appointment: {
      findMany: async () => [],
    },
    scheduleException: {
      findMany: async () => [],
    },
    doctorScheduleException: {
      findFirst: async () => null,
      findMany: async () => [],
    },
  };

  const mockGateway = {
    emitQueueUpdate: () => {},
  };

  const service = new AppointmentsService(mockPrisma, mockGateway);

  // 1. Past date throws 422 APPOINTMENT_DATE_IN_PAST
  await assert.rejects(
    async () => service.getSlots('doc-active', '2000-01-01'),
    (err) => {
      assert.ok(err instanceof HttpException);
      assert.equal(err.getStatus(), HttpStatus.UNPROCESSABLE_ENTITY);
      const res = err.getResponse();
      assert.equal(res.code, 'APPOINTMENT_DATE_IN_PAST');
      return true;
    },
  );

  // 2. Doctor not found throws 404
  await assert.rejects(
    async () => service.getSlots('doc-missing', '2099-01-01'),
    (err) => {
      assert.ok(err instanceof HttpException);
      assert.equal(err.getStatus(), HttpStatus.NOT_FOUND);
      return true;
    },
  );

  // 3. Inactive doctor throws 404
  await assert.rejects(
    async () => service.getSlots('doc-inactive', '2099-01-01'),
    (err) => {
      assert.ok(err instanceof HttpException);
      assert.equal(err.getStatus(), HttpStatus.NOT_FOUND);
      return true;
    },
  );
});

test('AppointmentsService: updateStatus enforces transition rules, roles, and consultation payment', async () => {
  const { AppointmentsService } = await import('../dist/modules/appointments/appointments.service.js');

  let updatedAppointment = null;
  const mockPrisma = {
    appointment: {
      findUnique: async ({ where }) => {
        if (where.id === 'apt-checked-in') {
          return {
            id: 'apt-checked-in',
            doctorId: 'doc-1',
            status: 'CHECKED_IN',
            patient: { id: 'pat-1', phone: '+249912345678', fullNameAr: 'مريض', fullNameEn: 'Patient' },
            doctor: { id: 'doc-1', fullNameAr: 'طبيب', fullNameEn: 'Doctor' },
          };
        }
        if (where.id === 'apt-completed') {
          return {
            id: 'apt-completed',
            doctorId: 'doc-1',
            status: 'COMPLETED',
          };
        }
        return null;
      },
      updateMany: async ({ where, data }) => {
        updatedAppointment = { ...where, ...data };
        return { count: 1 };
      },
    },
    invoice: {
      findFirst: async ({ where }) => {
        // Only return paid invoice if explicitly querying paid
        if (where.appointmentId === 'apt-checked-in' && where.paymentStatus === 'PAID') {
          return null; // Simulate unpaid consultation fee
        }
        return null;
      },
    },
    tenantAuditLog: {
      create: async () => ({ id: 'audit-1' }),
    },
    $transaction: async (fn) => fn(mockPrisma),
  };

  const mockGateway = {
    emitQueueUpdate: () => {},
  };

  const service = new AppointmentsService(mockPrisma, mockGateway);

  // 1. Illegal transition from COMPLETED throws 409 ILLEGAL_APPOINTMENT_STATUS_TRANSITION
  await assert.rejects(
    async () =>
      service.updateStatus(
        'apt-completed',
        'IN_CONSULTATION',
        { id: 'user-admin', role: 'ADMIN' },
      ),
    (err) => {
      assert.ok(err instanceof HttpException);
      assert.equal(err.getStatus(), HttpStatus.CONFLICT);
      assert.equal(err.getResponse().code, 'ILLEGAL_APPOINTMENT_STATUS_TRANSITION');
      return true;
    },
  );

  // 2. Doctor forbidden from advancing another doctor's appointment
  await assert.rejects(
    async () =>
      service.updateStatus(
        'apt-checked-in',
        'IN_CONSULTATION',
        { id: 'user-doc2', role: 'DOCTOR', doctorId: 'doc-other' },
      ),
    (err) => {
      assert.ok(err instanceof HttpException);
      assert.equal(err.getStatus(), HttpStatus.FORBIDDEN);
      assert.equal(err.getResponse().code, 'APPOINTMENT_STATUS_FORBIDDEN');
      return true;
    },
  );

  // 3. Receptionist forbidden from setting clinical state IN_CONSULTATION
  await assert.rejects(
    async () =>
      service.updateStatus(
        'apt-checked-in',
        'IN_CONSULTATION',
        { id: 'user-rec', role: 'RECEPTIONIST' },
      ),
    (err) => {
      assert.ok(err instanceof HttpException);
      assert.equal(err.getStatus(), HttpStatus.FORBIDDEN);
      assert.equal(err.getResponse().code, 'APPOINTMENT_STATUS_FORBIDDEN');
      return true;
    },
  );

  // 4. Entering IN_CONSULTATION without paid invoice throws 409 CONSULTATION_PAYMENT_REQUIRED
  await assert.rejects(
    async () =>
      service.updateStatus(
        'apt-checked-in',
        'IN_CONSULTATION',
        { id: 'user-doc1', role: 'DOCTOR', doctorId: 'doc-1' },
      ),
    (err) => {
      assert.ok(err instanceof HttpException);
      assert.equal(err.getStatus(), HttpStatus.CONFLICT);
      assert.equal(err.getResponse().code, 'CONSULTATION_PAYMENT_REQUIRED');
      return true;
    },
  );
});

test('AppointmentsService: getQueue checks doctor access and orders emergency overrides first', async () => {
  const { AppointmentsService } = await import('../dist/modules/appointments/appointments.service.js');

  const mockPrisma = {
    appointment: {
      findMany: async () => [
        {
          id: 'apt-regular',
          doctorId: 'doc-1',
          appointmentTime: '10:00',
          status: 'CHECKED_IN',
          emergencyOverride: null,
          invoices: [{ paymentStatus: 'UNPAID', totalAmountSdg: 5000 }],
          medicalRecord: null,
        },
        {
          id: 'apt-emergency',
          doctorId: 'doc-1',
          appointmentTime: '11:00',
          status: 'CHECKED_IN',
          emergencyOverride: { id: 'ovr-1', justification: 'Critical emergency queue override' },
          invoices: [{ paymentStatus: 'PAID', totalAmountSdg: 5000 }],
          medicalRecord: { id: 'mr-1' },
        },
      ],
    },
  };

  const service = new AppointmentsService(mockPrisma, { emitQueueUpdate: () => {} });

  // 1. Doctor role viewing another doctor queue is rejected
  await assert.rejects(
    async () =>
      service.getQueue('doc-1', '2026-11-13', { role: 'DOCTOR', doctorId: 'doc-different' }),
    (err) => {
      assert.ok(err instanceof HttpException);
      assert.equal(err.getStatus(), HttpStatus.FORBIDDEN);
      assert.equal(err.getResponse().code, 'DOCTOR_QUEUE_FORBIDDEN');
      return true;
    },
  );

  // 2. Queue sorts emergencyOverride to top regardless of later time
  const queue = await service.getQueue('doc-1', '2026-11-13', { role: 'DOCTOR', doctorId: 'doc-1' });
  assert.equal(queue.length, 2);
  assert.equal(queue[0].id, 'apt-emergency', 'Emergency override should be first in queue');
  assert.equal(queue[0].consultationReady, true, 'Paid consultation invoice marks consultationReady');
  assert.equal(queue[1].id, 'apt-regular');
  assert.equal(queue[1].consultationReady, false, 'Unpaid invoice marks consultationReady false');
});

test('AppointmentsService: applyOverride validates justification, state, and emits realtime update', async () => {
  const { AppointmentsService } = await import('../dist/modules/appointments/appointments.service.js');

  let realtimeEmitted = null;
  const mockGateway = {
    emitQueueUpdate: (payload, doctorIds) => {
      realtimeEmitted = { payload, doctorIds };
    },
  };

  const mockPrisma = {
    appointment: {
      findUnique: async ({ where }) => {
        if (where.id === 'apt-scheduled') {
          return { id: 'apt-scheduled', doctorId: 'doc-1', status: 'SCHEDULED' };
        }
        if (where.id === 'apt-completed') {
          return { id: 'apt-completed', doctorId: 'doc-1', status: 'COMPLETED' };
        }
        return null;
      },
      updateMany: async () => ({ count: 1 }),
    },
    emergencyOverride: {
      findUnique: async ({ where }) => {
        if (where.appointmentId === 'apt-already-overridden') return { id: 'ovr-exists' };
        return null;
      },
      create: async ({ data }) => ({ id: 'ovr-new', ...data }),
    },
    tenantAuditLog: {
      create: async () => ({ id: 'audit-1' }),
    },
    $transaction: async (fn) => fn(mockPrisma),
  };

  const service = new AppointmentsService(mockPrisma, mockGateway);

  // 1. Short justification throws 422 OVERRIDE_JUSTIFICATION_REQUIRED
  await assert.rejects(
    async () => service.applyOverride('apt-scheduled', 'too short', 'user-1'),
    (err) => {
      assert.ok(err instanceof HttpException);
      assert.equal(err.getStatus(), HttpStatus.UNPROCESSABLE_ENTITY);
      assert.equal(err.getResponse().code, 'OVERRIDE_JUSTIFICATION_REQUIRED');
      return true;
    },
  );

  // 2. Override from COMPLETED throws 409 OVERRIDE_INVALID_STATE
  await assert.rejects(
    async () =>
      service.applyOverride(
        'apt-completed',
        'Valid emergency justification text that is over twenty chars',
        'user-1',
      ),
    (err) => {
      assert.ok(err instanceof HttpException);
      assert.equal(err.getStatus(), HttpStatus.CONFLICT);
      assert.equal(err.getResponse().code, 'OVERRIDE_INVALID_STATE');
      return true;
    },
  );

  // 3. Successful override transitions to CHECKED_IN and emits event
  const res = await service.applyOverride(
    'apt-scheduled',
    'Patient in acute distress, emergency queue override required immediately.',
    'user-1',
  );
  assert.equal(res.success, true);
  assert.ok(realtimeEmitted);
  assert.equal(realtimeEmitted.payload.type, 'OVERRIDE');
  assert.deepEqual(realtimeEmitted.doctorIds, ['doc-1']);
});

test('AppointmentsService: transfer validates target doctor, checked-in status, and locks rows', async () => {
  const { AppointmentsService } = await import('../dist/modules/appointments/appointments.service.js');

  let queueEmitted = null;
  const mockGateway = {
    emitQueueUpdate: (payload, doctorIds) => {
      queueEmitted = { payload, doctorIds };
    },
  };

  const mockPrisma = {
    appointment: {
      findUnique: async ({ where }) => {
        if (where.id === 'apt-checkin') {
          return {
            id: 'apt-checkin',
            doctorId: 'doc-source',
            status: 'CHECKED_IN',
            appointmentDate: '2026-11-13',
            appointmentTime: '19:00',
          };
        }
        if (where.id === 'apt-not-checkin') {
          return {
            id: 'apt-not-checkin',
            doctorId: 'doc-source',
            status: 'SCHEDULED',
            appointmentDate: '2026-11-13',
            appointmentTime: '19:00',
          };
        }
        return null;
      },
      findFirst: async () => null, // No conflict in target doctor's slot
      updateMany: async () => ({ count: 1 }),
    },
    doctor: {
      findFirst: async ({ where }) => {
        if (where.id === 'doc-target') {
          return {
            id: 'doc-target',
            status: 'ACTIVE',
            user: { status: 'ACTIVE' },
            specialtyId: null,
            scheduleConfig: JSON.stringify({
              days: [0, 1, 2, 3, 4, 5, 6],
              start: '09:00',
              end: '17:00',
              slotDuration: 30,
            }),
          };
        }
        return null;
      },
    },
    scheduleException: {
      findMany: async () => [],
    },
    doctorScheduleException: {
      findFirst: async () => null,
      findMany: async () => [],
    },
    doctorSchedule: {
      findMany: async () => [
        {
          id: 'sched-1',
          doctorId: 'doc-target',
          effectiveFrom: '2026-01-01',
          effectiveTo: null,
          active: true,
          periods: [
            {
              dayOfWeek: 'FRIDAY',
              startTime: '18:00',
              endTime: '22:00',
              slotDurationMinutes: 30,
              active: true,
              breaks: [],
            },
          ],
        },
      ],
      count: async () => 1,
    },
    tenantAuditLog: {
      create: async () => ({ id: 'audit-1' }),
    },
    $queryRaw: async () => [{ id: 'doc-source' }, { id: 'doc-target' }],
    $transaction: async (fn) => fn(mockPrisma),
  };

  const service = new AppointmentsService(mockPrisma, mockGateway);

  // 1. Missing targetDoctorId throws 400
  await assert.rejects(
    async () => service.transfer('apt-checkin', '', 'user-1'),
    (err) => {
      assert.ok(err instanceof HttpException);
      assert.equal(err.getStatus(), HttpStatus.BAD_REQUEST);
      return true;
    },
  );

  // 2. Transferring non-checked-in appointment throws 409 TRANSFER_INVALID_STATE
  await assert.rejects(
    async () => service.transfer('apt-not-checkin', 'doc-target', 'user-1'),
    (err) => {
      assert.ok(err instanceof HttpException);
      assert.equal(err.getStatus(), HttpStatus.CONFLICT);
      assert.equal(err.getResponse().code, 'TRANSFER_INVALID_STATE');
      return true;
    },
  );

  // 3. Successful transfer emits update to both source and target doctors
  const result = await service.transfer('apt-checkin', 'doc-target', 'user-1');
  assert.equal(result.success, true);
  assert.ok(queueEmitted);
  assert.equal(queueEmitted.payload.type, 'TRANSFER');
  assert.deepEqual(queueEmitted.doctorIds, ['doc-source', 'doc-target']);
});

test('AppointmentsController: book & walk-in reject client-supplied fileNumber or mrn', async () => {
  const { AppointmentsController } = await import('../dist/modules/appointments/appointments.controller.js');

  const mockService = {
    book: async () => ({ success: true }),
    createWalkIn: async () => ({ success: true }),
  };

  const controller = new AppointmentsController(mockService);

  // 1. book with fileNumber throws 422 PATIENT_IDENTITY_FIELD_FORBIDDEN
  await assert.rejects(
    async () =>
      controller.book(
        { fileNumber: 'SHF-999999' },
        { ip: '127.0.0.1' },
        { set: () => {} },
      ),
    (err) => {
      assert.ok(err instanceof HttpException || err.status === 422);
      assert.equal(err.getStatus?.() || err.status, HttpStatus.UNPROCESSABLE_ENTITY);
      const res = err.getResponse?.() || err;
      assert.equal(res.code, 'PATIENT_IDENTITY_FIELD_FORBIDDEN');
      return true;
    },
  );

  // 2. walk-in with mrn throws 422 PATIENT_IDENTITY_FIELD_FORBIDDEN
  await assert.rejects(
    async () =>
      controller.createWalkIn(
        { mrn: 'MRN-12345' },
        { id: 'user-rec' },
        { ip: '127.0.0.1' },
      ),
    (err) => {
      assert.ok(err instanceof HttpException || err.status === 422);
      assert.equal(err.getStatus?.() || err.status, HttpStatus.UNPROCESSABLE_ENTITY);
      const res = err.getResponse?.() || err;
      assert.equal(res.code, 'PATIENT_IDENTITY_FIELD_FORBIDDEN');
      return true;
    },
  );
});
