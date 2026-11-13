import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpException, HttpStatus } from '@nestjs/common';

test('NestJS Phase 8: Records and Upload Modules resolve from AppModule', async () => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://localhost:5433/clinic_test';
  process.env.SOCKET_REVOCATION_DATABASE_URL = 'postgresql://localhost:5433/clinic_test';
  process.env.JWT_SECRET = 'test-jwt-secret-at-least-thirty-two-characters';
  process.env.MEDICAL_ENCRYPTION_KEY = 'test-medical-key-separate-at-least-thirty-two';

  const { AppModule } = await import('../dist/app.module.js');
  const { NestFactory } = await import('@nestjs/core');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  assert.ok(app, 'ApplicationContext should be instantiated');

  const { RecordsService } = await import('../dist/modules/records/records.service.js');
  const recordsService = app.get(RecordsService);
  assert.ok(recordsService, 'RecordsService should resolve from DI');

  const { RecordsController } = await import('../dist/modules/records/records.controller.js');
  const recordsController = app.get(RecordsController);
  assert.ok(recordsController, 'RecordsController should resolve from DI');

  const { UploadService } = await import('../dist/modules/upload/upload.service.js');
  const uploadService = app.get(UploadService);
  assert.ok(uploadService, 'UploadService should resolve from DI');

  const { UploadController } = await import('../dist/modules/upload/upload.controller.js');
  const uploadController = app.get(UploadController);
  assert.ok(uploadController, 'UploadController should resolve from DI');

  await app.close();
});

test('RecordsService: createEncounter validates diagnosis, doctor assignment, encrypts clinical data, and transitions state', async () => {
  const { RecordsService } = await import('../dist/modules/records/records.service.js');

  const mockCrypto = {
    encryptMedical: (text) => `enc:${text}`,
    decryptMedical: (cipher) => cipher.replace(/^enc:/, ''),
  };

  let emittedEvent = null;
  const mockGateway = {
    emitQueueUpdate: (payload, doctorIds) => {
      emittedEvent = { payload, doctorIds };
    },
  };

  let createdRecordData = null;
  let updatedAppointmentData = null;

  const mockPrisma = {
    doctor: {
      findUnique: async () => ({ id: 'doc-1' }),
    },
    appointment: {
      findUnique: async ({ where }) => {
        if (where.id === 'apt-valid') {
          return { id: 'apt-valid', doctorId: 'doc-1', patientId: 'pat-1', status: 'IN_CONSULTATION' };
        }
        if (where.id === 'apt-wrong-doc') {
          return { id: 'apt-wrong-doc', doctorId: 'doc-other', patientId: 'pat-1', status: 'IN_CONSULTATION' };
        }
        if (where.id === 'apt-not-consultation') {
          return { id: 'apt-not-consultation', doctorId: 'doc-1', patientId: 'pat-1', status: 'CHECKED_IN' };
        }
        return null;
      },
      updateMany: async ({ data }) => {
        updatedAppointmentData = data;
        return { count: 1 };
      },
    },
    medicalRecord: {
      findFirst: async () => null,
      create: async ({ data }) => {
        createdRecordData = data;
        return { id: 'rec-new-1', ...data };
      },
    },
    drugFormulary: {
      findMany: async () => [],
    },
    clinicalService: {
      findMany: async () => [],
    },
    tenantAuditLog: {
      create: async () => ({ id: 'audit-1' }),
    },
    $transaction: async (fn) => fn(mockPrisma),
  };

  const service = new RecordsService(mockPrisma, mockCrypto, mockGateway);

  // 1. Missing diagnosis without lab orders throws 422 DIAGNOSIS_REQUIRED
  await assert.rejects(
    async () =>
      service.createEncounter(
        { patientId: 'pat-1', appointmentId: 'apt-valid', diagnosis: '' },
        { id: 'user-doc-1', role: 'DOCTOR', doctorId: 'doc-1' },
      ),
    (err) => {
      assert.ok(err instanceof HttpException);
      assert.equal(err.getStatus(), HttpStatus.UNPROCESSABLE_ENTITY);
      assert.equal(err.getResponse().code, 'DIAGNOSIS_REQUIRED');
      return true;
    },
  );

  // 2. Doctor not assigned to appointment throws 403 CONSULTATION_RELATIONSHIP_INVALID
  await assert.rejects(
    async () =>
      service.createEncounter(
        { patientId: 'pat-1', appointmentId: 'apt-wrong-doc', diagnosis: 'Flu' },
        { id: 'user-doc-1', role: 'DOCTOR', doctorId: 'doc-1' },
      ),
    (err) => {
      assert.ok(err instanceof HttpException);
      assert.equal(err.getStatus(), HttpStatus.FORBIDDEN);
      assert.equal(err.getResponse().code, 'CONSULTATION_RELATIONSHIP_INVALID');
      return true;
    },
  );

  // 3. Appointment not in IN_CONSULTATION throws 409 CONSULTATION_STATUS_INVALID
  await assert.rejects(
    async () =>
      service.createEncounter(
        { patientId: 'pat-1', appointmentId: 'apt-not-consultation', diagnosis: 'Flu' },
        { id: 'user-doc-1', role: 'DOCTOR', doctorId: 'doc-1' },
      ),
    (err) => {
      assert.ok(err instanceof HttpException);
      assert.equal(err.getStatus(), HttpStatus.CONFLICT);
      assert.equal(err.getResponse().code, 'CONSULTATION_STATUS_INVALID');
      return true;
    },
  );

  // 4. Successful encounter creation encrypts data, sets COMPLETED, and emits event
  const result = await service.createEncounter(
    {
      patientId: 'pat-1',
      appointmentId: 'apt-valid',
      diagnosis: 'Acute Bronchitis',
      treatment: 'Rest and hydration',
      symptoms: 'Cough and mild fever',
      clinicalNotes: 'Chest clear on auscultation',
      vitalSigns: { blood_pressure: '120/80', temperature: 37.2 },
    },
    { id: 'user-doc-1', role: 'DOCTOR', doctorId: 'doc-1' },
  );

  assert.equal(result.success, true);
  assert.equal(createdRecordData.diagnosisEncrypted, 'enc:Acute Bronchitis');
  assert.equal(createdRecordData.symptomsEncrypted, 'enc:Cough and mild fever');
  assert.equal(updatedAppointmentData.status, 'COMPLETED');
  assert.ok(emittedEvent);
  assert.equal(emittedEvent.payload.type, 'CONSULTATION_COMPLETE');
  assert.deepEqual(emittedEvent.doctorIds, ['doc-1']);
});

