import { money } from './money.js';

export const insuranceProfileClaimSelect = {
  claimStatus: true,
  claimAmountSdg: true,
  invoiceId: true,
  insuranceCompany: { select: { labelAr: true, labelEn: true } },
  invoice: { select: { id: true, patientId: true, totalAmountSdg: true } }
};

export function insuranceProfileSnapshot(claim, patientId) {
  if (!claim) return null;

  let coverageRate = null;
  const invoice = claim.invoice;
  if (invoice && invoice.id === claim.invoiceId && invoice.patientId === patientId &&
      invoice.totalAmountSdg != null && claim.claimAmountSdg != null) {
    const gross = money(invoice.totalAmountSdg);
    const covered = money(claim.claimAmountSdg);
    if (gross.isFinite() && covered.isFinite() && gross.gt(0) && covered.gte(0) && covered.lte(gross)) {
      coverageRate = covered.times(100).div(gross).toDecimalPlaces(2).toNumber();
    }
  }

  return {
    providerName: claim.insuranceCompany?.labelAr || claim.insuranceCompany?.labelEn || 'Insurance',
    claimStatus: claim.claimStatus,
    coverageRate
  };
}
