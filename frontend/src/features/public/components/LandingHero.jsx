import { ArrowUpRight, HeartPulse } from 'lucide-react';
import { Link } from 'react-router-dom';
import LandingPhoto from './LandingPhoto.jsx';
import consultationSmallPhoto from '../../../assets/landing/healthcare-consultation-640.webp';
import consultationMediumPhoto from '../../../assets/landing/healthcare-consultation-960.webp';
import consultationPhoto from '../../../assets/landing/healthcare-consultation.webp';

export default function LandingHero({ copy }) {
  return <section className="public-hero" id="home" tabIndex={-1} aria-labelledby="hero-title">
    <div className="public-container public-hero__inner">
      <div className="public-hero__copy">
        <span className="public-kicker"><span className="public-kicker__dot" />{copy.heroKicker}</span>
        <h1 id="hero-title"><span>{copy.heroLineOne}</span><span className="public-hero__accent">{copy.heroLineTwo}</span></h1>
        <p>{copy.heroDescription}</p>
        <div className="public-hero__actions">
          <Link className="public-button public-button--primary" to="/register">{copy.getStarted}<ArrowUpRight aria-hidden="true" /></Link>
          <Link className="public-button public-button--outline" to="/patient-login">{copy.patientLogin}<ArrowUpRight aria-hidden="true" /></Link>
        </div>
        <p className="public-hero__note"><HeartPulse aria-hidden="true" />{copy.heroNote}</p>
      </div>
      <figure className="public-hero__visual">
        <LandingPhoto className="public-photo--hero" fallbackLabel={copy.imageUnavailable} src={consultationPhoto} srcSet={`${consultationSmallPhoto} 640w, ${consultationMediumPhoto} 960w, ${consultationPhoto} 1280w`} sizes="(max-width: 700px) calc(100vw - 50px), (max-width: 1440px) 46vw, 650px" width="1280" height="853" alt={copy.consultationAlt} loading="eager" fetchPriority="high" decoding="async" />
        <figcaption><span className="public-icon-tile"><HeartPulse aria-hidden="true" /></span><div><strong>{copy.heroImageTitle}</strong><p>{copy.heroImageNote}</p></div></figcaption>
      </figure>
    </div>
  </section>;
}
