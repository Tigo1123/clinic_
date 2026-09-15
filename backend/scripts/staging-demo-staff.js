import bcrypt from 'bcryptjs';
import { DateTime } from 'luxon';
import { passwordSchema } from '../src/utils/passwordPolicy.js';

export const specialties = [
  ['orthopedics', 'Orthopedics', 'جراحة العظام'],
  ['dentistry', 'Dentistry', 'طب الأسنان'],
  ['internal-medicine', 'Internal Medicine', 'الباطنية'],
  ['surgery', 'Surgery', 'الجراحة'],
  ['neurology', 'Neurology', 'طب الأعصاب']
].map(([code, nameEn, nameAr]) => ({ code, nameEn, nameAr }));

export const doctors = [
  ['ortho1', 'Dr. Khalid Hassan', 'د. خالد حسن', 'orthopedics', ['TUESDAY', 'THURSDAY'], '09:00', '14:00'],
  ['ortho2', 'Dr. Ahmed Ali', 'د. أحمد علي', 'orthopedics', ['MONDAY', 'WEDNESDAY'], '10:00', '15:00'],
  ['dentist1', 'Dr. Fatima Osman', 'د. فاطمة عثمان', 'dentistry', ['SUNDAY', 'WEDNESDAY'], '09:00', '14:00'],
  ['dentist2', 'Dr. Sara Mohamed', 'د. سارة محمد', 'dentistry', ['TUESDAY', 'THURSDAY'], '10:00', '16:00'],
  ['internal1', 'Dr. Yousif Ahmed', 'د. يوسف أحمد', 'internal-medicine', ['SUNDAY', 'TUESDAY', 'THURSDAY'], '08:00', '13:00'],
  ['internal2', 'Dr. Mariam Hassan', 'د. مريم حسن', 'internal-medicine', ['MONDAY', 'WEDNESDAY'], '12:00', '17:00'],
  ['surgery1', 'Dr. Omer Ibrahim', 'د. عمر إبراهيم', 'surgery', ['MONDAY', 'THURSDAY'], '09:00', '13:00'],
  ['surgery2', 'Dr. Nada Ali', 'د. ندى علي', 'surgery', ['SUNDAY', 'WEDNESDAY'], '10:00', '14:00'],
  ['neuro1', 'Dr. Mohamed Adam', 'د. محمد آدم', 'neurology', ['TUESDAY', 'THURSDAY'], '13:00', '17:00'],
  ['neuro2', 'Dr. Rania Hassan', 'د. رانيا حسن', 'neurology', ['SUNDAY', 'WEDNESDAY'], '08:00', '12:00']
].map(([suffix, fullNameEn, fullNameAr, specialtyCode, days, startTime, endTime]) => ({
  email: `doctor.${suffix}@cms.local`, role: 'DOCTOR', fullNameEn, fullNameAr, specialtyCode, days, startTime, endTime
}));

export const staff = [
  { email: 'reception.demo@cms.local', role: 'RECEPTIONIST' },
  { email: 'lab.demo@cms.local', role: 'LAB_TECH' },
  { email: 'pharmacy.demo@cms.local', role: 'PHARMACIST' },
  ...doctors
];

export class DemoStaffError extends Error {}
const refuse = (message) => { throw new DemoStaffError(message); };

