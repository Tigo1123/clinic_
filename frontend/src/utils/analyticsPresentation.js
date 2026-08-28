const STATUS_COLORS = Object.freeze({
  COMPLETED: '#16a36a', IN_CONSULTATION: '#1769e0', CHECKED_IN: '#0d9488',
  CONFIRMED: '#38a3c7', PENDING: '#8b5cf6', SCHEDULED: '#64748b',
  WAITING_LAB: '#d97706', CANCELLED: '#dc4c64', NO_SHOW: '#9f4f66'
});

export function authoritativeKpis(data) {
  if (!data) return [];
  return [
    { key: 'patients', labelKey: 'analyticsKpiPatients', contextKey: 'analyticsKpiPatientsContext', value: finiteOrNull(data.totalPatients), tone: 'blue' },
    { key: 'visits', labelKey: 'analyticsKpiMonthlyVisits', contextKey: 'analyticsKpiMonthlyVisitsContext', value: finiteOrNull(data.monthlyVisits), tone: 'teal' },
    { key: 'completion', labelKey: 'analyticsKpiCompletion', contextKey: 'analyticsKpiCompletionContext', value: finiteOrNull(data.completionRate), suffix: '%', tone: 'green' },
    { key: 'revenue', labelKey: 'analyticsKpiRevenue', contextKey: 'analyticsKpiRevenueContext', value: finiteOrNull(data.financials?.totalRevenueSdg), currency: true, tone: 'amber' }
  ];
}

function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

export function normalizeAppointmentTrend(data) {
  if (!Array.isArray(data)) return [];
  return data.filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item?.date) && Number.isFinite(Number(item.count)))
    .map((item) => ({ date: item.date, count: Math.max(0, Number(item.count)) }));
}

export function clinicWeekdayLabel(date, lang) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return '—';
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar' : 'en', { weekday: 'short', timeZone: 'UTC' })
    .format(new Date(`${date}T12:00:00.000Z`));
}

export function weeklyAppointmentSummary(raw) {
  const data = normalizeAppointmentTrend(raw);
  if (!data.length || data.every(({ count }) => count === 0)) return { highest: null, average: 0, total: 0 };
  const total = data.reduce((sum, item) => sum + item.count, 0);
  const highest = data.reduce((best, item) => item.count > best.count ? item : best, data[0]);
  return { highest, average: Math.round((total / data.length) * 10) / 10, total };
}

export function statusDistribution(statuses) {
  if (!Array.isArray(statuses)) return [];
  const valid = statuses.filter((item) => typeof item?.status === 'string' && Number(item.count) >= 0)
    .map((item) => ({ status: item.status, count: Number(item.count) }));
  const total = valid.reduce((sum, item) => sum + item.count, 0);
  return valid.map((item) => ({
    ...item,
    percentage: total ? Math.round((item.count / total) * 100) : 0,
    color: STATUS_COLORS[item.status] || '#64748b'
  }));
}

export function sortedDoctorVisits(doctors, limit = 6) {
  if (!Array.isArray(doctors)) return { items: [], total: 0, hasMore: false };
  const sorted = doctors.filter((doctor) => Number.isFinite(Number(doctor?.visitsCount)))
    .map((doctor) => ({ ...doctor, visitsCount: Math.max(0, Number(doctor.visitsCount)) }))
    .sort((a, b) => b.visitsCount - a.visitsCount || String(a.fullNameEn).localeCompare(String(b.fullNameEn)));
  return { items: sorted.slice(0, limit), total: sorted.length, hasMore: sorted.length > limit };
}

export function operationalInsights(data) {
  if (!data) return [];
  const insights = [];
  const weekly = weeklyAppointmentSummary(data.appointmentTrend);
  if (weekly.highest) insights.push({ key: 'busiestDay', tone: 'info', date: weekly.highest.date, count: weekly.highest.count });
  const pending = Number(data.statusBreakdown?.pending);
  if (Number.isFinite(pending) && pending > 0) insights.push({ key: 'pendingReview', tone: 'warning', count: pending });
  const completion = Number(data.completionRate);
  if (Number(data.totalAppointments) > 0 && Number.isFinite(completion) && completion < 70) {
    insights.push({ key: 'completionNeedsAttention', tone: 'warning', rate: completion });
  }
  const cancelled = Number(data.statusBreakdown?.cancelled);
  if (Number(data.totalAppointments) > 0 && cancelled === 0) insights.push({ key: 'noCancellations', tone: 'success' });
  return insights;
}

export function statusLabelKey(status) {
  return `analyticsStatus${status}`;
}
