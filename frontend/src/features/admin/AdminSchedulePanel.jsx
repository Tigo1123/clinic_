import { useStaffPagedList } from '../../hooks/useStaffPagedList.js';
import StaffListPaging from '../../components/StaffListPaging.jsx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, Save } from 'lucide-react';
import { CacheProvider } from '@emotion/react';
import { ThemeProvider as MuiThemeProvider } from '@mui/material/styles';
import { Alert, Box, Button, Card, Chip, FormControlLabel, Grid, Stack, Switch, TextField, Typography } from '@mui/material';
import { useTheme } from '../../app/theme/ThemeContext.jsx';
import { createPatientMuiTheme, patientStyleCaches } from '../../utils/patientMuiTheme.js';
import ScheduleWeekEditor from './ScheduleWeekEditor.jsx';
import AppDatePicker from '../../components/ui/AppDatePicker.jsx';
import { apiErrorMessage, fetchWithAuth } from '../../services/staffApi';
import './adminSchedule.css';
import { nextScheduleDate, selectScheduleVersion } from './scheduleVersion';
import { createLatestGuard } from './latestRequest';
import { normalizeScheduleTime, schedulePeriodErrors, scheduleTimeMessage } from './scheduleTime.js';

const clinicDate = (instant, timeZone) => { const values = Object.fromEntries(new Intl.DateTimeFormat('en', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant).map(({ type, value }) => [type, value])); return `${values.year}-${values.month}-${values.day}`; };

