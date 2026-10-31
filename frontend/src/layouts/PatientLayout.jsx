import { useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../app/auth/auth-context';
import { ArrowLeft, Bell, CalendarDays, FileHeart, FlaskConical, House, Languages, LogOut, Pill, Stethoscope, UserRound } from 'lucide-react';
import Dialog from '../components/ui/Dialog';
import ThemeToggle from '../components/ui/ThemeToggle';
import './patient.css';
import { useFacilityBranding } from '../app/branding/FacilityBrandingContext.js';
import ShifaLogo from '../components/brand/ShifaLogo.jsx';
import PwaInstallButton from '../components/pwa/PwaInstallButton.jsx';
import { useTheme } from '../app/theme/ThemeContext.jsx';

export default function PatientLayout() {
  const { t, i18n } = useTranslation();
  const branding = useFacilityBranding();
  const language = (i18n.resolvedLanguage || i18n.language || 'ar').startsWith('ar') ? 'ar' : 'en';
  const facilityName = language === 'ar' ? branding.facilityNameAr : branding.facilityNameEn;
  const { logout } = useAuth();
  const { theme } = useTheme();
  const themeLabelKey = theme === 'dark' ? 'lightMode' : 'darkMode';
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [updatesOpen, setUpdatesOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const links = [['/patient', 'patientHome', House], ['/patient/doctors', 'doctors', Stethoscope], ['/patient/appointments', 'myAppointments', CalendarDays], ['/patient/records', 'medicalRecords', FileHeart], ['/patient/profile', 'profile', UserRound]];
  const secondary = [['/patient/lab-results', 'labResults', FlaskConical], ['/patient/prescriptions', 'prescriptions', Pill]];
  const backTo = pathname.includes('/reschedule') ? pathname.replace('/reschedule', '')
    : /\/patient\/(doctors|book)\//.test(pathname) ? '/patient/doctors'
      : /\/patient\/appointments\//.test(pathname) ? '/patient/appointments' : '/patient';

  return <div className="patient-app">
    <a className="patient-skip-link" href="#patient-main">{t('patientSkipToContent')}</a>
    <header className="patient-header">
      <div className="patient-header__brand-group">
        <NavLink to="/patient" className="patient-brand" aria-label={language === 'ar' ? branding.displayNameAr : branding.displayNameEn}>
          <ShifaLogo responsive className="patient-brand__logo" />
          {facilityName && <span className="patient-brand__facility">{facilityName}</span>}
        </NavLink>
      </div>
      <div className="patient-header__actions">
        <PwaInstallButton />
        <button type="button" className="patient-icon-button" aria-label={t('notifications')} aria-haspopup="dialog" aria-expanded={updatesOpen} onClick={() => setUpdatesOpen(true)}><Bell aria-hidden="true"/></button>
        <button type="button" className="patient-icon-button patient-account-trigger" aria-haspopup="dialog" aria-expanded={accountOpen} aria-label={t('patientAccountMenu')} title={t('patientAccountMenu')} onClick={() => setAccountOpen(true)}><UserRound aria-hidden="true"/></button>
      </div>
    </header>
    <nav className="patient-nav" aria-label={t('patientNavigation')}>
      {links.map(([to, key, Icon]) => <NavLink key={to} to={to} end={to === '/patient'}><Icon aria-hidden="true"/><span>{t(key)}</span></NavLink>)}
      <div className="patient-nav__secondary">{secondary.map(([to, key, Icon]) => <NavLink key={to} to={to}><Icon aria-hidden="true"/><span>{t(key)}</span></NavLink>)}</div>
    </nav>
    <main id="patient-main" className="patient-main" tabIndex={-1}>
      {pathname !== '/patient' && <Link className="patient-back-link" to={backTo}><ArrowLeft size={16} aria-hidden="true"/>{t('patientBack')}</Link>}
      <Outlet/>
    </main>
    <Dialog open={updatesOpen} onClose={() => setUpdatesOpen(false)} title={t('notifications')} description={t('patientUpdatesDescription')}>
      <div className="patient-list">{[['/patient/appointments', 'myAppointments'], ['/patient/lab-results', 'labResults']].map(([to, key]) => <Link key={to} to={to} className="patient-button secondary" onClick={() => setUpdatesOpen(false)}>{t(key)}</Link>)}<button className="patient-button secondary" onClick={() => setUpdatesOpen(false)}>{t('close')}</button></div>
    </Dialog>
    <Dialog open={accountOpen} onClose={() => setAccountOpen(false)} title={t('patientAccountMenu')} description={t('patientAccountMenuDescription')}>
      <div className="patient-account-menu">
        <div className="patient-account-menu__theme"><span>{t(themeLabelKey)}</span><ThemeToggle className="patient-icon-button" size={18}/></div>
        <button type="button" className="patient-account-menu__action" onClick={() => i18n.changeLanguage(language === 'ar' ? 'en' : 'ar')}><Languages aria-hidden="true"/><span>{language === 'ar' ? t('switchToEnglish') : t('switchToArabic')}</span></button>
        <button type="button" className="patient-account-menu__action patient-account-menu__logout" disabled={loggingOut} onClick={async () => { if (loggingOut) return; setLoggingOut(true); setAccountOpen(false); await logout(); navigate('/patient-login'); }}><LogOut aria-hidden="true"/><span>{t('logout')}</span></button>
      </div>
    </Dialog>
  </div>;
}
