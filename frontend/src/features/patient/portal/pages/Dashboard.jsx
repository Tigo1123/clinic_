import { CacheProvider } from '@emotion/react';
import { ThemeProvider as MuiThemeProvider } from '@mui/material/styles';
import { Box, Button, Typography } from '@mui/material';
import { useTheme } from '../../../../app/theme/ThemeContext.jsx';
import { patientStyleCaches, createPatientMuiTheme } from '../../../../utils/patientMuiTheme';
import { patientGreeting } from '../patientGreeting';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import StatusBadge from '../../../../components/ui/StatusBadge';
import { CalendarDays, CalendarPlus, ChevronRight, FileHeart, FlaskConical, HeartPulse, Pill } from 'lucide-react';
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
  const value = (result) =>
    result.error ? t('patientDataUnavailable') : result.loading ? '…' : (result.data?.length || 0).toLocaleString(language);

  const activity = [
    ...(labs.data || []).map((item) => ({
      id: `lab-${item.id}`,
      date: item.releasedAt || item.orderDate,
      title: t('laboratoryReport'),
      doctor: item.doctor,
      to: '/patient/lab-results',
      icon: <FlaskConical size={18} />
    })),
    ...(records.data || []).map((item) => ({
      id: `record-${item.id}`,
      date: item.visitDate,
      title: t('medicalRecords'),
      doctor: item.doctor,
      to: '/patient/records',
      icon: <FileHeart size={18} />
    }))
  ].sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0)).slice(0, 3);

  if (profile.errorCode === 'PATIENT_RECORD_NOT_LINKED') {
    return (
      <div className="patient-claim-flow">
        <h1>{t('claimRecord')}</h1>
        <p className="patient-alert info">{t('claimInstructions')}</p>
        <Link className="patient-button" to="/patient/claim">{t('claimRecord')}</Link>
      </div>
    );
  }

  return (
    <CacheProvider value={patientStyleCaches[direction]}>
      <MuiThemeProvider theme={muiTheme}>
        <State loading={profile.loading} error={profile.error} onRetry={profile.reload}>
          <div className="patient-dashboard" dir={direction}>
            
            {/* Header Greeting */}
            <header className="patient-home__header patient-dashboard__header">
              <div className="patient-dashboard__header-text">
                <div className="patient-dashboard__brand">
                  <span aria-hidden="true" className="patient-dashboard__brand-icon">
                    <HeartPulse size={16} strokeWidth={1.8} />
                  </span>
                  {t('patientPortalShort')}
                </div>
                <h1 className="patient-dashboard__greeting-title">
                  {patientGreeting(profile.data, language)}
                </h1>
              </div>
            </header>

            {/* Dark "Your next visit" block (or clean empty state) */}
            <section
              aria-labelledby="next-visit-title"
              className="patient-next-visit health-summary-card"
              href="/patient/appointments"
            >
              <div className="patient-dashboard__next-header">
                <h2 id="next-visit-title" className="patient-next-visit__title">
                  {t('upcomingAppointments', { defaultValue: 'Your next visit' })}
                </h2>
                <Link to="/patient/appointments" className="patient-dashboard__all-link">
                  {t('all')}
                </Link>
              </div>

              <State loading={appointments.loading} error={appointments.error} onRetry={appointments.reload}>
                {next ? (
                  <article className="patient-view">
                    <div className="patient-next-visit__body">
                      <div className="patient-next-visit__date-box">
                        <span className="patient-next-visit__month">
                          {new Date(`${next.appointmentDate}T00:00:00`).toLocaleDateString(language, { month: 'short' })}
                        </span>
                        <span className="patient-next-visit__day ui-mono">
                          {new Date(`${next.appointmentDate}T00:00:00`).getDate().toLocaleString(language)}
                        </span>
                      </div>
                      <div className="patient-next-visit__info">
                        <span className="patient-next-visit__doctor">
                          {doctorName(next.doctor, language)}
                        </span>
                        <span className="patient-next-visit__specialty">
                          {localizeDoctorSpecialty(next.doctor, language)} · <bdi dir="ltr" className="ui-mono">{next.appointmentTime}</bdi>
                        </span>
                      </div>
                    </div>
                    <div className="patient-next-visit__footer">
                      <div className="patient-next-visit__status">
                        <StatusBadge status={next.status} language={language} />
                      </div>
                      <Link to={`/patient/appointments/${next.id}`} className="patient-next-visit__link">
                        {t('details')}
                      </Link>
                    </div>
                  </article>
                ) : (
                  <DashboardEmpty
                    icon={<CalendarDays size={24} />}
                    title={t('dashboardNoUpcoming')}
                    description={t(noDoctors ? 'dashboardNoDoctorsHelp' : 'dashboardAppointmentsHelp')}
                  />
                )}
              </State>
            </section>

            {/* Single Primary: Book an appointment */}
            <div className="patient-home__booking-wrapper patient-view">
              <Button
                variant="contained"
                component={noDoctors || doctors.loading ? 'button' : Link}
                to={noDoctors || doctors.loading ? undefined : '/patient/doctors'}
                disabled={noDoctors || doctors.loading}
                aria-busy={doctors.loading}
                aria-describedby={noDoctors ? 'dashboard-booking-status' : undefined}
                className="patient-home__book-btn"
              >
                <CalendarPlus size={20} aria-hidden="true" />
                {t('dashboardBookAppointment')}
              </Button>
              {noDoctors && (
                <Typography id="dashboard-booking-status" variant="body2" color="text.secondary">
                  {t('dashboardBookingUnavailable')}
                </Typography>
              )}
            </div>

            {/* Pending appointment reminder */}
            {hasPendingAppointments(appointments.data) && <aside className="patient-alert warning patient-pending-reminder">
              <strong>{t('appointmentPendingTitle')}</strong>
              <p>{t('appointmentPendingReminder')}</p>
              <Link className="patient-button secondary" to="/patient/appointments">
                {t('followMyAppointments')}
              </Link>
            </aside>}

            {/* "Your health file" panel: three hairline rows (Lab results, Prescriptions, Medical records) */}
            <section aria-labelledby="health-title" className="patient-dashboard__file-section">
              <h2 id="health-title" className="ui-section-label">
                {t('recentPatientInfo', { defaultValue: 'Your health file' })}
              </h2>
              <div className="patient-panel">
                {/* Row 1: Lab results */}
                <Link
                  to="/patient/lab-results"
                  className="patient-row-link health-summary-card"
                  href="/patient/lab-results"
                >
                  <span className="patient-row-link__content">
                    <FlaskConical size={20} strokeWidth={1.8} className="patient-row-link__arrow" aria-hidden="true" />
                    <span className="patient-row-link__text">
                      <span className="patient-row-link__title">{t('labResults')}</span>
                      <span className="patient-row-link__subtitle">{value(labs)}</span>
                    </span>
                  </span>
                  <ChevronRight size={18} strokeWidth={1.8} className="patient-row-link__arrow" aria-hidden="true" />
                </Link>

                {/* Row 2: Prescriptions */}
                <Link
                  to="/patient/prescriptions"
                  className="patient-row-link health-summary-card"
                  href="/patient/prescriptions"
                >
                  <span className="patient-row-link__content">
                    <Pill size={20} strokeWidth={1.8} className="patient-row-link__arrow" aria-hidden="true" />
                    <span className="patient-row-link__text">
                      <span className="patient-row-link__title">{t('prescriptions')}</span>
                      <span className="patient-row-link__subtitle">{value(prescriptions)}</span>
                    </span>
                  </span>
                  <ChevronRight size={18} strokeWidth={1.8} className="patient-row-link__arrow" aria-hidden="true" />
                </Link>

                {/* Row 3: Medical records */}
                <Link
                  to="/patient/records"
                  className="patient-row-link health-summary-card"
                  href="/patient/records"
                >
                  <span className="patient-row-link__content">
                    <FileHeart size={20} strokeWidth={1.8} className="patient-row-link__arrow" aria-hidden="true" />
                    <span className="patient-row-link__text">
                      <span className="patient-row-link__title">{t('medicalRecords')}</span>
                      <span className="patient-row-link__subtitle">{value(records)}</span>
                    </span>
                  </span>
                  <ChevronRight size={18} strokeWidth={1.8} className="patient-row-link__arrow" aria-hidden="true" />
                </Link>
              </div>
            </section>

            {/* Collapsed Recent Activity */}
            {activity.length > 0 && (
              <section aria-labelledby="dashboard-activity-title" className="patient-dashboard__activity-section">
                <h2 id="dashboard-activity-title" className="ui-section-label">
                  {t('dashboardRecentActivity')}
                </h2>
                <div className="patient-panel">
                  {activity.map((item) => (
                    <Link
                      key={item.id}
                      to={item.to}
                      className="patient-row-link patient-dashboard__activity"
                    >
                      <span className="patient-row-link__content">
                        <Box className="patient-dashboard__activity-icon" aria-hidden="true">
                          {item.icon}
                        </Box>
                        <span className="patient-row-link__text">
                          <span className="patient-row-link__title">{item.title}</span>
                          <span className="patient-row-link__subtitle">
                            {doctorName(item.doctor, language) || t('patientPortalShort')}
                          </span>
                        </span>
                      </span>
                      {item.date && !Number.isNaN(Date.parse(item.date)) && (
                        <time dateTime={item.date} className="ui-mono patient-dashboard__activity-date">
                          {new Date(item.date).toLocaleDateString(language, { month: 'short', day: 'numeric' })}
                        </time>
                      )}
                    </Link>
                  ))}
                </div>
              </section>
            )}

            {/* Partial activity error note if applicable */}
            {activity.length > 0 && (labs.error || records.error) && (
              <Typography role="status" variant="body2" color="text.secondary">
                {t('dashboardPartialActivity')}
              </Typography>
            )}

          </div>
        </State>
      </MuiThemeProvider>
    </CacheProvider>
  );
}

function DashboardEmpty({ icon, title, description }) {
  return (
    <div className="patient-dashboard__empty-row">
      <div className="patient-dashboard__empty-icon" aria-hidden="true">
        {icon}
      </div>
      <div className="patient-dashboard__empty-content">
        <span className="patient-dashboard__empty-title">{title}</span>
        <span className="patient-dashboard__empty-desc">{description}</span>
      </div>
    </div>
  );
}
