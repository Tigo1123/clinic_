import { HeartPulse } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function LandingHero({ copy }) {
  return (
    <section className="public-hero" id="home" aria-labelledby="hero-title">
      <div className="public-container public-hero__inner">
        <div className="public-hero__copy">
          <span className="ui-section-label">{copy.heroKicker}</span>
          <h1 id="hero-title" className="public-hero__title">
            <span>{copy.heroLineOne}</span> <span>{copy.heroLineTwo}</span>
          </h1>
          <p className="public-hero__description">{copy.heroDescription}</p>
          <div className="public-hero__actions">
            <Link className="public-button public-button--primary" to="/register">
              {copy.getStarted}
            </Link>
            <Link className="public-hero__secondary-link" to="/patient-login">
              {copy.patientLogin}
            </Link>
          </div>
          <div className="public-hero__note">
            <span className="public-hero__note-icon" aria-hidden="true">
              <HeartPulse size={14} />
            </span>
            <span>{copy.heroNote}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
