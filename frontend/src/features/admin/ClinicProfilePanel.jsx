import { Banknote, Building2, Languages, Monitor, ReceiptText, ShieldCheck, ScrollText } from 'lucide-react';
import './clinicProfile.css';

const CAPABILITIES = [
  { icon: Languages, title: 'clinicProfileLanguages', value: 'clinicProfileLanguagesValue' },
  { icon: Banknote, title: 'clinicProfileCurrency', value: 'clinicProfileCurrencyValue' },
  { icon: ShieldCheck, title: 'clinicProfileSecurity', value: 'clinicProfileSecurityValue' },
  { icon: ReceiptText, title: 'clinicProfileBilling', value: 'clinicProfileBillingValue' },
  { icon: Monitor, title: 'clinicProfileAccess', value: 'clinicProfileAccessValue' },
  { icon: ScrollText, title: 'clinicProfileAudit', value: 'clinicProfileAuditValue' }
];

export default function ClinicProfilePanel({ lang, t }) {
  return <section className="clinic-profile" dir={lang === 'ar' ? 'rtl' : 'ltr'} aria-labelledby="clinic-profile-title">
    <header className="clinic-profile__heading"><p>{t('clinicProfileEyebrow')}</p><h2 id="clinic-profile-title">{t('clinicProfileTitle')}</h2><span>{t('clinicProfileSubtitle')}</span></header>
    <article className="clinic-identity glass-panel" aria-labelledby="clinic-identity-title">
      <div className="clinic-identity__icon" aria-hidden="true"><Building2/></div>
      <div><p className="clinic-profile__label">{t('clinicIdentityTitle')}</p><h3 id="clinic-identity-title">{t('clinicIdentityNameAr')}</h3><strong dir="ltr">{t('clinicIdentityNameEn')}</strong><span>{t('clinicIdentityDescription')}</span></div>
      <span className="clinic-identity__badge">{t('clinicIdentityDisplayBadge')}</span>
    </article>
    <div className="clinic-capabilities" aria-label={t('clinicCapabilitiesTitle')}>
      {CAPABILITIES.map(({ icon: Icon, title, value }) => <article className="clinic-capability glass-panel" key={title}><div className="clinic-capability__icon" aria-hidden="true"><Icon/></div><div><h3>{t(title)}</h3><p>{t(value)}</p></div></article>)}
    </div>
    <aside className="clinic-financial-notice" role="note"><ShieldCheck aria-hidden="true"/><div><strong>{t('clinicFinancialNoticeTitle')}</strong><p>{t('clinicFinancialNotice')}</p></div></aside>
  </section>;
}
