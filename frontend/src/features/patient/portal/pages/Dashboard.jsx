import { CacheProvider } from '@emotion/react';
import { ThemeProvider as MuiThemeProvider } from '@mui/material/styles';
import { Box, Button, Card, Chip, Grid, Paper, Stack, Typography } from '@mui/material';
import { useTheme } from '../../../../app/theme/ThemeContext.jsx';
import { patientStyleCaches, createPatientMuiTheme } from '../../../../utils/patientMuiTheme';
import { patientGreeting } from '../patientGreeting';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import StatusBadge from '../../../../components/ui/StatusBadge';
import { CalendarDays, FileHeart, FlaskConical, HeartPulse, Pill, Stethoscope, UserRound } from 'lucide-react';
import { ErrorState, Skeleton } from '../../../../components/feedback/States';
import { localizeDoctorSpecialty } from '../doctorSpecialty';
import { hasPendingAppointments } from '../../../../utils/appointmentStatus';
import { useApi, State, doctorName } from './shared.jsx';

export function Dashboard() {
  const { t, i18n } = useTranslation();
  const { theme: mode } = useTheme();
  const language = i18n.language?.startsWith('ar') ? 'ar' : 'en';
  const direction = language === 'ar' ? 'rtl' : 'ltr';
  const muiTheme = useMemo(() => createPatientMuiTheme(mode, direction), [mode, direction]);
  const profile = useApi('/api/patient/me');
  const appointments = useApi('/api/patient/appointments?group=upcoming', { pollWhen: hasPendingAppointments });
  const labs = useApi('/api/patient/lab-results');
  const prescriptions = useApi('/api/patient/prescriptions');
  const records = useApi('/api/patient/medical-records');
  const doctors = useApi('/api/patient/doctors');
  // The list API returns descending dates; the dashboard needs the nearest visit.
  const next = [...(appointments.data || [])].sort((a, b) =>
    `${a.appointmentDate}T${a.appointmentTime}`.localeCompare(`${b.appointmentDate}T${b.appointmentTime}`)
  )[0];
  const noDoctors = !doctors.loading && !doctors.error && doctors.data?.length === 0;
  const value = result => result.error ? t('patientDataUnavailable') : result.loading ? '…' : (result.data?.length || 0).toLocaleString(language);
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
          {[['/patient/appointments', CalendarDays, 'upcomingAppointments', appointments, 'primary'], ['/patient/lab-results', FlaskConical, 'recentLabResults', labs, 'success'], ['/patient/prescriptions', Pill, 'prescriptions', prescriptions, 'warning'], ['/patient/records', FileHeart, 'medicalRecords', records, 'primary']].map(([to, Icon, title, result, accent]) => <Grid key={to} size={{ xs: 6, md: 3 }}>
            <Card component={Link} to={to} className="health-summary-card patient-dashboard__summary" sx={{ p: { xs: 3, sm: 4 }, height: '100%' }}>
              <Box className="patient-dashboard__icon" sx={{ color: `var(--color-${accent === 'primary' ? 'primary-strong' : accent})`, bgcolor: `var(--color-${accent}-soft)` }}><Icon size={20} aria-hidden="true"/></Box>
              <Typography component="h2" variant="body2" color="text.secondary">{t(title)}</Typography>
              <Typography component="strong" className="patient-dashboard__count" aria-live="polite">{value(result)}</Typography>
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
