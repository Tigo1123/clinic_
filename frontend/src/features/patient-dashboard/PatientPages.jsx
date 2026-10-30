import { CacheProvider } from '@emotion/react';
import { ThemeProvider as MuiThemeProvider } from '@mui/material/styles';
import { Box, Button, Card, Chip, Grid, Paper, Stack, Typography } from '@mui/material';
import { useTheme } from '../../app/theme/ThemeContext.jsx';
import { patientStyleCaches, createPatientMuiTheme } from '../../utils/patientMuiTheme';
import { patientGreeting } from '../../utils/patientGreeting';
import { clearPatientSession } from '../../services/authStorage.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { patientApiRequest as apiRequest, apiFetch, localizedApiErrorMessage } from '../../services/apiClient';
import StatusBadge from '../../components/ui/StatusBadge';
import { GoogleIdentityButton } from '../patient-auth/GoogleIdentityButton.jsx';
import { CalendarDays, FileHeart, FlaskConical, HeartPulse, Pill, Search, Stethoscope, UserRound } from 'lucide-react';
import Dialog from '../../components/ui/Dialog';
import { EmptyState, ErrorState, Skeleton } from '../../components/feedback/States';
import { clinicCalendarDays } from '../../utils/clinicTime';
import { formatPatientDateTime } from '../../utils/patientRecord';
import { doctorMatchesDirectorySearch, doctorSpecialtyKey, doctorSpecialtyOptions, localizeDoctorSpecialty } from '../../utils/doctorSpecialty';
import { hasPendingAppointments } from '../../utils/appointmentStatus';
import PasswordField from '../../components/PasswordField.jsx';

const patientApiFetch = (path) => apiFetch(path, {}, 'patient');

function useApi(path,{pollWhen=null,pollInterval=45000}={}){
  const [result,setResult]=useState({path:null,data:null,error:null,loading:true});
  const [reloadToken,setReloadToken]=useState(0);
  const reload=useCallback(()=>{setResult(current=>({...current,error:null,loading:true}));setReloadToken(token=>token+1)},[]);
  useEffect(()=>{
    let current=true;
    let pollTimer;
    setResult((currentResult)=>currentResult.path===path?currentResult:{path,data:null,error:null,loading:true});
    apiRequest(path)
      .then(data=>{if(current){setResult({path,data,error:null,loading:false});if(pollWhen?.(data))pollTimer=setTimeout(()=>setReloadToken(token=>token+1),pollInterval)}})
      .catch(error=>{if(current)setResult({path,data:null,error,loading:false})});
    return()=>{current=false;clearTimeout(pollTimer)};
  },[path,reloadToken,pollWhen,pollInterval]);
  const isCurrent=result.path===path;
  return{data:isCurrent?result.data:null,error:isCurrent?result.error?.message||'':'',errorCode:isCurrent?result.error?.code:null,errorStatus:isCurrent?result.error?.status:null,loading:!isCurrent||result.loading,reload};
}
function usePagedList(path, { pageSize = 25, pollWhen = null, pollInterval = 45000 } = {}) {
  const [result, setResult] = useState({ data: null, error: null, loading: true, loadingMore: false, hasMore: false, page: 1 });
  const [reloadToken, setReloadToken] = useState(0);
  const reload = useCallback(() => setReloadToken((value) => value + 1), []);
  useEffect(() => {
    let active = true;
    let pollTimer;
    setResult({ data: null, error: null, loading: true, loadingMore: false, hasMore: false, page: 1 });
    const url = `${path}${path.includes('?') ? '&' : '?'}page=1&pageSize=${pageSize}`;
    patientApiFetch(url).then(async (response) => {
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(localizedApiErrorMessage({ code: body?.code || body?.error?.code, status: response.status }, 'Unable to load this list.'));
      if (!active) return;
      const data = Array.isArray(body) ? body : [];
      setResult({ data, error: null, loading: false, loadingMore: false, hasMore: response.headers.get('X-Has-More') === 'true', page: 1 });
      if (pollWhen?.(data)) pollTimer = setTimeout(() => setReloadToken((value) => value + 1), pollInterval);
    }).catch((error) => { if (active) setResult({ data: null, error: error.message, loading: false, loadingMore: false, hasMore: false, page: 1 }); });
    return () => { active = false; clearTimeout(pollTimer); };
  }, [path, pageSize, reloadToken, pollWhen, pollInterval]);
  const loadMore = useCallback(async () => {
    if (result.loadingMore || !result.hasMore) return;
    const nextPage = result.page + 1;
    setResult((current) => ({ ...current, loadingMore: true, error: null }));
    try {
      const url = `${path}${path.includes('?') ? '&' : '?'}page=${nextPage}&pageSize=${pageSize}`;
      const response = await patientApiFetch(url);
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(localizedApiErrorMessage({ code: body?.code || body?.error?.code, status: response.status }, 'Unable to load more records.'));
      setResult((current) => ({ ...current, data: [...(current.data || []), ...(Array.isArray(body) ? body : [])], loadingMore: false, hasMore: response.headers.get('X-Has-More') === 'true', page: nextPage }));
    } catch (error) {
      setResult((current) => ({ ...current, loadingMore: false, error: error.message }));
    }
  }, [path, pageSize, result.loadingMore, result.hasMore, result.page]);
  return { ...result, reload, loadMore };
}
function State({loading,error,onRetry,children}){if(loading)return <div className="patient-card"><Skeleton/></div>;if(error)return <ErrorState message={error} onRetry={onRetry}/>;return children}
function Empty({children}){return <div className="patient-card patient-empty">{children}</div>}
const doctorName=(doctor,lang)=>
  lang==='ar'
    ? (doctor?.fullNameAr || doctor?.fullNameEn)
    : (doctor?.fullNameEn || doctor?.fullNameAr);

