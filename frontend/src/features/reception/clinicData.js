export function getWhatsAppLink(phone, message) {
  if (!phone) return '#';
  let cleaned = phone.replace(/[^0-9]/g, '');
  if (cleaned.startsWith('0')) {
    cleaned = '249' + cleaned.substring(1);
  } else if (!cleaned.startsWith('249') && cleaned.length === 9) {
    cleaned = '249' + cleaned;
  }
  return `https://wa.me/${cleaned}?text=${encodeURIComponent(message || '')}`;
}

// 18 Sudanese States List
export const SUDANESE_STATES = [
  { id: 1, labelAr: 'الخرطوم', labelEn: 'Khartoum' },
  { id: 2, labelAr: 'الجزيرة', labelEn: 'Gezira' },
  { id: 3, labelAr: 'البحر الأحمر', labelEn: 'Red Sea' },
  { id: 4, labelAr: 'كسلا', labelEn: 'Kassala' },
  { id: 5, labelAr: 'القضارف', labelEn: 'Al Qadarif' },
  { id: 6, labelAr: 'سنار', labelEn: 'Sennar' },
  { id: 7, labelAr: 'النيل الأزرق', labelEn: 'Blue Nile' },
  { id: 8, labelAr: 'النيل الأبيض', labelEn: 'White Nile' },
  { id: 9, labelAr: 'نهر النيل', labelEn: 'River Nile' },
  { id: 10, labelAr: 'الشمالية', labelEn: 'Northern' },
  { id: 11, labelAr: 'غرب كردفان', labelEn: 'West Kordofan' },
  { id: 12, labelAr: 'شمال كردفان', labelEn: 'North Kordofan' },
  { id: 13, labelAr: 'جنوب كردفان', labelEn: 'South Kordofan' },
  { id: 14, labelAr: 'شمال دارفور', labelEn: 'North Darfur' },
  { id: 15, labelAr: 'غرب دارفور', labelEn: 'West Darfur' },
  { id: 16, labelAr: 'جنوب دارفور', labelEn: 'South Darfur' },
  { id: 17, labelAr: 'شرق دارفور', labelEn: 'East Darfur' },
  { id: 18, labelAr: 'وسط دارفور', labelEn: 'Central Darfur' }
];

