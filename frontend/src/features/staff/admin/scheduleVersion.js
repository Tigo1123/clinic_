export function selectScheduleVersion(schedules, today, { preferFuture = false } = {}) {
  const active = (Array.isArray(schedules) ? schedules : []).filter((item) => item.active);
  const current = active.filter((item) => item.effectiveFrom <= today && (!item.effectiveTo || today <= item.effectiveTo)).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
  const future = active.filter((item) => item.effectiveFrom > today).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))[0];
  if (current && !(preferFuture && future)) return { schedule: current, kind: 'current' };
  if (future) return { schedule: future, kind: 'future' };
  const historical = active.sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
  return { schedule: historical || null, kind: historical ? 'historical' : 'empty' };
}