export default function AdminSchedulePanel({ t, lang, initialDoctorId }) {
  const direction = lang === 'ar' ? 'rtl' : 'ltr';
  const { theme: mode } = useTheme();
  const muiTheme = useMemo(() => createPatientMuiTheme(mode, direction), [mode, direction]);
  const [validationAttempted, setValidationAttempted] = useState(false);
  const [reveal, setReveal] = useState(null);
  const [editorRevision, setEditorRevision] = useState(0);
  const doctorList = useStaffPagedList('/api/admin/doctors');
  const [initialDoctor, setInitialDoctor] = useState(null);
  const doctors = useMemo(() => [...new Map([...(initialDoctor ? [initialDoctor] : []), ...doctorList.data].map((doctor) => [doctor.id, doctor])).values()], [initialDoctor, doctorList.data]);
  const [doctorId, setDoctorId] = useState(initialDoctorId || '');
  const [schedule, setSchedule] = useState(null); const [scheduleKind, setScheduleKind] = useState('empty'); const [periods, setPeriods] = useState([]); const [exceptions, setExceptions] = useState([]);
  const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [error, setError] = useState(''); const [success, setSuccess] = useState('');
  const [exceptionDate, setExceptionDate] = useState(''); const [exceptionReason, setExceptionReason] = useState('');
  const [versions, setVersions] = useState([]);
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [effectiveTo, setEffectiveTo] = useState('');
  const [scheduleActive, setScheduleActive] = useState(true);
  const [configReady, setConfigReady] = useState(false);
  const [configAttempt, setConfigAttempt] = useState(0);
  const mutation = useRef(null);
  const previousInitialDoctorId = useRef(initialDoctorId);
  const [ready, setReady] = useState(false);
  const [clinicTimeZone, setClinicTimeZone] = useState('Africa/Khartoum');
  const label = useCallback((key, fallback) => { const value = t?.(key); return value && value !== key ? value : fallback; }, [t]);
  const scheduleError = useCallback((data, fallback) => data?.error?.code === 'SCHEDULE_FUTURE_APPOINTMENT_CONFLICT'
    ? label('scheduleAppointmentConflict', 'This change would make a future appointment fall outside working hours or overlap a break. Adjust the hours, break, or effective dates first.')
    : scheduleTimeMessage(data?.error?.code, lang, t) || apiErrorMessage(data, fallback), [label, lang, t]);
  const guard = useRef(createLatestGuard()).current;
  const selectedDoctor = useMemo(() => doctors.find((doctor) => doctor.id === doctorId), [doctors, doctorId]);
  const read = useCallback(async (url) => {
    const response = await fetchWithAuth(url);
    const data = await response.json();
    if (!response.ok) throw new Error(apiErrorMessage(data, label('scheduleLoadError', 'Unable to load schedule.')));
    return data;
  }, [label]);
  const applyVersion = useCallback((version, kind) => {
    setValidationAttempted(false); setReveal(null); setEditorRevision(revision => revision + 1);
    const today = clinicDate(new Date(), clinicTimeZone);
    const started = version?.effectiveFrom <= today;
    const from = started ? nextScheduleDate(today) : (version?.effectiveFrom || today);
    setSchedule(version); setScheduleKind(kind);
    setEffectiveFrom(from);
    setEffectiveTo(version?.effectiveTo >= from ? version.effectiveTo : '');
    setScheduleActive(version?.active !== false);
    setPeriods(version?.periods?.map(p => ({ ...p, breaks: p.breaks || [] })) || []);
  }, [clinicTimeZone]);
  const loadSchedule = useCallback(async (id) => {
    if (!id || !configReady) return;
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
      setVersions(schedules);
      applyVersion(selection.schedule, selection.kind);
      setExceptions(ex); setReady(true);
    } catch (e) {
      if (guard.isCurrent(token)) setError(e.message || label('scheduleLoadError', 'Unable to load schedule.'));
    } finally { if (guard.isCurrent(token)) setLoading(false); }
  }, [guard, read, label, clinicTimeZone, configReady, applyVersion]);
  useEffect(() => {
    let mounted = true;
    Promise.all([initialDoctorId ? read(`/api/admin/doctors/${initialDoctorId}`) : Promise.resolve(null), read('/api/public-config')]).then(([data, config]) => {
      if (!mounted) return;
      if (config?.clinicTimeZone) setClinicTimeZone(config.clinicTimeZone);
      setInitialDoctor(data);
      setConfigReady(true);
      setLoading(false);
    }).catch((e) => { if (mounted) { setError(e.message); setLoading(false); } });
    return () => { mounted = false; guard.start(null); };
  }, [read, guard, initialDoctorId, configAttempt]);
  useEffect(() => { if (doctorId) loadSchedule(doctorId); return () => { guard.start(null); }; }, [doctorId, guard, loadSchedule]);
  useEffect(() => { if (!doctorId && doctors.length) setDoctorId(doctors[0].id); }, [doctorId, doctors]);
  const switchDoctor = useCallback((nextId) => {
    guard.start(nextId); mutation.current = null; setLoading(Boolean(nextId)); setReady(false); setSaving(false);
    setError(''); setSuccess(''); setSchedule(null); setScheduleKind('empty');
    setVersions([]); setEffectiveFrom(''); setEffectiveTo(''); setScheduleActive(true);
    setValidationAttempted(false); setReveal(null);
    setPeriods([]); setExceptions([]); setExceptionDate(''); setExceptionReason(''); setDoctorId(nextId);
  }, [guard]);
  useEffect(() => {
    if (previousInitialDoctorId.current !== initialDoctorId) {
      previousInitialDoctorId.current = initialDoctorId;
      switchDoctor(initialDoctorId || '');
    }
  }, [initialDoctorId, switchDoctor]);
  const periodErrors = useMemo(() => validationAttempted ? schedulePeriodErrors(periods) : {}, [periods, validationAttempted]);
  const validatePeriod = index => {
    setValidationAttempted(true);
    return !schedulePeriodErrors(periods)[index];
  };
  const save = async (event) => {
    event.preventDefault();
    if (mutation.current || saving || loading || !doctorId || !ready) return;
    const errors = schedulePeriodErrors(periods);
    setValidationAttempted(true);
    const firstInvalid = Object.keys(errors)[0];
    if (firstInvalid !== undefined) {
      setSuccess(''); setError('');
      setReveal({ index: Number(firstInvalid), day: periods[firstInvalid].dayOfWeek });
      return;
    }
    if ((scheduleActive && !periods.some(period => period.active !== false)) || !event.currentTarget.checkValidity()) {
      setError(label('scheduleInvalidForm', 'Choose valid effective dates and at least one valid working period for an active schedule.'));
      return;
    }
    const token = guard.start(doctorId);
    const savingDoctorId = doctorId;
    mutation.current = token;
    setSaving(true); setError(''); setSuccess('');
    try {
      const today = clinicDate(new Date(), clinicTimeZone);
      const currentIsEffective = Boolean(schedule?.id && schedule.effectiveFrom <= today);
      const body = {
        effectiveFrom,
        effectiveTo: effectiveTo || null,
        active: scheduleActive,
        periods: periods.map((period) => ({
          dayOfWeek: period.dayOfWeek, startTime: normalizeScheduleTime(period.startTime), endTime: normalizeScheduleTime(period.endTime),
          slotDurationMinutes: period.slotDurationMinutes, active: period.active !== false,
          breaks: (period.breaks || []).map((br) => ({ startTime: normalizeScheduleTime(br.startTime), endTime: normalizeScheduleTime(br.endTime), active: br.active !== false }))
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
    } finally { if (mutation.current === token) { mutation.current = null; setSaving(false); } }
  };
  const saveExceptionChange = async (url, options, successMessage, clear = false, reloadVersion = false) => {
    if (mutation.current || saving || loading || !doctorId || !ready) return;
    const token = guard.start(doctorId);
    mutation.current = token;
    const savingDoctorId = doctorId;
    setSaving(true); setError(''); setSuccess('');
    try {
      const response = await fetchWithAuth(url, options);
      const data = await response.json();
      if (!guard.isCurrent(token)) return;
      if (!response.ok) throw new Error(scheduleError(data, label('exceptionSaveError', 'Unable to update availability.')));
      if (clear) { setExceptionDate(''); setExceptionReason(''); }
      setSuccess(successMessage);
      if (reloadVersion) await loadSchedule(savingDoctorId);
      else {
        const refreshed = await read(`/api/admin/doctors/${savingDoctorId}/schedule-exceptions`);
        if (!Array.isArray(refreshed)) throw new Error(label('scheduleLoadError', 'Unable to load schedule.'));
        if (guard.isCurrent(token)) setExceptions(refreshed);
      }
    } catch (e) { if (guard.isCurrent(token)) { setSuccess(''); setError(e.message); } }
    finally { if (mutation.current === token) { mutation.current = null; setSaving(false); } }
  };
  const addException = event => {
    event.preventDefault();
    if (!exceptionDate) return;
    return saveExceptionChange(`/api/admin/doctors/${doctorId}/schedule-exceptions/${exceptionDate}`, { method: 'PUT', body: JSON.stringify({ type: 'FULL_DAY_LEAVE', reason: exceptionReason || null, periods: [] }) }, label('exceptionSaved', 'Unavailable date saved.'), true);
  };
  const deactivateException = date => {
    if (!globalThis.confirm(label('exceptionConfirm', 'Restore availability for this date?'))) return;
    return saveExceptionChange(`/api/admin/doctors/${doctorId}/schedule-exceptions/${date}/status`, { method: 'PATCH', body: JSON.stringify({ active: false }) }, label('exceptionRestored', 'Availability restored.'));
  };
  const changeScheduleStatus = () => saveExceptionChange(`/api/admin/doctors/${doctorId}/schedules/${schedule.id}/status`, { method: 'PATCH', body: JSON.stringify({ active: !schedule.active }) }, label('scheduleSaved', 'Schedule saved successfully.'), false, true);
  const busy = saving || loading || !doctorId || !ready;
  const doctorName = doctor => (lang === 'ar' ? doctor.fullNameAr || doctor.fullNameEn : doctor.fullNameEn || doctor.fullNameAr);
  const selectVersion = event => {
    const version = versions.find(item => item.id === event.target.value) || null;
    const today = clinicDate(new Date(), clinicTimeZone);
    setError(''); setSuccess('');
    applyVersion(version, !version ? 'empty' : !version.active ? 'inactive' : version.effectiveFrom > today ? 'future' : version.effectiveTo && version.effectiveTo < today ? 'historical' : 'current');
    if (!version && versions.some(item => item.active && item.effectiveFrom <= today && (!item.effectiveTo || item.effectiveTo >= today))) setEffectiveFrom(nextScheduleDate(today));
  };
  return <CacheProvider value={patientStyleCaches[direction]}><MuiThemeProvider theme={muiTheme}>
    <Box component="section" className="admin-schedule-panel" dir={direction} aria-labelledby="admin-schedule-title" sx={{ maxWidth: 1440, width: '100%', minWidth: 0, mx: 'auto', overflowWrap: 'anywhere' }}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', gap: 3 }}>
        <Box><Typography component="h2" id="admin-schedule-title" variant="h5" fontWeight={750}>{label('scheduleManagement', 'Doctor schedules')}</Typography><Typography variant="body2" color="text.secondary">{label('scheduleWorkflowHint', 'Choose a doctor, set working days, then save.')}</Typography></Box>
        <CalendarDays size={24} aria-hidden="true" style={{ flexShrink: 0 }}/>
      </Stack>
      <Box component="form" id="doctor-schedule-form" onSubmit={save} noValidate>
        <Card component="section" variant="outlined" aria-labelledby="schedule-settings-title" sx={{ p: 4, mb: 3 }}>
          <Typography component="h3" variant="subtitle1" fontWeight={700} id="schedule-settings-title" sx={{ mb: 3 }}>{label('scheduleDoctorVersion', 'Doctor & schedule version')}</Typography>
          <Grid container spacing={3} className="admin-schedule-version" sx={{ alignItems: 'center' }}>
            <Grid size={{ xs: 12, sm: 6, lg: 3 }}><TextField fullWidth size="small" select id="schedule-doctor" label={label('selectDoctor', 'Doctor')} value={doctorId} onChange={event => switchDoctor(event.target.value)} slotProps={{ select: { native: true }, htmlInput: { id: 'schedule-doctor', dir: 'auto' }, inputLabel: { shrink: true } }}>
              <option value="">{label('selectDoctor', 'Select a doctor')}</option>{doctors.map(doctor => <option key={doctor.id} value={doctor.id}>{doctorName(doctor)} — {(lang === 'ar' ? doctor.specialty?.nameAr || doctor.specialtyAr || doctor.specialtyEn : doctor.specialty?.nameEn || doctor.specialtyEn || doctor.specialtyAr) || ''}</option>)}
            </TextField></Grid>
            <Grid size={{ xs: 12, sm: 6, lg: 3 }}><TextField fullWidth size="small" select id="schedule-version" label={label('scheduleVersion', 'Schedule version')} value={schedule?.id || ''} onChange={selectVersion} disabled={busy} slotProps={{ select: { native: true }, htmlInput: { id: 'schedule-version' } }}>
              <option value="">{label('scheduleNewVersion', 'New version')}</option>{versions.map(version => <option key={version.id} value={version.id}>{version.effectiveFrom} – {version.effectiveTo || '∞'} · {label(version.active ? 'scheduleVersionActive' : 'scheduleVersionInactive', version.active ? 'Active' : 'Inactive')}</option>)}
            </TextField></Grid>
            <Grid size={{ xs: 6, sm: 4, lg: 2 }}><AppDatePicker fullWidth size="small" label={label('effectiveFrom', 'Effective from')} required value={effectiveFrom} disabled={busy} onChange={setEffectiveFrom} minDate={schedule?.effectiveFrom <= clinicDate(new Date(), clinicTimeZone) ? nextScheduleDate(clinicDate(new Date(), clinicTimeZone)) : undefined}/></Grid>
            <Grid size={{ xs: 6, sm: 4, lg: 2 }}><AppDatePicker fullWidth size="small" label={label('effectiveTo', 'Effective to')} value={effectiveTo} disabled={busy} onChange={setEffectiveTo} minDate={effectiveFrom}/></Grid>
            <Grid size={{ xs: 12, sm: 4, lg: 2 }}><FormControlLabel sx={{ m: 0 }} control={<Switch checked={scheduleActive} disabled={busy} onChange={event => setScheduleActive(event.target.checked)}/>} label={label('scheduleVersionActive', 'Active')}/></Grid>
          </Grid>
          <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ mt: 2, alignItems: { sm: 'center' }, justifyContent: 'space-between', gap: 2 }}>
            <Box sx={{ minWidth: 0 }}><StaffListPaging list={doctorList} lang={lang} label={label('selectDoctor', 'Doctors')}/>{selectedDoctor && <Typography variant="caption" color="text.secondary"><bdi>{doctorName(selectedDoctor)}</bdi></Typography>}</Box>
            {schedule && <Button type="button" size="small" disabled={busy} onClick={changeScheduleStatus}>{label(schedule.active ? 'scheduleDeactivateVersion' : 'scheduleActivateVersion', schedule.active ? 'Deactivate selected version' : 'Activate selected version')}</Button>}
          </Stack>
          {scheduleKind === 'current' && <Typography component="p" variant="caption" color="text.secondary" role="note">{label('scheduleTomorrowNotice', 'Changes to the current schedule will take effect from tomorrow.')}</Typography>}
          {scheduleKind === 'future' && schedule && <Typography component="p" variant="caption" color="text.secondary" role="note">{t?.('scheduleFutureNotice', { date: schedule.effectiveFrom }) || `This schedule starts on ${schedule.effectiveFrom}.`}</Typography>}
          {loading && <Typography variant="body2" role="status">{label('scheduleLoading', 'Loading schedule…')}</Typography>}
          {!loading && !ready && <Button type="button" onClick={() => configReady ? loadSchedule(doctorId) : setConfigAttempt(attempt => attempt + 1)}>{label('scheduleRetry', 'Retry loading schedule')}</Button>}
        </Card>
        <Box component="fieldset" disabled={busy} className="admin-schedule-editor">
          <Card component="section" variant="outlined" aria-labelledby="schedule-week-title" sx={{ p: { xs: 3, sm: 4 } }}>
            <Stack direction="row" sx={{ mb: 3, justifyContent: 'space-between', alignItems: 'center', gap: 2 }}>
              <Typography component="h3" variant="subtitle1" fontWeight={700} id="schedule-week-title">{label('scheduleWeeklyTitle', 'Weekly schedule')}</Typography>
              <Chip size="small" label={`${new Set(periods.filter(period => period.active !== false).map(period => period.dayOfWeek)).size} / 7 ${label('scheduleWorkingDays', 'working days')}`}/>
            </Stack>
            <ScheduleWeekEditor key={`${doctorId}-${editorRevision}`} periods={periods} setPeriods={setPeriods} errors={periodErrors} reveal={reveal} validatePeriod={validatePeriod} lang={lang} label={label} t={t} disabled={busy}/>
            <Typography id="schedule-time-help" variant="caption" color="text.secondary" component="p" sx={{ mt: 3, mb: 0 }}>{lang === 'ar' ? `الأوقات حسب المنطقة الزمنية للعيادة (${clinicTimeZone}). تنتهي كل فترة في نفس اليوم. الفترات الممتدة بعد منتصف الليل غير مدعومة.` : `Clinic time (${clinicTimeZone}). Each period ends on the same day. Overnight schedules are not supported.`}</Typography>
          </Card>
        </Box>
        <Box className="schedule-save-bar" sx={{ position: 'sticky', bottom: 0, zIndex: 5, bgcolor: 'background.paper', border: 1, borderColor: 'divider', borderRadius: 2, p: 3, mt: 3, boxShadow: '0 -4px 16px rgba(0,0,0,.06)' }}>
          {error && <Alert severity="error" role="alert" sx={{ mb: 2 }}>{error}</Alert>}
          <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' }, gap: 2 }}>
            <Box sx={{ minWidth: 0, display: success || Object.keys(periodErrors).length ? 'block' : { xs: 'none', sm: 'block' } }}>{success ? <Typography role="status" color="success.main" variant="body2">{success}</Typography> : <Typography variant="body2" color={Object.keys(periodErrors).length ? 'error' : 'text.secondary'}>{Object.keys(periodErrors).length ? label('scheduleReviewDay', 'Review the highlighted day before saving.') : label('scheduleSaveHint', 'Save to apply the weekly schedule and effective dates.')}</Typography>}</Box>
            <Button type="submit" variant="contained" disabled={busy} aria-busy={saving} startIcon={<Save size={18}/>} sx={{ flexShrink: 0 }}>{saving ? label('saving', 'Saving…') : label('saveSchedule', 'Save Schedule')}</Button>
          </Stack>
        </Box>
      </Box>
      <Card component="section" variant="outlined" aria-labelledby="schedule-exceptions-title" sx={{ p: 4 }}>
        <Typography component="h3" variant="subtitle1" fontWeight={700} id="schedule-exceptions-title">{label('unavailableDates', 'Exceptions / unavailable dates')}</Typography>
        <Box component="form" className="admin-exception-form" onSubmit={addException} sx={{ mt: 3 }}>
          <Box component="fieldset" disabled={busy} className="admin-schedule-editor">
            <Grid container spacing={3} sx={{ alignItems: 'center' }}>
              <Grid size={{ xs: 12, sm: 4, lg: 3 }}><AppDatePicker fullWidth size="small" required label={label('date', 'Date')} value={exceptionDate} onChange={setExceptionDate}/></Grid>
              <Grid size={{ xs: 12, sm: 8, lg: 6 }}><TextField fullWidth size="small" label={label('reason', 'Reason')} value={exceptionReason} onChange={event => setExceptionReason(event.target.value)} slotProps={{ htmlInput: { maxLength: 500 } }}/></Grid>
              <Grid size={{ xs: 12, lg: 3 }}><Button type="submit" variant="outlined" fullWidth disabled={busy}>{label('markUnavailable', 'Add unavailable date')}</Button></Grid>
            </Grid>
            <Stack spacing={1} sx={{ mt: exceptions.some(item => item.active) ? 3 : 0 }}>
              {exceptions.filter(item => item.active).map(item => <Box key={item.id} className="admin-exception" sx={{ py: 2 }}>
                <Typography variant="body2" sx={{ minWidth: 0 }}><bdi dir="ltr">{item.date}</bdi> · {item.reason || label(item.type === 'SPECIAL_HOURS' ? 'scheduleSpecialHours' : 'fullDayLeave', item.type === 'SPECIAL_HOURS' ? 'Special hours' : 'Full-day leave')}</Typography>
                <Button type="button" size="small" disabled={busy} onClick={() => deactivateException(item.date)}>{label('restoreDate', 'Restore')}</Button>
              </Box>)}
            </Stack>
          </Box>
        </Box>
      </Card>
    </Box>
  </MuiThemeProvider></CacheProvider>;
}
