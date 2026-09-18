/**
 * Purpose-built response shapes for unauthenticated clinic directory and
 * booking APIs. Never return Prisma records directly from public routes.
 */
export const publicDoctorSelect = Object.freeze({
  id: true,
  fullNameAr: true,
  fullNameEn: true,
  specialtyAr: true,
  specialtyEn: true,
  specialty: { select: { id: true, nameAr: true, nameEn: true } },
  consultationFee: true
});

export function toPublicDoctor(doctor) {
  return {
    id: doctor.id,
    fullNameAr: doctor.fullNameAr,
    fullNameEn: doctor.fullNameEn,
    specialtyAr: doctor.specialtyAr,
    specialtyEn: doctor.specialtyEn,
    specialty: doctor.specialty || null,
    consultationFee: doctor.consultationFee
  };
}

export function toPublicBookingConfirmation(appointment) {
  return {
    // The appointment UUID is the existing opaque booking reference used by
    // legacy callers; no patient or staff relationship identifiers are sent.
    id: appointment.id,
    bookingReference: appointment.id.slice(0, 8).toUpperCase(),
    doctor: toPublicDoctor(appointment.doctor),
    appointmentDate: appointment.appointmentDate,
    appointmentTime: appointment.appointmentTime,
    status: appointment.status
  };
}

export const publicClinicalServiceSelect = Object.freeze({
  id: true,
  labelAr: true,
  labelEn: true,
  baseFeeSdg: true,
  baseFeeUsd: true,
  category: true
});

export function toPublicClinicalService(service) {
  return {
    id: service.id,
    labelAr: service.labelAr,
    labelEn: service.labelEn,
    baseFeeSdg: service.baseFeeSdg,
    baseFeeUsd: service.baseFeeUsd,
    category: service.category
  };
}

export const staffInsuranceCompanySelect = Object.freeze({
  id: true,
  labelAr: true,
  labelEn: true,
  copayPercentage: true
});
