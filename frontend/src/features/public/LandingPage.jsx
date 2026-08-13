import { ArrowRight, CalendarCheck, HeartPulse, Languages, ShieldCheck, Stethoscope } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import './public.css';

export default function LandingPage() {
  const { t, i18n } = useTranslation();
  function toggleLanguage() {
    const language = i18n.language === 'ar' ? 'en' : 'ar';
    i18n.changeLanguage(language);
    document.documentElement.lang = language;
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
  }
  return <div className="public-site">
    <header className="public-header"><Link className="public-brand" to="/"><span><HeartPulse /></span><strong>{t('brandName')}</strong></Link><nav aria-label="Main navigation"><a href="#care">{t('services')}</a><Link to="/patient/doctors">{t('doctors')}</Link></nav><div className="public-header__actions"><button className="public-icon-button" onClick={toggleLanguage} aria-label="Change language"><Languages /></button><Link className="ui-button ui-button--outline" to="/staff">{t('staffPortal')}</Link><Link className="ui-button ui-button--primary" to="/patient-login">{t('patientLogin')}</Link></div></header>
    <main>
      <section className="hero"><div className="hero__copy"><span className="eyebrow"><ShieldCheck /> {t('trustedCare')}</span><h1>{t('heroTitle')}</h1><p>{t('heroDescription')}</p><div className="hero__actions"><Link className="ui-button ui-button--primary" to="/register">{t('createAccount')} <ArrowRight /></Link><Link className="ui-button ui-button--outline" to="/patient-login">{t('bookAppointment')}</Link></div><div className="hero__trust"><span><CalendarCheck /> {t('realAvailability')}</span><span><ShieldCheck /> {t('secureRecords')}</span></div></div><div className="hero__visual" aria-hidden="true"><div className="hero-orb"><HeartPulse /></div><div className="floating-care-card"><span><Stethoscope /></span><div><strong>{t('findCare')}</strong><small>{t('chooseDoctor')}</small></div></div><div className="floating-care-card second"><span><CalendarCheck /></span><div><strong>{t('manageAppointments')}</strong><small>{t('anyDevice')}</small></div></div></div></section>
      <section className="care-section" id="care"><div className="section-heading"><span className="eyebrow">{t('simpleHealthcare')}</span><h2>{t('careJourney')}</h2><p>{t('careJourneyText')}</p></div><div className="care-grid"><article><span>01</span><Stethoscope/><h3>{t('findDoctor')}</h3><p>{t('findDoctorText')}</p></article><article><span>02</span><CalendarCheck/><h3>{t('chooseTime')}</h3><p>{t('chooseTimeText')}</p></article><article><span>03</span><ShieldCheck/><h3>{t('manageCare')}</h3><p>{t('manageCareText')}</p></article></div></section>
    </main>
    <footer className="public-footer"><div className="public-brand"><span><HeartPulse /></span><strong>{t('brandName')}</strong></div><p>{t('healthcareFooter')}</p></footer>
  </div>;
}
