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

export function authoritativeStockSummary(medicine = {}) {
  const stock = medicine.stock || {};
  return {
    totalOnHand: Number(stock.totalOnHand ?? medicine.totalOnHand ?? 0),
    usableStock: Number(stock.usableStock ?? medicine.usableStock ?? 0),
    nearestUnexpiredExpiry: stock.nearestUnexpiredExpiry ?? medicine.nearestUnexpiredExpiry ?? null,
    expiredBatchCount: Number(stock.expiredBatchCount ?? medicine.expiredBatchCount ?? 0),
    lowStockBatchCount: Number(stock.lowStockBatchCount ?? medicine.lowStockBatchCount ?? 0),
    batchCount: Number(stock.batchCount ?? medicine.batchCount ?? 0),
    nearExpiry: Boolean(stock.nearExpiry ?? medicine.nearExpiry)
  };
}

export function stockPresentation(source = {}) {
  const stock = source.stock || source;
  const usableStock = Number(stock.usableStock ?? 0);
  const totalOnHand = Number(stock.totalOnHand ?? 0);
  if (usableStock <= 0) {
    return Number(stock.expiredBatchCount ?? 0) > 0 && totalOnHand > 0 ? 'EXPIRED' : 'OUT_OF_STOCK';
  }
  if (Number(stock.lowStockBatchCount ?? 0) > 0 || stock.lowStock === true) return 'LOW_STOCK';
  if (stock.nearExpiry === true) return 'NEAR_EXPIRY';
  return 'HEALTHY';
}

export function localizedStockState(state, lang = 'en') {
  const labels = {
    OUT_OF_STOCK: ['نفد المخزون', 'Out of stock'],
    LOW_STOCK: ['مخزون منخفض', 'Low stock'],
    EXPIRED: ['منتهي الصلاحية', 'Expired'],
    NEAR_EXPIRY: ['قريب الانتهاء', 'Near expiry'],
    HEALTHY: ['المخزون جيد', 'Healthy stock']
  };
  return (labels[state] || [state, state])[lang === 'ar' ? 0 : 1];
}

export function batchPresentation(batch = {}) {
  if (Number(batch.qtyOnHand) <= 0) return 'OUT_OF_STOCK';
  if (batch.state?.expired || batch.state?.expiresToday) return 'EXPIRED';
  if (batch.state?.nearExpiry) return 'NEAR_EXPIRY';
  if (batch.state?.lowStock) return 'LOW_STOCK';
  return 'HEALTHY';
}

export function localizedMovementType(type, lang = 'en') {
  const labels = {
    OPENING_BALANCE: ['رصيد افتتاحي', 'Opening balance'],
    RECEIPT: ['استلام مخزون', 'Stock receipt'],
    DISPENSE: ['صرف دواء', 'Dispense']
  };
  return (labels[type] || [type, type])[lang === 'ar' ? 0 : 1];
}

export function pharmacyManagementError(payload, status, lang = 'en', fallback = '') {
  const code = payload?.error?.code;
  const known = {
    FORMULARY_MEDICINE_ALREADY_EXISTS: ['يوجد دواء مطابق بالفعل في القائمة.', 'A matching medicine already exists.'],
    INVENTORY_BATCH_ALREADY_EXISTS: ['هذه الدفعة مسجلة بالفعل لنفس الدواء وتاريخ الصلاحية.', 'This lot already exists for this medicine and expiry date.'],
    INVENTORY_EXPIRY_INVALID: ['تاريخ انتهاء الدفعة غير صالح. يجب اختيار تاريخ انتهاء مستقبلي صالح.', 'The batch expiry date is invalid. Choose a valid future expiry date.'],
    FORMULARY_IDENTITY_IMMUTABLE: ['لا يمكن تعديل هوية الدواء بعد استخدامه سريريًا أو تسجيل مخزون له. يمكن فقط تصحيح أسماء العرض المسموحة.', 'Medicine identity cannot be changed after clinical or inventory use. Only permitted display-label corrections remain available.']
  };
  if (known[code]) return known[code][lang === 'ar' ? 0 : 1];
  const byStatus = {
    400: ['بيانات الطلب غير صالحة. راجع الحقول وحاول مرة أخرى.', 'The submitted data is invalid. Review the fields and try again.'],
    403: ['ليس لديك صلاحية لتنفيذ هذا الإجراء.', 'You are not authorized to perform this action.'],
    404: ['تعذر العثور على الدواء أو السجل المطلوب.', 'The requested medicine or record was not found.'],
    409: ['تعذر إتمام العملية بسبب تعارض في البيانات.', 'The operation could not be completed because of a data conflict.'],
    422: ['بيانات المخزون غير صالحة. راجع الحقول وحاول مرة أخرى.', 'The inventory data is invalid. Review the fields and try again.'],
    500: ['تعذر إتمام العملية الآن. حاول مرة أخرى.', 'The operation could not be completed. Please try again.']
  };
  if (byStatus[status]) return byStatus[status][lang === 'ar' ? 0 : 1];
  if (!status) return lang === 'ar' ? 'تعذر الاتصال بالخادم. تحقق من الاتصال وحاول مرة أخرى.' : 'Unable to reach the server. Check your connection and try again.';
  return fallback || (lang === 'ar' ? 'تعذر الاتصال بالخادم. حاول مرة أخرى.' : 'Unable to reach the server. Please try again.');
}

export function pharmacyInventoryAlert(medicine = {}) {
  const stock = authoritativeStockSummary(medicine);
  const state = stockPresentation(stock);
  return {
    medicine,
    usableStock: stock.usableStock,
    lowStockBatchCount: stock.lowStockBatchCount,
    expiredBatchCount: stock.expiredBatchCount,
    state,
    hasExpiredBatches: stock.expiredBatchCount > 0
  };
}

export function validateBatchForm(form, lang = 'en') {
  const errors = {};
  const ar = lang === 'ar';
  if (!String(form.batchNumber || '').trim()) errors.batchNumber = ar ? 'رقم الدفعة مطلوب.' : 'Batch number is required.';
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(form.expiryDate || '');
  const parsedDate = dateMatch ? new Date(Date.UTC(Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3]))) : null;
  const isRealDate = parsedDate && parsedDate.getUTCFullYear() === Number(dateMatch[1]) && parsedDate.getUTCMonth() === Number(dateMatch[2]) - 1 && parsedDate.getUTCDate() === Number(dateMatch[3]);
  const clinicToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Kigali', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  if (!isRealDate) errors.expiryDate = ar ? 'أدخل تاريخ صلاحية صحيحًا.' : 'Enter a valid expiry date.';
  else if (form.expiryDate <= clinicToday) errors.expiryDate = ar ? 'يجب أن يكون تاريخ الصلاحية بعد اليوم.' : 'Expiry date must be after today.';
  const quantity = Number(form.receivedQuantity);
  if (!Number.isSafeInteger(quantity) || quantity <= 0) errors.receivedQuantity = ar ? 'الكمية يجب أن تكون عددًا صحيحًا موجبًا.' : 'Quantity must be a positive whole number.';
  const reorder = Number(form.minReorderLevel);
  if (!Number.isSafeInteger(reorder) || reorder < 0) errors.minReorderLevel = ar ? 'حد إعادة الطلب يجب أن يكون صفرًا أو أكثر.' : 'Reorder level must be zero or greater.';
  return errors;
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