test('RecordsService: finalizeEncounter enforces lab completion, encrypts updates, and transitions to COMPLETED', async () => {
  const { RecordsService } = await import('../dist/modules/records/records.service.js');

  const mockCrypto = {
    encryptMedical: (text) => `enc:${text}`,
    decryptMedical: (cipher) => cipher.replace(/^enc:/, ''),
  };

  let queueEmitted = null;
  const mockGateway = {
    emitQueueUpdate: (payload, doctorIds) => {
      queueEmitted = { payload, doctorIds };
    },
  };

  let updatedRecord = null;
  let finalAppointmentStatus = null;

  const mockPrisma = {
    medicalRecord: {
      findUnique: async ({ where }) => {
        if (where.id === 'rec-pending-lab') {
          return {
            id: 'rec-pending-lab',
            doctorId: 'doc-1',
            patientId: 'pat-1',
            appointmentId: 'apt-1',
            appointment: { status: 'IN_CONSULTATION' },
            labOrders: [{ id: 'lab-1', status: 'PENDING_RESULTS' }],
          };
        }
        if (where.id === 'rec-ready') {
          return {
            id: 'rec-ready',
            doctorId: 'doc-1',
            patientId: 'pat-1',
            appointmentId: 'apt-1',
            appointment: { status: 'IN_CONSULTATION' },
            labOrders: [{ id: 'lab-1', status: 'COMPLETED' }],
          };
        }
        return null;
      },
      update: async ({ data }) => {
        updatedRecord = data;
        return { id: 'rec-ready', ...data };
      },
    },
    appointment: {
      updateMany: async ({ data }) => {
        finalAppointmentStatus = data.status;
        return { count: 1 };
      },
    },
    drugFormulary: {
      findMany: async () => [],
    },
    tenantAuditLog: {
      create: async () => ({ id: 'audit-1' }),
    },
    $transaction: async (fn) => fn(mockPrisma),
  };

  const service = new RecordsService(mockPrisma, mockCrypto, mockGateway);

  // 1. Incomplete lab order blocks finalize with 409 LAB_RESULTS_NOT_READY
  await assert.rejects(
    async () =>
      service.finalizeEncounter(
        'rec-pending-lab',
        { diagnosis: 'Confirmed Bacterial Infection' },
        { id: 'user-1', role: 'DOCTOR', doctorId: 'doc-1' },
      ),
    (err) => {
      assert.ok(err instanceof HttpException);
      assert.equal(err.getStatus(), HttpStatus.CONFLICT);
      assert.equal(err.getResponse().code, 'LAB_RESULTS_NOT_READY');
      return true;
    },
  );

  // 2. Finalize with completed labs succeeds, encrypts diagnosis, sets COMPLETED
  const res = await service.finalizeEncounter(
    'rec-ready',
    { diagnosis: 'Confirmed Bacterial Infection', treatment: 'Amoxicillin 500mg' },
    { id: 'user-1', role: 'DOCTOR', doctorId: 'doc-1' },
  );

  assert.equal(res.success, true);
  assert.equal(updatedRecord.diagnosisEncrypted, 'enc:Confirmed Bacterial Infection');
  assert.equal(finalAppointmentStatus, 'COMPLETED');
  assert.ok(queueEmitted);
  assert.equal(queueEmitted.payload.type, 'CONSULTATION_FINALIZED');
});

