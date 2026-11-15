import { CalendarDays, FileHeart, FlaskConical, HeartPulse, Pill, ReceiptText, ShieldCheck, Stethoscope, UserRound, UserRoundCheck, UsersRound } from 'lucide-react';
import { Link } from 'react-router-dom';

const overviewIcons = [HeartPulse, CalendarDays, FlaskConical, Pill, ReceiptText];
const featureIcons = [CalendarDays, FileHeart, Stethoscope, FlaskConical, Pill, ReceiptText];
const journeyIcons = [CalendarDays, UserRoundCheck, Stethoscope, ReceiptText, FlaskConical, Pill];
const roleIcons = [UserRound, UsersRound, Stethoscope, FlaskConical, Pill, ShieldCheck];

function SectionHeading({ kicker, title, intro, id }) {
  return (
    <div className="public-section-heading">
      {kicker && <span className="ui-section-label">{kicker}</span>}
      <h2 id={id} className="public-section-heading__title">{title}</h2>
      {intro && <p className="public-section-heading__intro">{intro}</p>}
    </div>
  );
}

export function SystemOverview({ copy }) {
  return (
    <section className="public-overview public-section" aria-label={copy.overviewLabel}>
      <div className="public-container">
        <div className="ui-panel public-overview__panel">
          <span className="ui-section-label public-overview__label">{copy.overviewLabel}</span>
          <div className="public-overview__items">
            {copy.overviewItems.map((item, index) => {
              const Icon = overviewIcons[index] || HeartPulse;
              return (
                <span className="public-overview__item" key={item}>
                  <Icon size={16} aria-hidden="true" />
                  <span>{item}</span>
                </span>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

export function FeatureSection({ copy }) {
  return (
    <section className="public-features public-section" id="features" aria-labelledby="features-title">
      <div className="public-container">
        <SectionHeading kicker={copy.featureKicker} title={copy.featureTitle} intro={copy.featureIntro} id="features-title" />
        <div className="ui-panel">
          {copy.features.map((feature, index) => {
            const Icon = featureIcons[index] || HeartPulse;
            const steps = [feature.previewA, feature.previewB, feature.previewC].filter(Boolean);
            return (
              <div className="ui-row public-feature-row" key={feature.tag}>
                <span className="public-feature-row__icon" aria-hidden="true">
                  <Icon size={18} />
                </span>
                <div className="public-feature-row__content">
                  <div className="public-feature-row__header">
                    <h3 className="public-feature-row__title">{feature.title}</h3>
                    <span className="public-feature-row__tag">{feature.tag}</span>
                  </div>
                  <p className="public-feature-row__desc">{feature.body}</p>
                  {steps.length > 0 && (
                    <div className="public-feature-row__steps">
                      <span className="ui-section-label public-feature-row__step-label">{feature.previewTitle}:</span>
                      {steps.map((step, sIdx) => (
                        <span className="public-feature-step" key={step}>
                          <span className="ui-mono public-feature-step__num">
                            {String(sIdx + 1).padStart(2, '0')}
                          </span>
                          <span>{step}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export function JourneySection({ copy }) {
  return (
    <section className="public-journey public-section" id="journey" aria-labelledby="journey-title">
      <div className="public-container">
        <SectionHeading kicker={copy.journeyKicker} title={copy.journeyTitle} intro={copy.journeyIntro} id="journey-title" />
        <div className="ui-panel">
          <ol className="public-journey-list">
            {copy.journey.map((step, index) => {
              const Icon = journeyIcons[index] || HeartPulse;
              return (
                <li className="ui-row public-journey-row" key={step.title}>
                  <span className="ui-mono public-journey-row__num">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className="public-journey-row__icon" aria-hidden="true">
                    <Icon size={18} />
                  </span>
                  <div className="public-journey-row__content">
                    <h3 className="public-journey-row__title">{step.title}</h3>
                    <p className="public-journey-row__desc">{step.body}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </section>
  );
}

export function HumanCareSection({ copy }) {
  return (
    <section className="public-human public-section" aria-labelledby="human-title">
      <div className="public-container">
        <SectionHeading kicker={copy.humanKicker} title={copy.humanTitle} intro={copy.humanIntro} id="human-title" />
        <div className="ui-panel">
          <div className="ui-row public-human-row">
            <span className="public-human-row__icon" aria-hidden="true"><UsersRound size={18} /></span>
            <div className="public-human-row__content">
              <h3 className="public-human-row__title">{copy.receptionCaption}</h3>
              <p className="public-human-row__desc">{copy.humanDetail}</p>
            </div>
          </div>
          <div className="ui-row public-human-row">
            <span className="public-human-row__icon" aria-hidden="true"><Stethoscope size={18} /></span>
            <div className="public-human-row__content">
              <h3 className="public-human-row__title">{copy.consultationCaption}</h3>
              <p className="public-human-row__desc">{copy.humanDetail}</p>
            </div>
          </div>
          <div className="ui-row public-human-row">
            <span className="public-human-row__icon" aria-hidden="true"><FlaskConical size={18} /></span>
            <div className="public-human-row__content">
              <h3 className="public-human-row__title">{copy.laboratoryCaption}</h3>
              <p className="public-human-row__desc">{copy.humanDetail}</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function ProductPreviewSection({ copy, brand }) {
  const workspaces = [
    [CalendarDays, copy.productAppointments],
    [UsersRound, copy.productPatients],
    [ReceiptText, copy.productBilling],
    [FlaskConical, copy.productLab]
  ];

  const queueItems = [
    { title: copy.queueOne, meta: copy.queueMeta[0], status: copy.queueStatus[0], modifier: 'ok' },
    { title: copy.queueTwo, meta: copy.queueMeta[1], status: copy.queueStatus[1], modifier: 'wait' },
    { title: copy.queueThree, meta: copy.queueMeta[2], status: copy.queueStatus[2], modifier: 'warn' }
  ];

  return (
    <section className="public-product public-section" aria-labelledby="product-title">
      <div className="public-container">
        <SectionHeading kicker={copy.productKicker} title={copy.productTitle} intro={copy.productIntro} id="product-title" />
        <div className="ui-panel public-product-panel">
          <div className="public-product-panel__header">
            <div className="public-product-panel__brand">
              <HeartPulse size={16} aria-hidden="true" />
              <span>{brand} · {copy.productWorkspace}</span>
            </div>
            <span className="ui-status ui-status--ok">{copy.productWorkspaceStatus}</span>
          </div>

          <div className="public-product-panel__subheader">
            <div>
              <span className="ui-section-label">{copy.productEyebrow}</span>
              <h3 className="public-product-panel__title">{copy.productHeading}</h3>
            </div>
            <button type="button" className="public-button public-button--secondary public-product-panel__action" tabIndex={-1}>
              {copy.productAction}
            </button>
          </div>

          <div className="public-product-panel__nav" aria-hidden="true">
            {workspaces.map(([Icon, label], idx) => (
              <span className={`public-product-panel__nav-item ${idx === 0 ? 'is-active' : ''}`} key={label}>
                <Icon size={16} aria-hidden="true" />
                <span>{label}</span>
              </span>
            ))}
          </div>

          <div className="public-product-panel__metrics">
            <div className="public-product-metric">
              <span className="ui-section-label">{copy.metricOneLabel}</span>
              <strong className="ui-mono public-product-metric__val">{copy.metricOneValue}</strong>
              <small className="public-product-metric__note">{copy.metricOneNote}</small>
            </div>
            <div className="public-product-metric">
              <span className="ui-section-label">{copy.metricTwoLabel}</span>
              <strong className="ui-mono public-product-metric__val">{copy.metricTwoValue}</strong>
              <small className="public-product-metric__note">{copy.metricTwoNote}</small>
            </div>
            <div className="public-product-metric">
              <span className="ui-section-label">{copy.metricThreeLabel}</span>
              <strong className="ui-mono public-product-metric__val">{copy.metricThreeValue}</strong>
              <small className="public-product-metric__note">{copy.metricThreeNote}</small>
            </div>
          </div>

          <div className="public-product-panel__queue-header">
            <strong className="public-product-panel__queue-title">{copy.queueTitle}</strong>
            <span className="ui-mono public-product-panel__queue-badge">{copy.queueToday}</span>
          </div>

          <div className="public-product-panel__queue-rows">
            {queueItems.map((item, index) => (
              <div className="ui-row public-product-queue-row" key={item.title}>
                <span className="ui-mono public-product-queue-row__num">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <div className="public-product-queue-row__main">
                  <strong className="public-product-queue-row__title">{item.title}</strong>
                  <span className="ui-mono public-product-queue-row__meta">{item.meta}</span>
                </div>
                <span className={`ui-status ui-status--${item.modifier}`}>{item.status}</span>
              </div>
            ))}
          </div>

          <div className="public-product-panel__chart">
            <div className="public-product-panel__chart-header">
              <span className="ui-section-label">{copy.chartTitle}</span>
              <span className="ui-mono public-product-panel__chart-range">{copy.chartRange}</span>
            </div>
            <div className="public-product-panel__chart-timeline">
              <span className="ui-mono">08:00</span>
              <span className="public-product-panel__chart-bar" aria-hidden="true" />
              <span className="ui-mono">12:00</span>
              <span className="public-product-panel__chart-bar" aria-hidden="true" />
              <span className="ui-mono">16:00</span>
            </div>
          </div>
        </div>

        <p className="public-product-note">
          <ShieldCheck size={14} aria-hidden="true" />
          <span>{copy.productNote}</span>
        </p>
      </div>
    </section>
  );
}

export function RoleSection({ copy }) {
  return (
    <section className="public-roles public-section" id="about" aria-labelledby="roles-title">
      <div className="public-container">
        <SectionHeading kicker={copy.rolesKicker} title={copy.rolesTitle} intro={copy.rolesIntro} id="roles-title" />
        <div className="ui-panel">
          {copy.roles.map((role, index) => {
            const Icon = roleIcons[index] || HeartPulse;
            return (
              <div className="ui-row public-role-row" key={role.title}>
                <span className="public-role-row__icon" aria-hidden="true">
                  <Icon size={18} />
                </span>
                <div className="public-role-row__content">
                  <h3 className="public-role-row__title">{role.title}</h3>
                  <p className="public-role-row__desc">{role.body}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export function FinalCTA({ copy }) {
  return (
    <section className="public-cta public-section" aria-labelledby="cta-title">
      <div className="public-container">
        <div className="ui-panel public-cta-panel">
          <span className="ui-section-label">{copy.ctaKicker}</span>
          <h2 id="cta-title" className="public-cta-panel__title">{copy.ctaTitle}</h2>
          <p className="public-cta-panel__desc">{copy.ctaBody}</p>
          <div className="public-cta-panel__actions">
            <Link className="public-button public-button--primary" to="/register">
              {copy.createAccount}
            </Link>
            <Link className="public-link" to="/patient-login">
              {copy.patientLogin}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

export function LandingFooter({ copy, brand, descriptor }) {
  return (
    <footer className="public-footer">
      <div className="public-container public-footer__inner">
        <div className="public-footer__brand">
          <Link className="public-brand" to="/" aria-label={brand}>
            <span className="public-brand__mark"><HeartPulse aria-hidden="true" size={16} /></span>
            <span className="public-brand__lockup">
              <span className="public-brand__name">{brand}</span>
              {descriptor && <small className="public-brand__descriptor">{descriptor}</small>}
            </span>
          </Link>
          <p className="public-footer__desc">{copy.footerDescription}</p>
        </div>
        <div className="public-footer__column">
          <strong className="ui-section-label public-footer__column-title">{copy.footerNavigate}</strong>
          <a href="#home">{copy.home}</a>
          <a href="#features">{copy.featuresNav}</a>
          <a href="#journey">{copy.howItWorks}</a>
          <a href="#about">{copy.about}</a>
        </div>
        <div className="public-footer__column">
          <strong className="ui-section-label public-footer__column-title">{copy.footerAccess}</strong>
          <Link to="/register">{copy.createAccount}</Link>
          <Link to="/patient-login">{copy.patientLogin}</Link>
          <Link to="/staff">{copy.staffLogin}</Link>
        </div>
      </div>
      <div className="public-container public-footer__bottom">
        <span>© {new Date().getFullYear()} {brand}{descriptor ? ` · ${descriptor}` : ''}</span>
        <span>{copy.footerCopyright || copy.footerDescription}</span>
      </div>
    </footer>
  );
}
