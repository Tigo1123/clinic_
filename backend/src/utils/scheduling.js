import { DateTime } from 'luxon';
import prisma from '../db.js';
import { clinicTimeZone, getClinicDateString } from './clinicTime.js';

export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
export const todayString = getClinicDateString;
export const OCCUPYING_APPOINTMENT_STATUSES = Object.freeze(['PENDING', 'SCHEDULED', 'CONFIRMED', 'CHECKED_IN', 'IN_CONSULTATION', 'WAITING_LAB', 'COMPLETED']);
export async function lockDoctorScheduleRows(tx, doctorIds) {
  const locked = new Set();
  for (const doctorId of [...new Set(doctorIds)].sort()) {
    const rows = await tx.$queryRaw`SELECT "id" FROM "Doctor" WHERE "id" = ${doctorId} FOR UPDATE`;
    if (!rows.length) return false;
    locked.add(doctorId);
  }
  return locked.size === new Set(doctorIds).size;
}
const DAY_MAP = Object.freeze({ Sunday: 'SUNDAY', Monday: 'MONDAY', Tuesday: 'TUESDAY', Wednesday: 'WEDNESDAY', Thursday: 'THURSDAY', Friday: 'FRIDAY', Saturday: 'SATURDAY' });
const validDate = (date) => { const parsed = DateTime.fromISO(date, { zone: clinicTimeZone() }); return DATE_PATTERN.test(String(date)) && parsed.isValid && parsed.toISODate() === date; };
const minutes = (value) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
const diagnostic = (code, details = {}) => console.warn(JSON.stringify({ event: 'scheduling.invalid_configuration', code, ...details }));

function legacyPeriods(doctor, date) {
  let schedule;
  try { schedule = JSON.parse(doctor.weeklySchedule || '[]'); } catch { diagnostic('MALFORMED_WEEKLY_SCHEDULE', { doctorId: doctor.id }); return []; }
  if (!Array.isArray(schedule)) { diagnostic('AMBIGUOUS_WEEKLY_SCHEDULE', { doctorId: doctor.id }); return []; }
  const day = DAY_MAP[DateTime.fromISO(date, { zone: clinicTimeZone() }).toFormat('cccc')];
  const entries = schedule.filter((item) => item?.day && DAY_MAP[String(item.day)] === day);
  if (entries.length > 1) { diagnostic('DUPLICATE_WEEKDAY', { doctorId: doctor.id, day }); return []; }
  const item = entries[0];
  if (!item || !TIME_PATTERN.test(item.startTime) || !TIME_PATTERN.test(item.endTime) || minutes(item.startTime) >= minutes(item.endTime) || !Number.isInteger(item.slotDurationInMinutes) || item.slotDurationInMinutes <= 0 || item.slotDurationInMinutes > 1440) return [];
  return [{ startTime: item.startTime, endTime: item.endTime, slotDurationMinutes: item.slotDurationInMinutes, breaks: [] }];
}

export async function getEffectiveSchedule(doctorId, date, { client = prisma, ignoreExceptionDate = null, scheduleOverride = null, exceptionOverride = null, excludeScheduleId = null } = {}) {
  if (!validDate(date)) return null;
  if (exceptionOverride?.doctorId === doctorId && exceptionOverride.date === date) {
    if (exceptionOverride.type === 'FULL_DAY_LEAVE') return { normalized: true, periods: [] };
    if (exceptionOverride.type === 'SPECIAL_HOURS') return { normalized: true, periods: exceptionOverride.periods || [] };
  }
  const exception = date !== ignoreExceptionDate ? await client.doctorScheduleException.findFirst({ where: { doctorId, date, active: true }, include: { periods: { where: { active: true } } } }) : null;
  if (exception) {
    if (exception.type === 'FULL_DAY_LEAVE') return { normalized: true, periods: [] };
    if (exception.type === 'SPECIAL_HOURS') return { normalized: true, periods: exception.periods };
    diagnostic('INVALID_EXCEPTION_TYPE', { doctorId, date });
    return { normalized: true, periods: [] };
  }
  const schedules = await client.doctorSchedule.findMany({ where: { doctorId, id: excludeScheduleId ? { not: excludeScheduleId } : undefined, active: true, effectiveFrom: { lte: date }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }] }, include: { periods: { where: { active: true }, include: { breaks: { where: { active: true } } } } } });
  if (scheduleOverride && scheduleOverride.doctorId === doctorId && scheduleOverride.effectiveFrom <= date && (!scheduleOverride.effectiveTo || scheduleOverride.effectiveTo >= date) && !schedules.some((schedule) => schedule.id === scheduleOverride.id)) schedules.push(scheduleOverride);
  if (!schedules.length) {
    const count = await client.doctorSchedule.count({ where: { doctorId } });
    if (count) return { normalized: true, periods: [] };
    const doctor = await client.doctor.findUnique({ where: { id: doctorId }, select: { id: true, weeklySchedule: true } });
    return { normalized: false, periods: doctor ? legacyPeriods(doctor, date) : [] };
  }
  if (schedules.length !== 1) { diagnostic('OVERLAPPING_EFFECTIVE_SCHEDULES', { doctorId, date }); return { normalized: true, periods: [] }; }
  const day = DAY_MAP[DateTime.fromISO(date, { zone: clinicTimeZone() }).toFormat('cccc')];
  return { normalized: true, periods: schedules[0].periods.filter((period) => period.dayOfWeek === day) };
}

