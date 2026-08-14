export const CLINIC_TIME_ZONE = import.meta.env.VITE_CLINIC_TIME_ZONE || 'Africa/Khartoum';

export function clinicDateString(instant = new Date()) {
  const parts = new Intl.DateTimeFormat('en', { timeZone: CLINIC_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function clinicCalendarDays(count, instant = new Date()) {
  const [year, month, day] = clinicDateString(instant).split('-').map(Number);
  return Array.from({ length: count }, (_, index) => {
    const calendarDate = new Date(Date.UTC(year, month - 1, day + index, 12));
    return { date: calendarDate.toISOString().slice(0, 10), calendarDate };
  });
}
