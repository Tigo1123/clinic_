import { useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../../app/auth/auth-context';
import { ArrowLeft, Bell, CalendarDays, FileHeart, FlaskConical, HeartPulse, House, Languages, LogOut, Pill, Stethoscope, UserRound } from 'lucide-react';
import Dialog from '../../../components/ui/Dialog';
import ThemeToggle from '../../../components/ui/ThemeToggle';
import './patient.css';
import { useFacilityBranding } from '../../../app/branding/FacilityBrandingContext.js';
import { brandingSubline } from '../../../app/branding/brandingConfig';

export default function PatientLayout() {
  const { t, i18n } = useTranslation();
  const branding = useFacilityBranding();
  const language = (i18n.resolvedLanguage || i18n.language || 'ar').startsWith('ar') ? 'ar' : 'en';
  const { logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [updatesOpen, setUpdatesOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const links = [
    ['/patient', 'patientHome', House],
    ['/patient/doctors', 'doctors', Stethoscope],
    ['/patient/appointments', 'myAppointments', CalendarDays],
    ['/patient/records', 'medicalRecords', FileHeart],
    ['/patient/profile', 'profile', UserRound]
  ];

  const secondary = [
    ['/patient/lab-results', 'labResults', FlaskConical],
    ['/patient/prescriptions', 'prescriptions', Pill]
  ];

  const backTo = pathname.includes('/reschedule')
    ? pathname.replace('/reschedule', '')
    : /\/patient\/(doctors|book)\//.test(pathname)
      ? '/patient/doctors'
      : /\/patient\/appointments\//.test(pathname)
        ? '/patient/appointments'
        : '/patient';

  return (
    <div className="patient-app" dir={language === 'ar' ? 'rtl' : 'ltr'}>
      <a className="patient-skip-link" href="#patient-main">{t('patientSkipToContent')}</a>

      {/* Slim header (HeartPulse brand mark + name, notifications, theme, language, logout) */}
      <header className="patient-header">
        <NavLink to="/patient" className="patient-brand" aria-label={language === 'ar' ? branding.displayNameAr : branding.displayNameEn}>
          <span className="patient-brand__mark" aria-hidden="true">
            <HeartPulse size={16} strokeWidth={1.8} />
          </span>
          <span className="patient-brand__name">
            {language === 'ar' ? branding.displayNameAr : branding.displayNameEn}
          </span>
          <small className="brand-product-descriptor sr-only">{brandingSubline(branding, language)}</small>
        </NavLink>

        <div className="patient-header__actions">
          <button
            type="button"
            className="patient-icon-button patient-header__btn"
            aria-label={t('notifications')}
            aria-haspopup="dialog"
            aria-expanded={updatesOpen}
            onClick={() => setUpdatesOpen(true)}
          >
            <Bell size={18} strokeWidth={1.8} aria-hidden="true" />
          </button>
          <ThemeToggle className="patient-icon-button patient-header__btn" size={18} />
          <button
            type="button"
            className="patient-icon-button patient-header__btn"
            onClick={() => i18n.changeLanguage(language === 'ar' ? 'en' : 'ar')}
            aria-label={language === 'ar' ? 'English' : 'العربية'}
            title={language === 'ar' ? 'English' : 'العربية'}
          >
            <Languages size={18} strokeWidth={1.8} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="patient-icon-button patient-header__btn"
            disabled={loggingOut}
            onClick={async () => {
              if (loggingOut) return;
              setLoggingOut(true);
              try {
                await logout();
                navigate('/patient-login');
              } finally {
                setLoggingOut(false);
              }
            }}
            aria-label={t('logout')}
            title={t('logout')}
          >
            <LogOut size={18} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>
      </header>

      {/* Navigation: Fixed bottom tab bar under 768px; restrained top nav above 768px */}
      <nav className="patient-nav" aria-label={t('patientNavigation')}>
        {links.map(([to, key, Icon]) => (
          <NavLink key={to} to={to} end={to === '/patient'}>
            <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
            <span>{t(key)}</span>
          </NavLink>
        ))}
        <div className="patient-nav__secondary">
          {secondary.map(([to, key, Icon]) => (
            <NavLink key={to} to={to}>
              <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
              <span>{t(key)}</span>
            </NavLink>
          ))}
        </div>
      </nav>

      <main id="patient-main" className="patient-main" tabIndex={-1}>
        {pathname !== '/patient' && (
          <Link className="patient-back-link" to={backTo}>
            <ArrowLeft size={16} strokeWidth={1.8} aria-hidden="true" />
            {t('patientBack')}
          </Link>
        )}
        <Outlet />
      </main>

      <Dialog open={updatesOpen} onClose={() => setUpdatesOpen(false)} title={t('notifications')} description={t('patientUpdatesDescription')}>
        <div className="patient-list">
          {[['/patient/appointments', 'myAppointments'], ['/patient/lab-results', 'labResults']].map(([to, key]) => (
            <Link key={to} to={to} className="patient-button secondary" onClick={() => setUpdatesOpen(false)}>{t(key)}</Link>
          ))}
          <button type="button" className="patient-button secondary" onClick={() => setUpdatesOpen(false)}>{t('close')}</button>
        </div>
      </Dialog>
    </div>
  );
}
