import prisma from '../db.js';
import { DateTime } from 'luxon';
import { clinicTimeZone, getClinicDateString } from '../utils/clinicTime.js';
import { DATE_PATTERN, TIME_PATTERN, OCCUPYING_APPOINTMENT_STATUSES, getAvailableSlots } from '../utils/scheduling.js';

export class ScheduleDomainError extends Error { constructor(code, message, status = 422, details) { super(message); this.code = code; this.status = status; this.details = details; } }
const minutes = (v) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3));
const validDate = (v) => DATE_PATTERN.test(v) && DateTime.fromISO(v, { zone: clinicTimeZone() }).isValid;
const dateInRange = (date, from, to) => date >= from && (!to || date <= to);
const overlap = (a, b, c, d) => a < d && c < b;
const future = (date, time) => DateTime.fromISO(`${date}T${time}`, { zone: clinicTimeZone() }) > DateTime.now().setZone(clinicTimeZone());
const previousDate = (date) => DateTime.fromISO(date, { zone: clinicTimeZone() }).minus({ days: 1 }).toISODate();

function validatePeriods(periods = [], exception = false) {
  const seen = new Map();
  for (const period of periods.filter((p) => p.active !== false)) {
    if (!exception && !['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'].includes(period.dayOfWeek)) throw new ScheduleDomainError('SCHEDULE_INVALID_PERIOD', 'Invalid weekday.');
    if (!TIME_PATTERN.test(period.startTime) || !TIME_PATTERN.test(period.endTime) || minutes(period.startTime) >= minutes(period.endTime) || !Number.isInteger(period.slotDurationMinutes) || period.slotDurationMinutes < 1 || period.slotDurationMinutes > 1440) throw new ScheduleDomainError('SCHEDULE_INVALID_PERIOD', 'Invalid period time or duration.');
    const key = exception ? 'all' : period.dayOfWeek;
    const list = seen.get(key) || [];
    if (list.some((x) => overlap(minutes(x.startTime), minutes(x.endTime), minutes(period.startTime), minutes(period.endTime)))) throw new ScheduleDomainError('SCHEDULE_PERIOD_OVERLAP', 'Active schedule periods overlap.');
    seen.set(key, [...list, period]);
    const breaks = period.breaks || [];
    const activeBreaks = breaks.filter((b) => b.active !== false);
    for (const br of activeBreaks) {
      if (!TIME_PATTERN.test(br.startTime) || !TIME_PATTERN.test(br.endTime) || minutes(br.startTime) >= minutes(br.endTime)) throw new ScheduleDomainError('SCHEDULE_BREAK_OUTSIDE_PERIOD', 'Invalid break interval.');
      if (minutes(br.startTime) < minutes(period.startTime) || minutes(br.endTime) > minutes(period.endTime)) throw new ScheduleDomainError('SCHEDULE_BREAK_OUTSIDE_PERIOD', 'Break must lie inside its period.');
      if (activeBreaks.some((other) => other !== br && overlap(minutes(other.startTime), minutes(other.endTime), minutes(br.startTime), minutes(br.endTime)))) throw new ScheduleDomainError('SCHEDULE_BREAK_OVERLAP', 'Active breaks overlap.');
    }
  }
}

function slotsForDate(periods, date) {
  const day = ['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'][DateTime.fromISO(date, { zone: clinicTimeZone() }).weekday % 7];
  const result = [];
  for (const p of periods.filter((x) => x.active !== false && x.dayOfWeek === day)) for (let m = minutes(p.startTime); m + p.slotDurationMinutes <= minutes(p.endTime); m += p.slotDurationMinutes) {
    const end = m + p.slotDurationMinutes;
    if (!(p.breaks || []).filter((b) => b.active !== false).some((b) => overlap(m, end, minutes(b.startTime), minutes(b.endTime)))) result.push(`${String(Math.floor(m / 60)).padStart(2,'0')}:${String(m % 60).padStart(2,'0')}`);
  }
  return result;
}

async function lockDoctor(tx, doctorId) {
  await tx.$queryRaw`SELECT "id" FROM "Doctor" WHERE "id" = ${doctorId} FOR UPDATE`;
  const doctor = await tx.doctor.findUnique({ where: { id: doctorId } });
  if (!doctor) throw new ScheduleDomainError('DOCTOR_NOT_FOUND', 'Doctor not found.', 404);
  return doctor;
}

