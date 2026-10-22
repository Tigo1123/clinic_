import { useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../app/auth/auth-context';
import { ArrowLeft, Bell, CalendarDays, FileHeart, FlaskConical, HeartPulse, House, Languages, LogOut, Pill, Stethoscope, UserRound } from 'lucide-react';
import Dialog from '../components/ui/Dialog';
import ThemeToggle from '../components/ui/ThemeToggle';
import './patient.css';
import { useFacilityBranding } from '../app/branding/FacilityBrandingContext.js';
import { brandingSubline } from '../app/branding/brandingConfig';

export default function PatientLayout() {
  const { t, i18n } = useTranslation();
  const branding = useFacilityBranding();
  const language = (i18n.resolvedLanguage || i18n.language || 'ar').startsWith('ar') ? 'ar' : 'en';
  const { logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [updatesOpen, setUpdatesOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const links = [['/patient', 'patientHome', House], ['/patient/doctors', 'doctors', Stethoscope], ['/patient/appointments', 'myAppointments', CalendarDays], ['/patient/records', 'medicalRecords', FileHeart], ['/patient/profile', 'profile', UserRound]];
  const secondary = [['/patient/lab-results', 'labResults', FlaskConical], ['/patient/prescriptions', 'prescriptions', Pill]];
  const backTo = pathname.includes('/reschedule') ? pathname.replace('/reschedule', '')
    : /\/patient\/(doctors|book)\//.test(pathname) ? '/patient/doctors'
      : /\/patient\/appointments\//.test(pathname) ? '/patient/appointments' : '/patient';

  return <div className="patient-app">
    <a className="patient-skip-link" href="#patient-main">{t('patientSkipToContent')}</a>
    <header className="patient-header">
      <NavLink to="/patient" className="patient-brand">
        <span className="patient-brand__mark"><HeartPulse aria-hidden="true"/></span>
        <span className="patient-brand__lockup">{language === 'ar' ? branding.displayNameAr : branding.displayNameEn}<small className="brand-product-descriptor">{brandingSubline(branding, language)}</small></span>
      </NavLink>
      <div className="patient-header__actions">
        <button type="button" className="patient-icon-button" aria-label={t('notifications')} aria-haspopup="dialog" aria-expanded={updatesOpen} onClick={() => setUpdatesOpen(true)}><Bell aria-hidden="true"/></button>
        <ThemeToggle className="patient-icon-button" size={18}/>
        <button type="button" className="patient-icon-button" onClick={() => i18n.changeLanguage(language === 'ar' ? 'en' : 'ar')} aria-label={language === 'ar' ? 'English' : 'العربية'} title={language === 'ar' ? 'English' : 'العربية'}><Languages aria-hidden="true"/></button>
        <button type="button" className="patient-icon-button" disabled={loggingOut} onClick={async () => { if (loggingOut) return; setLoggingOut(true); await logout(); navigate('/patient-login'); }} aria-label={t('logout')}><LogOut aria-hidden="true"/></button>
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
  </div>;
}
