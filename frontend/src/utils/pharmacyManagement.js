const metadataFields = ['brandName', 'labelAr', 'labelEn', 'genericName', 'strength', 'dosageForm'];

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