export function Dashboard() {
  const { t, i18n } = useTranslation();
  const { theme: mode } = useTheme();
  const language = i18n.language?.startsWith('ar') ? 'ar' : 'en';
  const direction = language === 'ar' ? 'rtl' : 'ltr';
  const muiTheme = useMemo(() => createPatientMuiTheme(mode, direction), [mode, direction]);
  const profile = useApi('/api/patient/me');
  const appointments = useApi('/api/patient/appointments?group=upcoming', { pollWhen: hasPendingAppointments });
  const summary = useApi('/api/patient/summary');
  const labs = useApi('/api/patient/lab-results?pageSize=3');
  const records = useApi('/api/patient/medical-records?pageSize=3');
  const doctors = useApi('/api/patient/doctors');
  // The list API returns descending dates; the dashboard needs the nearest visit.
  const next = [...(appointments.data || [])].sort((a, b) =>
    `${a.appointmentDate}T${a.appointmentTime}`.localeCompare(`${b.appointmentDate}T${b.appointmentTime}`)
  )[0];
  const noDoctors = !doctors.loading && !doctors.error && doctors.data?.length === 0;
  const value = key => summary.error ? t('patientDataUnavailable') : summary.loading ? '…' : (summary.data?.[key] || 0).toLocaleString(language);
  const activity = [
    ...(labs.data || []).map(item => ({ id: `lab-${item.id}`, date: item.releasedAt || item.orderDate, title: t('laboratoryReport'), doctor: item.doctor, to: '/patient/lab-results', icon: <FlaskConical size={18}/> })),
    ...(records.data || []).map(item => ({ id: `record-${item.id}`, date: item.visitDate, title: t('medicalRecords'), doctor: item.doctor, to: '/patient/records', icon: <FileHeart size={18}/> })),
  ].sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0)).slice(0, 3);
  if (profile.errorCode === 'PATIENT_RECORD_NOT_LINKED') return <><h1>{t('claimRecord')}</h1><p className="patient-alert info">{t('claimInstructions')}</p><Link className="patient-button" to="/patient/claim">{t('claimRecord')}</Link></>;
  return <CacheProvider value={patientStyleCaches[direction]}><MuiThemeProvider theme={muiTheme}>
    <State loading={profile.loading} error={profile.error} onRetry={profile.reload}>
      <Stack className="patient-dashboard" spacing={5} dir={direction}>
        <Paper component="section" className="patient-hero patient-dashboard__greeting" sx={{ p: { xs: 4, sm: 5 }, m: 0 }}>
          <Box className="patient-hero__copy">
            <Typography component="span" variant="body2" className="patient-hero__eyebrow"><HeartPulse size={16} aria-hidden="true"/>{t('patientPortalShort')}</Typography>
            <Typography component="h1" variant="h1">{patientGreeting(profile.data, language)}</Typography>
            <Typography color="text.secondary">{t('patientHeroText')}</Typography>
          </Box>
          <Stack spacing={1} className="patient-dashboard__booking">
            <Button variant="contained" component={noDoctors || doctors.loading ? 'button' : Link} to={noDoctors || doctors.loading ? undefined : '/patient/doctors'} disabled={noDoctors || doctors.loading} aria-busy={doctors.loading} aria-describedby={noDoctors ? 'dashboard-booking-status' : undefined}><CalendarDays size={18} aria-hidden="true"/>{t('dashboardBookAppointment')}</Button>
            {noDoctors && <Typography id="dashboard-booking-status" variant="body2" color="text.secondary">{t('dashboardBookingUnavailable')}</Typography>}
          </Stack>
        </Paper>

        <Grid container spacing={3} aria-label={t('recentPatientInfo')}>
          {[['/patient/appointments', CalendarDays, 'upcomingAppointments', 'upcomingAppointments', 'primary'], ['/patient/lab-results', FlaskConical, 'recentLabResults', 'releasedLabResults', 'success'], ['/patient/prescriptions', Pill, 'prescriptions', 'prescriptions', 'warning'], ['/patient/records', FileHeart, 'medicalRecords', 'medicalRecords', 'primary']].map(([to, Icon, title, metric, accent]) => <Grid key={to} size={{ xs: 6, md: 3 }}>
            <Card component={Link} to={to} className="health-summary-card patient-dashboard__summary" sx={{ p: { xs: 3, sm: 4 }, height: '100%' }}>
              <Box className="patient-dashboard__icon" sx={{ color: `var(--color-${accent === 'primary' ? 'primary-strong' : accent})`, bgcolor: `var(--color-${accent}-soft)` }}><Icon size={20} aria-hidden="true"/></Box>
              <Typography component="h2" variant="body2" color="text.secondary">{t(title)}</Typography>
              <Typography component="strong" className="patient-dashboard__count" aria-live="polite">{value(metric)}</Typography>
            </Card>
          </Grid>)}
        </Grid>

        {hasPendingAppointments(appointments.data) && <aside className="patient-alert warning patient-pending-reminder"><strong>{t('appointmentPendingTitle')}</strong><p>{t('appointmentPendingReminder')}</p><Link className="patient-button secondary" to="/patient/appointments">{t('followMyAppointments')}</Link></aside>}

        <Grid container spacing={4} sx={{ alignItems: 'stretch' }}>
          <Grid size={{ xs: 12, md: 7 }}>
            <Paper component="section" className="patient-dashboard__panel" sx={{ p: { xs: 4, sm: 5 }, height: '100%' }} aria-labelledby="dashboard-upcoming-title">
              <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 2, mb: 4 }}><Typography id="dashboard-upcoming-title" component="h2" variant="h2">{t('upcomingAppointments')}</Typography><Button component={Link} to="/patient/appointments" size="small">{t('all')}</Button></Stack>
              <State loading={appointments.loading} error={appointments.error} onRetry={appointments.reload}>
                {next ? <Stack component="article" spacing={4}>
                  <Stack direction="row" spacing={3} sx={{ alignItems: 'center' }}>
                    <Box className="patient-dashboard__date"><Typography variant="body2">{new Date(`${next.appointmentDate}T00:00:00`).toLocaleDateString(language, { month: 'short' })}</Typography><Typography component="strong">{new Date(`${next.appointmentDate}T00:00:00`).getDate().toLocaleString(language)}</Typography></Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}><Typography component="h3" variant="h3">{doctorName(next.doctor, language)}</Typography><Typography variant="body2" color="text.secondary">{localizeDoctorSpecialty(next.doctor, language)}</Typography><Typography variant="body2"><bdi dir="ltr">{next.appointmentTime}</bdi></Typography></Box>
                  </Stack>
                  <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}><StatusBadge status={next.status} language={language}/><Button component={Link} to={`/patient/appointments/${next.id}`} variant="text">{t('details')}</Button></Stack>
                </Stack> : <DashboardEmpty icon={<CalendarDays size={24}/>} title={t('dashboardNoUpcoming')} description={t(noDoctors ? 'dashboardNoDoctorsHelp' : 'dashboardAppointmentsHelp')}/>}
              </State>
            </Paper>
          </Grid>
          <Grid size={{ xs: 12, md: 5 }}>
            <Paper component="section" className="patient-dashboard__panel" sx={{ p: { xs: 4, sm: 5 }, height: '100%' }} aria-labelledby="dashboard-actions-title">
              <Typography id="dashboard-actions-title" component="h2" variant="h2" sx={{ mb: 4 }}>{t('dashboardQuickActions')}</Typography>
              <Stack spacing={2} className="patient-dashboard__actions">
                {[[Stethoscope, 'doctors', '/patient/doctors'], [FileHeart, 'medicalRecords', '/patient/records'], [UserRound, 'profile', '/patient/profile']].map(([Icon, label, to]) => <Button key={to} component={Link} to={to} className="patient-dashboard__action" fullWidth><Box className="patient-dashboard__icon"><Icon size={19} aria-hidden="true"/></Box><span>{t(label)}</span></Button>)}
              </Stack>
            </Paper>
          </Grid>
        </Grid>

        <Paper component="section" className="patient-dashboard__panel" sx={{ p: { xs: 4, sm: 5 } }} aria-labelledby="dashboard-activity-title">
          <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 2, mb: 3 }}><Typography id="dashboard-activity-title" component="h2" variant="h2">{t('dashboardRecentActivity')}</Typography>{activity.length > 0 && <Chip size="small" label={t('released')}/>}</Stack>
          {activity.length > 0 ? <Stack component="ul" spacing={0} sx={{ listStyle: 'none', m: 0, p: 0 }}>{activity.map(item => <Box component="li" key={item.id}><Button className="patient-dashboard__activity" component={Link} to={item.to} fullWidth>
            <Box className="patient-dashboard__icon" aria-hidden="true">{item.icon}</Box><Box sx={{ flex: 1, textAlign: 'start' }}><Typography component="span" variant="h3" sx={{ display: 'block' }}>{item.title}</Typography><Typography component="span" variant="body2" color="text.secondary">{doctorName(item.doctor, language) || t('patientPortalShort')}</Typography></Box>{item.date && !Number.isNaN(Date.parse(item.date)) && <Typography component="time" dateTime={item.date} variant="body2" color="text.secondary">{new Date(item.date).toLocaleDateString(language, { month: 'short', day: 'numeric' })}</Typography>}
          </Button></Box>)}</Stack> : labs.error || records.error ? <ErrorState message={t('patientDataUnavailable')} onRetry={() => { labs.reload(); records.reload(); }}/> : labs.loading || records.loading ? <Skeleton/> : <DashboardEmpty icon={<FileHeart size={24}/>} title={t('dashboardNoActivity')} description={t('dashboardActivityHelp')}/>}
          {activity.length > 0 && (labs.error || records.error) && <Typography role="status" variant="body2" color="text.secondary" sx={{ mt: 2 }}>{t('dashboardPartialActivity')}</Typography>}
        </Paper>
      </Stack>
    </State>
  </MuiThemeProvider></CacheProvider>;
}

function DashboardEmpty({ icon, title, description }) {
  return <Stack className="patient-dashboard__empty" direction="row" spacing={3} sx={{ alignItems: 'flex-start', py: 3 }}>
    <Box className="patient-dashboard__icon" aria-hidden="true">{icon}</Box><Box><Typography component="h3" variant="h3">{title}</Typography><Typography variant="body2" color="text.secondary" sx={{ mt: 1, maxWidth: '60ch' }}>{description}</Typography></Box>
  </Stack>;
}

