export function getWhatsAppLink(phone, message) {
  if (!phone) return '#';
  let cleaned = phone.replace(/[^0-9]/g, '');
  if (cleaned.startsWith('0')) cleaned = '249' + cleaned.substring(1);
  else if (!cleaned.startsWith('249') && cleaned.length === 9) cleaned = '249' + cleaned;
  return `https://wa.me/${cleaned}?text=${encodeURIComponent(message || '')}`;
}