export function validateDemoEnvironment(env) {
  for (const key of ['NODE_ENV', 'DEPLOYMENT_ENV', 'APP_ENV', 'ENVIRONMENT']) {
    if (/^(production|prod)$/i.test(String(env[key] || '').trim())) refuse('Production environment refused.');
  }
  if (env.DEPLOYMENT_ENV !== 'staging' || env.DEMO_SEED_ENABLED !== 'true') refuse('DEPLOYMENT_ENV=staging and DEMO_SEED_ENABLED=true are required.');
  let url;
  try { url = new URL(env.DEMO_STAFF_DATABASE_URL); } catch { refuse('DEMO_STAFF_DATABASE_URL must be an explicit PostgreSQL URL.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) refuse('PostgreSQL is required.');
  const database = decodeURIComponent(url.pathname.slice(1));
  if (!database || database !== env.DEMO_STAFF_CONFIRM_DATABASE) refuse('DEMO_STAFF_CONFIRM_DATABASE must match the target database name.');
  if (/prod/i.test(`${url.hostname}/${database}`)) refuse('Production database target refused.');
  if (!passwordSchema.safeParse(env.DEMO_STAFF_PASSWORD).success || Buffer.byteLength(env.DEMO_STAFF_PASSWORD) > 72) refuse('DEMO_STAFF_PASSWORD must satisfy the existing password policy and fit within 72 UTF-8 bytes.');
  const today = DateTime.now().setZone(env.CLINIC_TIME_ZONE || 'Africa/Khartoum');
  if (!today.isValid) refuse('Invalid CLINIC_TIME_ZONE.');
  return { database, today: today.toISODate() };
}

// One transaction and a shared lock make concurrent/repeated executions safe.
// Conflicting identities or edited schedules require manual review, never deletion.
export async function seedDemoStaff(prisma, env = process.env) {
  const { database, today } = validateDemoEnvironment(env);
  const passwordHash = await bcrypt.hash(env.DEMO_STAFF_PASSWORD, 12);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(184732, 310)`;
    const [identity] = await tx.$queryRaw`SELECT current_database() AS database`;
    if (identity.database !== database) refuse('Connected database does not match confirmation.');
    const byCode = new Map();
    for (const item of specialties) {
      const matches = await tx.specialty.findMany({ where: { OR: [{ code: { equals: item.code, mode: 'insensitive' } }, { nameEn: { equals: item.nameEn, mode: 'insensitive' } }, { nameAr: item.nameAr }] } });
      if (matches.length > 1 || (matches[0] && (!matches[0].active || matches[0].nameEn.toLowerCase() !== item.nameEn.toLowerCase()))) refuse(`Specialty conflict: ${item.code}.`);
      byCode.set(item.code, matches[0] || await tx.specialty.create({ data: item }));
    }
    for (const item of staff) {
      const matches = await tx.user.findMany({ where: { OR: [{ username: { equals: item.email, mode: 'insensitive' } }, { email: { equals: item.email, mode: 'insensitive' } }] }, include: { doctor: true, patient: true, mfaConfiguration: true } });
      const existing = matches[0];
      if (matches.length > 1 || (existing && (existing.username !== item.email || (existing.email && existing.email !== item.email) || existing.role !== item.role || existing.patient || existing.mfaEnabled || existing.mfaConfiguration || (item.role !== 'DOCTOR' && existing.doctor)))) refuse(`Account conflict: ${item.email}.`);
      if (item.role === 'DOCTOR') {
        const namesakes = await tx.doctor.findMany({ where: { OR: [{ fullNameEn: { equals: item.fullNameEn, mode: 'insensitive' } }, { fullNameAr: item.fullNameAr }] } });
        if (namesakes.some((d) => d.userId !== existing?.id) || (existing?.doctor && existing.doctor.fullNameEn !== item.fullNameEn)) refuse(`Doctor identity conflict: ${item.email}.`);
      }
      const data = { email: item.email, status: 'ACTIVE', passwordHash, mustChangePassword: false, lastPasswordChange: new Date() };
      const user = existing
        ? await tx.user.update({ where: { id: existing.id }, data: { ...data, authVersion: { increment: 1 } } })
        : await tx.user.create({ data: { ...data, username: item.email, role: item.role } });
      if (item.role !== 'DOCTOR') continue;
      const specialty = byCode.get(item.specialtyCode);
      const profile = { fullNameEn: item.fullNameEn, fullNameAr: item.fullNameAr, specialtyId: specialty.id, specialtyEn: specialty.nameEn, specialtyAr: specialty.nameAr, status: 'ACTIVE' };
      const doctor = await tx.doctor.upsert({ where: { userId: user.id }, update: profile, create: { ...profile, userId: user.id, consultationFee: 100, weeklySchedule: '[]' } });
      const schedules = await tx.doctorSchedule.findMany({ where: { doctorId: doctor.id }, include: { periods: { include: { breaks: true } } } });
      if (schedules.length) {
        const [schedule] = schedules;
        if (schedules.length !== 1 || !schedule.active || schedule.effectiveTo || schedule.effectiveFrom > today || schedule.periods.length !== item.days.length || new Set(schedule.periods.map((p) => p.dayOfWeek)).size !== item.days.length || schedule.periods.some((p) => !item.days.includes(p.dayOfWeek) || !p.active || p.startTime !== item.startTime || p.endTime !== item.endTime || p.slotDurationMinutes !== 30 || p.breaks.length)) refuse(`Schedule conflict: ${item.email}.`);
      } else {
        if (existing?.doctor && existing.doctor.weeklySchedule !== '[]') refuse(`Legacy schedule conflict: ${item.email}.`);
        await tx.doctorSchedule.create({ data: { doctorId: doctor.id, effectiveFrom: today, periods: { create: item.days.map((dayOfWeek) => ({ dayOfWeek, startTime: item.startTime, endTime: item.endTime, slotDurationMinutes: 30 })) } } });
      }
    }
    return { users: staff.length, doctors: doctors.length, specialties: specialties.length, schedules: doctors.length, periods: doctors.reduce((sum, d) => sum + d.days.length, 0) };
  }, { timeout: 30000 });
}
