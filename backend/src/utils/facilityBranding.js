export const SHIFA_PRODUCT_IDENTITY = Object.freeze({
  nameAr: 'شفاء',
  nameEn: 'Shifa',
  descriptorAr: 'نظام إدارة المنشآت الصحية',
  descriptorEn: 'Healthcare Facility Management System'
});

function configuredName(value, key) {
  if (value === undefined || value === null || value === '') return null;
  const name = String(value).normalize('NFC').trim();
  if (!name || [...name].length > 120 || /[\u0000-\u001f\u007f]/u.test(name)) {
    throw new Error(`${key} must contain 1–120 characters without control characters.`);
  }
  return name;
}

export function getFacilityBranding(env = process.env) {
  const facilityNameAr = configuredName(env.FACILITY_NAME_AR, 'FACILITY_NAME_AR');
  const facilityNameEn = configuredName(env.FACILITY_NAME_EN, 'FACILITY_NAME_EN');
  return {
    productNameAr: SHIFA_PRODUCT_IDENTITY.nameAr,
    productNameEn: SHIFA_PRODUCT_IDENTITY.nameEn,
    productDescriptorAr: SHIFA_PRODUCT_IDENTITY.descriptorAr,
    productDescriptorEn: SHIFA_PRODUCT_IDENTITY.descriptorEn,
    facilityNameAr,
    facilityNameEn,
    displayNameAr: facilityNameAr || SHIFA_PRODUCT_IDENTITY.nameAr,
    displayNameEn: facilityNameEn || SHIFA_PRODUCT_IDENTITY.nameEn
  };
}

export function escapeHtmlText(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}
