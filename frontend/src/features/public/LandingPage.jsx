import { ArrowLeft, ArrowRight, CalendarDays, ClipboardList, HeartPulse, Stethoscope } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useFacilityBranding } from '../../app/branding/FacilityBrandingContext.js';
import { PATIENT_BOOKING_PATH } from '../../app/router/patientBooking.js';
import consultationPhoto from '../../assets/landing/healthcare-consultation.webp';
import LandingHeader from './components/LandingHeader.jsx';
import { landingCopy } from './landingCopy.js';
import './public.css';

const visitIcons = [CalendarDays, Stethoscope, ClipboardList];

export default function LandingPage() {
  const { i18n } = useTranslation();
  const isArabic = (i18n.resolvedLanguage || i18n.language || 'ar').startsWith('ar');
  const language = isArabic ? 'ar' : 'en';
  const copy = landingCopy[language];
  const branding = useFacilityBranding();
  const brand = isArabic ? branding.displayNameAr : branding.displayNameEn;
  const DirectionalArrow = isArabic ? ArrowLeft : ArrowRight;

  return (
    <div className="public-site" lang={language} dir={isArabic ? 'rtl' : 'ltr'}>
      <a className="public-skip-link" href="#main-content">{copy.skip}</a>
      <LandingHeader
        copy={copy}
        brand={brand}
        language={language}
        onLanguageChange={() => i18n.changeLanguage(isArabic ? 'en' : 'ar')}
      />
      <main className="public-container" id="main-content" tabIndex={-1}>
        <section className="public-hero" aria-labelledby="public-hero-title">
          <div className="public-hero__intro">
            <h1 id="public-hero-title">{copy.title}</h1>
            <p>{copy.intro}</p>
            <div className="public-hero__actions">
              <Link className="ui-button ui-button--primary" to={PATIENT_BOOKING_PATH}>
                {copy.book} <DirectionalArrow aria-hidden="true" size={18} />
              </Link>
              <Link className="ui-button ui-button--secondary" to="/patient-login">
                {copy.patientLogin}
              </Link>
            </div>
          </div>
          <img
            className="public-hero__photo"
            src={consultationPhoto}
            width="1280"
            height="853"
            alt={copy.photoAlt}
            fetchPriority="high"
          />
        </section>

        <section className="public-visit" id="visit" aria-labelledby="visit-title">
          <h2 id="visit-title">{copy.visit}</h2>
          <ul className="public-visit__list">
            {copy.visitSteps.map(({ title, description }, index) => {
              const Icon = visitIcons[index];
              return (
                <li className="public-visit__item" key={title}>
                  <span className="public-visit__icon"><Icon aria-hidden="true" size={21} /></span>
                  <h3>{title}</h3>
                  <p>{description}</p>
                </li>
              );
            })}
          </ul>
        </section>
      </main>
      <footer className="public-footer">
        <div className="public-container public-footer__inner">
          <span><HeartPulse aria-hidden="true" size={20} /> {brand}</span>
          <Link className="public-staff-link" to="/staff">{copy.staffLogin}</Link>
        </div>
      </footer>
    </div>
  );
}
