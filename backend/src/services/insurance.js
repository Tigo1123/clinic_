import { getClinicDateString } from '../utils/clinicTime.js';

export async function eligibleInsuranceCompany(db, patientId, insuranceCompanyId, categories) {
  const company = await db.insuranceCompany.findUnique({ where: { id: insuranceCompanyId } });
  const fail = (code, message, status = 409) => { throw Object.assign(new Error(message), { code, status }); };
  if (!company) fail('INSURANCE_COMPANY_INVALID', 'The selected insurance company is not available.', 422);
  const membership = await db.patientInsurance.findUnique({ where: { patientId_insuranceCompanyId: { patientId, insuranceCompanyId } } });
  const today = getClinicDateString();
  if (!company.active || !membership?.active || membership.validFrom > today || membership.validUntil < today) {
    fail('INSURANCE_NOT_ELIGIBLE', 'Active insurance membership valid today is required. Verify membership or explicitly choose self-pay.');
  }
  if (!categories.length || categories.some(category => !company.coveredCategories.includes(category))) {
    fail('INSURANCE_SERVICE_NOT_COVERED', 'The selected insurance does not cover every service. Choose self-pay or separate covered services.');
  }
  return company;
}
