import { useFacilityBranding } from '../app/branding/FacilityBrandingContext.js';
import { brandingSubline } from '../app/branding/brandingConfig';

export default function FacilityIdentityLine({ language = 'en', branding: suppliedBranding }) {
  const contextBranding = useFacilityBranding();
  const branding = suppliedBranding || contextBranding;
  const isArabic = language === 'ar';
  return <div className="facility-identity-line" lang={isArabic ? 'ar' : 'en'} dir={isArabic ? 'rtl' : 'ltr'}>
    <strong>{isArabic ? branding.displayNameAr : branding.displayNameEn}</strong>
    <small>{brandingSubline(branding, isArabic ? 'ar' : 'en')}</small>
  </div>;
}
