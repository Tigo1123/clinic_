let backendClinicTimeZone = import.meta.env?.VITE_CLINIC_TIME_ZONE || 'Africa/Khartoum';
export let CLINIC_TIME_ZONE = backendClinicTimeZone;

export async function loadClinicTimeZone() {
  try {
    const response = await fetch('/api/public-config', { headers: { Accept: 'application/json' } });
    const config = await response.json();
    if (response.ok && typeof config.clinicTimeZone === 'string' && config.clinicTimeZone) {
      backendClinicTimeZone = config.clinicTimeZone;
      CLINIC_TIME_ZONE = backendClinicTimeZone;
    }
  } catch { /* retain development fallback when API is unavailable */ }
  return CLINIC_TIME_ZONE;
}

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
