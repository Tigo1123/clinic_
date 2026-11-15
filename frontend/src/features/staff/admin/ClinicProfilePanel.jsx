import { Banknote, Building2, Languages, Monitor, ReceiptText, ShieldCheck, ScrollText } from 'lucide-react';
import './clinicProfile.css';
import { useFacilityBranding } from '../../../app/branding/FacilityBrandingContext.js';

const CAPABILITIES = [
  { icon: Languages, title: 'clinicProfileLanguages', value: 'clinicProfileLanguagesValue' },
  { icon: Banknote, title: 'clinicProfileCurrency', value: 'clinicProfileCurrencyValue' },
  { icon: ShieldCheck, title: 'clinicProfileSecurity', value: 'clinicProfileSecurityValue' },
  { icon: ReceiptText, title: 'clinicProfileBilling', value: 'clinicProfileBillingValue' },
  { icon: Monitor, title: 'clinicProfileAccess', value: 'clinicProfileAccessValue' },
  { icon: ScrollText, title: 'clinicProfileAudit', value: 'clinicProfileAuditValue' }
];

export default function ClinicProfilePanel({ lang, t }) {
  const branding = useFacilityBranding();
  return <section className="clinic-profile" dir={lang === 'ar' ? 'rtl' : 'ltr'} aria-labelledby="clinic-profile-title">
    <header className="clinic-profile__heading ui-page-header"><div><p className="ui-section-label">{t('clinicProfileEyebrow')}</p><h2 id="clinic-profile-title" className="ui-page-title">{t('clinicProfileTitle')}</h2><span>{t('clinicProfileSubtitle')}</span></div></header>
    <article className="clinic-identity ui-panel" aria-labelledby="clinic-identity-title">
      <div className="clinic-identity__icon" aria-hidden="true"><Building2/></div>
      <div><p className="clinic-profile__label ui-section-label">{t('clinicIdentityTitle')}</p><h3 id="clinic-identity-title" lang="ar" dir="rtl">{branding.displayNameAr}</h3><strong lang="en" dir="ltr">{branding.displayNameEn}</strong><span lang="ar" dir="rtl">{branding.productNameAr} · {branding.productDescriptorAr}</span><span lang="en" dir="ltr">{branding.productNameEn} · {branding.productDescriptorEn}</span></div>
      <span className="clinic-identity__badge">{t('clinicIdentityDisplayBadge')}</span>
    </article>
    <div className="clinic-capabilities" aria-label={t('clinicCapabilitiesTitle')}>
      {CAPABILITIES.map(({ icon: Icon, title, value }) => <article className="clinic-capability ui-panel" key={title}><div className="clinic-capability__icon" aria-hidden="true"><Icon/></div><div><h3>{t(title)}</h3><p>{t(value)}</p></div></article>)}
    </div>
    <aside className="clinic-financial-notice ui-panel" role="note"><ShieldCheck aria-hidden="true"/><div><strong>{t('clinicFinancialNoticeTitle')}</strong><p>{t('clinicFinancialNotice')}</p></div></aside>
  </section>;
}
