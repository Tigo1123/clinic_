import dayjs from 'dayjs';

export function parseDateOnly(value) {
  if (!value) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = dayjs(value);
  return parsed.isValid() && parsed.format('YYYY-MM-DD') === value ? parsed : null;
}

export function formatDateOnly(value) {
  return value?.isValid?.() ? value.format('YYYY-MM-DD') : '';
}

export function todayDateOnly() {
  return dayjs().format('YYYY-MM-DD');
}