function generatePeriods(periods, date, now = DateTime.now().setZone(clinicTimeZone())) {
  const slots = [];
  for (const period of periods) {
    if (!TIME_PATTERN.test(period.startTime) || !TIME_PATTERN.test(period.endTime) || minutes(period.startTime) >= minutes(period.endTime)) continue;
    const duration = Number(period.slotDurationMinutes);
    if (!Number.isInteger(duration) || duration <= 0 || duration > 1440) continue;
    for (let current = minutes(period.startTime); current + duration <= minutes(period.endTime); current += duration) {
      const hhmm = `${String(Math.floor(current / 60)).padStart(2, '0')}:${String(current % 60).padStart(2, '0')}`;
      const start = DateTime.fromISO(`${date}T${hhmm}`, { zone: clinicTimeZone() });
      const end = start.plus({ minutes: duration });
      if (date === now.toISODate() && start <= now) continue;
      const overlapsBreak = (period.breaks || []).some((br) => TIME_PATTERN.test(br.startTime) && TIME_PATTERN.test(br.endTime) && start < DateTime.fromISO(`${date}T${br.endTime}`, { zone: clinicTimeZone() }) && end > DateTime.fromISO(`${date}T${br.startTime}`, { zone: clinicTimeZone() }));
      if (!overlapsBreak) slots.push(hhmm);
    }
  }
  return [...new Set(slots)].sort();
}

export async function getConfiguredSlots(doctor, date, now = DateTime.now().setZone(clinicTimeZone()), client = prisma) {
  if (!doctor || doctor.status !== 'ACTIVE' || !validDate(date) || date < todayString(now.toJSDate())) return [];
  const eligible = await client.doctor.findFirst({ where: { id: doctor.id, status: 'ACTIVE', user: { status: 'ACTIVE' }, OR: [{ specialtyId: null }, { specialty: { active: true } }] }, select: { id: true } });
  if (!eligible) return [];
  const effective = await getEffectiveSchedule(doctor.id, date, { client });
  return effective ? generatePeriods(effective.periods, date, now) : [];
}

export async function getAvailableSlots(doctor, date, now) {
  const slots = await getConfiguredSlots(doctor, date, now);
  if (!slots.length) return [];
  const bookings = await prisma.appointment.findMany({ where: { doctorId: doctor.id, appointmentDate: date, status: { in: OCCUPYING_APPOINTMENT_STATUSES } }, select: { appointmentTime: true } });
  const occupied = new Set(bookings.map(({ appointmentTime }) => appointmentTime));
  return slots.filter((slot) => !occupied.has(slot));
}

export async function validateBookableSlot(doctorId, date, time) {
  if (!TIME_PATTERN.test(time) || !validDate(date) || date < todayString()) return { ok: false, code: 'INVALID_APPOINTMENT_SLOT' };
  const doctor = await prisma.doctor.findFirst({ where: { id: doctorId, status: 'ACTIVE' } });
  if (!doctor) return { ok: false, code: 'DOCTOR_NOT_FOUND' };
  const slots = await getConfiguredSlots(doctor, date);
  return slots.includes(time) ? { ok: true, doctor } : { ok: false, code: 'INVALID_APPOINTMENT_SLOT' };
}
