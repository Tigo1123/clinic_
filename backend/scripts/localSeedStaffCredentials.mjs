// Credentials used only by the repository's disposable local seed. Keep this
// module out of production runtime code and never include its values in output.
export const LOCAL_SEED_STAFF = Object.freeze({
  doctor: Object.freeze({ username: 'doctor@cms.com', password: 'Doctor@123', role: 'DOCTOR' }),
  lab: Object.freeze({ username: 'lab@cms.com', password: 'Labtech@123', role: 'LAB_TECH' }),
  pharmacist: Object.freeze({ username: 'pharma@cms.com', password: 'Pharmacist@123', role: 'PHARMACIST' }),
  receptionist: Object.freeze({ username: 'recep@cms.com', password: 'Receptionist@123', role: 'RECEPTIONIST' })
});