test('RecordsService: applyBypass validates justification and writes critical audit override', async () => {
  const { RecordsService } = await import('../dist/modules/records/records.service.js');

  let writtenAudit = null;
  const mockPrisma = {
    tenantAuditLog: {
      create: async ({ data }) => {
        writtenAudit = data;
        return { id: 'audit-1' };
      },
    },
  };

  const service = new RecordsService(mockPrisma, {}, { emitQueueUpdate: () => {} });

  // 1. Short justification rejected with 400
  await assert.rejects(
    async () => service.applyBypass('pat-1', 'short', { id: 'user-doc-1' }),
    (err) => {
      assert.ok(err instanceof HttpException);
      assert.equal(err.getStatus(), HttpStatus.BAD_REQUEST);
      return true;
    },
  );

  // 2. Valid justification logs break-glass entry
  const res = await service.applyBypass(
    'pat-1',
    'Emergency resuscitation in progress, EMR access required immediately.',
    { id: 'user-doc-1' },
  );
  assert.equal(res.success, true);
  assert.ok(writtenAudit);
  assert.equal(writtenAudit.action, 'EMR_BREAK_THE_GLASS_BYPASS:pat-1');
  assert.equal(writtenAudit.userId, 'user-doc-1');
});

test('RecordsService: getSummary decrypts clinical notes and handles decryption failures', async () => {
  const { RecordsService } = await import('../dist/modules/records/records.service.js');
  const { ClinicalDataDecryptionError } = await import('../dist/utils/encryption.js');

  const mockCrypto = {
    decryptMedical: (cipher) => {
      if (cipher === 'corrupt') throw new ClinicalDataDecryptionError();
      return cipher.replace(/^enc:/, '');
    },
  };

  const mockPrisma = {
    medicalRecord: {
      findFirst: async ({ where }) => {
        if (where.OR[0].id === 'rec-corrupt') {
          return {
            id: 'rec-corrupt',
            doctorId: 'doc-1',
            appointmentId: 'apt-1',
            visitDate: '2026-11-13',
            diagnosisEncrypted: 'corrupt',
            symptomsEncrypted: 'corrupt',
            treatmentEncrypted: 'corrupt',
            clinicalNotesEncrypted: 'corrupt',
            vitalSignsJson: '{}',
            patient: { id: 'pat-1', fullNameAr: 'مريض', fullNameEn: 'Patient' },
            doctor: { fullNameAr: 'طبيب', fullNameEn: 'Doctor' },
            prescriptions: [],
            labOrders: [],
          };
        }
        if (where.OR[0].id === 'rec-valid') {
          return {
            id: 'rec-valid',
            doctorId: 'doc-1',
            appointmentId: 'apt-1',
            visitDate: '2026-11-13',
            diagnosisEncrypted: 'enc:Hypertension',
            symptomsEncrypted: 'enc:Headache',
            treatmentEncrypted: 'enc:Amlodipine',
            clinicalNotesEncrypted: 'enc:Follow-up in 2 weeks',
            vitalSignsJson: '{"blood_pressure":"140/90"}',
            patient: { id: 'pat-1', fullNameAr: 'مريض', fullNameEn: 'Patient' },
            doctor: { fullNameAr: 'طبيب', fullNameEn: 'Doctor' },
            prescriptions: [],
            labOrders: [],
          };
        }
        return null;
      },
    },
  };

  const service = new RecordsService(mockPrisma, mockCrypto, { emitQueueUpdate: () => {} });

  // 1. Corrupt encrypted data throws ClinicalDataDecryptionError (which filter turns into 500 CLINICAL_DATA_UNREADABLE)
  await assert.rejects(
    async () => service.getSummary('rec-corrupt', { doctorId: 'doc-1' }),
    (err) => {
      assert.ok(err instanceof ClinicalDataDecryptionError || err.name === 'ClinicalDataDecryptionError');
      return true;
    },
  );

  // 2. Valid data decrypts successfully
  const summary = await service.getSummary('rec-valid', { doctorId: 'doc-1' });
  assert.equal(summary.diagnosis, 'Hypertension');
  assert.equal(summary.symptoms, 'Headache');
  assert.equal(summary.vitals.blood_pressure, '140/90');
});

