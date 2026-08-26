export function searchDoctorMedicines(medicines, query) {
  const normalized = String(query || '').trim().toLocaleLowerCase();
  if (!normalized) return medicines;
  const fields = ['brandName', 'labelAr', 'labelEn', 'genericName', 'strength'];
  return medicines.filter((medicine) => fields.some((field) => String(medicine?.[field] || '').toLocaleLowerCase().includes(normalized)));
}

export function doctorPrescriptionItem(drug, form) {
  const common = {
    dosage: form.dosage.trim(),
    duration: form.duration.trim(),
    instructionsAr: form.instructionsAr.trim(),
    instructionsEn: form.instructionsEn.trim(),
    qtyPrescribed: Number(form.quantity)
  };
  if (!drug) {
    const customDrugName = form.customDrugName.trim();
    return { customDrugName, nameAr: customDrugName, nameEn: customDrugName, ...common };
  }
  return {
    drugId: drug.id,
    nameAr: drug.labelAr,
    nameEn: drug.labelEn,
    ...common
  };
}

export function duplicatePrescriptionItem(items, candidate, excludedIndex = -1) {
  return items.some((item, index) => index !== excludedIndex && (
    candidate.drugId ? item.drugId === candidate.drugId : !item.drugId && item.customDrugName?.trim().toLocaleLowerCase() === candidate.customDrugName?.trim().toLocaleLowerCase()
  ));
}
