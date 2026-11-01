import { ArrowRight, ArrowUpRight, CalendarDays, CircleCheck, FileHeart, FlaskConical, HeartPulse, Pill, ReceiptText, ShieldCheck, Stethoscope, UserRoundCheck, UsersRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import ShifaLogo from '../../../components/brand/ShifaLogo.jsx';
import LandingPhoto from './LandingPhoto.jsx';
import receptionSmallPhoto from '../../../assets/landing/healthcare-reception-640.webp';
import teamSmallPhoto from '../../../assets/landing/healthcare-team-640.webp';
import handoffSmallPhoto from '../../../assets/landing/healthcare-handoff-640.webp';
import laboratorySmallPhoto from '../../../assets/landing/healthcare-laboratory-640.webp';
import receptionPhoto from '../../../assets/landing/healthcare-reception.webp';
import teamPhoto from '../../../assets/landing/healthcare-team.webp';
import handoffPhoto from '../../../assets/landing/healthcare-handoff.webp';
import laboratoryPhoto from '../../../assets/landing/healthcare-laboratory.webp';

const moduleIcons = { appointments: CalendarDays, reception: UsersRound, doctor: Stethoscope, laboratory: FlaskConical, pharmacy: Pill, billing: ReceiptText, records: FileHeart };
const startIcons = [UserRoundCheck, CalendarDays, FileHeart];
const journeyIcons = [CalendarDays, UsersRound, Stethoscope, ReceiptText, FlaskConical, FileHeart];
const benefitIcons = [HeartPulse, CalendarDays, ShieldCheck, UsersRound];

function SectionHeading({ kicker, title, intro, id }) {
  return <div className="public-section-heading">
    <span className="public-kicker"><span className="public-kicker__dot" />{kicker}</span>
    <h2 id={id}>{title}</h2>
    {intro && <p>{intro}</p>}
  </div>;
}

export function SystemOverview({ copy }) {
  const icons = [UsersRound, HeartPulse, FileHeart];
  return <section className="public-overview" aria-label={copy.overviewLabel}>
    <div className="public-container public-overview__inner" data-scroll-reveal>
      <p>{copy.overviewLabel}</p>
      <div className="public-overview__items">{copy.overviewItems.map((item, index) => {
        const Icon = icons[index];
        return <span key={item}><Icon aria-hidden="true" />{item}</span>;
      })}</div>
    </div>
  </section>;
}

export function HowItWorksSection({ copy }) {
  return <section className="public-how public-section" id="how-it-works" tabIndex={-1} aria-labelledby="how-title">
    <div className="public-container public-how__layout">
      <div className="public-how__intro" data-scroll-reveal>
        <SectionHeading kicker={copy.howKicker} title={copy.howTitle} intro={copy.howIntro} id="how-title" />
        <a href="#features" className="public-text-link">{copy.exploreModules}<ArrowRight aria-hidden="true" /></a>
      </div>
      <ol className="public-how__steps">{copy.startSteps.map((step, index) => {
        const Icon = startIcons[index];
        return <li key={step.title} data-scroll-reveal>
          <span className="public-how__number" aria-hidden="true">0{index + 1}</span>
          <div><h3>{step.title}</h3><p>{step.body}</p></div>
          <span className="public-icon-tile"><Icon aria-hidden="true" /></span>
        </li>;
      })}</ol>
    </div>
  </section>;
}

export function AboutSection({ copy }) {
  return <section className="public-about public-section" id="about" tabIndex={-1} aria-labelledby="about-title">
    <div className="public-container public-about__layout">
      <div className="public-about__copy" data-scroll-reveal>
        <SectionHeading kicker={copy.storyKicker} title={copy.storyTitle} intro={copy.storyIntro} id="about-title" />
        <p className="public-about__body">{copy.storyBody}</p>
        <ul className="public-about__values">{copy.storyValues.map(value => <li key={value}><CircleCheck aria-hidden="true" />{value}</li>)}</ul>
        <a href="#journey" className="public-text-link">{copy.storyLink}<ArrowRight aria-hidden="true" /></a>
      </div>
      <figure className="public-about__visual" data-scroll-reveal>
        <LandingPhoto className="public-photo--team" fallbackLabel={copy.imageUnavailable} src={teamPhoto} srcSet={`${teamSmallPhoto} 640w, ${teamPhoto} 960w`} sizes="(max-width: 700px) calc(100vw - 32px), (max-width: 1440px) 40vw, 570px" width="960" height="1024" alt={copy.teamAlt} loading="lazy" decoding="async" />
        <figcaption><span>{copy.storyCaptionLabel}</span><strong>{copy.storyCaption}</strong></figcaption>
      </figure>
    </div>
  </section>;
}

export function FeatureSection({ copy }) {
  return <section className="public-features public-section" id="features" tabIndex={-1} aria-labelledby="features-title">
    <div className="public-container">
      <div className="public-features__heading" data-scroll-reveal><SectionHeading kicker={copy.featureKicker} title={copy.featureTitle} intro={copy.featureIntro} id="features-title" /></div>
      <div className="public-feature-grid">
        <figure className="public-feature-photo" data-scroll-reveal>
          <LandingPhoto className="public-photo--laboratory" fallbackLabel={copy.imageUnavailable} src={laboratoryPhoto} srcSet={`${laboratorySmallPhoto} 640w, ${laboratoryPhoto} 1200w`} sizes="(max-width: 700px) calc(100vw - 32px), (max-width: 1100px) 52vw, 610px" width="1200" height="800" alt={copy.laboratoryAlt} loading="lazy" decoding="async" />
          <figcaption><span className="public-kicker">{copy.departmentPhotoKicker}</span><strong>{copy.departmentPhotoTitle}</strong></figcaption>
        </figure>
        {copy.modules.map((module, index) => {
        const Icon = moduleIcons[module.id];
        return <article className={`public-feature${index === 0 ? ' public-feature--lead' : ''}`} key={module.id} data-module={module.id} data-scroll-reveal>
          <span className="public-icon-tile"><Icon aria-hidden="true" /></span>
          <div className="public-feature__copy"><h3>{module.title}</h3><p>{module.body}</p></div>
          {index === 0 && <Link to="/register" className="public-text-link">{copy.getStarted}<ArrowUpRight aria-hidden="true" /></Link>}
        </article>;
      })}</div>
    </div>
  </section>;
}

export function JourneySection({ copy }) {
  return <section className="public-journey public-section" id="journey" tabIndex={-1} aria-labelledby="journey-title">
    <div className="public-container">
      <div className="public-journey__heading" data-scroll-reveal><SectionHeading kicker={copy.journeyKicker} title={copy.journeyTitle} intro={copy.journeyIntro} id="journey-title" /><figure className="public-journey__visual"><LandingPhoto className="public-photo--handoff" fallbackLabel={copy.imageUnavailable} src={handoffPhoto} srcSet={`${handoffSmallPhoto} 640w, ${handoffPhoto} 1120w`} sizes="(max-width: 700px) calc(100vw - 32px), (max-width: 1440px) 41vw, 590px" width="1120" height="746" alt={copy.handoffAlt} loading="lazy" decoding="async" /></figure></div>
      <ol className="public-journey__track">{copy.journey.map((step, index) => {
        const Icon = journeyIcons[index];
        return <li key={step.title} data-scroll-reveal>
          <div className="public-journey__step-top"><span className="public-journey__number" aria-hidden="true">0{index + 1}</span><Icon aria-hidden="true" /></div>
          <h3>{step.title}</h3><p>{step.body}</p>
          {index < copy.journey.length - 1 && <ArrowRight className="public-journey__arrow" aria-hidden="true" />}
        </li>;
      })}</ol>
      <p className="public-journey__note"><CircleCheck aria-hidden="true" />{copy.journeyNote}</p>
    </div>
  </section>;
}

export function BenefitsSection({ copy }) {
  return <section className="public-benefits public-section" id="why-shifa" tabIndex={-1} aria-labelledby="benefits-title">
    <div className="public-container public-benefits__layout">
      <figure className="public-benefits__visual" data-scroll-reveal>
        <LandingPhoto className="public-photo--reception" fallbackLabel={copy.imageUnavailable} src={receptionPhoto} srcSet={`${receptionSmallPhoto} 640w, ${receptionPhoto} 800w`} sizes="(max-width: 600px) calc(100vw - 32px), (max-width: 850px) 560px, (max-width: 1440px) 40vw, 540px" width="800" height="1000" alt={copy.receptionAlt} loading="lazy" decoding="async" />
        <figcaption>{copy.receptionCaption}</figcaption>
      </figure>
      <div className="public-benefits__copy" data-scroll-reveal>
        <SectionHeading kicker={copy.benefitsKicker} title={copy.benefitsTitle} intro={copy.benefitsIntro} id="benefits-title" />
        <div className="public-benefits__list">{copy.benefits.map((benefit, index) => {
          const Icon = benefitIcons[index];
          return <div className="public-benefit" key={benefit.title}><span className="public-icon-tile"><Icon aria-hidden="true" /></span><div><h3>{benefit.title}</h3><p>{benefit.body}</p></div></div>;
        })}</div>
      </div>
    </div>
  </section>;
}

export function FinalCTA({ copy }) {
  return <section className="public-cta" id="start-care" tabIndex={-1} aria-labelledby="cta-title">
    <div className="public-container"><div className="public-cta__panel" data-scroll-reveal>
      <div className="public-cta__content"><span className="public-kicker"><span className="public-kicker__dot" />{copy.ctaKicker}</span><h2 id="cta-title">{copy.ctaTitle}</h2><p>{copy.ctaBody}</p></div>
      <div className="public-cta__actions"><Link className="public-button public-button--light" to="/register">{copy.createAccount}<ArrowUpRight aria-hidden="true" /></Link><Link className="public-button public-button--ghost" to="/patient-login">{copy.patientLogin}<ArrowUpRight aria-hidden="true" /></Link></div>
    </div></div>
  </section>;
}

export function LandingFooter({ copy, brand, descriptor, facilityName }) {
  return <footer className="public-footer" id="footer" tabIndex={-1}>
    <div className="public-container public-footer__inner">
      <div className="public-footer__brand" data-scroll-reveal><a className="public-brand" href="#home" aria-label={brand}><ShifaLogo className="public-brand__logo" />{facilityName && <span className="public-brand__facility">{facilityName}</span>}</a><p>{copy.footerDescription}</p></div>
      <nav className="public-footer__column" data-scroll-reveal aria-label={copy.footerNavigate}><strong>{copy.footerNavigate}</strong><a href="#how-it-works">{copy.howItWorks}</a><a href="#features">{copy.featuresNav}</a><a href="#journey">{copy.journeyNav}</a><a href="#about">{copy.about}</a><a href="#why-shifa">{copy.whyShifa}</a></nav>
      <nav className="public-footer__column" data-scroll-reveal aria-label={copy.footerAccess}><strong>{copy.footerAccess}</strong><Link to="/register">{copy.createAccount}</Link><Link to="/patient-login">{copy.patientLogin}</Link><Link to="/staff">{copy.staffLogin}</Link></nav>
    </div>
    <div className="public-container public-footer__bottom" data-scroll-reveal><span>© {new Date().getFullYear()} {brand}</span><span>{descriptor}</span><a href="#home">{copy.backToTop}<ArrowUpRight aria-hidden="true" /></a></div>
  </footer>;
}
