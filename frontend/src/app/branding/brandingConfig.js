export const DEFAULT_BRANDING = Object.freeze({
  productNameAr: 'شفاء', productNameEn: 'Shifa',
  productDescriptorAr: 'نظام إدارة المنشآت الصحية',
  productDescriptorEn: 'Healthcare Facility Management System',
  facilityNameAr: null, facilityNameEn: null, displayNameAr: 'شفاء', displayNameEn: 'Shifa'
});

export function normalizeBrandingConfig(config = {}) {
  const merged = { ...DEFAULT_BRANDING, ...config };
  merged.displayNameAr = merged.facilityNameAr || merged.displayNameAr || merged.productNameAr;
  merged.displayNameEn = merged.facilityNameEn || merged.displayNameEn || merged.productNameEn;
  return merged;
}

export function brandingSubline(branding, language) {
  const isArabic = language === 'ar';
  const configuredFacility = isArabic ? branding.facilityNameAr : branding.facilityNameEn;
  const productName = isArabic ? branding.productNameAr : branding.productNameEn;
  const descriptor = isArabic ? branding.productDescriptorAr : branding.productDescriptorEn;
  return configuredFacility ? `${productName} · ${descriptor}` : descriptor;
}
