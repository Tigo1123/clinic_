import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../app/auth/auth-context';
import './patient.css';

export default function PatientLayout() {
  const { t, i18n } = useTranslation();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const toggleLanguage = () => { const next = i18n.language === 'ar' ? 'en' : 'ar'; i18n.changeLanguage(next); document.documentElement.dir = next === 'ar' ? 'rtl' : 'ltr'; };
  const links = [['/patient', t('patientHome')], ['/patient/doctors', t('doctors')], ['/patient/appointments', t('myAppointments')], ['/patient/lab-results', t('labResults')], ['/patient/prescriptions', t('prescriptions')], ['/patient/records', t('medicalRecords')], ['/patient/profile', t('profile')]];
  return <div className="patient-app"><header className="patient-header"><NavLink to="/patient" className="patient-brand">{t('brandName')}</NavLink><div><button className="patient-button secondary" onClick={toggleLanguage}>{i18n.language === 'ar' ? 'English' : 'العربية'}</button><button className="patient-button secondary" onClick={() => { logout(); navigate('/patient-login'); }}>{t('logout')}</button></div></header><nav className="patient-nav" aria-label={t('patientNavigation')}>{links.map(([to,label]) => <NavLink key={to} to={to} end={to === '/patient'}>{label}</NavLink>)}</nav><main className="patient-main"><Outlet /></main></div>;
}
