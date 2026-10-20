import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { getPublicConfig } from '../../utils/clinicTime.js';
import { normalizeBrandingConfig } from './brandingConfig.js';
import { FacilityBrandingContext } from './FacilityBrandingContext.js';

export function FacilityBrandingProvider({ children }) {
  const { i18n } = useTranslation();
  const language = (i18n.resolvedLanguage || i18n.language || 'ar').startsWith('ar') ? 'ar' : 'en';
  const branding = useMemo(() => normalizeBrandingConfig(getPublicConfig()), []);

  useEffect(() => {
    const facilityName = language === 'ar' ? branding.displayNameAr : branding.displayNameEn;
    const productName = language === 'ar' ? branding.productNameAr : branding.productNameEn;
    const descriptor = language === 'ar' ? branding.productDescriptorAr : branding.productDescriptorEn;
    document.title = `${facilityName === productName ? productName : `${facilityName} | ${productName}`} — ${descriptor}`;
  }, [branding, i18n, language]);

  return <FacilityBrandingContext.Provider value={branding}>{children}</FacilityBrandingContext.Provider>;
}
