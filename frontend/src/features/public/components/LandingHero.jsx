import { ArrowUpRight, CalendarDays, CircleCheck, FlaskConical, HeartPulse, Pill, ReceiptText, Stethoscope } from 'lucide-react';
import { Link } from 'react-router-dom';

const modules = [
  ['appointment', CalendarDays, 'visualAppointment', 'visualAppointmentSub'],
  ['doctor', Stethoscope, 'visualDoctor', 'visualDoctorSub'],
  ['lab', FlaskConical, 'visualLab', 'visualLabSub'],
  ['pharmacy', Pill, 'visualPharmacy', 'visualPharmacySub'],
  ['billing', ReceiptText, 'visualBilling', 'visualBillingSub']
];

function HeroVisual({ copy }) {
  return <div className="care-network" aria-hidden="true">
    <span className="care-network__grid" />
    <span className="care-network__halo care-network__halo--one" />
    <span className="care-network__halo care-network__halo--two" />
    <span className="care-network__caption">{copy.visualCaption}<span /></span>
    <svg className="care-network__lines" viewBox="0 0 600 560" preserveAspectRatio="none" fill="none">
      <path d="M180 148 C230 150 230 240 290 255" />
      <path d="M445 161 C398 180 400 240 344 255" />
      <path d="M158 395 C222 385 230 315 286 309" />
      <path d="M446 389 C404 374 395 319 346 309" />
      <path d="M310 341 C310 400 310 420 310 456" />
      <circle cx="290" cy="255" r="5" /><circle cx="344" cy="255" r="5" /><circle cx="286" cy="309" r="5" /><circle cx="346" cy="309" r="5" />
    </svg>
    <div className="care-network__center">
      <span className="care-network__center-icon"><HeartPulse /></span>
      <strong>{copy.visualCenter}</strong>
      <small>{copy.visualCenterSub}</small>
      <span className="care-network__status"><CircleCheck />{copy.visualStatus}</span>
    </div>
    {modules.map(([position, Icon, title, subtitle]) => <div className={`care-network__node care-network__node--${position}`} key={position}>
      <span className="care-network__node-icon"><Icon /></span>
      <span><strong>{copy[title]}</strong><small>{copy[subtitle]}</small></span>
    </div>)}
    <span className="care-network__spark care-network__spark--one" />
    <span className="care-network__spark care-network__spark--two" />
  </div>;
}

export default function LandingHero({ copy }) {
  return <section className="public-hero" id="home" aria-labelledby="hero-title">
    <div className="public-container public-hero__inner">
      <div className="public-hero__copy">
        <span className="public-kicker"><span className="public-kicker__dot" />{copy.heroKicker}</span>
        <h1 id="hero-title"><span>{copy.heroLineOne}</span><span className="public-hero__accent">{copy.heroLineTwo}</span></h1>
        <p>{copy.heroDescription}</p>
        <div className="public-hero__actions">
          <Link className="public-button public-button--primary" to="/register">{copy.getStarted}<ArrowUpRight aria-hidden="true" /></Link>
          <Link className="public-button public-button--outline" to="/patient-login">{copy.patientLogin}<ArrowUpRight aria-hidden="true" /></Link>
        </div>
        <div className="public-hero__note"><span><HeartPulse aria-hidden="true" /></span>{copy.heroNote}</div>
      </div>
      <HeroVisual copy={copy} />
    </div>
  </section>;
}