async function ensureNoFutureConflicts(tx, doctorId, periods, from, to) {
  const appointments = await tx.appointment.findMany({ where: { doctorId, appointmentDate: { gte: from, ...(to ? { lte: to } : {}) }, status: { in: OCCUPYING_APPOINTMENT_STATUSES } }, select: { id: true, appointmentDate: true, appointmentTime: true } });
  const invalid = appointments.filter((a) => future(a.appointmentDate, a.appointmentTime) && !slotsForDate(periods, a.appointmentDate).includes(a.appointmentTime));
  if (invalid.length) throw new ScheduleDomainError('SCHEDULE_FUTURE_APPOINTMENT_CONFLICT', 'Schedule change conflicts with future appointments.', 409, invalid.map(({ id, appointmentDate, appointmentTime }) => ({ appointmentId: id, appointmentDate, appointmentTime })));
}

function audit(tx, req, action, details) { return tx.tenantAuditLog.create({ data: { userId: req.user.id, action, details: JSON.stringify(details), ipAddress: req.ip || 'unknown' } }); }

export async function listSchedules(doctorId) { return prisma.doctorSchedule.findMany({ where: { doctorId }, include: { periods: { include: { breaks: true } } }, orderBy: { effectiveFrom: 'asc' } }); }
export async function replaceSchedule(req, doctorId, payload, scheduleId = null) {
  const today = getClinicDateString();
  if (!validDate(payload.effectiveFrom) || (payload.effectiveTo && !validDate(payload.effectiveTo)) || (payload.effectiveTo && payload.effectiveTo < payload.effectiveFrom)) throw new ScheduleDomainError('SCHEDULE_INVALID_PERIOD', 'Invalid effective date range.');
  validatePeriods(payload.periods);
  return prisma.$transaction(async (tx) => {
    await lockDoctor(tx, doctorId);
    const active = await tx.doctorSchedule.findMany({ where: { doctorId, active: true } });
    const existing = scheduleId ? await tx.doctorSchedule.findUnique({ where: { id: scheduleId }, include: { periods: { include: { breaks: true } } } }) : null;
    if (scheduleId && !existing) throw new ScheduleDomainError('SCHEDULE_NOT_FOUND', 'Schedule not found.', 404);
    if (existing && existing.effectiveFrom <= today && payload.effectiveFrom < today) throw new ScheduleDomainError('SCHEDULE_CURRENT_IMMUTABLE', 'Effective schedules must be replaced from tomorrow.', 409);
    if (existing && existing.effectiveFrom <= today && payload.effectiveFrom < getClinicDateString(DateTime.now().setZone(clinicTimeZone()).plus({ days: 1 }).toJSDate())) throw new ScheduleDomainError('SCHEDULE_CURRENT_IMMUTABLE', 'Current schedules require a tomorrow-or-later replacement.', 409);
    if (!existing && payload.effectiveFrom > today) {
      const current = active.find((s) => s.effectiveFrom <= today && (!s.effectiveTo || s.effectiveTo >= today));
      if (current) await tx.doctorSchedule.update({ where: { id: current.id }, data: { effectiveTo: previousDate(payload.effectiveFrom) } });
    }
    const remaining = await tx.doctorSchedule.findMany({ where: { doctorId, active: true, id: { not: scheduleId || undefined } } });
    if (remaining.some((s) => s.effectiveFrom <= (payload.effectiveTo || '9999-12-31') && (s.effectiveTo || '9999-12-31') >= payload.effectiveFrom)) throw new ScheduleDomainError('SCHEDULE_VERSION_OVERLAP', 'Active schedule versions overlap.', 409);
    await ensureNoFutureConflicts(tx, doctorId, payload.periods, payload.effectiveFrom, payload.effectiveTo);
    let result;
    if (existing) {
      result = await tx.doctorSchedule.update({ where: { id: existing.id }, data: { effectiveFrom: payload.effectiveFrom, effectiveTo: payload.effectiveTo || null, active: payload.active !== false, periods: { deleteMany: {}, create: payload.periods.map((p) => ({ dayOfWeek: p.dayOfWeek, startTime: p.startTime, endTime: p.endTime, slotDurationMinutes: p.slotDurationMinutes, active: p.active !== false, breaks: { create: (p.breaks || []).map((b) => ({ startTime: b.startTime, endTime: b.endTime, active: b.active !== false })) } })) } }, include: { periods: { include: { breaks: true } } } });
    } else result = await tx.doctorSchedule.create({ data: { doctorId, effectiveFrom: payload.effectiveFrom, effectiveTo: payload.effectiveTo || null, active: payload.active !== false, periods: { create: payload.periods.map((p) => ({ dayOfWeek: p.dayOfWeek, startTime: p.startTime, endTime: p.endTime, slotDurationMinutes: p.slotDurationMinutes, active: p.active !== false, breaks: { create: (p.breaks || []).map((b) => ({ startTime: b.startTime, endTime: b.endTime, active: b.active !== false })) } })) } }, include: { periods: { include: { breaks: true } } } });
    await audit(tx, req, existing ? 'DOCTOR_SCHEDULE_UPDATED' : 'DOCTOR_SCHEDULE_CREATED', { doctorId, scheduleId: result.id, effectiveFrom: result.effectiveFrom, effectiveTo: result.effectiveTo, active: result.active });
    return result;
  });
}

