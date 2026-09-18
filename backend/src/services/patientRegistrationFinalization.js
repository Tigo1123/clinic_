import { ApiError } from '../utils/apiError.js';
import { normalizePatientPhone } from '../utils/patientIdentity.js';
import { lockPatientIdentity, patientIdentitySummary } from '../utils/patientOnboarding.js';

async function audit(tx, userId, action, details, ipAddress = 'unknown') {
  await tx.tenantAuditLog.create({ data: { userId, action, details, ipAddress } });
}

async function resolveAddressStateId(tx, addressStateId) {
  const state = await tx.state.findUnique({ where: { id: addressStateId }, select: { id: true } });
  if (!state) throw new ApiError(422, 'INVALID_ADDRESS_STATE', 'The selected address state is unavailable.');
  return state.id;
}

async function matchingPatients(tx, phoneNormalized, dateOfBirth) {
  const candidates = await tx.patient.findMany({ where: { dateOfBirth }, select: { id: true, phone: true, userId: true } });
  return candidates.filter((patient) => normalizePatientPhone(patient.phone) === phoneNormalized);
}

/**
 * Finalizes the shared patient identity pipeline. Google onboarding passes no
 * verification type: its email is already trusted, while phone remains
 * unverified and therefore cannot claim an existing medical record.
 */
export async function finalizePatientRegistration(tx, { user, registration, verificationType = null, ipAddress = 'unknown' }) {
  const addressStateId = await resolveAddressStateId(tx, registration.addressStateId);
  const verificationAt = new Date();
  const verificationData = verificationType?.endsWith('PHONE')
    ? { phoneVerifiedAt: verificationAt }
    : verificationType?.endsWith('EMAIL')
      ? { emailVerifiedAt: verificationAt }
      : {};
  const current = await tx.user.update({ where: { id: user.id }, data: { status: 'ACTIVE', ...verificationData } });

  const review = async (result) => {
    const pending = await tx.user.update({ where: { id: current.id }, data: { status: 'PENDING_VERIFICATION' } });
    return { ...result, user: pending };
  };

  await lockPatientIdentity(tx, { phone: current.phoneNormalized, dateOfBirth: registration.dateOfBirth });
  const matches = await matchingPatients(tx, current.phoneNormalized, registration.dateOfBirth);
  if (matches.some((patient) => patient.userId)) {
    await audit(tx, current.id, 'PATIENT_CLAIM_REJECTED', 'Matching patient record is already claimed.', ipAddress);
    return review({ state: 'MANUAL_REVIEW_REQUIRED', patient: null });
  }

  if (matches.length === 0) {
    const patient = await tx.patient.create({ data: {
      userId: current.id, fullNameAr: registration.fullNameAr, fullNameEn: registration.fullNameEn,
      firstNameAr: registration.firstNameAr, fatherNameAr: registration.fatherNameAr,
      grandfatherNameAr: registration.grandfatherNameAr, familyNameAr: registration.familyNameAr,
      firstNameEn: registration.firstNameEn, fatherNameEn: registration.fatherNameEn,
      grandfatherNameEn: registration.grandfatherNameEn, familyNameEn: registration.familyNameEn,
      gender: registration.gender, dateOfBirth: registration.dateOfBirth, phone: current.phoneNormalized,
      addressStateId, emergencyContact: 'Self'
    } });
    await audit(tx, current.id, 'PATIENT_FILE_CREATED', JSON.stringify({ patientId: patient.id, fileNumber: patient.fileNumber, context: 'ONLINE_VERIFICATION' }), ipAddress);
    await audit(tx, current.id, 'PATIENT_RECORD_CREATED', `Created patient record ${patient.id} for verified account.`, ipAddress);
    return { state: 'CLAIMED', patient: patientIdentitySummary(patient), user: current };
  }

  if (matches.length === 1) {
    const matchedPatient = matches[0];
    if (!current.phoneVerifiedAt) {
      await audit(tx, current.id, 'PATIENT_AUTO_LINK_REJECTED', 'Automatic linkage to an existing patient record requires a verified phone number.', ipAddress);
      return review({ state: 'MANUAL_REVIEW_REQUIRED', reason: 'VERIFIED_PHONE_REQUIRED', patient: null });
    }
    const linked = await tx.patient.updateMany({ where: { id: matchedPatient.id, userId: null }, data: { userId: current.id } });
    if (linked.count !== 1) {
      await audit(tx, current.id, 'PATIENT_AUTO_LINK_CONFLICT', 'Matching patient record could not be auto-linked because ownership changed.', ipAddress);
      return review({ state: 'MANUAL_REVIEW_REQUIRED', patient: null });
    }
    await audit(tx, current.id, 'PATIENT_RECORD_AUTO_LINKED', `Automatically linked verified account to existing patient record ${matchedPatient.id}.`, ipAddress);
    return { state: 'CLAIMED', patient: patientIdentitySummary(await tx.patient.findUnique({ where: { id: matchedPatient.id } })), user: current };
  }

  await audit(tx, current.id, 'PATIENT_CLAIM_AMBIGUOUS', 'Multiple patient records matched verified identity and date of birth.', ipAddress);
  return review({ state: 'AMBIGUOUS_MATCH', patient: null });
}
