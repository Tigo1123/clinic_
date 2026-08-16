import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../app/auth/auth-context';
import { Bell, CalendarDays, FileHeart, HeartPulse, House, Languages, LogOut, Stethoscope, UserRound } from 'lucide-react';
import './patient.css';

export default function PatientLayout() {
  const { t, i18n } = useTranslation();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const toggleLanguage = () => {
    const current = (i18n.resolvedLanguage || i18n.language || 'ar')
      .split('-')[0];

    i18n.changeLanguage(current === 'ar' ? 'en' : 'ar');
  };
  const links = [['/patient',t('patientHome'),House],['/patient/doctors',t('doctors'),Stethoscope],['/patient/appointments',t('myAppointments'),CalendarDays],['/patient/records',t('medicalRecords'),FileHeart],['/patient/profile',t('profile'),UserRound]];
  return <div className="patient-app"><header className="patient-header"><NavLink to="/patient" className="patient-brand"><span><HeartPulse/></span>{t('brandName')}</NavLink><div><button className="patient-icon-button" aria-label={t('notifications')}><Bell/></button><button className="patient-icon-button" onClick={toggleLanguage} aria-label="Change language"><Languages/></button><button className="patient-icon-button" onClick={()=>{logout();navigate('/patient-login')}} aria-label={t('logout')}><LogOut/></button></div></header><nav className="patient-nav" aria-label={t('patientNavigation')}>{links.map(([to,label,Icon],index)=><NavLink key={to} to={to} end={to==='/patient'} className={index===2?'patient-nav__primary':''}><Icon/><span>{label}</span></NavLink>)}</nav><main className="patient-main"><Outlet/></main></div>;
}
