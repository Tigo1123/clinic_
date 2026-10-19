import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { Client } from 'pg';
import bcrypt from 'bcryptjs';
import { app } from '../src/server.js';
import prisma from '../src/db.js';
import { linkGooglePatientIdentity, unlinkGooglePatientIdentity } from '../src/services/googlePatientIdentity.js';

const api = request(app);
let adminToken;
let receptionistToken;
let pg;
let schema;

async function login(username, password) {
  const response = await api.post('/api/auth/login').send({ username, password });
  assert.equal(response.status, 200);
  return response.body.token;
}

async function auditCount(action, code) {
  return prisma.tenantAuditLog.count({ where: { action, details: { contains: code } } });
}

async function createAuditFailureTrigger(triggerName, actions) {
  assert.match(triggerName, /^test_fail_[a-z_]+$/);
  assert.ok(actions.every((action) => /^[A-Z_]+$/.test(action)));
  const actionList = actions.map((action) => `'${action}'`).join(', ');
  await pg.query(`CREATE OR REPLACE FUNCTION "${schema}".${triggerName}() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.action IN (${actionList}) THEN RAISE EXCEPTION 'forced audit failure'; END IF;
      RETURN NEW;
    END;
  $$`);
  await pg.query(`CREATE TRIGGER ${triggerName} BEFORE INSERT ON "${schema}"."TenantAuditLog" FOR EACH ROW EXECUTE FUNCTION "${schema}".${triggerName}()`);
}

async function dropAuditFailureTrigger(triggerName) {
  await pg.query(`DROP TRIGGER IF EXISTS ${triggerName} ON "${schema}"."TenantAuditLog"`);
  await pg.query(`DROP FUNCTION IF EXISTS "${schema}".${triggerName}()`);
}

async function createRegistrationAuditOrderTrigger() {
  await pg.query(`CREATE OR REPLACE FUNCTION "${schema}".test_require_registration_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM "${schema}"."TenantAuditLog" WHERE "userId" = NEW."userId" AND action = 'PATIENT_ACCOUNT_REGISTRATION') THEN
        RAISE EXCEPTION 'registration audit must precede challenge creation';
      END IF;
      RETURN NEW;
    END;
  $$`);
  await pg.query(`CREATE TRIGGER test_require_registration_audit BEFORE INSERT ON "${schema}"."VerificationChallenge" FOR EACH ROW EXECUTE FUNCTION "${schema}".test_require_registration_audit()`);
}

async function dropRegistrationAuditOrderTrigger() {
  await pg.query(`DROP TRIGGER IF EXISTS test_require_registration_audit ON "${schema}"."VerificationChallenge"`);
  await pg.query(`DROP FUNCTION IF EXISTS "${schema}".test_require_registration_audit()`);
}

before(async () => {
  adminToken = await login('admin@cms.com', 'Admin@123');
  receptionistToken = await login('recep@cms.com', 'Receptionist@123');
  pg = new Client({ connectionString: process.env.DATABASE_URL });
  await pg.connect();
  ({ schema } = (await pg.query('SELECT current_schema() AS schema')).rows[0]);
});

after(async () => {
  if (pg) {
    await pg.query(`DROP TRIGGER IF EXISTS test_fail_specialty_audit ON "${schema}"."TenantAuditLog"`);
    await pg.query(`DROP FUNCTION IF EXISTS "${schema}".test_fail_specialty_audit()`);
    await pg.end();
  }
  await prisma.$disconnect();
});

