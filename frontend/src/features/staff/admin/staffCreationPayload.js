const DOCTOR_ROLE = 'DOCTOR';

export function buildStaffCreationPayload({
  username,
  password,
  role,
  preferredLanguage,
  fullNameAr,
  fullNameEn,
  specialtyId,
  consultationFee
}) {
  const payload = { username, password, role };
  if (preferredLanguage) payload.preferredLanguage = preferredLanguage;

  if (role === DOCTOR_ROLE) {
    Object.assign(payload, {
      fullNameAr,
      fullNameEn,
      specialtyId,
      consultationFee
    });
  }

  return payload;
}
