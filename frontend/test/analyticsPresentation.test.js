import test from 'node:test';
import assert from 'node:assert/strict';
import {
  authoritativeKpis, clinicWeekdayLabel, normalizeAppointmentTrend, operationalInsights,
  sortedDoctorVisits, statusDistribution, weeklyAppointmentSummary
} from '../src/utils/analyticsPresentation.js';

test('authoritative KPI values remain exact and unsupported comparisons are absent', () => {
  const kpis = authoritativeKpis({ totalPatients: 24, monthlyVisits: 9, completionRate: 75, financials: { totalRevenueSdg: 123456 } });
  assert.deepEqual(kpis.map(({ value }) => value), [24, 9, 75, 123456]);
  assert.equal(kpis.some((kpi) => 'comparison' in kpi || 'changePercent' in kpi), false);
  assert.deepEqual(authoritativeKpis({ totalPatients: null, financials: {} }).map(({ value }) => value), [null, null, null, null]);
});

test('weekly chart and summary use only returned values', () => {
  const trend = normalizeAppointmentTrend([
    { date: '2026-08-24', count: 2 }, { date: '2026-08-25', count: 5 }, { date: '2026-08-26', count: 1 }
  ]);
  assert.deepEqual(trend.map(({ count }) => count), [2, 5, 1]);
  assert.deepEqual(weeklyAppointmentSummary(trend), {
    highest: { date: '2026-08-25', count: 5 }, average: 2.7, total: 8
  });
  assert.deepEqual(weeklyAppointmentSummary([]), { highest: null, average: 0, total: 0 });
  assert.deepEqual(weeklyAppointmentSummary([{ date: '2026-08-24', count: 0 }]), { highest: null, average: 0, total: 0 });
});

test('clinic weekday labels do not shift with browser timezone', () => {
  assert.equal(clinicWeekdayLabel('2026-08-24', 'en'), 'Mon');
  assert.notEqual(clinicWeekdayLabel('2026-08-24', 'ar'), '—');
});

test('status distribution calculates authoritative percentages and tolerates unknown and zero states', () => {
  const statuses = statusDistribution([
    { status: 'COMPLETED', count: 3 }, { status: 'PENDING', count: 1 }, { status: 'FUTURE_STATE', count: 0 }
  ]);
  assert.deepEqual(statuses.map(({ percentage }) => percentage), [75, 25, 0]);
  assert.equal(statuses[2].color, '#64748b');
  assert.deepEqual(statusDistribution([{ status: 'PENDING', count: 0 }])[0].percentage, 0);
  assert.deepEqual(statusDistribution(null), []);
});

test('doctor visits are descending and bounded without exposing ordering assumptions', () => {
  const result = sortedDoctorVisits(Array.from({ length: 8 }, (_, index) => ({
    doctorId: `doctor-${index}`, fullNameEn: `Doctor ${index}`, visitsCount: index
  })));
  assert.deepEqual(result.items.map(({ visitsCount }) => visitsCount), [7, 6, 5, 4, 3, 2]);
  assert.equal(result.hasMore, true);
  assert.equal(result.total, 8);
});

test('operational insights are deterministic and disappear without supporting data', () => {
  const data = {
    totalAppointments: 10, completionRate: 40,
    appointmentTrend: [{ date: '2026-08-24', count: 1 }, { date: '2026-08-25', count: 4 }],
    statusBreakdown: { pending: 2, cancelled: 0 }
  };
  assert.deepEqual(operationalInsights(data).map(({ key }) => key), [
    'busiestDay', 'pendingReview', 'completionNeedsAttention', 'noCancellations'
  ]);
  assert.deepEqual(operationalInsights(null), []);
  assert.deepEqual(operationalInsights({ totalAppointments: 0, appointmentTrend: [], statusBreakdown: {} }), []);
});
