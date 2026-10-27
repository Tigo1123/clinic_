import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { isolatedDatabaseUrl } from '../test/helpers/testRunner.js';

// Explicitly refuses operational databases, including accidental inherited URLs.
const schema = `test_notifications_browser_${Date.now()}`;
const databaseUrl = isolatedDatabaseUrl(process.env.TEST_DATABASE_URL, schema, process.env.TEST_DATABASE_PORT || '5433');
Object.assign(process.env, {
  NODE_ENV: 'test', DEPLOYMENT_ENV: 'test', DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl,
  SOCKET_REVOCATION_DATABASE_URL: databaseUrl, CLINIC_TIME_ZONE: 'Africa/Khartoum',
  JWT_SECRET: 'isolated-notification-browser-jwt-not-for-deployment',
  MEDICAL_ENCRYPTION_KEY: 'isolated-notification-browser-clinical-test-key',
  MFA_ENCRYPTION_KEY: 'isolated-notification-browser-mfa-test-key',
  CORS_ALLOWED_ORIGINS: 'http://127.0.0.1:5187', NOTIFICATIONS_DISABLED: 'true',
  VERIFICATION_PROVIDER: 'development', PHONE_VERIFICATION_PROVIDER: 'development', PHONE_DEFAULT_COUNTRY: 'RW', STAFF_MFA_POLICY: 'optional'
});
for (const command of [['node_modules/prisma/build/index.js', 'migrate', 'deploy'], ['prisma/seed.js']]) {
  const result = spawnSync(process.execPath, command, { env: process.env, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
const { default: prisma } = await import('../src/db.js');
const { signAccessToken } = await import('../src/services/accessTokens.js');
const { getClinicDateString } = await import('../src/utils/clinicTime.js');
const { httpServer, socketRevocation, shutdown } = await import('../src/server.js');
const sessions = {};
for (const role of ['ADMIN', 'RECEPTIONIST', 'DOCTOR', 'OTHER_DOCTOR', 'PHARMACIST', 'LAB_TECH']) {
  const user = await prisma.user.create({ data: { username: `browser-${role}-${Date.now()}`, role: role === 'OTHER_DOCTOR' ? 'DOCTOR' : role, passwordHash: 'unused-isolated-browser-fixture' } });
  const safe = { id: user.id, username: user.username, role: user.role, mustChangePassword: false, mfaEnabled: false };
  if (user.role === 'DOCTOR') {
    const doctor = await prisma.doctor.create({ data: { userId: user.id, fullNameAr: 'طبيب اختبار الإشعارات', fullNameEn: 'Notification Test Doctor', specialtyAr: 'عام', specialtyEn: 'General', consultationFee: 100, weeklySchedule: '{}' } });
    safe.doctorId = doctor.id;
  }
  sessions[role] = { user: safe, token: signAccessToken({ ...user, doctorId: safe.doctorId }) };
}
const patient = await prisma.patient.create({ data: { fullNameAr: 'اختبار الإشعارات', fullNameEn: 'Notification Test Patient', gender: 'MALE', dateOfBirth: '1990-01-01', phone: '0991234567', addressStateId: 1, emergencyContact: 'Self' } });
const appointment = await prisma.appointment.create({ data: { patientId: patient.id, doctorId: sessions.DOCTOR.user.doctorId, appointmentDate: getClinicDateString(), appointmentTime: '09:00', status: 'CONFIRMED' } });
await prisma.invoice.create({ data: { patientId: patient.id, appointmentId: appointment.id, invoiceType: 'CONSULTATION', totalAmountSdg: 100, totalAmountUsd: 1, invoiceExchangeRate: 100, paymentStatus: 'PAID', createdBy: sessions.RECEPTIONIST.user.id } });
const service = await prisma.clinicalService.create({ data: { labelAr: 'فحص اختبار', labelEn: 'Notification test', category: 'LABORATORY', baseFeeSdg: 100, status: 'ACTIVE' } });
await prisma.notification.deleteMany({ where: { userId: { in: Object.values(sessions).map(s => s.user.id) } } });
const fixturePath = process.env.NOTIFICATION_QA_FIXTURE || '/tmp/clinic-notifications-browser-fixture.json';
fs.writeFileSync(fixturePath, JSON.stringify({ schema, databaseUrl, sessions, patientId: patient.id, appointmentId: appointment.id, serviceId: service.id }), { mode: 0o600 });
await socketRevocation.start();
if (!socketRevocation.isReady()) throw Error('Socket security listener is not ready.');
httpServer.listen(55438, '127.0.0.1'); await once(httpServer, 'listening');
console.log(JSON.stringify({ ready: true, port: 55438, schema, fixturePath }));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => shutdown(signal).then(() => process.exit(0)));
