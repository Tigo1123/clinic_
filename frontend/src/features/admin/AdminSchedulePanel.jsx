import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, Clock3, Plus, Save, Trash2 } from 'lucide-react';
import { apiErrorMessage, fetchWithAuth } from '../../services/staffApi';
import './adminSchedule.css';
import { selectScheduleVersion } from './scheduleVersion';
import { createLatestGuard } from './latestRequest';

const weekdays = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
const blankPeriod = (dayOfWeek = 'MONDAY') => ({ dayOfWeek, startTime: '09:00', endTime: '17:00', slotDurationMinutes: 30, active: true, breaks: [] });
const clinicDate = (instant, timeZone) => { const values = Object.fromEntries(new Intl.DateTimeFormat('en', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant).map(({ type, value }) => [type, value])); return `${values.year}-${values.month}-${values.day}`; };

export default function AdminSchedulePanel({ t }) {
  const [doctors, setDoctors] = useState([]); const [doctorId, setDoctorId] = useState('');
  const [schedule, setSchedule] = useState(null); const [scheduleKind, setScheduleKind] = useState('empty'); const [periods, setPeriods] = useState([]); const [exceptions, setExceptions] = useState([]);
  const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [error, setError] = useState(''); const [success, setSuccess] = useState('');
  const [exceptionDate, setExceptionDate] = useState(''); const [exceptionReason, setExceptionReason] = useState('');
  const [ready, setReady] = useState(false);
  const [clinicTimeZone, setClinicTimeZone] = useState('Africa/Khartoum');
  const label = useCallback((key, fallback) => { const value = t?.(key); return value && value !== key ? value : fallback; }, [t]);
  const scheduleError = useCallback((data, fallback) => data?.error?.code === 'SCHEDULE_FUTURE_APPOINTMENT_CONFLICT'
    ? label('scheduleAppointmentConflict', 'This change would make a future appointment fall outside working hours or overlap a break. Adjust the hours, break, or effective dates first.')
    : apiErrorMessage(data, fallback), [label]);
  const guard = useRef(createLatestGuard()).current;
  const selectedDoctor = useMemo(() => doctors.find((doctor) => doctor.id === doctorId), [doctors, doctorId]);
  const read = useCallback(async (url) => {
    const response = await fetchWithAuth(url);
    const data = await response.json();
    if (!response.ok) throw new Error(apiErrorMessage(data, label('scheduleLoadError', 'Unable to load schedule.')));
    return data;
  }, [label]);
  const loadSchedule = useCallback(async (id) => {
    if (!id) return;
    const token = guard.start(id);
    setLoading(true); setReady(false); setError('');
    try {
      const [schedules, ex] = await Promise.all([
        read(`/api/admin/doctors/${id}/schedules`),
        read(`/api/admin/doctors/${id}/schedule-exceptions`)
      ]);
      if (!guard.isCurrent(token)) return;
      if (!Array.isArray(schedules) || !Array.isArray(ex)) throw new Error(label('scheduleLoadError', 'Unable to load schedule.'));
      const selection = selectScheduleVersion(schedules, clinicDate(new Date(), clinicTimeZone), { preferFuture: true });
      setSchedule(selection.schedule); setScheduleKind(selection.kind);
      setPeriods(selection.schedule?.periods?.map((p) => ({ ...p, breaks: p.breaks || [] })) || []);
      setExceptions(ex); setReady(true);
    } catch (e) {
      if (guard.isCurrent(token)) setError(e.message || label('scheduleLoadError', 'Unable to load schedule.'));
    } finally { if (guard.isCurrent(token)) setLoading(false); }
  }, [guard, read, label, clinicTimeZone]);
  useEffect(() => {
    let mounted = true;
    Promise.all([read('/api/appointments/doctors'), read('/api/public-config')]).then(([data, config]) => {
      if (!mounted) return;
      if (config?.clinicTimeZone) setClinicTimeZone(config.clinicTimeZone);
      setDoctors(Array.isArray(data) ? data : []);
      setDoctorId(data?.[0]?.id || '');
      if (!data?.length) setLoading(false);
    }).catch((e) => { if (mounted) { setError(e.message); setLoading(false); } });
    return () => { mounted = false; guard.start(null); };
  }, [read, guard]);
  useEffect(() => { if (doctorId) loadSchedule(doctorId); return () => { guard.start(null); }; }, [doctorId, guard, loadSchedule]);
  const switchDoctor = (nextId) => {
    guard.start(nextId); setLoading(Boolean(nextId)); setReady(false); setSaving(false);
    setError(''); setSuccess(''); setSchedule(null); setScheduleKind('empty');
    setPeriods([]); setExceptions([]); setExceptionDate(''); setExceptionReason(''); setDoctorId(nextId);
  };
  const updatePeriod = (index, patch) => setPeriods((current) => current.map((period, i) => i === index ? { ...period, ...patch } : period));
  const save = async (event) => {
    event.preventDefault();
    if (saving || loading || !doctorId || !ready) return;
    const token = guard.start(doctorId);
    const savingDoctorId = doctorId;
    setSaving(true); setError(''); setSuccess('');
    try {
      const today = clinicDate(new Date(), clinicTimeZone);
      const [year, month, day] = today.split('-').map(Number);
      const tomorrow = clinicDate(new Date(Date.UTC(year, month - 1, day + 1, 12)), clinicTimeZone);
      const currentIsEffective = Boolean(schedule?.id && schedule.effectiveFrom <= today);
      const body = {
        effectiveFrom: currentIsEffective ? tomorrow : (schedule?.effectiveFrom || today),
        effectiveTo: currentIsEffective ? (schedule?.effectiveTo >= tomorrow ? schedule.effectiveTo : null) : (schedule?.effectiveTo || null),
        active: true,
        periods: periods.map((period) => ({
          dayOfWeek: period.dayOfWeek, startTime: period.startTime, endTime: period.endTime,
          slotDurationMinutes: period.slotDurationMinutes, active: period.active !== false,
          breaks: (period.breaks || []).map((br) => ({ startTime: br.startTime, endTime: br.endTime, active: br.active !== false }))
        }))
      };
      const url = currentIsEffective ? `/api/admin/doctors/${doctorId}/schedules` : (schedule?.id ? `/api/admin/doctors/${doctorId}/schedules/${schedule.id}` : `/api/admin/doctors/${doctorId}/schedules`);
      const response = await fetchWithAuth(url, {
        method: currentIsEffective || !schedule?.id ? 'POST' : 'PUT', body: JSON.stringify(body)
      });
      const data = await response.json();
      if (!guard.isCurrent(token)) return;
      if (!response.ok) throw new Error(scheduleError(data, label('scheduleSaveError', 'Unable to save schedule.')));
      setSuccess(label('scheduleSaved', 'Schedule saved successfully.'));
      setSaving(false);
      await loadSchedule(savingDoctorId);
    } catch (e) {
      if (guard.isCurrent(token)) setError(e.message || label('scheduleSaveError', 'Unable to save schedule.'));
    } finally { if (guard.isCurrent(token)) setSaving(false); }
  };
  const addException = async (event) => { event.preventDefault(); if (!exceptionDate || saving || loading || !doctorId || !ready) return; const token = guard.start(doctorId); const savingDoctorId = doctorId; setSaving(true); setError(''); try { const response = await fetchWithAuth(`/api/admin/doctors/${doctorId}/schedule-exceptions/${exceptionDate}`, { method: 'PUT', body: JSON.stringify({ type: 'FULL_DAY_LEAVE', reason: exceptionReason || null, periods: [] }) }); const data = await response.json(); if (!guard.isCurrent(token)) return; if (!response.ok) throw new Error(scheduleError(data, label('exceptionSaveError', 'Unable to save exception.'))); setExceptionDate(''); setExceptionReason(''); setSuccess(label('exceptionSaved', 'Unavailable date saved.')); setSaving(false); await loadSchedule(savingDoctorId); } catch (e) { if (guard.isCurrent(token)) setError(e.message || label('exceptionSaveError', 'Unable to save exception.')); } finally { if (guard.isCurrent(token)) setSaving(false); } };
  const deactivateException = async (date) => { if (saving || loading || !doctorId || !ready || !globalThis.confirm(label('exceptionConfirm', 'Restore availability for this date?'))) return; const token = guard.start(doctorId); const savingDoctorId = doctorId; setSaving(true); try { const response = await fetchWithAuth(`/api/admin/doctors/${doctorId}/schedule-exceptions/${date}/status`, { method: 'PATCH', body: JSON.stringify({ active: false }) }); const data = await response.json(); if (!guard.isCurrent(token)) return; if (!response.ok) throw new Error(scheduleError(data, label('exceptionSaveError', 'Unable to update exception.'))); setSuccess(label('exceptionRestored', 'Availability restored.')); setSaving(false); await loadSchedule(savingDoctorId); } catch (e) { if (guard.isCurrent(token)) setError(e.message || label('exceptionSaveError', 'Unable to update exception.')); } finally { if (guard.isCurrent(token)) setSaving(false); } };
  if (loading && !doctors.length) return <div className="admin-schedule-panel" role="status">{label('loading', 'Loading…')}</div>;
  return <section className="admin-schedule-panel" aria-labelledby="admin-schedule-title">
    <header className="admin-schedule-header"><div><span className="admin-schedule-eyebrow"><CalendarDays size={16}/>{label('scheduleManagement', 'Schedule management')}</span><h2 id="admin-schedule-title">{label('scheduleTitle', 'Doctor availability')}</h2><p>{label('scheduleSubtitle', 'Manage recurring clinic hours and unavailable dates.')}</p></div><Clock3 size={28} aria-hidden="true"/></header>
    {error && <div className="badge badge-danger" role="alert">{error}</div>}{success && <div className="badge badge-success" role="status">{success}</div>}
    <label className="form-label" htmlFor="schedule-doctor">{label('selectDoctor', 'Doctor')}</label><select id="schedule-doctor" className="form-input" value={doctorId} onChange={(e) => switchDoctor(e.target.value)}><option value="">{label('selectDoctor', 'Select a doctor')}</option>{doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.fullNameEn || doctor.fullNameAr} — {doctor.specialty?.nameEn || doctor.specialtyEn || ''}</option>)}</select>
    {selectedDoctor && <p className="admin-schedule-doctor">{selectedDoctor.fullNameEn || selectedDoctor.fullNameAr} · {selectedDoctor.specialty?.nameEn || selectedDoctor.specialtyEn || selectedDoctor.specialty?.nameAr || selectedDoctor.specialtyAr || '—'}</p>}
    {loading && <p role="status">{label('scheduleLoading', 'Loading schedule…')}</p>}
    {saving && <p role="status">{label('saving', 'Saving…')}</p>}
    {!loading && doctorId && !ready && <button type="button" className="btn btn-secondary" onClick={() => loadSchedule(doctorId)}>{label('scheduleRetry', 'Retry loading schedule')}</button>}
    {scheduleKind === 'current' && <div className="admin-schedule-notice" role="note">{label('scheduleTomorrowNotice', 'Changes to the current schedule will take effect from tomorrow.')}</div>}
    {scheduleKind === 'future' && schedule && <div className="admin-schedule-notice" role="note">{t?.('scheduleFutureNotice', { date: schedule.effectiveFrom }) || `The selected schedule starts on ${schedule.effectiveFrom}.`}</div>}
    {!loading && ready && !schedule && <p className="admin-schedule-empty">{label('scheduleEmpty', 'No normalized schedule yet. Add a working period to begin.')}</p>}
    <form onSubmit={save}><fieldset disabled={saving || loading || !doctorId || !ready} className="admin-schedule-editor"><div className="admin-period-list">{periods.map((period, index) => <fieldset className="admin-period" key={period.id || index}><legend>{label(`weekday${period.dayOfWeek}`, period.dayOfWeek)}</legend><label>{label('scheduleWeekday', 'Day')}<select className="form-input" value={period.dayOfWeek} onChange={(e) => updatePeriod(index, { dayOfWeek: e.target.value })}>{weekdays.map((day) => <option key={day} value={day}>{label(`weekday${day}`, day)}</option>)}</select></label><label><input type="checkbox" checked={period.active !== false} onChange={(e) => updatePeriod(index, { active: e.target.checked })}/> {label('workingDay', 'Working day')}</label><div className="admin-period-grid"><label>{label('startTime', 'Start')}<input className="form-input" type="time" value={period.startTime} onChange={(e) => updatePeriod(index, { startTime: e.target.value })}/></label><label>{label('endTime', 'End')}<input className="form-input" type="time" value={period.endTime} onChange={(e) => updatePeriod(index, { endTime: e.target.value })}/></label><label>{label('slotDuration', 'Slot duration')}<input className="form-input" type="number" min="1" max="1440" value={period.slotDurationMinutes} onChange={(e) => updatePeriod(index, { slotDurationMinutes: Number(e.target.value) })}/></label></div><div className="admin-breaks"><strong>{label('breaks', 'Breaks')}</strong>{(period.breaks || []).map((br, bi) => <div className="admin-break" key={br.id || bi}><input className="form-input" type="time" value={br.startTime} onChange={(e) => updatePeriod(index, { breaks: period.breaks.map((b, i) => i === bi ? { ...b, startTime: e.target.value } : b) })}/><input className="form-input" type="time" value={br.endTime} onChange={(e) => updatePeriod(index, { breaks: period.breaks.map((b, i) => i === bi ? { ...b, endTime: e.target.value } : b) })}/><button type="button" className="btn btn-secondary" onClick={() => updatePeriod(index, { breaks: period.breaks.filter((_, i) => i !== bi) })} aria-label={label('removeBreak', 'Remove break')}><Trash2 size={15}/></button></div>)}<button type="button" className="btn btn-secondary" onClick={() => updatePeriod(index, { breaks: [...(period.breaks || []), { startTime: '12:00', endTime: '13:00', active: true }] })}><Plus size={14}/> {label('addBreak', 'Add break')}</button></div><button type="button" className="btn btn-secondary" onClick={() => setPeriods((current) => current.filter((_, i) => i !== index))}>{label('removePeriod', 'Remove day')}</button></fieldset>)}</div><div className="admin-schedule-actions"><button type="button" className="btn btn-secondary" onClick={() => setPeriods((current) => [...current, blankPeriod()])}><Plus size={15}/> {label('addWorkingDay', 'Add working period')}</button><button type="submit" className="btn btn-primary" disabled={saving || loading || !doctorId || !ready}><Save size={15}/> {saving ? label('saving', 'Saving…') : label('saveSchedule', 'Save schedule')}</button></div></fieldset></form>
    <form className="admin-exception-form" onSubmit={addException}><fieldset disabled={saving || loading || !doctorId || !ready} className="admin-schedule-editor"><h3>{label('unavailableDates', 'Unavailable dates')}</h3><div className="admin-period-grid"><label>{label('date', 'Date')}<input className="form-input" type="date" required value={exceptionDate} onChange={(e) => setExceptionDate(e.target.value)}/></label><label>{label('reason', 'Reason')}<input className="form-input" value={exceptionReason} onChange={(e) => setExceptionReason(e.target.value)} maxLength="500"/></label><button className="btn btn-primary" disabled={saving}>{label('markUnavailable', 'Mark unavailable')}</button></div>{exceptions.filter((item) => item.active).map((item) => <div className="admin-exception" key={item.id}><span>{item.date} — {item.reason || label('fullDayLeave', 'Full-day leave')}</span><button type="button" className="btn btn-secondary" onClick={() => deactivateException(item.date)}>{label('restoreDate', 'Restore')}</button></div>)}</fieldset></form>
  </section>;
}
