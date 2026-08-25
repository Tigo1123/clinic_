const metadataFields = ['brandName', 'labelAr', 'labelEn', 'genericName', 'strength', 'dosageForm'];
const pharmacyReviewRequiredCodes = new Set([
  'PHARMACY_REFUNDED_INVOICE_REVIEW_REQUIRED',
  'PHARMACY_INVOICE_INVARIANT_VIOLATION'
]);

export function pharmacyBillingRequiresReview(code) {
  return pharmacyReviewRequiredCodes.has(code);
}

export function pharmacyBillingPendingCopy(code, lang) {
  if (pharmacyBillingRequiresReview(code)) {
    return lang === 'ar'
      ? 'تحتاج فاتورة الصيدلية إلى مراجعة قبل المتابعة.'
      : 'The pharmacy invoice requires review before continuing.';
  }
  return lang === 'ar'
    ? 'فاتورة الدواء قيد التجهيز تلقائيًا. قد يحتاج أحد الأدوية إلى مراجعة أو تسعير قبل إنشاء الفاتورة.'
    : 'The medicine invoice is being prepared automatically. A medication may require review or pricing before the invoice can be created.';
}

export function buildMedicationReviewPayload(item, decision, form = {}) {
  if (!['LINK_EXISTING', 'CREATE_FORMULARY', 'EXTERNAL'].includes(decision)) {
    throw new Error('Unsupported medication review decision.');
  }
  const payload = { decision, note: typeof form.note === 'string' ? form.note.trim() : '' };
  if (decision === 'LINK_EXISTING') payload.drugId = form.drugId;
  if (decision === 'CREATE_FORMULARY') {
    payload.formulary = {
      labelEn: form.labelEn?.trim() || item.customDrugName,
      labelAr: form.labelAr?.trim() || form.labelEn?.trim() || item.customDrugName,
      genericName: form.genericName.trim(),
      strength: form.strength.trim(),
      dosageForm: form.dosageForm.trim()
    };
    payload.inventory = {
      batchNumber: form.batchNumber.trim(),
      expiryDate: form.expiryDate,
      qtyOnHand: Number(form.qtyOnHand),
      minReorderLevel: Number(form.minReorderLevel)
    };
  }
  return payload;
}

export function customMedicineRequiresReview(item) {
  return Boolean(
    item?.customDrugName
    && !item?.drug
    && !item?.drugId
    && !['APPROVED', 'EXTERNAL'].includes(item?.pharmacyReviewStatus)
  );
}

export function buildMedicinePayload(form) {
  const payload = Object.fromEntries(metadataFields.map((field) => [field, String(form[field] || '').trim()]));
  if (form.includeInitialBatch) {
    payload.initialBatch = {
      batchNumber: String(form.batchNumber || '').trim(),
      expiryDate: form.expiryDate,
      qtyOnHand: Number(form.receivedQuantity),
      minReorderLevel: Number(form.minReorderLevel)
    };
  }
  return payload;
}

export function buildMetadataPayload(form) {
  return Object.fromEntries(metadataFields.map((field) => [field, String(form[field] || '').trim()]));
}

export function buildBatchPayload(form) {
  return {
    batchNumber: String(form.batchNumber || '').trim(),
    expiryDate: form.expiryDate,
    receivedQuantity: Number(form.receivedQuantity),
    minReorderLevel: Number(form.minReorderLevel)
  };
}

export function buildPaymentPayload(amount, paymentMethod) {
  return { payments: [{ amountSdg: Number(amount), paymentMethod }] };
}

export function newPaymentAttempt(invoiceId, amount, paymentMethod, paidBefore = 0, createId = () => crypto.randomUUID()) {
  return {
    invoiceId,
    amount: Number(amount),
    paymentMethod,
    paidBefore: Number(paidBefore),
    idempotencyKey: createId()
  };
}

export function samePaymentAttempt(attempt, invoiceId, amount, paymentMethod) {
  return Boolean(attempt)
    && attempt.invoiceId === invoiceId
    && attempt.amount === Number(amount)
    && attempt.paymentMethod === paymentMethod;
}

export function paymentAttemptIsReflected(attempt, paymentState) {
  return Boolean(attempt && paymentState?.invoice?.id === attempt.invoiceId)
    && Number(paymentState.invoice.paidAmountSdg) >= attempt.paidBefore + attempt.amount;
}
export function updateMedicineField(current, field, value) {
  return { ...current, [field]: value };
}