export function Doctors(){
  const { t, i18n } = useTranslation();
  const { data, error, loading, reload } = useApi('/api/patient/doctors');
  const [query, setQuery] = useState('');
  const [specialty, setSpecialty] = useState('');
  const language = i18n.language?.startsWith('ar') ? 'ar' : 'en';

  const specialties = doctorSpecialtyOptions(data || [], language);

  const filtered = (data || []).filter((doctor) => {
    const matchesQuery = doctorMatchesDirectorySearch(doctor, query);

    const matchesSpecialty =
      !specialty ||
      doctorSpecialtyKey(doctor) === specialty;

    return matchesQuery && matchesSpecialty;
  });

  return (
    <State loading={loading} error={error} onRetry={reload}>
      <div className="patient-doctors-directory" dir={language === 'ar' ? 'rtl' : 'ltr'}>
      <header className="doctor-search-header">
        <div>
          <span>{t('healthServices')}</span>
          <h1>{t('doctors')}</h1>
        </div>

        <label className="doctor-search">
          <Search size={19}/>
          <span className="sr-only">{t('searchDoctors')}</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('searchDoctors')}
          />
        </label>
      </header>

      {specialties.length > 0 && (
        <div
          className="specialty-chips"
          aria-label={t('selectSpecialty')}
        >
          <button
            className={!specialty ? 'selected' : ''}
            aria-pressed={!specialty}
            onClick={() => setSpecialty('')}
          >
            {t('all')}
          </button>

          {specialties.map((item) => (
            <button
              className={specialty === item.key ? 'selected' : ''}
              aria-pressed={specialty === item.key}
              onClick={() => setSpecialty(item.key)}
              key={item.key}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}

      <div className="section-heading-row">
        <h2>{t('doctors')}</h2>
        <span>{filtered.length}</span>
      </div>

      {!filtered.length ? (
        <Empty>{t('noDoctors')}</Empty>
      ) : (
        <div className="doctor-list">
          {filtered.map((doctor) => (
            <article
              className="patient-card doctor-card"
              key={doctor.id}
            >
              <div className="doctor-card__avatar">
                <UserRound/>
              </div>

              <div className="doctor-card__body">
                <h2>{doctorName(doctor, i18n.language)}</h2>

                <p>
                  {localizeDoctorSpecialty(doctor, language)}
                </p>

                <strong>
                  {Number(doctor.consultationFee).toLocaleString(
                    i18n.language === 'ar' ? 'ar' : 'en'
                  )}{' '}
                  {i18n.language === 'ar' ? 'ج.س' : 'SDG'}
                </strong>

                <div className="patient-actions">
                  <Link
                    className="patient-button secondary"
                    to={`/patient/doctors/${doctor.id}`}
                  >
                    {t('details')}
                  </Link>

                  <Link
                    className="patient-button"
                    to={`/patient/book/${doctor.id}`}
                  >
                    {t('book')}
                  </Link>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
      </div>
    </State>
  );
}

export function DoctorDetails(){const{id}=useParams();const{t,i18n}=useTranslation();const{data,error,loading,reload}=useApi(`/api/patient/doctors/${id}`);if(loading)return <div className="patient-card"><Skeleton/></div>;if(error)return <ErrorState message={error} onRetry={reload}/>;if(!data)return <EmptyState title={t('doctorNotFound')}/>;return <article className="patient-card doctor-profile"><div className="doctor-profile__avatar"><UserRound/></div><div><span className="doctor-profile__label"><Stethoscope size={16}/>{t('doctors')}</span><h1>{doctorName(data,i18n.language)}</h1><p>{localizeDoctorSpecialty(data,i18n.language)}</p><strong>
      {Number(data.consultationFee).toLocaleString(
        i18n.language === 'ar' ? 'ar' : 'en'
      )}{' '}
      {i18n.language === 'ar' ? 'ج.س' : 'SDG'}
    </strong></div><Link className="patient-button" to={`/patient/book/${id}`}><CalendarDays size={18}/>{t('bookAppointment')}</Link></article>}
export function BookAppointment() {
  const { doctorId } = useParams();
  const { t, i18n } = useTranslation();
  const [date, setDate] = useState('');
  const [slots, setSlots] = useState([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [time, setTime] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [successAppointmentId, setSuccessAppointmentId] = useState('');
  const days = clinicCalendarDays(7);

  useEffect(() => {
    let current = true;
    setSlots([]);
    setTime('');
    setError('');
    if (date) {
      setSlotsLoading(true);
      apiRequest(`/api/appointments/slots?doctorId=${doctorId}&date=${date}`)
        .then(value => { if (current) setSlots(value); })
        .catch((requestError) => { if (current) setError(requestError.message); })
        .finally(() => { if (current) setSlotsLoading(false); });
    } else {
      setSlotsLoading(false);
    }
    return () => { current = false; };
  }, [doctorId, date]);

  async function submit(event) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const appointment = await apiRequest('/api/patient/appointments', {
        method: 'POST',
        body: JSON.stringify({ doctorId, appointmentDate: date, appointmentTime: time })
      });
      setSuccessAppointmentId(appointment.id);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  if (successAppointmentId) {
    return <section className="patient-card patient-booking-pending">
      <div className="patient-alert success" role="status">
        <strong>{t('bookingRequestSent')}</strong>
        <p>{t('bookingPendingReview')}</p>
        <p>{t('bookingFollowStatus')}</p>
      </div>
      <div className="patient-actions">
        <Link className="patient-button" to="/patient/appointments">{t('followMyAppointments')}</Link>
        <Link className="patient-button secondary" to={`/patient/appointments/${successAppointmentId}`}>{t('details')}</Link>
      </div>
    </section>;
  }

  return <section className="patient-card">
    <h1>{t('bookAppointment')}</h1>
    <form onSubmit={submit}>
      <div className="section-heading-row"><h2>{t('selectDate')}</h2></div>
      <div className="date-strip">{days.map((day) => {
        const value = day.date;
        return <button type="button" className={`date-chip ${date === value ? 'selected' : ''}`} key={value} onClick={() => { setDate(value); setTime(''); }} aria-pressed={date === value} aria-label={day.calendarDate.toLocaleDateString(i18n.language, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })}>
          <span>{day.calendarDate.toLocaleDateString(i18n.language, { weekday: 'short', timeZone: 'UTC' })}</span>
          <strong>{day.calendarDate.getUTCDate().toLocaleString(i18n.language)}</strong>
          <span>{day.calendarDate.toLocaleDateString(i18n.language, { month: 'short', timeZone: 'UTC' })}</span>
        </button>;
      })}</div>
      {date && <fieldset className="patient-card">
        <legend>{t('selectTime')}</legend>
        <div className="slot-grid">{slots.map((slot) => <button type="button" className={`slot-chip ${time === slot ? 'selected' : ''}`} key={slot} onClick={() => setTime(slot)} aria-pressed={time === slot}>{slot}</button>)}</div>
        {slotsLoading ? <p role="status">{t('loading')}</p> : !slots.length && !error && <p>{t('noSlots')}</p>}
      </fieldset>}
      {error && <div className="patient-alert error" role="alert">{error}</div>}
      <button className="patient-button" style={{ width: '100%' }} disabled={!time || loading || slotsLoading} aria-busy={loading}>{loading ? t('loading') : t('confirmBooking')}</button>
    </form>
  </section>;
}

export function Appointments() {
  const { t, i18n } = useTranslation();
  const [group, setGroup] = useState('upcoming');
  const { data, error, loading, loadingMore, hasMore, loadMore, reload } = usePagedList(`/api/patient/appointments?group=${group}`, { pageSize: 25, pollWhen: hasPendingAppointments });
  return <State loading={loading} error={error} onRetry={reload}>
    <h1>{t('myAppointments')}</h1>
    <div className="patient-tabs" role="group" aria-label={t('myAppointments')}>{['upcoming', 'past', 'cancelled', 'all'].map((item) => <button className={`patient-button ${group === item ? '' : 'secondary'}`} aria-pressed={group === item} onClick={() => setGroup(item)} key={item}>{t(item)}</button>)}</div>
    {!data?.length ? <Empty>{t('noAppointments')}</Empty> : <div className="patient-list">{data.map((appointment) => <article className="patient-card patient-row" key={appointment.id}>
      <div>
        <h2>{doctorName(appointment.doctor, i18n.language)}</h2>
        <p><bdi dir="ltr">{appointment.appointmentDate} · {appointment.appointmentTime}</bdi></p>
        <StatusBadge status={appointment.status} language={i18n.language}/>
      </div>
      <Link className="patient-button secondary" to={`/patient/appointments/${appointment.id}`}>{t('details')}</Link>
    </article>)}</div>}
    {hasMore && <button type="button" className="patient-button secondary" onClick={loadMore} disabled={loadingMore}>{loadingMore ? t('loading') : t('loadMore')}</button>}
  </State>;
}
export function AppointmentDetails(){
  const{id}=useParams();
  const{t,i18n}=useTranslation();
  const{data:appointment,error,errorStatus,loading,reload}=useApi(`/api/patient/appointments/${id}`);
  const[actionError,setActionError]=useState('');
  const[confirming,setConfirming]=useState(false);
  const[cancelling,setCancelling]=useState(false);

  useEffect(()=>{setActionError('');setConfirming(false);setCancelling(false)},[id]);

  async function cancel(){
    setCancelling(true);
    setActionError('');
    try{await apiRequest(`/api/patient/appointments/${id}/cancel`,{method:'POST'});setConfirming(false);reload()}
    catch(requestError){setActionError(requestError.message)}
    finally{setCancelling(false)}
  }

  if(loading)return <div className="patient-card"><Skeleton/></div>;
  if(errorStatus===404)return <EmptyState title={t('appointmentNotFound')} message={t('appointmentNotFoundMessage')}/>;
  if(error)return <ErrorState message={error} onRetry={reload}/>;
  if(!appointment)return <EmptyState title={t('appointmentNotFound')} message={t('appointmentNotFoundMessage')}/>;

  const canModify=['PENDING','SCHEDULED','CONFIRMED'].includes(appointment.status);
  return <article className="patient-card"><h1>{t('appointmentDetails')}</h1><StatusBadge status={appointment.status} language={i18n.language}/><h2 style={{marginTop:'1.25rem'}}>{doctorName(appointment.doctor,i18n.language)}</h2><p><bdi dir="ltr">{appointment.appointmentDate} · {appointment.appointmentTime}</bdi></p><p>#{String(appointment.id).slice(0,8).toUpperCase()}</p>{actionError&&<div className="patient-alert error" role="alert">{actionError}</div>}{canModify&&<div className="patient-actions" style={{marginTop:'1.25rem'}}><Link className="patient-button secondary" to={`/patient/appointments/${id}/reschedule`}>{t('rescheduleAppointment')}</Link><button className="patient-button" onClick={()=>setConfirming(true)}>{t('cancelAppointment')}</button></div>}<Dialog open={confirming} onClose={()=>!cancelling&&setConfirming(false)} title={t('cancelAppointmentQuestion')} description={t('cancelWarning')}><div className="ui-dialog__details"><strong>{doctorName(appointment.doctor,i18n.language)}</strong><span dir="ltr">{appointment.appointmentDate}</span><span dir="ltr">{appointment.appointmentTime}</span></div>{actionError&&<div className="patient-alert error" role="alert">{actionError}</div>}<div className="ui-dialog__actions"><button className="ui-button ui-button--outline" onClick={()=>setConfirming(false)} disabled={cancelling}>{t('keepAppointment')}</button><button className="ui-button ui-button--danger" onClick={cancel} disabled={cancelling} aria-busy={cancelling}>{cancelling?t('loading'):t('cancelAppointment')}</button></div></Dialog></article>;
}

export function LabResults() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith('ar') ? 'ar' : 'en';

  const getTestName = (test) => {
    if (test?.service) {
      return lang === 'ar'
        ? test.service.labelAr || test.service.labelEn
        : test.service.labelEn || test.service.labelAr;
    }

    return test?.customTestName || t('customLabTest');
  };

  const getReferenceRange = (test) => {
    const min = test?.referenceRangeMin;
    const max = test?.referenceRangeMax;

    if (min == null && max == null) {
      return t('notAvailable');
    }

    if (min != null && max != null) {
      return `${min} – ${max}`;
    }

    if (min != null) {
      return `${t('greaterThanOrEqual')} ${min}`;
    }

    return `${t('lessThanOrEqual')} ${max}`;
  };

  const formatDate = (value) => {
    if (!value) return t('notAvailable');

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return t('notAvailable');
    }

    return date.toLocaleDateString(
      lang === 'ar' ? 'ar' : 'en',
      {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      }
    );
  };

  return (
    <Collection
      path="/api/patient/lab-results"
      titleKey="labResults"
      render={(item) => {
        const doctor = item?.doctor;
        const doctorDisplayName = doctor
          ? doctorName(doctor, lang)
          : t('notAvailable');

        return (
          <div className="patient-lab-result">
            <div className="patient-lab-result__header">
              <div>
                <span className="patient-lab-result__eyebrow">
                  {t('laboratoryReport')}
                </span>

                <h2>
                  {t('labOrderDate')}: {formatDate(item.orderDate)}
                </h2>
              </div>

              <span className="patient-lab-result__released">
                {t('released')}
              </span>
            </div>

            <div className="patient-lab-result__meta">
              <div>
                <span>{t('doctor')}</span>
                <strong>{doctorDisplayName}</strong>
              </div>

              <div>
                <span>{t('releasedAt')}</span>
                <strong>{formatPatientDateTime(item.releasedAt, lang, t('notAvailable'))}</strong>
              </div>

              <div>
                <span>{t('testsCount')}</span>
                <strong>{item.tests?.length || 0}</strong>
              </div>
            </div>

            <div className="patient-lab-tests">
              {(item.tests || []).map((test) => {
                const abnormal = Boolean(test.isOutOfRange);

                return (
                  <article
                    className={`patient-lab-test ${
                      abnormal
                        ? 'patient-lab-test--abnormal'
                        : 'patient-lab-test--normal'
                    }`}
                    key={test.id}
                  >
                    <div className="patient-lab-test__heading">
                      <div>
                        <span className="patient-lab-test__category">
                          {t('laboratoryReport')}
                        </span>

                        <h3>{getTestName(test)}</h3>
                      </div>

                      <span
                        className={`patient-lab-status ${
                          abnormal
                            ? 'patient-lab-status--abnormal'
                            : 'patient-lab-status--normal'
                        }`}
                      >
                        {abnormal
                          ? t('abnormalResult')
                          : t('normalResult')}
                      </span>
                    </div>

                    <div className="patient-lab-test__result">
                      <span>{t('result')}</span>
                      <strong><bdi dir="auto">{test.resultValue ?? t('notAvailable')}</bdi></strong>
                    </div>

                    <div className="patient-lab-test__details">
                      <div>
                        <span>{t('referenceRange')}</span>
                        <strong><bdi dir="ltr">{getReferenceRange(test)}</bdi></strong>
                      </div>

                      <div>
                        <span>{t('resultStatus')}</span>
                        <strong>
                          {abnormal
                            ? t('outsideReferenceRange')
                            : t('withinReferenceRange')}
                        </strong>
                      </div>
                    </div>

                    {test.attachmentPath && (
                      <div className="patient-lab-test__actions">
                        <a
                          className="patient-button secondary"
                          href={test.attachmentPath}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {t('viewLabAttachment')}
                        </a>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>

            <p className="patient-lab-disclaimer">
              {t('labResultDisclaimer')}
            </p>
          </div>
        );
      }}
    />
  );
}

export function Prescriptions(){
  const { i18n } = useTranslation();
  const lang = i18n.language?.startsWith('ar') ? 'ar' : 'en';

  return (
    <Collection
      path="/api/patient/prescriptions"
      titleKey="prescriptions"
      render={item=>(
        <>
          <h2>{new Date(item.prescriptionDate).toLocaleDateString(i18n.language)}</h2>
          {item.medicines.map(m=>(
            <p key={m.id}>
              {lang === 'ar'
                ? m.medicine?.labelAr || m.medicine?.labelEn || m.customDrugName
                : m.medicine?.labelEn || m.medicine?.labelAr || m.customDrugName
              }
              {' — '}
              {m.dosage}, {m.duration}
            </p>
          ))}
        </>
      )}
    />
  );
}
export function MedicalRecords(){
  const { t, i18n } = useTranslation();
  const {
    data,
    error,
    loading,
    reload,
    loadingMore, hasMore, loadMore
  } = usePagedList('/api/patient/medical-records');

  const [selectedRecord, setSelectedRecord] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const detailRequest = useRef(0);

  const lang =
    i18n.language?.startsWith('ar')
      ? 'ar'
      : 'en';

  const openRecord = async (recordId) => {
    const requestId = ++detailRequest.current;
    setDetailLoading(true);
    setDetailError('');
    setSelectedRecord({ id: recordId });

    try {
      const details = await apiRequest(
        `/api/patient/medical-records/${recordId}`
      );

      if (requestId === detailRequest.current) setSelectedRecord(details);
    } catch (requestError) {
      if (requestId === detailRequest.current) setDetailError(
        requestError?.message ||
        (
          lang === 'ar'
            ? 'تعذر تحميل تفاصيل السجل الطبي.'
            : 'Unable to load medical record details.'
        )
      );
    } finally {
      if (requestId === detailRequest.current) setDetailLoading(false);
    }
  };

  const closeRecord = () => {
    detailRequest.current += 1;
    setSelectedRecord(null);
    setDetailError('');
    setDetailLoading(false);
  };

  return (
    <State loading={loading} error={error} onRetry={reload}>
      <h1>{t('medicalRecords')}</h1>

      {!data?.length ? (
        <Empty>{t('noRecords')}</Empty>
      ) : (
        <div className="patient-list">
          {data.map((item) => (
            <button
              type="button"
              className="patient-card medical-record-card"
              key={item.id}
              onClick={() => openRecord(item.id)}
            >
              <div className="medical-record-card__header">
                <div>
                  <span className="medical-record-card__date">
                    <CalendarDays size={17}/>

                    {new Date(item.visitDate)
                      .toLocaleDateString(i18n.language)}
                  </span>

                  <h2>
                    {doctorName(
                      item.doctor,
                      i18n.language
                    )}
                  </h2>

                  <p>
                    {lang === 'ar'
                      ? (
                          item.doctor?.specialtyAr ||
                          item.doctor?.specialtyEn
                        )
                      : (
                          item.doctor?.specialtyEn ||
                          item.doctor?.specialtyAr
                        )}
                  </p>
                </div>

                <span className="medical-record-card__open">
                  {lang === 'ar'
                    ? 'عرض التفاصيل'
                    : 'View details'}
                </span>
              </div>

              <div className="medical-record-card__summary">
                <p>
                  <strong>
                    {t('diagnosisLabel')}:
                  </strong>{' '}
                  {item.diagnosis || '—'}
                </p>

                <p>
                  <strong>
                    {t('treatmentLabel')}:
                  </strong>{' '}
                  {item.treatment || '—'}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}

      {hasMore && <button type="button" className="patient-button secondary" onClick={loadMore} disabled={loadingMore}>{loadingMore ? t('loading') : t('loadMore')}</button>}

      <Dialog
        open={Boolean(selectedRecord)}
        title={
          lang === 'ar'
            ? 'تفاصيل السجل الطبي'
            : 'Medical Record Details'
        }
        description={
          lang === 'ar'
            ? 'تفاصيل الزيارة والتشخيص والعلاج والوصفات والنتائج المتاحة لك.'
            : 'Visit details, diagnosis, treatment, prescriptions and released results.'
        }
        onClose={closeRecord}
      >
        {detailLoading ? (
          <div style={{ padding: '1rem 0' }}>
            <Skeleton/>
          </div>
        ) : detailError ? (
          <div className="patient-alert error" role="alert">
            {detailError}
          </div>
        ) : selectedRecord?.visitDate ? (
          <div className="medical-record-details">

            <section>
              <h3>
                {lang === 'ar'
                  ? 'معلومات الزيارة'
                  : 'Visit Information'}
              </h3>

              <p>
                <strong>
                  {lang === 'ar'
                    ? 'التاريخ:'
                    : 'Date:'}
                </strong>{' '}

                {new Date(
                  selectedRecord.visitDate
                ).toLocaleString(i18n.language)}
              </p>

              <p>
                <strong>
                  {lang === 'ar'
                    ? 'الطبيب:'
                    : 'Doctor:'}
                </strong>{' '}

                {doctorName(
                  selectedRecord.doctor,
                  i18n.language
                )}
              </p>

              <p>
                <strong>
                  {lang === 'ar'
                    ? 'التخصص:'
                    : 'Specialty:'}
                </strong>{' '}

                {lang === 'ar'
                  ? (
                      selectedRecord.doctor
                        ?.specialtyAr ||
                      selectedRecord.doctor
                        ?.specialtyEn
                    )
                  : (
                      selectedRecord.doctor
                        ?.specialtyEn ||
                      selectedRecord.doctor
                        ?.specialtyAr
                    )}
              </p>
            </section>

            <section>
              <h3>
                {lang === 'ar'
                  ? 'التقييم الطبي'
                  : 'Clinical Assessment'}
              </h3>

              <p>
                <strong>
                  {lang === 'ar'
                    ? 'الأعراض:'
                    : 'Symptoms:'}
                </strong>{' '}

                {selectedRecord.symptoms || '—'}
              </p>

              <p>
                <strong>
                  {t('diagnosisLabel')}:
                </strong>{' '}

                {selectedRecord.diagnosis || '—'}
              </p>

              <p>
                <strong>
                  {t('treatmentLabel')}:
                </strong>{' '}

                {selectedRecord.treatment || '—'}
              </p>
            </section>

            {selectedRecord.vitalSigns &&
              Object.keys(
                selectedRecord.vitalSigns
              ).length > 0 && (
              <section>
                <h3>
                  {lang === 'ar'
                    ? 'العلامات الحيوية'
                    : 'Vital Signs'}
                </h3>

                <div className="medical-vitals-grid">
                  {Object.entries(
                    selectedRecord.vitalSigns
                  ).map(([key, value]) => (
                    <div key={key}>
                      <span>
                        {t(`patientVital_${key}`, { defaultValue: key.replaceAll('_', ' ') })}
                      </span>

                      <strong dir="ltr">
                        {value ?? '—'}
                      </strong>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section>
              <h3>
                {lang === 'ar'
                  ? 'الوصفات الطبية'
                  : 'Prescriptions'}
              </h3>

              {!selectedRecord.prescriptions
                ?.some(
                  (prescription) =>
                    prescription.medicines?.length
                ) ? (
                <p>
                  {lang === 'ar'
                    ? 'لا توجد أدوية في هذه الزيارة.'
                    : 'No medicines were prescribed during this visit.'}
                </p>
              ) : (
                selectedRecord.prescriptions
                  .flatMap(
                    (prescription) =>
                      prescription.medicines || []
                  )
                  .map((medicine) => (
                    <div
                      key={medicine.id}
                      className="medical-detail-item"
                    >
                      <strong>
                        {lang === 'ar'
                          ? (
                              medicine.medicine
                                ?.labelAr ||
                              medicine.medicine
                                ?.labelEn ||
                              medicine.customDrugName
                            )
                          : (
                              medicine.medicine
                                ?.labelEn ||
                              medicine.medicine
                                ?.labelAr ||
                              medicine.customDrugName
                            )}
                      </strong>

                      <p>
                        {lang === 'ar'
                          ? 'الجرعة'
                          : 'Dosage'}
                        :{' '}
                        {medicine.dosage || '—'}
                      </p>

                      <p>
                        {lang === 'ar'
                          ? 'المدة'
                          : 'Duration'}
                        :{' '}
                        {medicine.duration || '—'}
                      </p>

                      {(medicine.instructionsAr ||
                        medicine.instructionsEn) && (
                        <p>
                          {lang === 'ar'
                            ? 'التعليمات'
                            : 'Instructions'}
                          :{' '}

                          {lang === 'ar'
                            ? (
                                medicine.instructionsAr ||
                                medicine.instructionsEn
                              )
                            : (
                                medicine.instructionsEn ||
                                medicine.instructionsAr
                              )}
                        </p>
                      )}
                    </div>
                  ))
              )}
            </section>

            <section>
              <h3>
                {lang === 'ar'
                  ? 'نتائج المختبر'
                  : 'Laboratory Results'}
              </h3>

              {!selectedRecord
                .releasedLabResults?.length ? (
                <p>
                  {lang === 'ar'
                    ? 'لا توجد نتائج مختبر مفرج عنها لهذه الزيارة.'
                    : 'No released laboratory results are available for this visit.'}
                </p>
              ) : (
                selectedRecord.releasedLabResults
                  .map((result) => (
                    <div
                      key={result.id}
                      className="medical-detail-item"
                    >
                      <strong>
                        {lang === 'ar'
                          ? (
                              result.testNameAr ||
                              result.testNameEn
                            )
                          : (
                              result.testNameEn ||
                              result.testNameAr
                            )}
                      </strong>

                      <p>
                        {lang === 'ar'
                          ? 'النتيجة'
                          : 'Result'}
                        :{' '}
                        {result.resultValue ?? '—'}
                      </p>

                      {(result.referenceRangeMin != null ||
                        result.referenceRangeMax != null) && (
                        <p>
                          {lang === 'ar'
                            ? 'المدى المرجعي'
                            : 'Reference range'}
                          :{' '}

                          <bdi dir="ltr">{result.referenceRangeMin ?? '—'}
                          {' – '}
                          {result.referenceRangeMax ?? '—'}</bdi>
                        </p>
                      )}

                      {result.isOutOfRange && (
                        <span
                          className="badge badge-warning"
                        >
                          {lang === 'ar'
                            ? 'خارج المعدل المرجعي'
                            : 'Outside reference range'}
                        </span>
                      )}

                      {result.releasedToPatientAt && (
                        <p>
                          {lang === 'ar' ? 'تاريخ الإفراج' : 'Released'}:{' '}
                          {formatPatientDateTime(result.releasedToPatientAt, lang)}
                        </p>
                      )}
                    </div>
                  ))
              )}
            </section>

            {selectedRecord.attachmentPath && (
              <section>
                <a
                  className="patient-button secondary"
                  href={selectedRecord.attachmentPath}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {lang === 'ar'
                    ? 'فتح المرفق'
                    : 'Open Attachment'}
                </a>
              </section>
            )}

            <button
              type="button"
              className="patient-button secondary"
              onClick={closeRecord}
              style={{ width: '100%' }}
            >
              {lang === 'ar'
                ? 'إغلاق'
                : 'Close'}
            </button>
          </div>
        ) : null}
      </Dialog>
    </State>
  );
}

function Collection({path,titleKey,render}){const{t}=useTranslation();const{data,error,loading,loadingMore,hasMore,loadMore,reload}=usePagedList(path);return <State loading={loading} error={error} onRetry={reload}><h1>{t(titleKey)}</h1>{!data?.length?<Empty>{t('noRecords')}</Empty>:data.map(item=><article className="patient-card" key={item.id}>{render(item)}</article>)}{hasMore&&<button type="button" className="patient-button secondary" onClick={loadMore} disabled={loadingMore}>{loadingMore?t('loading'):t('loadMore')}</button>}</State>}
export function Profile() {
  const { t, i18n } = useTranslation();
  const {
    data,
    error,
    loading,
    reload
  } = useApi('/api/patient/me');

  const lang = i18n.language?.startsWith('ar') ? 'ar' : 'en';

  const [form, setForm] = useState(null);
  const [message, setMessage] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);

  const [emailChangeOpen, setEmailChangeOpen] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [emailChallengeId, setEmailChallengeId] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [emailChanging, setEmailChanging] = useState(false);
  const [emailChangeError, setEmailChangeError] = useState('');
  const [emailChangeMessage, setEmailChangeMessage] = useState('');

  const [phoneChangeOpen, setPhoneChangeOpen] = useState(false);
  const [newPhone, setNewPhone] = useState('');
  const [phoneChallengeId, setPhoneChallengeId] = useState('');
  const [phoneCode, setPhoneCode] = useState('');
  const [phoneChanging, setPhoneChanging] = useState(false);
  const [phoneChangeError, setPhoneChangeError] = useState('');
  const [phoneChangeMessage, setPhoneChangeMessage] = useState('');
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [passwordChanging, setPasswordChanging] = useState(false);
  const [passwordChangeError, setPasswordChangeError] = useState('');

  const location = useLocation();
  const highlightGoogleLink = location.state?.highlightGoogleLink;

  const [googleLinkOpen, setGoogleLinkOpen] = useState(false);
  const [googleLinkPassword, setGoogleLinkPassword] = useState('');
  const [googleLinkError, setGoogleLinkError] = useState('');
  const [googleLinkMessage, setGoogleLinkMessage] = useState('');
  const [googleLinking, setGoogleLinking] = useState(false);
  const [pendingGoogleCredential, setPendingGoogleCredential] = useState(null);

  const [googleUnlinkOpen, setGoogleUnlinkOpen] = useState(false);
  const [googleUnlinkPassword, setGoogleUnlinkPassword] = useState('');
  const [googleUnlinkError, setGoogleUnlinkError] = useState('');
  const [googleUnlinking, setGoogleUnlinking] = useState(false);

  async function handleConfirmGoogleLink(event) {
    event.preventDefault();
    if (googleLinking || !pendingGoogleCredential || !googleLinkPassword) return;
    setGoogleLinking(true);
    setGoogleLinkError('');
    setGoogleLinkMessage('');

    try {
      await apiRequest('/api/patient/me/external-identities/google/link', {
        method: 'POST',
        body: JSON.stringify({
          credential: pendingGoogleCredential,
          currentPassword: googleLinkPassword
        })
      });
      setGoogleLinkMessage(t('googleLinkedSuccess'));
      setPendingGoogleCredential(null);
      setGoogleLinkPassword('');
      setGoogleLinkOpen(false);
      await reload();
    } catch (requestError) {
      let msg = t('genericLinkingFailed');
      if (requestError?.code === 'REAUTHENTICATION_FAILED') msg = t('reauthenticationFailed');
      else if (requestError?.code === 'GOOGLE_EMAIL_MISMATCH') msg = t('googleEmailMismatch');
      else if (requestError?.code === 'GOOGLE_IDENTITY_ALREADY_LINKED') msg = t('identityAlreadyLinked');
      else if (requestError?.code === 'GOOGLE_ALREADY_LINKED') msg = t('googleAlreadyLinked');
      else if (requestError?.code === 'GOOGLE_CREDENTIAL_INVALID') msg = t('googleCredentialInvalid');
      setGoogleLinkError(msg);
    } finally {
      setGoogleLinking(false);
    }
  }

  async function handleConfirmGoogleUnlink(event) {
    event.preventDefault();
    if (googleUnlinking || !googleUnlinkPassword) return;
    setGoogleUnlinking(true);
    setGoogleUnlinkError('');

    try {
      await apiRequest('/api/patient/me/external-identities/google', {
        method: 'DELETE',
        body: JSON.stringify({
          currentPassword: googleUnlinkPassword
        })
      });
      setGoogleUnlinkOpen(false);
      setGoogleUnlinkPassword('');
      setMessage(t('googleUnlinkedSuccess'));
      await reload();
    } catch (requestError) {
      let msg = t('genericUnlinkingFailed');
      if (requestError?.code === 'REAUTHENTICATION_FAILED') msg = t('reauthenticationFailed');
      setGoogleUnlinkError(msg);
    } finally {
      setGoogleUnlinking(false);
    }
  }

  useEffect(() => {
    if (!data) return;

    setForm({
      addressStateId: data.addressStateId,
      addressDetails: data.addressDetails || '',
      emergencyContact: data.emergencyContact || '',
      bloodType: data.bloodType || '',
      preferredLanguage: data.preferredLanguage
    });
  }, [data]);

  async function save(event) {
    event.preventDefault();

    if (!form || saving) return;

    setSaving(true);
    setMessage('');
    setSaveError('');

    try {
      await apiRequest('/api/patient/me', {
        method: 'PATCH',
        body: JSON.stringify({
          addressStateId: form.addressStateId,
          addressDetails: form.addressDetails || null,
          emergencyContact: form.emergencyContact,
          bloodType: form.bloodType || null,
          preferredLanguage: form.preferredLanguage
        })
      });

      setMessage(
        lang === 'ar'
          ? 'تم حفظ التغييرات بنجاح.'
          : 'Profile changes saved successfully.'
      );

      try {
        await reload();
      } catch (reloadError) {
        console.error('Patient profile reload error:', reloadError);
      }
    } catch (requestError) {
      console.error('Patient profile save error:', requestError);

      setSaveError(
        requestError?.message ||
          (
            lang === 'ar'
              ? 'تعذر حفظ التغييرات. يرجى المحاولة مرة أخرى.'
              : 'Unable to save profile changes. Please try again.'
          )
      );
    } finally {
      setSaving(false);
    }
  }

  async function changePassword(event) {
    event.preventDefault();
    setPasswordChangeError('');
    if (passwordForm.newPassword !== passwordForm.confirmPassword) return setPasswordChangeError(t('passwordsDoNotMatch'));
    setPasswordChanging(true);
    try {
      await apiRequest('/api/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword: passwordForm.currentPassword, newPassword: passwordForm.newPassword }) });
      clearPatientSession();
      window.location.replace('/patient-login');
    } catch (requestError) {
      setPasswordChangeError(requestError?.message || t('passwordChangeFailed'));
    } finally { setPasswordChanging(false); }
  }

  async function requestEmailChange(event) {
    event.preventDefault();

    setEmailChanging(true);
    setEmailChangeError('');
    setEmailChangeMessage('');

    try {
      const result = await apiRequest(
        '/api/patient/me/email-change/request',
        {
          method: 'POST',
          body: JSON.stringify({
            email: newEmail.trim(), currentPassword
          })
        }
      );

      setEmailChallengeId(result.challengeId);

      setEmailChangeMessage(
        lang === 'ar'
          ? 'تم إرسال رمز تحقق إلى البريد الإلكتروني الجديد.'
          : 'A verification code was sent to the new email address.'
      );
    } catch (requestError) {
      setEmailChangeError(
        requestError?.message ||
          (
            lang === 'ar'
              ? 'تعذر إرسال رمز التحقق.'
              : 'Unable to send verification code.'
          )
      );
    } finally {
      setEmailChanging(false);
    }
  }

  async function verifyEmailChange(event) {
    event.preventDefault();

    setEmailChanging(true);
    setEmailChangeError('');

    try {
      await apiRequest(
        '/api/patient/me/email-change/verify',
        {
          method: 'POST',
          body: JSON.stringify({
            challengeId: emailChallengeId,
            code: emailCode, currentPassword
          })
        }
      );

      setEmailChangeMessage(
        lang === 'ar'
          ? 'تم تغيير البريد الإلكتروني والتحقق منه بنجاح.'
          : 'Email address changed and verified successfully.'
      );

      setEmailChangeOpen(false);
      setEmailChallengeId('');
      setEmailCode('');
      setNewEmail('');

      setCurrentPassword('');
      clearPatientSession();
      window.location.replace('/patient-login');
    } catch (requestError) {
      setEmailChangeError(
        requestError?.message ||
          (
            lang === 'ar'
              ? 'تعذر التحقق من رمز البريد الإلكتروني.'
              : 'Unable to verify the email change code.'
          )
      );
    } finally {
      setEmailChanging(false);
    }
  }

  async function requestPhoneChange(event) {
    event.preventDefault();

    setPhoneChanging(true);
    setPhoneChangeError('');
    setPhoneChangeMessage('');

    try {
      const result = await apiRequest(
        '/api/patient/me/phone-change/request',
        {
          method: 'POST',
          body: JSON.stringify({
            phone: newPhone.trim()
          })
        }
      );

      setPhoneChallengeId(result.challengeId);

      setPhoneChangeMessage(
        lang === 'ar'
          ? `تم إرسال رمز تأكيد إلى بريدك الإلكتروني الموثق${result.deliveredTo ? ` (${result.deliveredTo})` : ''}.`
          : `An authorization code was sent to your verified email${result.deliveredTo ? ` (${result.deliveredTo})` : ''}.`
      );
    } catch (requestError) {
      setPhoneChangeError(
        requestError?.message ||
          (
            lang === 'ar'
              ? 'تعذر بدء عملية تغيير رقم الهاتف.'
              : 'Unable to start the phone number change.'
          )
      );
    } finally {
      setPhoneChanging(false);
    }
  }

  async function verifyPhoneChange(event) {
    event.preventDefault();

    setPhoneChanging(true);
    setPhoneChangeError('');

    try {
      await apiRequest(
        '/api/patient/me/phone-change/verify',
        {
          method: 'POST',
          body: JSON.stringify({
            challengeId: phoneChallengeId,
            code: phoneCode
          })
        }
      );

      setPhoneChangeMessage(
        lang === 'ar'
          ? 'تم تغيير رقم الهاتف. سيظل الرقم غير موثق حتى يتم التحقق منه عبر SMS.'
          : 'Phone number changed. It will remain unverified until SMS verification is available.'
      );

      setPhoneChangeOpen(false);
      setPhoneChallengeId('');
      setPhoneCode('');
      setNewPhone('');

      clearPatientSession();
      window.location.replace('/patient-login');
    } catch (requestError) {
      setPhoneChangeError(
        requestError?.message ||
          (
            lang === 'ar'
              ? 'تعذر التحقق من رمز تغيير رقم الهاتف.'
              : 'Unable to verify the phone change code.'
          )
      );
    } finally {
      setPhoneChanging(false);
    }
  }

  return (
    <State
      loading={loading}
      error={error}
      onRetry={reload}
    >
      {form && data && (
        <div className="patient-profile">
          <section className="patient-card">
            <h1>{t('profile')}</h1>

            <h2>
              {lang === 'ar'
                ? data.fullNameAr || data.fullNameEn
                : data.fullNameEn || data.fullNameAr}
            </h2>

            <p style={{ color: 'var(--color-primary-strong)', fontWeight: 700 }}>
              {lang === 'ar' ? 'رقم الملف: ' : 'File number: '}<bdi dir="ltr">{data.fileNumber || '—'}</bdi>
            </p>

            <div
              style={{
                display: 'grid',
                gap: '.35rem',
                marginBottom: '1.25rem'
              }}
            >
              <p style={{ margin: 0 }}>
                <strong>
                  {lang === 'ar'
                    ? 'رقم الهاتف:'
                    : 'Phone:'}
                </strong>{' '}
                <bdi dir="ltr">{data.phone || (
                  lang === 'ar'
                    ? 'غير متوفر'
                    : 'Not available'
                )}</bdi>
              </p>

              <p style={{ margin: 0 }}>
                <strong>
                  {lang === 'ar'
                    ? 'البريد الإلكتروني:'
                    : 'Email:'}
                </strong>{' '}
                <bdi dir="ltr">{data.email || (
                  lang === 'ar'
                    ? 'غير متوفر'
                    : 'Not available'
                )}</bdi>
              </p>
            </div>

            <form onSubmit={save}>
              <label className="patient-field">
                {t('addressState')}

                <select
                  required
                  value={form.addressStateId || ''}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      addressStateId: Number(event.target.value)
                    })
                  }
                >
                  <option value="">
                    {t('selectState')}
                  </option>

                  <option value="1">{t('stateKhartoum')}</option>
                  <option value="2">{t('stateGezira')}</option>
                  <option value="3">{t('stateRedSea')}</option>
                  <option value="4">{t('stateKassala')}</option>
                  <option value="5">{t('stateGedaref')}</option>
                  <option value="6">{t('stateSennar')}</option>
                  <option value="7">{t('stateBlueNile')}</option>
                  <option value="8">{t('stateWhiteNile')}</option>
                  <option value="9">{t('stateRiverNile')}</option>
                  <option value="10">{t('stateNorthern')}</option>
                  <option value="11">{t('stateWestKordofan')}</option>
                  <option value="12">{t('stateNorthKordofan')}</option>
                  <option value="13">{t('stateSouthKordofan')}</option>
                  <option value="14">{t('stateNorthDarfur')}</option>
                  <option value="15">{t('stateWestDarfur')}</option>
                  <option value="16">{t('stateSouthDarfur')}</option>
                  <option value="17">{t('stateEastDarfur')}</option>
                  <option value="18">{t('stateCentralDarfur')}</option>
                </select>
              </label>

              <label className="patient-field">
                {lang === 'ar'
                  ? 'فصيلة الدم'
                  : 'Blood Type'}

                <select
                  dir="ltr"
                  value={form.bloodType || ''}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      bloodType: event.target.value
                    })
                  }
                >
                  <option value="">
                    {lang === 'ar'
                      ? 'اختر فصيلة الدم'
                      : 'Select blood type'}
                  </option>

                  <option value="A+">A+</option>
                  <option value="A-">A-</option>
                  <option value="B+">B+</option>
                  <option value="B-">B-</option>
                  <option value="AB+">AB+</option>
                  <option value="AB-">AB-</option>
                  <option value="O+">O+</option>
                  <option value="O-">O-</option>
                </select>
              </label>

              <label className="patient-field">
                {t('addressDetails')}

                <input
                  value={form.addressDetails}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      addressDetails: event.target.value
                    })
                  }
                />
              </label>

              <label className="patient-field">
                {t('emergencyContact')}

                <input
                  required
                  value={form.emergencyContact}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      emergencyContact: event.target.value
                    })
                  }
                />
              </label>

              {saveError && (
                <div
                  className="patient-alert error"
                  role="alert"
                >
                  {saveError}
                </div>
              )}

              {message && (
                <div
                  className="patient-alert success"
                  role="status"
                >
                  {message}
                </div>
              )}

              <button
                className="patient-button"
                disabled={saving}
              >
                {saving
                  ? t('loading')
                  : t('save')}
              </button>
            </form>
          </section>

          <section className="patient-card">
            <h2>{t('accountSecurity')}</h2>

            <div style={{ padding: '0 0 1rem', borderBottom: '1px solid var(--border-color)' }}>
              <strong>{t('changePassword')}</strong><p style={{ margin: '.3rem 0 1rem' }}>{t('passwordChangeSignInAgain')}</p>
              <form onSubmit={changePassword} style={{ display: 'grid', gap: '.7rem', maxWidth: 420 }}>
                <PasswordField label={t('currentPassword')} autoComplete="current-password" value={passwordForm.currentPassword} onChange={(event) => setPasswordForm({ ...passwordForm, currentPassword: event.target.value })} required />
                <PasswordField label={t('newPassword')} autoComplete="new-password" value={passwordForm.newPassword} onChange={(event) => setPasswordForm({ ...passwordForm, newPassword: event.target.value })} required minLength={10} maxLength={200} helperText={t('passwordRequirementsSummary')} />
                <PasswordField label={t('confirmNewPassword')} autoComplete="new-password" value={passwordForm.confirmPassword} onChange={(event) => setPasswordForm({ ...passwordForm, confirmPassword: event.target.value })} required error={Boolean(passwordForm.confirmPassword && passwordForm.newPassword !== passwordForm.confirmPassword)} helperText={passwordForm.confirmPassword && passwordForm.newPassword !== passwordForm.confirmPassword ? t('passwordsDoNotMatch') : undefined} />
                {passwordChangeError && <div className="patient-alert error" role="alert">{passwordChangeError}</div>}
                <button className="patient-button" disabled={passwordChanging}>{passwordChanging ? t('loading') : t('changePassword')}</button>
              </form>
            </div>

            {/* Email */}
            <div
              style={{
                padding: '1rem 0',
                borderBottom: '1px solid var(--border-color)'
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: '1rem',
                  flexWrap: 'wrap',
                  alignItems: 'center'
                }}
              >
                <div>
                  <strong>
                    {lang === 'ar'
                      ? 'البريد الإلكتروني'
                      : 'Email'}
                  </strong>

                  <p style={{ margin: '.3rem 0' }}>
                    <bdi dir="ltr">{data.email || '-'}</bdi>
                  </p>

                  <span className={`status-badge status-badge--${data.emailVerified ? 'success' : 'warning'}`}>{t(data.emailVerified ? 'patientVerified' : 'patientNotVerified')}</span>
                </div>

                <button
                  type="button"
                  className="patient-button secondary"
                  onClick={() => {
                    setEmailChangeOpen((current) => !current);
                    setEmailChangeError('');
                    setEmailChangeMessage('');
                  }}
                >
                  {lang === 'ar'
                    ? 'تغيير البريد'
                    : 'Change Email'}
                </button>
              </div>

              {emailChangeOpen && (
                <div style={{ marginTop: '1rem' }}>
                  {!emailChallengeId ? (
                    <form onSubmit={requestEmailChange}>
                      <PasswordField label={t('currentPassword')} autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required />
                      <label className="patient-field">
                        {lang === 'ar'
                          ? 'البريد الإلكتروني الجديد'
                          : 'New email address'}

                        <input
                          type="email"
                          value={newEmail}
                          onChange={(event) =>
                            setNewEmail(event.target.value)
                          }
                          required
                        />
                      </label>

                      <button
                        className="patient-button"
                        disabled={emailChanging || !newEmail.trim()}
                      >
                        {emailChanging
                          ? t('loading')
                          : (
                              lang === 'ar'
                                ? 'إرسال رمز التحقق'
                                : 'Send Verification Code'
                            )}
                      </button>
                    </form>
                  ) : (
                    <form onSubmit={verifyEmailChange}>
                      <label className="patient-field">
                        {lang === 'ar'
                          ? 'رمز التحقق'
                          : 'Verification code'}

                        <input
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          dir="ltr"
                          maxLength={6}
                          value={emailCode}
                          onChange={(event) =>
                            setEmailCode(
                              event.target.value.replace(/\D/g, '')
                            )
                          }
                          required
                        />
                      </label>

                      <button
                        className="patient-button"
                        disabled={
                          emailChanging ||
                          emailCode.length !== 6
                        }
                      >
                        {emailChanging
                          ? t('loading')
                          : (
                              lang === 'ar'
                                ? 'تأكيد البريد الجديد'
                                : 'Confirm New Email'
                            )}
                      </button>
                    </form>
                  )}

                  {emailChangeError && (
                    <div className="patient-alert error" role="alert">
                      {emailChangeError}
                    </div>
                  )}

                  {emailChangeMessage && (
                    <div className="patient-alert success" role="status">
                      {emailChangeMessage}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Phone */}
            <div style={{ padding: '1rem 0' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: '1rem',
                  flexWrap: 'wrap',
                  alignItems: 'center'
                }}
              >
                <div>
                  <strong>
                    {lang === 'ar'
                      ? 'رقم الهاتف'
                      : 'Phone'}
                  </strong>

                  <p style={{ margin: '.3rem 0' }}>
                    <bdi dir="ltr">{data.phone || '-'}</bdi>
                  </p>

                  <span className={`status-badge status-badge--${data.phoneVerified ? 'success' : 'warning'}`}>{t(data.phoneVerified ? 'patientVerified' : 'patientNotVerified')}</span>
                </div>

                <button
                  type="button"
                  className="patient-button secondary"
                  onClick={() => {
                    setPhoneChangeOpen((current) => !current);
                    setPhoneChangeError('');
                    setPhoneChangeMessage('');
                  }}
                >
                  {lang === 'ar'
                    ? 'تغيير رقم الهاتف'
                    : 'Change Phone'}
                </button>
              </div>

              {phoneChangeOpen && (
                <div style={{ marginTop: '1rem' }}>
                  {!phoneChallengeId ? (
                    <form onSubmit={requestPhoneChange}>
                      <label className="patient-field">
                        {lang === 'ar'
                          ? 'رقم الهاتف الجديد'
                          : 'New phone number'}

                        <input
                          type="tel"
                          dir="ltr"
                          autoComplete="tel"
                          value={newPhone}
                          onChange={(event) =>
                            setNewPhone(event.target.value)
                          }
                          placeholder="+249..."
                          required
                        />
                      </label>

                      <button
                        className="patient-button"
                        disabled={phoneChanging || !newPhone.trim()}
                      >
                        {phoneChanging
                          ? t('loading')
                          : (
                              lang === 'ar'
                                ? 'إرسال رمز التأكيد'
                                : 'Send Authorization Code'
                            )}
                      </button>
                    </form>
                  ) : (
                    <form onSubmit={verifyPhoneChange}>
                      <label className="patient-field">
                        {lang === 'ar'
                          ? 'رمز التأكيد المرسل إلى بريدك'
                          : 'Authorization code sent to your email'}

                        <input
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          dir="ltr"
                          maxLength={6}
                          value={phoneCode}
                          onChange={(event) =>
                            setPhoneCode(
                              event.target.value.replace(/\D/g, '')
                            )
                          }
                          required
                        />
                      </label>

                      <button
                        className="patient-button"
                        disabled={
                          phoneChanging ||
                          phoneCode.length !== 6
                        }
                      >
                        {phoneChanging
                          ? t('loading')
                          : (
                              lang === 'ar'
                                ? 'تأكيد تغيير الرقم'
                                : 'Confirm Phone Change'
                            )}
                      </button>
                    </form>
                  )}

                  {phoneChangeError && (
                    <div className="patient-alert error" role="alert">
                      {phoneChangeError}
                    </div>
                  )}

                  {phoneChangeMessage && (
                    <div className="patient-alert success" role="status">
                      {phoneChangeMessage}
                    </div>
                  )}

                  <p
                    style={{
                      marginTop: '.75rem',
                      fontSize: '.85rem',
                      opacity: .75
                    }}
                  >
                    {lang === 'ar'
                      ? 'يتم تأكيد طلب تغيير الرقم عبر بريدك الموثق حالياً. سيظل الرقم الجديد بحالة قيد التحقق حتى يتوفر التحقق عبر SMS.'
                      : 'The change is authorized through your currently verified email. The new phone remains pending until SMS verification is available.'}
                  </p>
                </div>
              )}
            </div>

            {/* Linked Accounts */}
            <div
              id="linked-accounts-section"
              style={{
                padding: '1rem 0',
                borderTop: '1px solid var(--border-color)'
              }}
            >
              <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.1rem' }}>
                {t('linkedAccounts')}
              </h3>

              {highlightGoogleLink && !data.googleAccount?.linked && (
                <div className="patient-alert info" style={{ marginBottom: '1rem' }} role="status">
                  {t('googleLinkPostLoginHint')}
                </div>
              )}

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: '1rem',
                  flexWrap: 'wrap',
                  alignItems: 'center'
                }}
              >
                <div>
                  <strong>{t('googleAccount')}</strong>
                  <p style={{ margin: '.3rem 0' }}>
                    {data.googleAccount?.linked
                      ? `${t('connected')}: ${data.googleAccount.email}`
                      : t('notConnected')}
                  </p>
                  <span className={`status-badge status-badge--${data.googleAccount?.linked ? 'success' : 'neutral'}`}>{t(data.googleAccount?.linked ? 'connected' : 'notConnected')}</span>
                </div>

                {!data.googleAccount?.linked ? (
                  <button
                    type="button"
                    className="patient-button secondary"
                    onClick={() => {
                      setGoogleLinkOpen((current) => !current);
                      setGoogleLinkError('');
                      setGoogleLinkMessage('');
                      setPendingGoogleCredential(null);
                      setGoogleLinkPassword('');
                    }}
                  >
                    {t('connectGoogle')}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="patient-button secondary"
                    onClick={() => {
                      setGoogleUnlinkOpen((current) => !current);
                      setGoogleUnlinkError('');
                      setGoogleUnlinkPassword('');
                    }}
                  >
                    {t('disconnectGoogle')}
                  </button>
                )}
              </div>

              {googleLinkOpen && !data.googleAccount?.linked && (
                <div style={{ marginTop: '1rem' }}>
                  {!pendingGoogleCredential ? (
                    <div>
                      <p style={{ margin: '0 0 .75rem 0', fontSize: '.9rem' }}>
                        {t('connectGooglePrompt')}
                      </p>
                      <GoogleIdentityButton
                        onCredential={(credential) => {
                          setPendingGoogleCredential(credential);
                          setGoogleLinkError('');
                        }}
                      />
                    </div>
                  ) : (
                    <form onSubmit={handleConfirmGoogleLink}>
                      <p style={{ margin: '0 0 .75rem 0', fontSize: '.9rem' }}>
                        {t('enterPasswordToLink')}
                      </p>
                      <PasswordField label={t('confirmPassword')} autoComplete="current-password" value={googleLinkPassword} onChange={(e) => setGoogleLinkPassword(e.target.value)} required />
                      <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
                        <button
                          className="patient-button"
                          disabled={googleLinking || !googleLinkPassword}
                        >
                          {googleLinking ? t('loading') : t('connectGoogle')}
                        </button>
                        <button
                          type="button"
                          className="patient-button secondary"
                          disabled={googleLinking}
                          onClick={() => {
                            setPendingGoogleCredential(null);
                            setGoogleLinkPassword('');
                            setGoogleLinkError('');
                          }}
                        >
                          {t('cancel')}
                        </button>
                      </div>
                    </form>
                  )}

                  {googleLinkError && (
                    <div className="patient-alert error" style={{ marginTop: '.75rem' }} role="alert">
                      {googleLinkError}
                    </div>
                  )}
                  {googleLinkMessage && (
                    <div className="patient-alert success" style={{ marginTop: '.75rem' }} role="status">
                      {googleLinkMessage}
                    </div>
                  )}
                </div>
              )}

              {googleUnlinkOpen && data.googleAccount?.linked && (
                <div style={{ marginTop: '1rem' }}>
                  <form onSubmit={handleConfirmGoogleUnlink}>
                    <p style={{ margin: '0 0 .75rem 0', fontSize: '.9rem' }}>
                      {t('disconnectGoogleConfirm')}
                    </p>
                    <PasswordField label={t('enterPasswordToUnlink')} autoComplete="current-password" value={googleUnlinkPassword} onChange={(e) => setGoogleUnlinkPassword(e.target.value)} required />
                    <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
                      <button
                        className="patient-button secondary"
                        style={{ borderColor: 'var(--color-danger, #ef4444)', color: 'var(--color-danger, #ef4444)' }}
                        disabled={googleUnlinking || !googleUnlinkPassword}
                      >
                        {googleUnlinking ? t('loading') : t('disconnectGoogle')}
                      </button>
                      <button
                        type="button"
                        className="patient-button secondary"
                        disabled={googleUnlinking}
                        onClick={() => {
                          setGoogleUnlinkOpen(false);
                          setGoogleUnlinkPassword('');
                          setGoogleUnlinkError('');
                        }}
                      >
                        {t('cancel')}
                      </button>
                    </div>
                  </form>
                  {googleUnlinkError && (
                    <div className="patient-alert error" style={{ marginTop: '.75rem' }} role="alert">
                      {googleUnlinkError}
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </State>
  );
}
