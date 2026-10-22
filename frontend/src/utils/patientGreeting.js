// Keep full names on the profile, never in the dashboard greeting.
const firstToken = value => typeof value === 'string'
  ? value.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, ' ').trim().split(/\s+/u)[0]
  : '';

export function patientFirstName(profile, language) {
  const ar = language?.startsWith('ar');
  const candidates = ar
    ? [profile?.firstNameAr, profile?.firstNameEn, profile?.fullNameAr, profile?.fullNameEn]
    : [profile?.firstNameEn, profile?.firstNameAr, profile?.fullNameEn, profile?.fullNameAr];
  return candidates.map(firstToken).find(Boolean) || '';
}

export function patientGreeting(profile, language, hour = new Date().getHours()) {
  const ar = language?.startsWith('ar');
  const morning = hour >= 5 && hour < 12;
  const greeting = ar ? (morning ? 'صباح الخير' : 'مساء الخير') : (morning ? 'Good morning' : 'Good evening');
  const name = patientFirstName(profile, language);
  return greeting + (name ? `${ar ? '، ' : ', '}${name}` : '');
}