export async function setScheduleStatus(req, doctorId, scheduleId, active) { return prisma.$transaction(async (tx) => { await lockDoctor(tx, doctorId); const schedule = await tx.doctorSchedule.findFirst({ where: { id: scheduleId, doctorId } }); if (!schedule) throw new ScheduleDomainError('SCHEDULE_NOT_FOUND', 'Schedule not found.', 404); if (!active) await ensureNoFutureConflicts(tx, doctorId, [], getClinicDateString(), schedule.effectiveTo || '9999-12-31'); const result = await tx.doctorSchedule.update({ where: { id: scheduleId }, data: { active }, include: { periods: { include: { breaks: true } } } }); await audit(tx, req, active ? 'DOCTOR_SCHEDULE_ACTIVATED' : 'DOCTOR_SCHEDULE_DEACTIVATED', { doctorId, scheduleId }); return result; }); }

export async function replaceException(req, doctorId, date, payload) { if (!validDate(date) || !['FULL_DAY_LEAVE','SPECIAL_HOURS'].includes(payload.type)) throw new ScheduleDomainError('SCHEDULE_EXCEPTION_INVALID', 'Invalid schedule exception.', 422); if (payload.type === 'FULL_DAY_LEAVE' && (payload.periods || []).some((p) => p.active !== false)) throw new ScheduleDomainError('SCHEDULE_EXCEPTION_INVALID', 'Full-day leave cannot contain active periods.'); if (payload.type === 'SPECIAL_HOURS' && !(payload.periods || []).some((p) => p.active !== false)) throw new ScheduleDomainError('SCHEDULE_EXCEPTION_INVALID', 'Special hours require an active period.'); validatePeriods(payload.periods, true); return prisma.$transaction(async (tx) => { await lockDoctor(tx, doctorId); const current = await tx.doctorScheduleException.findUnique({ where: { doctorId_date: { doctorId, date } } }); const periods = payload.type === 'FULL_DAY_LEAVE' ? [] : payload.periods; await ensureNoFutureConflicts(tx, doctorId, periods, date, date); const result = await tx.doctorScheduleException.upsert({ where: { doctorId_date: { doctorId, date } }, create: { doctorId, date, type: payload.type, reason: payload.reason || null, active: payload.active !== false, periods: { create: periods.map((p) => ({ startTime: p.startTime, endTime: p.endTime, slotDurationMinutes: p.slotDurationMinutes, active: p.active !== false })) } }, update: { type: payload.type, reason: payload.reason || null, active: payload.active !== false, periods: { deleteMany: {}, create: periods.map((p) => ({ startTime: p.startTime, endTime: p.endTime, slotDurationMinutes: p.slotDurationMinutes, active: p.active !== false })) } }, include: { periods: true } }); await audit(tx, req, current ? 'DOCTOR_SCHEDULE_EXCEPTION_UPDATED' : 'DOCTOR_SCHEDULE_EXCEPTION_CREATED', { doctorId, exceptionId: result.id, date, type: result.type, active: result.active }); return result; }); }
export async function listExceptions(doctorId, from, to) { return prisma.doctorScheduleException.findMany({ where: { doctorId, ...(from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}) }, include: { periods: true }, orderBy: { date: 'asc' } }); }
export async function setExceptionStatus(req, doctorId, date, active) { return prisma.$transaction(async (tx) => { await lockDoctor(tx, doctorId); const current = await tx.doctorScheduleException.findUnique({ where: { doctorId_date: { doctorId, date } } }); if (!current) throw new ScheduleDomainError('SCHEDULE_EXCEPTION_NOT_FOUND', 'Schedule exception not found.', 404); if (!active) await ensureNoFutureConflicts(tx, doctorId, [], date, date); const result = await tx.doctorScheduleException.update({ where: { id: current.id }, data: { active } }); await audit(tx, req, active ? 'DOCTOR_SCHEDULE_EXCEPTION_UPDATED' : 'DOCTOR_SCHEDULE_EXCEPTION_DEACTIVATED', { doctorId, exceptionId: current.id, date, active }); return result; }); }
export async function preview(doctorId, date) { const doctor = await prisma.doctor.findFirst({ where: { id: doctorId, status: 'ACTIVE' } }); if (!doctor) throw new ScheduleDomainError('DOCTOR_NOT_FOUND', 'Doctor not found.', 404); return { doctorId, date, clinicTimeZone: clinicTimeZone(), slots: await getAvailableSlots(doctor, date) }; }
