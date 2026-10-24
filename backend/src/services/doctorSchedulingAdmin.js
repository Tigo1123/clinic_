import prisma from '../db.js';
import { DateTime } from 'luxon';
import { clinicTimeZone, getClinicDateString } from '../utils/clinicTime.js';
import { DATE_PATTERN, TIME_PATTERN, OCCUPYING_APPOINTMENT_STATUSES, generateScheduleSlots, getAvailableSlots, getEffectiveSchedule } from '../utils/scheduling.js';

export class ScheduleDomainError extends Error { constructor(code, message, status = 422, details) { super(message); this.code = code; this.status = status; this.details = details; } }
const minutes = (v) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3));
const validDate = (v) => DATE_PATTERN.test(v) && DateTime.fromISO(v, { zone: clinicTimeZone() }).isValid;
const overlap = (a, b, c, d) => a < d && c < b;
const future = (date, time) => DateTime.fromISO(`${date}T${time}`, { zone: clinicTimeZone() }) > DateTime.now().setZone(clinicTimeZone());
const previousDate = (date) => DateTime.fromISO(date, { zone: clinicTimeZone() }).minus({ days: 1 }).toISODate();

function validatePeriods(periods = [], exception = false) {
  const seen = new Map();
  for (const period of periods.filter((p) => p.active !== false)) {
    if (!exception && !['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'].includes(period.dayOfWeek)) throw new ScheduleDomainError('SCHEDULE_INVALID_PERIOD', 'Invalid weekday.');
    if (!TIME_PATTERN.test(period.startTime) || !TIME_PATTERN.test(period.endTime) || minutes(period.startTime) >= minutes(period.endTime) || !Number.isInteger(period.slotDurationMinutes) || period.slotDurationMinutes < 1 || period.slotDurationMinutes > minutes(period.endTime) - minutes(period.startTime)) throw new ScheduleDomainError('SCHEDULE_INVALID_PERIOD', 'Invalid period time or duration.');
    const key = exception ? 'all' : period.dayOfWeek;
    const list = seen.get(key) || [];
    const conflict = list.find((x) => overlap(minutes(x.startTime), minutes(x.endTime), minutes(period.startTime), minutes(period.endTime)));
    if (conflict) throw new ScheduleDomainError('SCHEDULE_PERIOD_OVERLAP', `${exception ? 'Special hours' : period.dayOfWeek}: ${period.startTime}–${period.endTime} overlaps ${conflict.startTime}–${conflict.endTime}. Change the day or times, or remove the duplicate period.`);
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

function slotsForDate(periods, date, exception = false) {
  const day = ['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'][DateTime.fromISO(date, { zone: clinicTimeZone() }).weekday % 7];
  return generateScheduleSlots(periods.filter(x => x.active !== false && (exception || x.dayOfWeek === day)), date);
}

async function lockDoctor(tx, doctorId) {
  await tx.$queryRaw`SELECT "id" FROM "Doctor" WHERE "id" = ${doctorId} FOR UPDATE`;
  const doctor = await tx.doctor.findUnique({ where: { id: doctorId } });
  if (!doctor) throw new ScheduleDomainError('DOCTOR_NOT_FOUND', 'Doctor not found.', 404);
  return doctor;
}

function durationOfExistingSlot(periods, date, time) {
  const start = minutes(time);
  for (const period of periods.filter((item) => item.active !== false)) {
    const duration = Number(period.slotDurationMinutes);
    const periodStart = minutes(period.startTime);
    const periodEnd = minutes(period.endTime);
    if (Number.isInteger(duration) && duration > 0 && start >= periodStart && (start - periodStart) % duration === 0 && start + duration <= periodEnd
      && !(period.breaks || []).filter((br) => br.active !== false).some((br) => overlap(start, start + duration, minutes(br.startTime), minutes(br.endTime)))) return duration;
  }
  return null;
}

async function ensureExistingAppointmentIntervalsFitEffectiveSchedule(tx, doctorId, appointments, options = {}, beforeDurations = null) {
  for (const appointment of appointments) {
    if (!future(appointment.appointmentDate, appointment.appointmentTime)) continue;
    const before = beforeDurations ? null : await getEffectiveSchedule(doctorId, appointment.appointmentDate, { client: tx });
    const duration = beforeDurations ? beforeDurations.get(`${appointment.appointmentDate}/${appointment.appointmentTime}`) : durationOfExistingSlot(before?.periods || [], appointment.appointmentDate, appointment.appointmentTime);
    if (!duration) continue; // Appointment rows contain no historical duration to infer.
    const after = await getEffectiveSchedule(doctorId, appointment.appointmentDate, { client: tx, ...options });
    const start = minutes(appointment.appointmentTime);
    const end = start + duration;
    const covered = (after?.periods || []).some((period) => Number(period.slotDurationMinutes) >= duration && minutes(period.startTime) <= start && minutes(period.endTime) >= end
      && !(period.breaks || []).filter((br) => br.active !== false).some((br) => overlap(start, end, minutes(br.startTime), minutes(br.endTime))));
    if (!covered) throw new ScheduleDomainError('SCHEDULE_FUTURE_APPOINTMENT_CONFLICT', 'Schedule change conflicts with future appointments.', 409, [{ appointmentDate: appointment.appointmentDate, appointmentTime: appointment.appointmentTime }]);
  }
}

async function ensureAppointmentsFitEffectiveSchedule(tx, doctorId, appointments, options = {}) {
  const byDate = new Map();
  for (const appointment of appointments) {
    if (!future(appointment.appointmentDate, appointment.appointmentTime)) continue;
    if (!byDate.has(appointment.appointmentDate)) {
      const effective = await getEffectiveSchedule(doctorId, appointment.appointmentDate, { client: tx, ...options });
      byDate.set(appointment.appointmentDate, effective?.periods || []);
    }
  }
  const invalid = appointments.filter((appointment) => future(appointment.appointmentDate, appointment.appointmentTime)
    && !slotsForDate(byDate.get(appointment.appointmentDate) || [], appointment.appointmentDate, true).includes(appointment.appointmentTime));
  if (invalid.length) {
    throw new ScheduleDomainError(
      'SCHEDULE_FUTURE_APPOINTMENT_CONFLICT',
      'This schedule change would make one or more future appointments fall outside the doctor’s working hours or break rules.',
      409,
      invalid.map(({ appointmentDate, appointmentTime }) => ({ appointmentDate, appointmentTime }))
    );
  }
}

function audit(tx, req, action, details) { return tx.tenantAuditLog.create({ data: { userId: req.user.id, action, details: JSON.stringify(details), ipAddress: req.ip || 'unknown' } }); }

export async function listSchedules(doctorId) { return prisma.doctorSchedule.findMany({ where: { doctorId }, include: { periods: { include: { breaks: true } } }, orderBy: { effectiveFrom: 'asc' } }); }
export async function replaceSchedule(req, doctorId, payload, scheduleId = null) {
  const today = getClinicDateString();
  if (!validDate(payload.effectiveFrom) || (payload.effectiveTo && !validDate(payload.effectiveTo)) || (payload.effectiveTo && payload.effectiveTo < payload.effectiveFrom)) throw new ScheduleDomainError('SCHEDULE_INVALID_PERIOD', 'Invalid effective date range.');
  validatePeriods(payload.periods);
  if (payload.active !== false && !payload.periods.some(period => period.active !== false)) throw new ScheduleDomainError('SCHEDULE_INVALID_PERIOD', 'An active schedule requires a working period.');
  return prisma.$transaction(async (tx) => {
    await lockDoctor(tx, doctorId);
    const active = await tx.doctorSchedule.findMany({ where: { doctorId, active: true } });
    const existing = scheduleId ? await tx.doctorSchedule.findFirst({ where: { id: scheduleId, doctorId }, include: { periods: { include: { breaks: true } } } }) : null;
    if (scheduleId && !existing) throw new ScheduleDomainError('SCHEDULE_NOT_FOUND', 'Schedule not found.', 404);
    if (existing && existing.effectiveFrom <= today) throw new ScheduleDomainError('SCHEDULE_CURRENT_IMMUTABLE', 'Started schedules must be preserved; create a tomorrow-or-later replacement.', 409);
    const current = !existing && payload.active !== false && payload.effectiveFrom > today
      ? active.find(s => s.effectiveFrom <= today && (!s.effectiveTo || s.effectiveTo >= today)) : null;
    const affected = [payload, existing, current].filter(Boolean);
    // Include the old range as well as the new one: moving/shrinking dates or
    // deactivating a version must not silently strand a confirmed booking.
    const firstNormalized = !existing && !(await tx.doctorSchedule.count({ where: { doctorId } }));
    const from = firstNormalized ? today : [today, affected.map(s => s.effectiveFrom).sort()[0]].sort().at(-1);
    const to = firstNormalized || affected.some(s => !s.effectiveTo) ? null : affected.map(s => s.effectiveTo).sort().at(-1);
    const appointments = await tx.appointment.findMany({
      where: { doctorId, appointmentDate: { gte: from, ...(to ? { lte: to } : {}) }, status: { in: OCCUPYING_APPOINTMENT_STATUSES } },
      select: { appointmentDate: true, appointmentTime: true }
    });
    const beforeDurations = new Map();
    const beforeByDate = new Map();
    for (const appointment of appointments) {
      if (!beforeByDate.has(appointment.appointmentDate)) beforeByDate.set(appointment.appointmentDate, await getEffectiveSchedule(doctorId, appointment.appointmentDate, { client: tx }));
      beforeDurations.set(`${appointment.appointmentDate}/${appointment.appointmentTime}`, durationOfExistingSlot(beforeByDate.get(appointment.appointmentDate)?.periods || [], appointment.appointmentDate, appointment.appointmentTime));
    }
    if (current && (!current.effectiveTo || current.effectiveTo >= payload.effectiveFrom)) {
      await tx.doctorSchedule.update({ where: { id: current.id }, data: { effectiveTo: previousDate(payload.effectiveFrom) } });
    }
    if (payload.active !== false) {
      const remaining = await tx.doctorSchedule.findMany({ where: { doctorId, active: true, id: { not: scheduleId || undefined } } });
      if (remaining.some(s => s.effectiveFrom <= (payload.effectiveTo || '9999-12-31') && (s.effectiveTo || '9999-12-31') >= payload.effectiveFrom)) throw new ScheduleDomainError('SCHEDULE_VERSION_OVERLAP', 'Active schedule versions overlap.', 409);
    }
    let result;
    if (existing) {
      result = await tx.doctorSchedule.update({ where: { id: existing.id }, data: { effectiveFrom: payload.effectiveFrom, effectiveTo: payload.effectiveTo || null, active: payload.active !== false, periods: { deleteMany: {}, create: payload.periods.map((p) => ({ dayOfWeek: p.dayOfWeek, startTime: p.startTime, endTime: p.endTime, slotDurationMinutes: p.slotDurationMinutes, active: p.active !== false, breaks: { create: (p.breaks || []).map((b) => ({ startTime: b.startTime, endTime: b.endTime, active: b.active !== false })) } })) } }, include: { periods: { include: { breaks: true } } } });
    } else result = await tx.doctorSchedule.create({ data: { doctorId, effectiveFrom: payload.effectiveFrom, effectiveTo: payload.effectiveTo || null, active: payload.active !== false, periods: { create: payload.periods.map((p) => ({ dayOfWeek: p.dayOfWeek, startTime: p.startTime, endTime: p.endTime, slotDurationMinutes: p.slotDurationMinutes, active: p.active !== false, breaks: { create: (p.breaks || []).map((b) => ({ startTime: b.startTime, endTime: b.endTime, active: b.active !== false })) } })) } }, include: { periods: { include: { breaks: true } } } });
    // Validate the resulting effective schedule, including active exceptions.
    // These checks run before commit and roll back the entire edit on conflict.
    await ensureAppointmentsFitEffectiveSchedule(tx, doctorId, appointments);
    await ensureExistingAppointmentIntervalsFitEffectiveSchedule(tx, doctorId, appointments, {}, beforeDurations);
    await audit(tx, req, existing ? 'DOCTOR_SCHEDULE_UPDATED' : 'DOCTOR_SCHEDULE_CREATED', { doctorId, scheduleId: result.id, effectiveFrom: result.effectiveFrom, effectiveTo: result.effectiveTo, active: result.active });
    return result;
  });
}

export async function setScheduleStatus(req, doctorId, scheduleId, active) {
  return prisma.$transaction(async (tx) => {
    await lockDoctor(tx, doctorId);
    const schedule = await tx.doctorSchedule.findFirst({
      where: { id: scheduleId, doctorId },
      include: { periods: { where: { active: true }, include: { breaks: { where: { active: true } } } } }
    });
    if (!schedule) throw new ScheduleDomainError('SCHEDULE_NOT_FOUND', 'Schedule not found.', 404);
    if (active) {
      const others = await tx.doctorSchedule.findMany({ where: { doctorId, active: true, id: { not: scheduleId } } });
      if (others.some((o) => o.effectiveFrom <= (schedule.effectiveTo || '9999-12-31') && (o.effectiveTo || '9999-12-31') >= schedule.effectiveFrom)) {
        throw new ScheduleDomainError('SCHEDULE_VERSION_OVERLAP', 'Active schedule versions overlap.', 409);
      }
    }
    if (active) {
      validatePeriods(schedule.periods);
      if (!schedule.periods.length) throw new ScheduleDomainError('SCHEDULE_INVALID_PERIOD', 'An active schedule requires a working period.');
    }
    const today = getClinicDateString();
    const from = schedule.effectiveFrom > today ? schedule.effectiveFrom : today;
    const to = schedule.effectiveTo || '9999-12-31';
    if (from <= to) {
      const appointments = await tx.appointment.findMany({
        where: { doctorId, appointmentDate: { gte: from, lte: to }, status: { in: OCCUPYING_APPOINTMENT_STATUSES } },
        select: { appointmentDate: true, appointmentTime: true }
      });
      await ensureAppointmentsFitEffectiveSchedule(tx, doctorId, appointments, {
        ...(active ? { scheduleOverride: { ...schedule, active: true } } : { excludeScheduleId: scheduleId })
      });
    }
    const result = await tx.doctorSchedule.update({ where: { id: scheduleId }, data: { active }, include: { periods: { include: { breaks: true } } } });
    await audit(tx, req, active ? 'DOCTOR_SCHEDULE_ACTIVATED' : 'DOCTOR_SCHEDULE_DEACTIVATED', { doctorId, scheduleId });
    return result;
  });
}

export async function replaceException(req, doctorId, date, payload) {
  if (!validDate(date) || !['FULL_DAY_LEAVE','SPECIAL_HOURS'].includes(payload.type)) throw new ScheduleDomainError('SCHEDULE_EXCEPTION_INVALID', 'Invalid schedule exception.', 422);
  if (payload.type === 'FULL_DAY_LEAVE' && (payload.periods || []).some((p) => p.active !== false)) throw new ScheduleDomainError('SCHEDULE_EXCEPTION_INVALID', 'Full-day leave cannot contain active periods.');
  if (payload.type === 'SPECIAL_HOURS' && !(payload.periods || []).some((p) => p.active !== false)) throw new ScheduleDomainError('SCHEDULE_EXCEPTION_INVALID', 'Special hours require an active period.');
  validatePeriods(payload.periods, true);
  return prisma.$transaction(async (tx) => {
    await lockDoctor(tx, doctorId);
    const current = await tx.doctorScheduleException.findUnique({ where: { doctorId_date: { doctorId, date } } });
    const periods = payload.type === 'FULL_DAY_LEAVE' ? [] : payload.periods;
    const appointments = await tx.appointment.findMany({
      where: { doctorId, appointmentDate: date, status: { in: OCCUPYING_APPOINTMENT_STATUSES } },
      select: { appointmentDate: true, appointmentTime: true }
    });
    const active = payload.active !== false;
    const effectiveOptions = active
      ? { exceptionOverride: { doctorId, date, type: payload.type, active: true, periods: periods.filter((period) => period.active !== false) } }
      : { ignoreExceptionDate: date };
    await ensureAppointmentsFitEffectiveSchedule(tx, doctorId, appointments, effectiveOptions);
    await ensureExistingAppointmentIntervalsFitEffectiveSchedule(tx, doctorId, appointments, effectiveOptions);
    const result = await tx.doctorScheduleException.upsert({
      where: { doctorId_date: { doctorId, date } },
      create: { doctorId, date, type: payload.type, reason: payload.reason || null, active, periods: { create: periods.map((p) => ({ startTime: p.startTime, endTime: p.endTime, slotDurationMinutes: p.slotDurationMinutes, active: p.active !== false })) } },
      update: { type: payload.type, reason: payload.reason || null, active, periods: { deleteMany: {}, create: periods.map((p) => ({ startTime: p.startTime, endTime: p.endTime, slotDurationMinutes: p.slotDurationMinutes, active: p.active !== false })) } },
      include: { periods: true }
    });
    await audit(tx, req, current ? 'DOCTOR_SCHEDULE_EXCEPTION_UPDATED' : 'DOCTOR_SCHEDULE_EXCEPTION_CREATED', { doctorId, exceptionId: result.id, date, type: result.type, active: result.active });
    return result;
  });
}
export async function listExceptions(doctorId, from, to) { return prisma.doctorScheduleException.findMany({ where: { doctorId, ...(from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}) }, include: { periods: true }, orderBy: { date: 'asc' } }); }
export async function setExceptionStatus(req, doctorId, date, active) {
  return prisma.$transaction(async (tx) => {
    await lockDoctor(tx, doctorId);
    const current = await tx.doctorScheduleException.findUnique({ where: { doctorId_date: { doctorId, date } }, include: { periods: { where: { active: true } } } });
    if (!current) throw new ScheduleDomainError('SCHEDULE_EXCEPTION_NOT_FOUND', 'Schedule exception not found.', 404);
    const appointments = await tx.appointment.findMany({
      where: { doctorId, appointmentDate: date, status: { in: OCCUPYING_APPOINTMENT_STATUSES } },
      select: { appointmentDate: true, appointmentTime: true }
    });
    const effectiveOptions = active ? { exceptionOverride: { ...current, active: true } } : { ignoreExceptionDate: date };
    await ensureAppointmentsFitEffectiveSchedule(tx, doctorId, appointments, effectiveOptions);
    await ensureExistingAppointmentIntervalsFitEffectiveSchedule(tx, doctorId, appointments, effectiveOptions);
    const result = await tx.doctorScheduleException.update({ where: { id: current.id }, data: { active } });
    await audit(tx, req, active ? 'DOCTOR_SCHEDULE_EXCEPTION_UPDATED' : 'DOCTOR_SCHEDULE_EXCEPTION_DEACTIVATED', { doctorId, exceptionId: current.id, date, active });
    return result;
  });
}
export async function preview(doctorId, date) { const doctor = await prisma.doctor.findFirst({ where: { id: doctorId, status: 'ACTIVE' } }); if (!doctor) throw new ScheduleDomainError('DOCTOR_NOT_FOUND', 'Doctor not found.', 404); return { doctorId, date, clinicTimeZone: clinicTimeZone(), slots: await getAvailableSlots(doctor, date) }; }
