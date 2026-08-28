import { useEffect, useState } from 'react';
import { Eye, RefreshCw, Search, X } from 'lucide-react';
import { fetchWithAuth } from '../../services/staffApi.js';
import {
  actorDisplayName, auditDetailSummary, auditEventFallback, auditEventPresentation, formatAuditDateTime, shortTechnicalId
} from '../../utils/auditLogPresentation.js';
import './auditLog.css';

const EMPTY_FILTERS = Object.freeze({ search: '', action: '', role: '', from: '', to: '' });
const ROLES = ['ADMIN', 'RECEPTIONIST', 'DOCTOR', 'LAB_TECH', 'PHARMACIST', 'PATIENT'];

export default function AuditLogPanel({ lang, t }) {
  const [logs, setLogs] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 25, total: 0, totalPages: 0 });
  const [actions, setActions] = useState([]);
  const [draftFilters, setDraftFilters] = useState(EMPTY_FILTERS);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);

  const tr = (key, fallback) => {
    const translated = t(key);
    return translated === key ? fallback : translated;
  };

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const query = new URLSearchParams({ page: String(page), pageSize: '25' });
      Object.entries(filters).forEach(([key, value]) => { if (value) query.set(key, value); });
      const response = await fetchWithAuth(`/api/auth/audit-logs?${query}`);
      if (!response.ok) throw new Error('AUDIT_LOAD_FAILED');
      const payload = await response.json();
      setLogs(Array.isArray(payload.items) ? payload.items : []);
      setPagination(payload.pagination || { page, pageSize: 25, total: 0, totalPages: 0 });
      setActions(Array.isArray(payload.filters?.actions) ? payload.filters.actions.map(({ action }) => action) : []);
    } catch {
      setLogs([]);
      setError(tr('auditLoadError', lang === 'ar' ? 'تعذر تحميل سجل العمليات بأمان. حاول مرة أخرى.' : 'The audit log could not be loaded safely. Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [page, filters]); // eslint-disable-line react-hooks/exhaustive-deps

  const applyFilters = (event) => {
    event.preventDefault();
    setPage(1);
    setFilters({ ...draftFilters });
  };
  const resetFilters = () => {
    setDraftFilters(EMPTY_FILTERS);
    setFilters(EMPTY_FILTERS);
    setPage(1);
  };
  const eventLabel = (action) => {
    const presentation = auditEventPresentation(action);
    return presentation.labelKey ? tr(presentation.labelKey, auditEventFallback(action)) : auditEventFallback(action);
  };
  const roleLabel = (role) => tr(`auditRole${role}`, role?.replaceAll('_', ' ') || '—');
  const targetLabel = (target) => target
    ? `${tr(`auditTarget${target.type}`, target.type.replaceAll('_', ' '))} · ${shortTechnicalId(target.id)}`
    : tr('auditTargetUnavailable', lang === 'ar' ? 'المستهدف غير متاح بنيوياً' : 'Target not structurally available');

  return <section className="audit-panel glass-panel" aria-labelledby="audit-log-title">
    <header className="audit-heading">
      <div>
        <p className="audit-eyebrow">{tr('auditSecurityEyebrow', lang === 'ar' ? 'الأمان والمساءلة' : 'Security and accountability')}</p>
        <h2 id="audit-log-title">{tr('auditTitle', lang === 'ar' ? 'سجل العمليات والتدقيق الأمني' : 'Security audit log')}</h2>
        <p>{tr('auditSubtitle', lang === 'ar' ? 'سجل للقراءة فقط يوضح من نفّذ العملية ومتى.' : 'A read-only record showing who performed each operation and when.')}</p>
      </div>
      <div className="audit-count"><strong>{pagination.total}</strong><span>{tr('auditRecords', lang === 'ar' ? 'عملية مسجلة' : 'recorded events')}</span></div>
    </header>

    <form className="audit-filters" onSubmit={applyFilters}>
      <label className="audit-search"><span>{tr('auditSearchActor', lang === 'ar' ? 'البحث عن منفذ العملية' : 'Search actor')}</span><div><Search size={17}/><input value={draftFilters.search} maxLength={120} onChange={(event) => setDraftFilters({ ...draftFilters, search: event.target.value })} placeholder={tr('auditSearchPlaceholder', lang === 'ar' ? 'الاسم أو البريد الإلكتروني' : 'Name or email')}/></div></label>
      <label><span>{tr('auditEventType', lang === 'ar' ? 'نوع العملية' : 'Event type')}</span><select value={draftFilters.action} onChange={(event) => setDraftFilters({ ...draftFilters, action: event.target.value })}><option value="">{tr('auditAllEvents', lang === 'ar' ? 'كل العمليات' : 'All events')}</option>{actions.map((action) => <option key={action} value={action}>{eventLabel(action)}</option>)}</select></label>
      <label><span>{tr('auditActorRole', lang === 'ar' ? 'الدور' : 'Role')}</span><select value={draftFilters.role} onChange={(event) => setDraftFilters({ ...draftFilters, role: event.target.value })}><option value="">{tr('auditAllRoles', lang === 'ar' ? 'كل الأدوار' : 'All roles')}</option>{ROLES.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}</select></label>
      <label><span>{tr('auditFromDate', lang === 'ar' ? 'من تاريخ' : 'From')}</span><input type="date" value={draftFilters.from} onChange={(event) => setDraftFilters({ ...draftFilters, from: event.target.value })}/></label>
      <label><span>{tr('auditToDate', lang === 'ar' ? 'إلى تاريخ' : 'To')}</span><input type="date" value={draftFilters.to} min={draftFilters.from || undefined} onChange={(event) => setDraftFilters({ ...draftFilters, to: event.target.value })}/></label>
      <div className="audit-filter-actions"><button className="btn btn-primary" type="submit">{tr('auditApplyFilters', lang === 'ar' ? 'تطبيق الفلاتر' : 'Apply filters')}</button><button className="btn" type="button" onClick={resetFilters}><X size={16}/>{tr('auditResetFilters', lang === 'ar' ? 'إعادة ضبط' : 'Reset')}</button></div>
    </form>

    {loading ? <div className="audit-state" aria-live="polite"><RefreshCw className="audit-spin" size={22}/>{tr('auditLoading', lang === 'ar' ? 'جارٍ تحميل سجل العمليات...' : 'Loading audit log...')}</div>
      : error ? <div className="audit-state audit-state--error" role="alert"><p>{error}</p><button className="btn" type="button" onClick={load}>{tr('auditRetry', lang === 'ar' ? 'إعادة المحاولة' : 'Retry')}</button></div>
      : logs.length === 0 ? <div className="audit-state">{tr('auditEmpty', lang === 'ar' ? 'لا توجد عمليات مطابقة للفلاتر الحالية.' : 'No events match the current filters.')}</div>
      : <>
        <div className="audit-table-wrap"><table className="audit-table"><thead><tr><th>{tr('auditDateTime', lang === 'ar' ? 'التاريخ والوقت' : 'Date and time')}</th><th>{tr('auditActor', lang === 'ar' ? 'منفذ العملية' : 'Actor')}</th><th>{tr('auditActorRole', lang === 'ar' ? 'الدور' : 'Role')}</th><th>{tr('auditOperation', lang === 'ar' ? 'نوع العملية' : 'Operation')}</th><th>{tr('auditTarget', lang === 'ar' ? 'المستهدف' : 'Target')}</th><th>{tr('auditResultDetails', lang === 'ar' ? 'النتيجة / التفاصيل' : 'Result / details')}</th><th><span className="sr-only">{tr('auditViewDetails', lang === 'ar' ? 'عرض التفاصيل' : 'View details')}</span></th></tr></thead><tbody>{logs.map((log) => <AuditRow key={log.id} log={log} lang={lang} tr={tr} eventLabel={eventLabel} roleLabel={roleLabel} targetLabel={targetLabel} onOpen={setSelected}/>)}</tbody></table></div>
        <div className="audit-cards">{logs.map((log) => <AuditCard key={log.id} log={log} lang={lang} tr={tr} eventLabel={eventLabel} roleLabel={roleLabel} targetLabel={targetLabel} onOpen={setSelected}/>)}</div>
      </>}

    {!loading && !error && pagination.totalPages > 1 && <nav className="audit-pagination" aria-label={tr('auditPagination', lang === 'ar' ? 'صفحات سجل العمليات' : 'Audit log pages')}><button className="btn" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>{tr('auditPrevious', lang === 'ar' ? 'السابق' : 'Previous')}</button><span>{page} / {pagination.totalPages}</span><button className="btn" disabled={page >= pagination.totalPages} onClick={() => setPage((value) => value + 1)}>{tr('auditNext', lang === 'ar' ? 'التالي' : 'Next')}</button></nav>}
    {selected && <AuditDetails log={selected} lang={lang} tr={tr} eventLabel={eventLabel} roleLabel={roleLabel} targetLabel={targetLabel} onClose={() => setSelected(null)}/>}
  </section>;
}

function Actor({ actor, lang, tr }) {
  if (!actor) return <span className="audit-muted">{tr('auditActorUnavailable', lang === 'ar' ? 'مستخدم غير متاح' : 'Unavailable user')}</span>;
  const name = actorDisplayName(actor, lang);
  return <div className="audit-actor">{name && <strong>{name}</strong>}<span dir="ltr">{actor.email || actor.username}</span>{name && actor.email && actor.username !== actor.email && <small dir="ltr">{actor.username}</small>}</div>;
}

function AuditRow({ log, lang, tr, eventLabel, roleLabel, targetLabel, onOpen }) {
  const time = formatAuditDateTime(log.timestamp, lang);
  const presentation = auditEventPresentation(log.action);
  return <tr><td><time dateTime={log.timestamp}><strong>{time.date}</strong><span>{time.time}</span></time></td><td><Actor actor={log.actor} lang={lang} tr={tr}/></td><td><span className="audit-role">{roleLabel(log.actor?.role)}</span></td><td><span className={`audit-event audit-event--${presentation.tone}`}>{eventLabel(log.action)}</span></td><td className="audit-target">{targetLabel(log.target)}</td><td><span className="audit-detail-preview">{auditDetailSummary(log.details, lang)}</span></td><td><button type="button" className="audit-view" onClick={() => onOpen(log)} aria-label={tr('auditViewDetails', lang === 'ar' ? 'عرض التفاصيل' : 'View details')}><Eye size={18}/></button></td></tr>;
}

function AuditCard({ log, lang, tr, eventLabel, roleLabel, targetLabel, onOpen }) {
  const time = formatAuditDateTime(log.timestamp, lang);
  const presentation = auditEventPresentation(log.action);
  return <article className="audit-card"><div className="audit-card__top"><time dateTime={log.timestamp}><strong>{time.date}</strong><span>{time.time}</span></time><span className={`audit-event audit-event--${presentation.tone}`}>{eventLabel(log.action)}</span></div><Actor actor={log.actor} lang={lang} tr={tr}/><div className="audit-card__meta"><span className="audit-role">{roleLabel(log.actor?.role)}</span><span>{targetLabel(log.target)}</span></div><button type="button" className="btn" onClick={() => onOpen(log)}><Eye size={17}/>{tr('auditViewDetails', lang === 'ar' ? 'عرض التفاصيل' : 'View details')}</button></article>;
}

function AuditDetails({ log, lang, tr, eventLabel, roleLabel, targetLabel, onClose }) {
  const time = formatAuditDateTime(log.timestamp, lang);
  return <div className="audit-drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><aside className="audit-drawer" role="dialog" aria-modal="true" aria-labelledby="audit-details-title"><header><div><p className="audit-eyebrow">{tr('auditTechnicalDetails', lang === 'ar' ? 'تفاصيل السجل' : 'Record details')}</p><h3 id="audit-details-title">{eventLabel(log.action)}</h3></div><button type="button" className="audit-view" onClick={onClose} aria-label={tr('close', lang === 'ar' ? 'إغلاق' : 'Close')}><X/></button></header><dl><div><dt>{tr('auditActor', lang === 'ar' ? 'منفذ العملية' : 'Actor')}</dt><dd><Actor actor={log.actor} lang={lang} tr={tr}/><span className="audit-role">{roleLabel(log.actor?.role)}</span></dd></div><div><dt>{tr('auditTarget', lang === 'ar' ? 'المستهدف' : 'Target')}</dt><dd>{targetLabel(log.target)}</dd></div><div><dt>{tr('auditResultDetails', lang === 'ar' ? 'النتيجة / التفاصيل' : 'Result / details')}</dt><dd className="audit-details-text">{auditDetailSummary(log.details, lang)}</dd></div><div><dt>{tr('auditDateTime', lang === 'ar' ? 'التاريخ والوقت' : 'Date and time')}</dt><dd>{time.precise}</dd></div><div><dt>{tr('auditIpAddress', lang === 'ar' ? 'عنوان الشبكة' : 'IP address')}</dt><dd dir="ltr">{log.ipAddress || '—'}</dd></div><div><dt>{tr('auditEventIdentifier', lang === 'ar' ? 'معرّف نوع العملية' : 'Event identifier')}</dt><dd dir="ltr" className="audit-technical">{log.action}</dd></div><div><dt>{tr('auditRecordId', lang === 'ar' ? 'معرّف سجل التدقيق' : 'Audit record ID')}</dt><dd dir="ltr" className="audit-technical">{log.id}</dd></div>{log.target?.id && <div><dt>{tr('auditTargetId', lang === 'ar' ? 'المعرّف التقني للمستهدف' : 'Technical target ID')}</dt><dd dir="ltr" className="audit-technical">{log.target.id}</dd></div>}</dl></aside></div>;
}
