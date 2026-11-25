export const PATIENT_BOOKING_PATH = '/patient/doctors';

export function patientDestination(state) {
  return state?.afterSignIn === PATIENT_BOOKING_PATH ? PATIENT_BOOKING_PATH : '/patient';
}
