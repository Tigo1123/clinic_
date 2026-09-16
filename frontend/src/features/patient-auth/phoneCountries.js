import { getCountries, getCountryCallingCode, parsePhoneNumberFromString } from 'libphonenumber-js/min';

// ISO 3166-1 alpha-2 members of Africa, plus the Arab League. Dialling metadata
// comes from libphonenumber-js; the Set keeps the overlapping groups unique.
const AFRICAN_COUNTRIES = [
  'AO', 'BF', 'BI', 'BJ', 'BW', 'CD', 'CF', 'CG', 'CI', 'CM', 'CV', 'DJ', 'DZ', 'EG', 'EH', 'ER', 'ET',
  'GA', 'GH', 'GM', 'GN', 'GQ', 'GW', 'KE', 'KM', 'LR', 'LS', 'LY', 'MA', 'MG', 'ML', 'MR', 'MU', 'MW',
  'MZ', 'NA', 'NE', 'NG', 'RW', 'SC', 'SD', 'SL', 'SN', 'SO', 'SS', 'ST', 'SZ', 'TD', 'TG', 'TN', 'TZ',
  'UG', 'ZA', 'ZM', 'ZW'
];
const ARAB_COUNTRIES = [
  'AE', 'BH', 'DZ', 'EG', 'IQ', 'JO', 'KM', 'KW', 'LB', 'LY', 'MA', 'MR', 'OM', 'PS', 'QA', 'SA', 'SD',
  'SO', 'SY', 'TN', 'YE', 'DJ'
];

const availableCountries = new Set(getCountries());
export const DEFAULT_PHONE_COUNTRY = 'SD';
export const PATIENT_PHONE_COUNTRIES = [...new Set([...AFRICAN_COUNTRIES, ...ARAB_COUNTRIES])]
  .filter((country) => availableCountries.has(country))
  .sort((left, right) => countryName(left, 'en').localeCompare(countryName(right, 'en')));
const supportedCountries = new Set(PATIENT_PHONE_COUNTRIES);

export function countryName(country, language = 'en') {
  try {
    return new Intl.DisplayNames([language === 'ar' ? 'ar' : 'en'], { type: 'region' }).of(country) || country;
  } catch {
    return country;
  }
}

export function countryFlag(country) {
  return String.fromCodePoint(...country.split('').map((letter) => 127397 + letter.charCodeAt(0)));
}

export function callingCode(country) {
  return `+${getCountryCallingCode(country)}`;
}

export function normalisePatientPhone(value, country = DEFAULT_PHONE_COUNTRY) {
  const input = String(value || '').trim();
  const parsed = input.startsWith('+')
    ? parsePhoneNumberFromString(input)
    : parsePhoneNumberFromString(input, country);
  return parsed?.isValid() && supportedCountries.has(parsed.country) ? parsed.number : null;
}

export function splitInternationalPhone(value, selectedCountry = DEFAULT_PHONE_COUNTRY) {
  const input = String(value || '').trim();
  if (!input.startsWith('+')) return { country: selectedCountry, phone: value };
  const parsed = parsePhoneNumberFromString(input);
  if (!parsed?.country || !supportedCountries.has(parsed.country) || !parsed.nationalNumber) return { country: selectedCountry, phone: value };
  return { country: parsed.country, phone: parsed.nationalNumber };
}
