export function shifaLogoAsset({ language, theme, compact = false }) {
  if (compact) return '/brand/shifa-mark-light.png';
  return `/brand/shifa-logo-${language === 'ar' ? 'ar' : 'en'}-${theme === 'dark' ? 'dark' : 'light'}.png`;
}

export function shifaLogoAlternative(language) {
  return language === 'ar' ? 'شفاء — نظام إدارة المنشآت الصحية' : 'Shifa Clinic Management System';
}
