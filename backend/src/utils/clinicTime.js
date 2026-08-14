import { DateTime, IANAZone } from 'luxon';

export const DEFAULT_CLINIC_TIME_ZONE = 'Africa/Khartoum';

export function clinicTimeZone() {
  return process.env.CLINIC_TIME_ZONE || DEFAULT_CLINIC_TIME_ZONE;
}

export function isValidClinicTimeZone(zone = clinicTimeZone()) {
  return typeof zone === 'string' && IANAZone.isValidZone(zone);
}

function instantDateTime(instant = new Date()) {
  if (DateTime.isDateTime(instant)) return instant;
  if (instant instanceof Date) return DateTime.fromJSDate(instant);
  return DateTime.fromISO(String(instant), { setZone: true });
}

export function getClinicNow(instant = new Date()) {
  return instantDateTime(instant).setZone(clinicTimeZone());
}

export function getClinicDateString(instant = new Date()) {
  return getClinicNow(instant).toISODate();
}

export function clinicAppointmentToInstant(date, time) {
  const value = DateTime.fromISO(`${date}T${time}`, { zone: clinicTimeZone() });
  if (!value.isValid) throw new Error('Invalid clinic appointment date or time.');
  return value.toUTC().toJSDate();
}

export function cancellationCutoffReached(date, time, cutoffHours, now = new Date()) {
  const hours = Number(cutoffHours);
  if (!Number.isFinite(hours) || hours < 0) throw new Error('Cancellation cutoff must be a non-negative number.');
  return clinicAppointmentToInstant(date, time).getTime() - instantDateTime(now).toMillis() <= hours * 3600000;
}

export function clinicDayBounds(date = getClinicDateString()) {
  const day = DateTime.fromISO(date, { zone: clinicTimeZone() });
  if (!day.isValid) throw new Error('Invalid clinic calendar date.');
  return { start: day.startOf('day').toUTC().toJSDate(), end: day.plus({ days: 1 }).startOf('day').toUTC().toJSDate() };
}

export function clinicMonthBounds(instant = new Date(), monthOffset = 0) {
  const start = getClinicNow(instant).startOf('month').plus({ months: monthOffset });
  return { start: start.toUTC().toJSDate(), end: start.plus({ months: 1 }).toUTC().toJSDate(), label: start.toFormat('LLL yyyy') };
}

export function clinicDateSequence(days, instant = new Date()) {
  const today = getClinicNow(instant).startOf('day');
  return Array.from({ length: days }, (_, index) => today.minus({ days: days - 1 - index }).toISODate());
}

export function instantToClinicDateString(instant) {
  return getClinicNow(instant).toISODate();
}
