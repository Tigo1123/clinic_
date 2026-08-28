import { Activity, CalendarDays, CheckCircle2, CircleDollarSign, RefreshCw, Stethoscope, UsersRound } from 'lucide-react';
import { CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  authoritativeKpis, clinicWeekdayLabel, normalizeAppointmentTrend, operationalInsights,
  sortedDoctorVisits, statusDistribution, statusLabelKey, weeklyAppointmentSummary
} from '../../utils/analyticsPresentation.js';
import './analytics.css';

const KPI_ICONS = { patients: UsersRound, visits: CalendarDays, completion: CheckCircle2, revenue: CircleDollarSign };

export default function AnalyticsPanel({ data, loading, error, lang, t, onRefresh }) {
  const tr = (key, options) => t(key, options);
  return <section className="clinic-analytics" dir={lang === 'ar' ? 'rtl' : 'ltr'} aria-labelledby="analytics-title">
    <header className="analytics-header">
      <div><p className="analytics-eyebrow">{tr('analyticsEyebrow')}</p><h2 id="analytics-title">{tr('analyticsTitle')}</h2><p>{tr('analyticsSubtitle')}</p></div>
      <button type="button" className="analytics-refresh btn" onClick={onRefresh} disabled={loading}><RefreshCw size={17} className={loading ? 'analytics-spin' : ''}/>{tr('analyticsRefresh')}</button>
    </header>
    {loading ? <AnalyticsState kind="loading" text={tr('analyticsLoading')}/>
      : error ? <AnalyticsState kind="error" text={tr('analyticsLoadError')} action={onRefresh} actionLabel={tr('analyticsRetry')}/>
      : !data ? <AnalyticsState text={tr('analyticsNoData')}/>
      : <AnalyticsContent data={data} lang={lang} tr={tr}/>}
  </section>;
}

function AnalyticsState({ kind = 'empty', text, action, actionLabel }) {
  return <div className={`analytics-state analytics-state--${kind}`} role={kind === 'error' ? 'alert' : 'status'}>{kind === 'loading' && <span className="analytics-loader"/>}<p>{text}</p>{action && <button type="button" className="btn" onClick={action}>{actionLabel}</button>}</div>;
}

function AnalyticsContent({ data, lang, tr }) {
  const kpis = authoritativeKpis(data);
  const trend = normalizeAppointmentTrend(data.appointmentTrend).map((item) => ({ ...item, day: clinicWeekdayLabel(item.date, lang) }));
  const weekly = weeklyAppointmentSummary(trend);
  const statuses = statusDistribution(data.appointmentStatuses);
  const statusTotal = statuses.reduce((sum, item) => sum + item.count, 0);
  const doctors = sortedDoctorVisits(data.doctorVisits);
  const insights = operationalInsights(data);
  return <>
    <div className="analytics-kpis">{kpis.map((kpi) => <KpiCard key={kpi.key} kpi={kpi} lang={lang} tr={tr}/>)}</div>
    <div className="analytics-primary-grid">
      <article className="analytics-card analytics-trend-card"><CardHeading icon={Activity} title={tr('analyticsWeeklyTrend')} subtitle={tr('analyticsWeeklyTrendContext')}/>{trend.length && trend.some(({ count }) => count > 0) ? <><div className="analytics-line-chart" role="img" aria-label={tr('analyticsWeeklyChartAccessible')}><ResponsiveContainer width="100%" height="100%"><LineChart data={trend} margin={{ top: 12, right: 10, left: -20, bottom: 0 }}><CartesianGrid strokeDasharray="3 5" vertical={false} stroke="var(--color-border)"/><XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: 'var(--color-text-secondary)', fontSize: 12 }}/><YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: 'var(--color-text-secondary)', fontSize: 11 }}/><Tooltip content={<TrendTooltip tr={tr}/>}/><Line type="monotone" dataKey="count" name={tr('analyticsAppointments')} stroke="#1769e0" strokeWidth={3} dot={{ r: 4, fill: '#fff', strokeWidth: 3 }} activeDot={{ r: 6 }}/></LineChart></ResponsiveContainer></div><p className="analytics-chart-summary">{trend.map((item) => `${item.day}: ${item.count}`).join('، ')}</p></> : <EmptyData tr={tr}/>}</article>
      <QuickSummary summary={weekly} lang={lang} tr={tr}/>
    </div>
    <div className="analytics-secondary-grid">
      <StatusCard statuses={statuses} total={statusTotal} tr={tr}/>
      <DoctorCard doctors={doctors} lang={lang} tr={tr}/>
      <InsightsCard insights={insights} lang={lang} tr={tr}/>
    </div>
  </>;
}

function KpiCard({ kpi, lang, tr }) {
  const Icon = KPI_ICONS[kpi.key];
  const available = kpi.value !== null;
  const value = !available ? '—' : kpi.currency
    ? new Intl.NumberFormat(lang === 'ar' ? 'ar' : 'en').format(kpi.value)
    : new Intl.NumberFormat(lang === 'ar' ? 'ar' : 'en', { maximumFractionDigits: 1 }).format(kpi.value);
  return <article className={`analytics-kpi analytics-kpi--${kpi.tone}`}><div className="analytics-kpi__top"><span>{tr(kpi.labelKey)}</span><span className="analytics-kpi__icon"><Icon size={19} aria-hidden="true"/></span></div><strong>{value}{available && kpi.suffix}<small>{available && kpi.currency ? tr('analyticsCurrencySdg') : ''}</small></strong><p>{available ? tr(kpi.contextKey) : tr('analyticsMetricUnavailable')}</p></article>;
}

