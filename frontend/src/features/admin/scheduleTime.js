// Clinic wall-clock values only. Never convert these through Date or UTC.
export function normalizeScheduleTime(value) {
  const text = String(value ?? '').trim()
    .replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 0x6f0));
  const match = /^(\d{1,2}):([0-5]\d)(?::00)?\s*(AM|PM|ص|م)?$/i.exec(text);
  if (!match) return null;
  let hour = Number(match[1]);
  if (match[3]) {
    if (hour < 1 || hour > 12) return null;
    hour = hour % 12 + (/^(PM|م)$/i.test(match[3]) ? 12 : 0);
  } else if (hour > 23) return null;
  return `${String(hour).padStart(2, '0')}:${match[2]}`;
}
const minutes = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));

export function schedulePeriodError(period) {
  const start = normalizeScheduleTime(period.startTime);
  const end = normalizeScheduleTime(period.endTime);
  if (!start || !end) return 'SCHEDULE_INVALID_TIME';
  if (end === start) return 'SCHEDULE_TIME_ORDER';
  if (end < start) return 'SCHEDULE_OVERNIGHT_UNSUPPORTED';
  if (!Number.isInteger(period.slotDurationMinutes) || period.slotDurationMinutes < 1 || period.slotDurationMinutes > minutes(end) - minutes(start)) return 'SCHEDULE_INVALID_DURATION';
  const breaks = (period.breaks || []).filter(br => br.active !== false);
  for (const br of breaks) {
    const from = normalizeScheduleTime(br.startTime);
    const to = normalizeScheduleTime(br.endTime);
    if (!from || !to || from >= to || from < start || to > end) return 'SCHEDULE_BREAK_OUTSIDE_PERIOD';
  }
  if (breaks.some((br, index) => breaks.slice(index + 1).some(other => normalizeScheduleTime(br.startTime) < normalizeScheduleTime(other.endTime) && normalizeScheduleTime(other.startTime) < normalizeScheduleTime(br.endTime)))) return 'SCHEDULE_BREAK_OVERLAP';
  return null;
}

export const scheduleTimeMessages = {
  en: {
    SCHEDULE_PERIOD_OVERLAP: ['schedulePeriodOverlap', 'Working periods on the same day must not overlap.'],
    SCHEDULE_INVALID_TIME: ['scheduleInvalidTime', 'Enter valid start and end times, including AM or PM when shown.'],
    SCHEDULE_TIME_ORDER: ['scheduleTimeOrder', 'The end time must be after the start time on the same calendar day.'],
    SCHEDULE_OVERNIGHT_UNSUPPORTED: ['scheduleOvernightUnsupported', 'Overnight schedules are not supported yet. The end time must be later than the start time on the same calendar day.'],
    SCHEDULE_INVALID_DURATION: ['scheduleInvalidDuration', 'Slot duration must be a whole number of minutes, at least 1, and no longer than the working period.'],
    SCHEDULE_BREAK_OUTSIDE_PERIOD: ['scheduleBreakOutsidePeriod', 'Each break must end after it starts and lie inside its working period on the same day.'],
    SCHEDULE_BREAK_OVERLAP: ['scheduleBreakOverlap', 'Breaks must not overlap.']
  },
  ar: {
    SCHEDULE_PERIOD_OVERLAP: ['schedulePeriodOverlap', 'يجب ألا تتداخل فترات العمل في نفس اليوم.'],
    SCHEDULE_INVALID_TIME: ['scheduleInvalidTime', 'أدخل وقتَي بداية ونهاية صالحين، مع تحديد صباحاً أو مساءً عند ظهورهما.'],
    SCHEDULE_TIME_ORDER: ['scheduleTimeOrder', 'يجب أن يكون وقت النهاية بعد وقت البداية في نفس اليوم.'],
    SCHEDULE_OVERNIGHT_UNSUPPORTED: ['scheduleOvernightUnsupported', 'الجداول التي تمتد بعد منتصف الليل غير مدعومة حالياً. يجب أن يكون وقت النهاية بعد وقت البداية في نفس اليوم.'],
    SCHEDULE_INVALID_DURATION: ['scheduleInvalidDuration', 'يجب أن تكون مدة الموعد عدداً صحيحاً من الدقائق، دقيقة واحدة على الأقل، وألا تتجاوز مدة فترة العمل.'],
    SCHEDULE_BREAK_OUTSIDE_PERIOD: ['scheduleBreakOutsidePeriod', 'يجب أن تنتهي كل استراحة بعد بدايتها وأن تقع بالكامل ضمن فترة العمل في نفس اليوم.'],
    SCHEDULE_BREAK_OVERLAP: ['scheduleBreakOverlap', 'يجب ألا تتداخل الاستراحات.']
  }
};
export function scheduleTimeMessage(code, lang, t) {
  const entry = scheduleTimeMessages[lang === 'ar' ? 'ar' : 'en'][code];
  if (!entry) return null;
  const translated = t?.(entry[0]);
  return translated && translated !== entry[0] ? translated : entry[1];
}
export function formatScheduleTime(value, lang) {
  const time = normalizeScheduleTime(value);
  if (!time) return '—';
  const hour = Number(time.slice(0, 2));
  const marker = lang === 'ar' ? (hour < 12 ? 'ص' : 'م') : (hour < 12 ? 'AM' : 'PM');
  return `${String(hour % 12 || 12).padStart(2, '0')}:${time.slice(3)} ${marker}`;
}

// Validate collapsed rows too; their inputs are intentionally unmounted.
export function schedulePeriodErrors(periods) {
  const errors = {};
  periods.forEach((period, index) => {
    const error = schedulePeriodError(period);
    if (error) errors[index] = error;
  });
  periods.forEach((period, index) => {
    if (period.active === false || errors[index]) return;
    periods.slice(index + 1).forEach((other, offset) => {
      const otherIndex = index + 1 + offset;
      if (other.active === false || errors[otherIndex] || other.dayOfWeek !== period.dayOfWeek) return;
      if (normalizeScheduleTime(period.startTime) < normalizeScheduleTime(other.endTime) && normalizeScheduleTime(other.startTime) < normalizeScheduleTime(period.endTime)) {
        errors[index] = 'SCHEDULE_PERIOD_OVERLAP'; errors[otherIndex] = 'SCHEDULE_PERIOD_OVERLAP';
      }
    });
  });
  return errors;
}