test('specialty create and update commit with their expected actor/action audits', async () => {
  const code = `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const created = await api.post('/api/specialties').set('Authorization', `Bearer ${adminToken}`).send({
    code, nameAr: 'اختبار التدقيق', nameEn: 'Audit Atomicity Test'
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.code, code);
  const createdAudit = await prisma.tenantAuditLog.findFirst({ where: { action: 'SPECIALTY_CREATED', details: { contains: code } } });
  assert.ok(createdAudit);
  assert.equal(createdAudit.userId, (await prisma.user.findUnique({ where: { username: 'admin@cms.com' }, select: { id: true } })).id);

  const updated = await api.patch(`/api/specialties/${created.body.id}`).set('Authorization', `Bearer ${adminToken}`).send({ active: false, nameAr: 'اختبار التدقيق', nameEn: 'Audit Atomicity Test' });
  assert.equal(updated.status, 200);
  const updatedAudit = await prisma.tenantAuditLog.findFirst({ where: { action: 'SPECIALTY_UPDATED', details: { contains: created.body.id } } });
  assert.ok(updatedAudit);
  assert.equal(updatedAudit.userId, createdAudit.userId);
});

test('specialty mutation and existing audit roll back together when audit insertion fails', async () => {
  await createAuditFailureTrigger('test_fail_specialty_audit', ['SPECIALTY_CREATED', 'SPECIALTY_UPDATED']);
  try {
    const code = `audit-rollback-${Date.now()}`;
    const created = await api.post('/api/specialties').set('Authorization', `Bearer ${adminToken}`).send({
      code, nameAr: 'اختبار التراجع', nameEn: 'Audit Rollback Test'
    });
    assert.equal(created.status, 500);
    assert.equal(await prisma.specialty.count({ where: { code } }), 0);
    assert.equal(await auditCount('SPECIALTY_CREATED', code), 0);

    const target = await prisma.specialty.findUnique({ where: { code: 'surgery' } });
    const update = await api.patch(`/api/specialties/${target.id}`).set('Authorization', `Bearer ${adminToken}`).send({ active: false, nameAr: target.nameAr, nameEn: target.nameEn });
    assert.equal(update.status, 500);
    assert.equal((await prisma.specialty.findUnique({ where: { id: target.id } })).active, true);
    assert.equal(await prisma.tenantAuditLog.count({ where: { action: 'SPECIALTY_UPDATED', details: { contains: target.id } } }), 0);
  } finally {
    await dropAuditFailureTrigger('test_fail_specialty_audit');
  }
});

test('patient profile writes commit with their audit and roll back together on audit failure', async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const password = 'AuditPatientStrong123';
  const user = await prisma.user.create({ data: {
    username: `audit-patient-${suffix}@example.test`, email: `audit-patient-${suffix}@example.test`,
    passwordHash: await bcrypt.hash(password, 4), role: 'PATIENT', status: 'ACTIVE', preferredLanguage: 'en'
  } });
  const patient = await prisma.patient.create({ data: {
    fullNameAr: 'مريض تدقيق', fullNameEn: 'Synthetic Audit Patient', gender: 'MALE',
    dateOfBirth: '1990-01-01', phone: `+250788${String(Date.now()).slice(-6)}`,
    addressStateId: 1, emergencyContact: 'Synthetic Contact', userId: user.id
  } });
  const loginResponse = await api.post('/api/auth/login').send({ username: user.username, password });
  assert.equal(loginResponse.status, 200);
  const auth = { Authorization: `Bearer ${loginResponse.body.token}` };

  const successful = await api.patch('/api/patient/me').set(auth).send({ addressDetails: 'Synthetic address one', preferredLanguage: 'ar' });
  assert.equal(successful.status, 200);
  assert.equal((await prisma.patient.findUnique({ where: { id: patient.id } })).addressDetails, 'Synthetic address one');
  assert.equal((await prisma.user.findUnique({ where: { id: user.id } })).preferredLanguage, 'ar');
  assert.equal(await prisma.tenantAuditLog.count({ where: { userId: user.id, action: 'PATIENT_PROFILE_UPDATED' } }), 1);

  await createAuditFailureTrigger('test_fail_patient_profile_audit', ['PATIENT_PROFILE_UPDATED']);
  try {
    const rejected = await api.patch('/api/patient/me').set(auth).send({ addressDetails: 'Synthetic address two', preferredLanguage: 'en' });
    assert.equal(rejected.status, 500);
    assert.equal((await prisma.patient.findUnique({ where: { id: patient.id } })).addressDetails, 'Synthetic address one');
    assert.equal((await prisma.user.findUnique({ where: { id: user.id } })).preferredLanguage, 'ar');
    assert.equal(await prisma.tenantAuditLog.count({ where: { userId: user.id, action: 'PATIENT_PROFILE_UPDATED' } }), 1);
  } finally {
    await dropAuditFailureTrigger('test_fail_patient_profile_audit');
  }
});

test('registration creation and its audit are atomic while delivery remains a separate step', async () => {
  const originalProvider = process.env.VERIFICATION_PROVIDER;
  const originalNotificationsDisabled = process.env.NOTIFICATIONS_DISABLED;
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const validRegistration = {
    firstNameAr: 'مريض', fatherNameAr: 'اختبار', grandfatherNameAr: 'أحمد', familyNameAr: 'الأسرة',
    firstNameEn: 'Synthetic', fatherNameEn: 'Audit', grandfatherNameEn: 'Boundary', familyNameEn: 'Test',
    phone: `+250781${String(Date.now()).slice(-6)}`, email: `registration-${suffix}@example.test`,
    dateOfBirth: '1990-02-03', gender: 'FEMALE', password: 'RegistrationStrong123', addressStateId: 1
  };
  try {
    process.env.VERIFICATION_PROVIDER = 'development';
    process.env.NOTIFICATIONS_DISABLED = 'true';
    const created = await api.post('/api/patient-auth/register').send(validRegistration);
    assert.equal(created.status, 201);
    const user = await prisma.user.findUnique({ where: { email: validRegistration.email } });
    assert.ok(user);
    assert.ok(await prisma.patientRegistration.findUnique({ where: { userId: user.id } }));
    assert.equal(await prisma.tenantAuditLog.count({ where: { userId: user.id, action: 'PATIENT_ACCOUNT_REGISTRATION' } }), 1);

    const ordered = { ...validRegistration, email: `registration-order-${suffix}@example.test`, phone: `+250784${String(Date.now()).slice(-6)}` };
    await createRegistrationAuditOrderTrigger();
    try {
      const response = await api.post('/api/patient-auth/register').send(ordered);
      assert.equal(response.status, 201);
      const orderedUser = await prisma.user.findUnique({ where: { email: ordered.email } });
      assert.ok(orderedUser);
      assert.ok(await prisma.verificationChallenge.findFirst({ where: { userId: orderedUser.id } }));
      assert.equal(await prisma.tenantAuditLog.count({ where: { userId: orderedUser.id, action: 'PATIENT_ACCOUNT_REGISTRATION' } }), 1);
    } finally {
      await dropRegistrationAuditOrderTrigger();
    }

    const auditCountBeforeFailure = await prisma.tenantAuditLog.count({ where: { action: 'PATIENT_ACCOUNT_REGISTRATION', details: 'Patient online account registration started.' } });
    const failing = { ...validRegistration, email: `registration-failed-${suffix}@example.test`, phone: `+250782${String(Date.now()).slice(-6)}` };
    await createAuditFailureTrigger('test_fail_registration_audit', ['PATIENT_ACCOUNT_REGISTRATION']);
    try {
      const rejected = await api.post('/api/patient-auth/register').send(failing);
      assert.equal(rejected.status, 500);
      assert.equal(await prisma.user.count({ where: { email: failing.email } }), 0);
      assert.equal(await prisma.patientRegistration.count({ where: { user: { email: failing.email } } }), 0);
      assert.equal(await prisma.verificationChallenge.count({ where: { user: { email: failing.email } } }), 0);
      assert.equal(await prisma.tenantAuditLog.count({ where: { action: 'PATIENT_ACCOUNT_REGISTRATION', details: 'Patient online account registration started.' } }), auditCountBeforeFailure);
    } finally {
      await dropAuditFailureTrigger('test_fail_registration_audit');
    }

    process.env.VERIFICATION_PROVIDER = 'email';
    const deliveryFailure = { ...validRegistration, email: `registration-delivery-${suffix}@example.test`, phone: `+250783${String(Date.now()).slice(-6)}` };
    const auditCountBeforeDelivery = await prisma.tenantAuditLog.count({ where: { action: 'PATIENT_ACCOUNT_REGISTRATION', details: 'Patient online account registration started.' } });
    const failedDelivery = await api.post('/api/patient-auth/register').send(deliveryFailure);
    assert.equal(failedDelivery.status, 503);
    assert.equal(await prisma.user.count({ where: { email: deliveryFailure.email } }), 0);
    assert.equal(await prisma.tenantAuditLog.count({ where: { action: 'PATIENT_ACCOUNT_REGISTRATION', details: 'Patient online account registration started.' } }), auditCountBeforeDelivery);
  } finally {
    if (originalProvider === undefined) delete process.env.VERIFICATION_PROVIDER;
    else process.env.VERIFICATION_PROVIDER = originalProvider;
    if (originalNotificationsDisabled === undefined) delete process.env.NOTIFICATIONS_DISABLED;
    else process.env.NOTIFICATIONS_DISABLED = originalNotificationsDisabled;
  }
});

test('patient booking mutation and audit roll back together on audit failure', async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const password = 'AuditBookingStrong123';
  const user = await prisma.user.create({ data: {
    username: `audit-booking-${suffix}@example.test`, email: `audit-booking-${suffix}@example.test`,
    passwordHash: await bcrypt.hash(password, 4), role: 'PATIENT', status: 'ACTIVE'
  } });
  const patient = await prisma.patient.create({ data: {
    fullNameAr: 'مريض موعد', fullNameEn: 'Synthetic Booking Patient', gender: 'MALE',
    dateOfBirth: '1990-01-01', phone: `+250788${String(Date.now()).slice(-6)}`,
    addressStateId: 1, emergencyContact: 'Synthetic Contact', userId: user.id
  } });
  const doctor = await prisma.doctor.findFirst({ where: { user: { username: 'doctor@cms.com' } } });
  const loginResponse = await api.post('/api/auth/login').send({ username: user.username, password });
  assert.equal(loginResponse.status, 200);

  await createAuditFailureTrigger('test_fail_booking_audit', ['PATIENT_APPOINTMENT_BOOKED']);
  try {
    const rejected = await api.post('/api/patient/appointments').set('Authorization', `Bearer ${loginResponse.body.token}`).send({
      doctorId: doctor.id, appointmentDate: '2032-01-04', appointmentTime: '10:00'
    });
    assert.equal(rejected.status, 500);
    assert.equal(await prisma.appointment.count({ where: { patientId: patient.id, appointmentDate: '2032-01-04', appointmentTime: '10:00' } }), 0);
    assert.equal(await prisma.tenantAuditLog.count({ where: { userId: user.id, action: 'PATIENT_APPOINTMENT_BOOKED' } }), 0);
  } finally {
    await dropAuditFailureTrigger('test_fail_booking_audit');
  }
});

test('claim-code issuance commits with its audit and rolls back when the audit write fails', async () => {
  const successfulPatient = await prisma.patient.create({ data: {
    fullNameAr: 'مريض اختبار', fullNameEn: 'Synthetic Claim Patient', gender: 'FEMALE',
    dateOfBirth: '1991-02-02', phone: `+250789${String(Date.now()).slice(-6)}`,
    addressStateId: 1, emergencyContact: 'Synthetic Contact'
  } });
  const issued = await api.post(`/api/patient-auth/claims/${successfulPatient.id}/code`).set('Authorization', `Bearer ${adminToken}`);
  assert.equal(issued.status, 201);
  assert.equal(await prisma.patientClaimCode.count({ where: { patientId: successfulPatient.id } }), 1);
  assert.ok(await prisma.tenantAuditLog.findFirst({ where: { action: 'PATIENT_CLAIM_CODE_ISSUED', details: { contains: successfulPatient.id } } }));

  await createAuditFailureTrigger('test_fail_claim_code_audit', ['PATIENT_CLAIM_CODE_ISSUED']);
  try {
    const rejected = await api.post(`/api/patient-auth/claims/${successfulPatient.id}/code`).set('Authorization', `Bearer ${adminToken}`);
    assert.equal(rejected.status, 500);
    const codes = await prisma.patientClaimCode.findMany({ where: { patientId: successfulPatient.id } });
    assert.equal(codes.length, 1);
    assert.equal(codes[0].usedAt, null);
    assert.equal(await prisma.tenantAuditLog.count({ where: { action: 'PATIENT_CLAIM_CODE_ISSUED', details: { contains: successfulPatient.id } } }), 1);
  } finally {
    await dropAuditFailureTrigger('test_fail_claim_code_audit');
  }
});

test('patient link recovery rolls back ownership linkage when its audit write fails', async () => {
  const phone = `+250788${String(Date.now()).slice(-6)}`;
  const user = await prisma.user.create({ data: {
    username: phone, phoneNormalized: phone, passwordHash: await bcrypt.hash('RecoveryStrong123', 4),
    role: 'PATIENT', status: 'ACTIVE', phoneVerifiedAt: new Date()
  } });
  const patient = await prisma.patient.create({ data: {
    fullNameAr: 'مريض استعادة', fullNameEn: 'Synthetic Recovery Patient', gender: 'MALE',
    dateOfBirth: '1990-04-05', phone, addressStateId: 1, emergencyContact: 'Synthetic Contact'
  } });
  const loginResponse = await api.post('/api/auth/login').send({ username: phone, password: 'RecoveryStrong123' });
  assert.equal(loginResponse.status, 200);
  await createAuditFailureTrigger('test_fail_link_recovery_audit', ['PATIENT_LINK_RECOVERED']);
  try {
    const rejected = await api.post('/api/patient-auth/link/recover').set('Authorization', `Bearer ${loginResponse.body.token}`).send({ dateOfBirth: '1990-04-05' });
    assert.equal(rejected.status, 500);
    assert.equal((await prisma.patient.findUnique({ where: { id: patient.id } })).userId, null);
    assert.equal(await prisma.tenantAuditLog.count({ where: { userId: user.id, action: 'PATIENT_LINK_RECOVERED' } }), 0);
  } finally {
    await dropAuditFailureTrigger('test_fail_link_recovery_audit');
  }
});

test('patient record claim rolls back patient linkage and claim-code consumption when audit fails', async () => {
  const phone = `+250789${String(Date.now()).slice(-6)}`;
  const patient = await prisma.patient.create({ data: {
    fullNameAr: 'مريض مطالبة', fullNameEn: 'Synthetic Record Claim Patient', gender: 'FEMALE',
    dateOfBirth: '1991-06-07', phone, addressStateId: 1, emergencyContact: 'Synthetic Contact'
  } });
  const issued = await api.post(`/api/patient-auth/claims/${patient.id}/code`).set('Authorization', `Bearer ${adminToken}`);
  assert.equal(issued.status, 201);
  const user = await prisma.user.create({ data: {
    username: phone, phoneNormalized: phone, passwordHash: await bcrypt.hash('RecordClaimStrong123', 4),
    role: 'PATIENT', status: 'ACTIVE'
  } });
  const loginResponse = await api.post('/api/auth/login').send({ username: phone, password: 'RecordClaimStrong123' });
  assert.equal(loginResponse.status, 200);
  const code = await prisma.patientClaimCode.findUnique({ where: { publicId: issued.body.code.split('.')[0] } });

  await createAuditFailureTrigger('test_fail_record_claim_audit', ['PATIENT_RECORD_CLAIMED']);
  try {
    const rejected = await api.post('/api/patient-auth/claim').set('Authorization', `Bearer ${loginResponse.body.token}`).send({ code: issued.body.code, dateOfBirth: '1991-06-07' });
    assert.equal(rejected.status, 500);
    assert.equal((await prisma.patient.findUnique({ where: { id: patient.id } })).userId, null);
    assert.equal((await prisma.patientClaimCode.findUnique({ where: { id: code.id } })).usedAt, null);
    assert.equal(await prisma.tenantAuditLog.count({ where: { userId: user.id, action: 'PATIENT_RECORD_CLAIMED' } }), 0);
  } finally {
    await dropAuditFailureTrigger('test_fail_record_claim_audit');
  }
});

test('offline activation audit failure rolls back the user, linkage, and claim-code consumption', async () => {
  const oldProvider = process.env.VERIFICATION_PROVIDER;
  process.env.VERIFICATION_PROVIDER = 'disabled';
  const phone = `+250790${String(Date.now()).slice(-6)}`;
  const patient = await prisma.patient.create({ data: {
    fullNameAr: 'مريض تفعيل', fullNameEn: 'Synthetic Offline Activation Patient', gender: 'MALE',
    dateOfBirth: '1992-08-09', phone, addressStateId: 1, emergencyContact: 'Synthetic Contact'
  } });
  try {
    const issued = await api.post(`/api/patient-auth/claims/${patient.id}/code`).set('Authorization', `Bearer ${adminToken}`);
    assert.equal(issued.status, 201);
    const code = await prisma.patientClaimCode.findUnique({ where: { publicId: issued.body.code.split('.')[0] } });
    await createAuditFailureTrigger('test_fail_offline_activation_audit', ['PATIENT_OFFLINE_ACTIVATION_COMPLETED']);
    try {
      const rejected = await api.post('/api/patient-auth/offline-activation').send({ code: issued.body.code, dateOfBirth: '1992-08-09', password: 'OfflineActivationStrong123' });
      assert.equal(rejected.status, 500);
      assert.equal((await prisma.patient.findUnique({ where: { id: patient.id } })).userId, null);
      assert.equal(await prisma.user.count({ where: { phoneNormalized: phone } }), 0);
      assert.equal((await prisma.patientClaimCode.findUnique({ where: { id: code.id } })).usedAt, null);
      assert.equal(await prisma.tenantAuditLog.count({ where: { action: 'PATIENT_OFFLINE_ACTIVATION_COMPLETED', details: { contains: patient.id } } }), 0);
    } finally {
      await dropAuditFailureTrigger('test_fail_offline_activation_audit');
    }
  } finally {
    if (oldProvider === undefined) delete process.env.VERIFICATION_PROVIDER;
    else process.env.VERIFICATION_PROVIDER = oldProvider;
  }
});

test('Google identity link and unlink audit callbacks share their mutation transaction', async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const password = 'GoogleAuditStrong123';
  const user = await prisma.user.create({ data: {
    username: `audit-google-${suffix}@example.test`, email: `audit-google-${suffix}@example.test`,
    passwordHash: await bcrypt.hash(password, 4), role: 'PATIENT', status: 'ACTIVE'
  } });
  const identity = { provider: 'GOOGLE', providerSubject: `synthetic-google-subject-${suffix}`, email: user.email };

  await linkGooglePatientIdentity({
    userId: user.id, currentPassword: password, credential: 'mock-credential', db: prisma,
    verifyCredential: async () => identity,
    onLinked: (tx, created) => tx.tenantAuditLog.create({ data: {
      userId: user.id, action: 'PATIENT_GOOGLE_LINKED', details: created.normalizedEmailAtLink, ipAddress: '127.0.0.1'
    } })
  });
  assert.ok(await prisma.userExternalIdentity.findUnique({ where: { provider_providerSubject: { provider: 'GOOGLE', providerSubject: identity.providerSubject } } }));
  assert.equal(await prisma.tenantAuditLog.count({ where: { userId: user.id, action: 'PATIENT_GOOGLE_LINKED' } }), 1);

  await createAuditFailureTrigger('test_fail_google_unlink_audit', ['PATIENT_GOOGLE_UNLINKED']);
  try {
    await assert.rejects(unlinkGooglePatientIdentity({
      userId: user.id, currentPassword: password, db: prisma,
      onUnlinked: (tx) => tx.tenantAuditLog.create({ data: {
        userId: user.id, action: 'PATIENT_GOOGLE_UNLINKED', details: 'Synthetic unlink', ipAddress: '127.0.0.1'
      } })
    }));
    assert.equal(await prisma.userExternalIdentity.count({ where: { userId: user.id, provider: 'GOOGLE' } }), 1);
    assert.equal(await prisma.tenantAuditLog.count({ where: { userId: user.id, action: 'PATIENT_GOOGLE_UNLINKED' } }), 0);
  } finally {
    await dropAuditFailureTrigger('test_fail_google_unlink_audit');
  }

  await unlinkGooglePatientIdentity({
    userId: user.id, currentPassword: password, db: prisma,
    onUnlinked: (tx) => tx.tenantAuditLog.create({ data: {
      userId: user.id, action: 'PATIENT_GOOGLE_UNLINKED', details: 'Synthetic unlink', ipAddress: '127.0.0.1'
    } })
  });
  assert.equal(await prisma.userExternalIdentity.count({ where: { userId: user.id, provider: 'GOOGLE' } }), 0);
  assert.equal(await prisma.tenantAuditLog.count({ where: { userId: user.id, action: 'PATIENT_GOOGLE_UNLINKED' } }), 1);

  const failingUser = await prisma.user.create({ data: {
    username: `audit-google-fail-${suffix}@example.test`, email: `audit-google-fail-${suffix}@example.test`,
    passwordHash: await bcrypt.hash(password, 4), role: 'PATIENT', status: 'ACTIVE'
  } });
  const failingIdentity = { ...identity, providerSubject: `synthetic-google-failure-${suffix}`, email: failingUser.email };
  await createAuditFailureTrigger('test_fail_google_link_audit', ['PATIENT_GOOGLE_LINKED']);
  try {
    await assert.rejects(linkGooglePatientIdentity({
      userId: failingUser.id, currentPassword: password, credential: 'mock-credential', db: prisma,
      verifyCredential: async () => failingIdentity,
      onLinked: (tx, created) => tx.tenantAuditLog.create({ data: {
        userId: failingUser.id, action: 'PATIENT_GOOGLE_LINKED', details: created.normalizedEmailAtLink, ipAddress: '127.0.0.1'
      } })
    }));
    assert.equal(await prisma.userExternalIdentity.count({ where: { userId: failingUser.id, provider: 'GOOGLE' } }), 0);
    assert.equal(await prisma.tenantAuditLog.count({ where: { userId: failingUser.id, action: 'PATIENT_GOOGLE_LINKED' } }), 0);
  } finally {
    await dropAuditFailureTrigger('test_fail_google_link_audit');
  }
});

test('failed and unauthorized specialty mutations change neither data nor success audit records', async () => {
  const code = `audit-denied-${Date.now()}`;
  const existing = await prisma.specialty.findUnique({ where: { code: 'surgery' } });
  const beforeAudits = await prisma.tenantAuditLog.count({ where: { action: 'SPECIALTY_CREATED' } });
  const duplicate = await api.post('/api/specialties').set('Authorization', `Bearer ${adminToken}`).send({
    code: 'surgery', nameAr: 'مكرر', nameEn: 'Duplicate'
  });
  assert.equal(duplicate.status, 409);
  assert.equal(await prisma.tenantAuditLog.count({ where: { action: 'SPECIALTY_CREATED' } }), beforeAudits);

  const denied = await api.post('/api/specialties').set('Authorization', `Bearer ${receptionistToken}`).send({
    code, nameAr: 'غير مصرح', nameEn: 'Unauthorized'
  });
  assert.equal(denied.status, 403);
  assert.equal(await prisma.specialty.count({ where: { code } }), 0);
  assert.equal(await prisma.tenantAuditLog.count({ where: { action: 'SPECIALTY_CREATED' } }), beforeAudits);

  const forbiddenUpdate = await api.patch(`/api/specialties/${existing.id}`).set('Authorization', `Bearer ${receptionistToken}`).send({ active: false });
  assert.equal(forbiddenUpdate.status, 403);
  assert.equal((await prisma.specialty.findUnique({ where: { id: existing.id } })).active, true);
  assert.equal(await prisma.tenantAuditLog.count({ where: { action: 'SPECIALTY_UPDATED', details: { contains: existing.id } } }), 0);
});
