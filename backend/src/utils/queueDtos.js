// These projections are intentionally small; clinical detail remains available
// through separately authorized patient-file endpoints.
export const queuePatientSelect = Object.freeze({
  id: true,
  fileNumber: true,
  fullNameAr: true,
  fullNameEn: true,
  phone: true
});

export const queuePatientNameSelect = Object.freeze({
  fullNameAr: true,
  fullNameEn: true
});

export const queueDoctorSelect = Object.freeze({
  id: true,
  fullNameAr: true,
  fullNameEn: true
});