test('UploadService: validates file type by magic bytes and checks role authorization', async () => {
  const { UploadService } = await import('../dist/modules/upload/upload.service.js');

  const mockPrisma = {
    patient: {
      findFirst: async () => null,
      findUnique: async () => null,
    },
    medicalRecord: {
      findFirst: async () => null,
    },
    labOrderItem: {
      findFirst: async () => null,
    },
  };

  const service = new UploadService(mockPrisma);

  // 1. Missing file throws 400 FILE_REQUIRED
  await assert.rejects(
    async () => service.validateAndSaveFile(null),
    (err) => {
      assert.ok(err instanceof HttpException);
      assert.equal(err.getStatus(), HttpStatus.BAD_REQUEST);
      assert.equal(err.getResponse().code, 'FILE_REQUIRED');
      return true;
    },
  );

  // 2. Invalid magic bytes mismatching declared mimetype throws 422 UNSUPPORTED_FILE_TYPE
  await assert.rejects(
    async () =>
      service.validateAndSaveFile({
        fieldname: 'file',
        originalname: 'fake.png',
        encoding: '7bit',
        mimetype: 'image/png',
        size: 100,
        buffer: Buffer.from('NOT_A_PNG_FILE_HEADER'),
      }),
    (err) => {
      assert.ok(err instanceof HttpException);
      assert.equal(err.getStatus(), HttpStatus.UNPROCESSABLE_ENTITY);
      assert.equal(err.getResponse().code, 'UNSUPPORTED_FILE_TYPE');
      return true;
    },
  );

  // 3. Directory traversal in filename throws 400 INVALID_FILE_PATH
  await assert.rejects(
    async () => service.getAuthorizedFilePath('../../../etc/passwd', { role: 'ADMIN' }),
    (err) => {
      assert.ok(err instanceof HttpException);
      assert.equal(err.getStatus(), HttpStatus.BAD_REQUEST);
      assert.equal(err.getResponse().code, 'INVALID_FILE_PATH');
      return true;
    },
  );

  // 4. Unauthorized file access throws 403 ATTACHMENT_ACCESS_FORBIDDEN
  await assert.rejects(
    async () => service.getAuthorizedFilePath('some-unauthorized-file.pdf', { role: 'DOCTOR', doctorId: 'doc-1' }),
    (err) => {
      assert.ok(err instanceof HttpException);
      assert.equal(err.getStatus(), HttpStatus.FORBIDDEN);
      assert.equal(err.getResponse().code, 'ATTACHMENT_ACCESS_FORBIDDEN');
      return true;
    },
  );
});