function CardHeading({ icon: Icon, title, subtitle }) {
  return <header className="analytics-card-heading"><span><Icon size={18}/></span><div><h3>{title}</h3>{subtitle && <p>{subtitle}</p>}</div></header>;
}

function TrendTooltip({ active, payload, label, tr }) {
  if (!active || !payload?.length) return null;
  return <div className="analytics-tooltip"><strong>{label}</strong><span>{payload[0].value} {tr('analyticsAppointments')}</span></div>;
}

function QuickSummary({ summary, lang, tr }) {
  return <article className="analytics-card analytics-quick"><CardHeading icon={CalendarDays} title={tr('analyticsQuickSummary')}/>{summary.highest ? <div className="analytics-quick__items"><div><span>{tr('analyticsBusiestDay')}</span><strong>{clinicWeekdayLabel(summary.highest.date, lang)}</strong><small>{summary.highest.count} {tr('analyticsAppointments')}</small></div><div><span>{tr('analyticsDailyAverage')}</span><strong>{new Intl.NumberFormat(lang === 'ar' ? 'ar' : 'en', { maximumFractionDigits: 1 }).format(summary.average)}</strong><small>{tr('analyticsAppointmentPerDay')}</small></div><div><span>{tr('analyticsSevenDayTotal')}</span><strong>{summary.total}</strong><small>{tr('analyticsAppointments')}</small></div></div> : <EmptyData tr={tr}/>}</article>;
}

function StatusCard({ statuses, total, tr }) {
  return <article className="analytics-card analytics-status-card"><CardHeading icon={Activity} title={tr('analyticsStatusDistribution')}/>{total > 0 ? <div className="analytics-status-layout"><div className="analytics-donut" role="img" aria-label={tr('analyticsStatusChartAccessible')}><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={statuses} dataKey="count" nameKey="status" innerRadius="62%" outerRadius="88%" paddingAngle={2} stroke="none">{statuses.map((item) => <Cell key={item.status} fill={item.color}/>)}</Pie><Tooltip formatter={(value, name) => [value, tr(statusLabelKey(name), { defaultValue: name.replaceAll('_', ' ') })]}/></PieChart></ResponsiveContainer><div><strong>{total}</strong><span>{tr('analyticsTotalAppointments')}</span></div></div><ul className="analytics-status-list">{statuses.map((item) => <li key={item.status}><i style={{ background: item.color }}/><span>{tr(statusLabelKey(item.status), { defaultValue: item.status.replaceAll('_', ' ') })}</span><strong>{item.count}</strong><small>{item.percentage}%</small></li>)}</ul></div> : <EmptyData tr={tr}/>}</article>;
}

function DoctorCard({ doctors, lang, tr }) {
  const max = Math.max(...doctors.items.map(({ visitsCount }) => visitsCount), 1);
  return <article className="analytics-card analytics-doctors"><CardHeading icon={Stethoscope} title={tr('analyticsDoctorVisits')}/>{doctors.items.length ? <><ol>{doctors.items.map((doctor) => <li key={doctor.doctorId}><div><strong>{lang === 'ar' ? doctor.fullNameAr : doctor.fullNameEn}</strong><span>{lang === 'ar' ? doctor.specialtyAr : doctor.specialtyEn}</span></div><b>{doctor.visitsCount} {tr('analyticsVisits')}</b><span className="analytics-doctor-bar"><i style={{ width: `${Math.round((doctor.visitsCount / max) * 100)}%` }}/></span></li>)}</ol>{doctors.hasMore && <p className="analytics-bounded-note">{tr('analyticsShowingTopDoctors', { count: doctors.items.length, total: doctors.total })}</p>}</> : <EmptyData tr={tr}/>}</article>;
}

function InsightsCard({ insights, lang, tr }) {
  return <article className="analytics-card analytics-insights"><CardHeading icon={CheckCircle2} title={tr('analyticsOperationalInsights')} subtitle={tr('analyticsInsightsContext')}/>{insights.length ? <ul>{insights.map((insight) => <li key={insight.key} className={`analytics-insight--${insight.tone}`}><span/><p>{insight.key === 'busiestDay' ? tr('analyticsInsightBusiest', { day: clinicWeekdayLabel(insight.date, lang), count: insight.count }) : insight.key === 'pendingReview' ? tr('analyticsInsightPending', { count: insight.count }) : insight.key === 'completionNeedsAttention' ? tr('analyticsInsightCompletion', { rate: insight.rate }) : tr('analyticsInsightNoCancellations')}</p></li>)}</ul> : <EmptyData tr={tr}/>}</article>;
}

function EmptyData({ tr }) { return <p className="analytics-empty">{tr('analyticsNoPeriodData')}</p>; }
