import { Activity, ArrowUpRight, CalendarDays, FileHeart, FlaskConical, HeartPulse, Pill, ReceiptText, ShieldCheck, Stethoscope, UserRound, UserRoundCheck, UsersRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import receptionPhoto from '../../../assets/landing/healthcare-reception.webp';
import laboratoryPhoto from '../../../assets/landing/healthcare-laboratory.webp';
import consultationPhoto from '../../../assets/landing/healthcare-consultation.webp';

const overviewIcons = [HeartPulse, CalendarDays, FlaskConical, Pill, ReceiptText];
const featureIcons = [CalendarDays, FileHeart, Stethoscope, FlaskConical, Pill, ReceiptText];
const journeyIcons = [CalendarDays, UserRoundCheck, Stethoscope, ReceiptText, FlaskConical, Pill];
const roleIcons = [UserRound, UsersRound, Stethoscope, FlaskConical, Pill, ShieldCheck];

function SectionHeading({ kicker, title, intro, id }) {
  return <div className="public-section-heading">
    <span className="public-kicker"><span className="public-kicker__dot" />{kicker}</span>
    <h2 id={id}>{title}</h2>
    <p>{intro}</p>
  </div>;
}

export function SystemOverview({ copy }) {
  return <section className="public-overview" aria-label={copy.overviewLabel}>
    <div className="public-container public-overview__inner">
      <p>{copy.overviewLabel}</p>
      <div className="public-overview__items">
        {copy.overviewItems.map((item, index) => {
          const Icon = overviewIcons[index];
          return <span key={item}><Icon aria-hidden="true" />{item}</span>;
        })}
      </div>
    </div>
  </section>;
}

function FeaturePreview({ feature, index }) {
  const steps = [feature.previewA, feature.previewB, feature.previewC];
  return <div className={`feature-preview feature-preview--${index + 1}`} aria-hidden="true">
    <div className="feature-preview__top"><span className="feature-preview__dots"><i /><i /><i /></span><span>{feature.previewTitle}</span><Activity /></div>
    <div className="feature-preview__body">
      {steps.map((step, stepIndex) => <div className="feature-preview__step" key={step}>
        <span className="feature-preview__step-mark">{String(stepIndex + 1).padStart(2, '0')}</span>
        <strong>{step}</strong>
      </div>)}
    </div>
  </div>;
}

export function FeatureSection({ copy }) {
  return <section className="public-features public-section" id="features" aria-labelledby="features-title">
    <div className="public-container">
      <SectionHeading kicker={copy.featureKicker} title={copy.featureTitle} intro={copy.featureIntro} id="features-title" />
      <div className="public-feature-grid">
        {copy.features.map((feature, index) => {
          const Icon = featureIcons[index];
          return <article className={`public-feature public-feature--${index + 1}`} key={feature.tag}>
            <div className="public-feature__top"><span className="public-feature__icon"><Icon aria-hidden="true" /></span><span className="public-feature__tag">{feature.tag}</span></div>
            <div className="public-feature__copy"><h3>{feature.title}</h3><p>{feature.body}</p></div>
            <FeaturePreview feature={feature} index={index} />
          </article>;
        })}
      </div>
    </div>
  </section>;
}

export function JourneySection({ copy }) {
  return <section className="public-journey public-section" id="journey" aria-labelledby="journey-title">
    <div className="public-container">
      <SectionHeading kicker={copy.journeyKicker} title={copy.journeyTitle} intro={copy.journeyIntro} id="journey-title" />
      <ol className="public-journey__track">
        {copy.journey.map((step, index) => {
          const Icon = journeyIcons[index];
          return <li key={step.title}>
            <div className="public-journey__number"><Icon aria-hidden="true" /><span>{String(index + 1).padStart(2, '0')}</span></div>
            <h3>{step.title}</h3><p>{step.body}</p>
          </li>;
        })}
      </ol>
    </div>
  </section>;
}

export function HumanCareSection({ copy }) {
  return <section className="public-human public-section" aria-labelledby="human-title">
    <div className="public-container public-human__layout">
      <div className="public-human__copy"><SectionHeading kicker={copy.humanKicker} title={copy.humanTitle} intro={copy.humanIntro} id="human-title" /><div className="public-human__detail"><HeartPulse aria-hidden="true" /><span>{copy.humanDetail}</span></div></div>
      <div className="public-human__collage">
        <figure className="public-human__image public-human__image--main"><img src={receptionPhoto} alt={copy.receptionAlt} loading="lazy" /><figcaption>{copy.receptionCaption}</figcaption></figure>
        <figure className="public-human__image public-human__image--consult"><img src={consultationPhoto} alt={copy.consultationAlt} loading="lazy" /><figcaption>{copy.consultationCaption}</figcaption></figure>
        <figure className="public-human__image public-human__image--lab"><img src={laboratoryPhoto} alt={copy.laboratoryAlt} loading="lazy" /><figcaption>{copy.laboratoryCaption}</figcaption></figure>
      </div>
    </div>
  </section>;
}

export function ProductPreviewSection({ copy }) {
  return <section className="public-product public-section" aria-labelledby="product-title">
    <div className="public-container">
      <SectionHeading kicker={copy.productKicker} title={copy.productTitle} intro={copy.productIntro} id="product-title" />
      <div className="product-preview" data-asset-slot="product-dashboard-preview">
        <div className="product-preview__bar"><span className="product-preview__dots"><i /><i /><i /></span><strong>{copy.productWorkspace}</strong><span className="product-preview__secure"><ShieldCheck aria-hidden="true" />{copy.productWorkspaceStatus}</span></div>
        <div className="product-preview__body">
          <aside className="product-preview__sidebar"><span className="product-preview__brand"><HeartPulse />{copy.productBrand}</span><span className="is-active"><CalendarDays />{copy.productAppointments}</span><span><UsersRound />{copy.productPatients}</span><span><ReceiptText />{copy.productBilling}</span><span><FlaskConical />{copy.productLab}</span></aside>
          <div className="product-preview__main"><div className="product-preview__heading"><div><span>{copy.productEyebrow}</span><h3>{copy.productHeading}</h3></div><button type="button" tabIndex="-1">{copy.productAction}<ArrowUpRight aria-hidden="true" /></button></div><div className="product-preview__metrics"><div><span>{copy.metricOneLabel}</span><strong>{copy.metricOneValue}</strong><small>{copy.metricOneNote}</small></div><div><span>{copy.metricTwoLabel}</span><strong>{copy.metricTwoValue}</strong><small>{copy.metricTwoNote}</small></div><div><span>{copy.metricThreeLabel}</span><strong>{copy.metricThreeValue}</strong><small>{copy.metricThreeNote}</small></div></div><div className="product-preview__grid"><div className="product-preview__queue"><div className="product-preview__subhead"><strong>{copy.queueTitle}</strong><span>{copy.queueToday}</span></div>{[copy.queueOne, copy.queueTwo, copy.queueThree].map((item, index) => <div className="product-preview__queue-item" key={item}><span className={`product-preview__avatar product-preview__avatar--${index + 1}`}>{index + 1}</span><div><strong>{item}</strong><small>{copy.queueMeta[index]}</small></div><span className="product-preview__badge">{copy.queueStatus[index]}</span></div>)}</div><div className="product-preview__chart"><div className="product-preview__subhead"><strong>{copy.chartTitle}</strong><span>{copy.chartRange}</span></div><div className="product-preview__bars" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /></div><div className="product-preview__axis"><span>08:00</span><span>12:00</span><span>16:00</span></div></div></div></div>
        </div>
      </div>
      <p className="product-preview__note"><ShieldCheck aria-hidden="true" />{copy.productNote}</p>
    </div>
  </section>;
}

export function RoleSection({ copy }) {
  return <section className="public-roles public-section" id="about" aria-labelledby="roles-title">
    <div className="public-container public-roles__layout">
      <div className="public-roles__intro"><SectionHeading kicker={copy.rolesKicker} title={copy.rolesTitle} intro={copy.rolesIntro} id="roles-title" /><div className="public-roles__symbol" aria-hidden="true"><span><HeartPulse /></span><i /><i /><i /></div></div>
      <div className="public-roles__grid">
        {copy.roles.map((role, index) => {
          const Icon = roleIcons[index];
          return <article className="public-role" key={role.title}><span className="public-role__icon"><Icon aria-hidden="true" /></span><div><h3>{role.title}</h3><p>{role.body}</p></div></article>;
        })}
      </div>
    </div>
  </section>;
}

export function FinalCTA({ copy }) {
  return <section className="public-cta public-section" aria-labelledby="cta-title">
    <div className="public-container"><div className="public-cta__panel">
      <div className="public-cta__decoration" aria-hidden="true"><span /><span /><span /></div>
      <div className="public-cta__content"><span className="public-kicker"><span className="public-kicker__dot" />{copy.ctaKicker}</span><h2 id="cta-title">{copy.ctaTitle}</h2><p>{copy.ctaBody}</p><div className="public-cta__actions"><Link className="public-button public-button--light" to="/register">{copy.createAccount}<ArrowUpRight aria-hidden="true" /></Link><Link className="public-button public-button--ghost" to="/patient-login">{copy.patientLogin}<ArrowUpRight aria-hidden="true" /></Link></div></div>
      <span className="public-cta__mark" aria-hidden="true"><HeartPulse /></span>
    </div></div>
  </section>;
}

export function LandingFooter({ copy, brand }) {
  return <footer className="public-footer"><div className="public-container public-footer__inner">
    <div className="public-footer__brand"><Link className="public-brand" to="/"><span className="public-brand__mark"><HeartPulse aria-hidden="true" /></span><span className="public-brand__name">{brand}</span></Link><p>{copy.footerDescription}</p></div>
    <div className="public-footer__column"><strong>{copy.footerNavigate}</strong><a href="#home">{copy.home}</a><a href="#features">{copy.featuresNav}</a><a href="#journey">{copy.howItWorks}</a><a href="#about">{copy.about}</a></div>
    <div className="public-footer__column"><strong>{copy.footerAccess}</strong><Link to="/register">{copy.createAccount}</Link><Link to="/patient-login">{copy.patientLogin}</Link><Link to="/staff">{copy.staffLogin}</Link></div>
  </div><div className="public-container public-footer__bottom"><span>© {new Date().getFullYear()} {copy.footerCopyright}</span><span>{copy.footerDescription}</span></div></footer>;
}
