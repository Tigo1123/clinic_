import { DateTime } from 'luxon';
import { clinicTimeZone, getClinicDateString } from './clinicTime.js';

export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
export const todayString = getClinicDateString;

export function configuredSlots(doctor, date) {
  const parsed = DateTime.fromISO(date, { zone: clinicTimeZone() });
  if (!parsed.isValid || parsed.toISODate() !== date) return [];
  const dayName = parsed.toFormat('cccc');
  const schedule = JSON.parse(doctor.weeklySchedule || '[]');
  const config = schedule.find((item) => item.day?.toLowerCase() === dayName.toLowerCase());
  if (!config || !Number.isInteger(config.slotDurationInMinutes) || config.slotDurationInMinutes <= 0) return [];
  const slots = [];
  let current = DateTime.fromISO(`${date}T${config.startTime}`, { zone: clinicTimeZone() });
  const end = DateTime.fromISO(`${date}T${config.endTime}`, { zone: clinicTimeZone() });
  if (!current.isValid || !end.isValid) return [];
  while (current < end) {
    slots.push(current.toFormat('HH:mm'));
    current = current.plus({ minutes: config.slotDurationInMinutes });
  }
  return slots;
}
