import i18n from '../../i18n.js';
import { apiFetch } from '../apiClient.js';

export const STAFF_ERROR_MESSAGES = {
  ADMIN_SELF_DEACTIVATION_UNSUPPORTED: {
    ar: 'لا يمكنك إلغاء تفعيل حسابك الخاص.',
    en: 'You cannot deactivate your own account.'
  },
  ADMIN_ACTOR_NOT_ACTIVE: {
    ar: 'حساب المسؤول الخاص بك لم يعد نشطاً.',
    en: 'Your administrator account is no longer active.'
  },
  ADMIN_SELF_RESET_UNSUPPORTED: {
    ar: 'لا يمكن إعادة تعيين كلمة المرور لحسابك الخاص من هنا. استخدم إجراءات الاسترداد المخصصة للمسؤول.',
    en: 'Use the dedicated administrator recovery process to reset your own password.'
  },
  CONSULTATION_PAYMENT_REQUIRED: {
    ar: 'يجب سداد رسوم الكشف في الاستقبال أولاً قبل بدء المعاينة.',
    en: 'Consultation fee must be paid at reception first.'
  },
  INVOICE_ALREADY_PAID: {
    ar: 'تم دفع الفاتورة بالكامل مسبقاً.',
    en: 'The invoice is already fully paid.'
  },
  PAYMENT_EXCEEDS_BALANCE: {
    ar: 'مبلغ الدفع يتجاوز الرصيد المتبقي على الفاتورة.',
    en: 'Payment exceeds the remaining invoice balance.'
  },
  PAYMENT_LEDGER_CONFLICT: {
    ar: 'تغيرت بيانات الفاتورة أو سجل المدفوعات. حدّث الصفحة وأعد المحاولة.',
    en: 'The invoice changed, refresh and try again.'
  },
  DUPLICATE_PAYMENT_REFERENCE: {
    ar: 'رقم مرجع الدفع مستخدم مسبقاً.',
    en: 'Payment reference has already been used.'
  },
  REFUNDED_INVOICE_LOCKED: {
    ar: 'لا يمكن إضافة دفعات بعد تسجيل استرداد على الفاتورة.',
    en: 'Payments cannot be added after a refund has been recorded.'
  },
  CATALOG_CHANGED: {
    ar: 'تغيرت أسعار الخدمات في القائمة. يرجى تحديث الصفحة قبل إنشاء الفاتورة.',
    en: 'Catalog prices changed, refresh before creating the invoice.'
  },
  APPOINTMENT_SLOT_UNAVAILABLE: {
    ar: 'تم حجز هذا الموعد للتو. يرجى اختيار موعد آخر.',
    en: 'This appointment slot is no longer available. Please select another slot.'
  },
  INVALID_APPOINTMENT_SLOT: {
    ar: 'وقت الموعد المحدد غير متاح في جدول الطبيب.',
    en: 'The selected appointment slot is not available in the doctor schedule.'
  },
  ILLEGAL_APPOINTMENT_STATUS_TRANSITION: {
    ar: 'لا يمكن الانتقال إلى حالة الموعد المطلوبة.',
    en: 'This appointment status transition is not allowed.'
  },
  WALK_IN_ALREADY_EXISTS: {
    ar: 'يوجد موعد نشط للمريض بالفعل اليوم.',
    en: 'This patient already has an active appointment today.'
  },
  PHARMACY_UNAVAILABLE_PAID_REVIEW_REQUIRED: {
    ar: 'الدواء المدفوع يحتاج إلى مراجعة مالية قبل تحديد تعذر توفره.',
    en: 'Paid medication cannot be marked unavailable without financial review.'
  },
  PRESCRIPTION_NOT_ACTIVE: {
    ar: 'الوصفة الطبية لم تعد نشطة.',
    en: 'This prescription is no longer active.'
  },
  CLINICAL_DATA_UNREADABLE: {
    ar: 'تعذر قراءة البيانات السريرية.',
    en: 'Clinical information is unavailable.'
  },
  VALIDATION_ERROR: {
    ar: 'البيانات المدخلة غير صحيحة.',
    en: 'Request validation failed.'
  },
  FILE_TOO_LARGE: {
    ar: 'حجم الملف يتجاوز الحد الأقصى المسموح به.',
    en: 'The uploaded file exceeds the configured size limit.'
  },
  UPLOAD_INVALID: {
    ar: 'طلب رفع الملف غير صالح.',
    en: 'The upload request is invalid.'
  },
  POSSIBLE_PATIENT_DUPLICATE: {
    ar: 'يوجد مريض مسجل ببيانات مطابقة بالفعل.',
    en: 'A patient with matching details already exists.'
  },
  USERNAME_ALREADY_REGISTERED: {
    ar: 'اسم المستخدم مسجل بالفعل.',
    en: 'Username is already registered.'
  },
  SPECIALTY_NAME_EXISTS: {
    ar: 'يوجد تخصص بهذا الاسم بالفعل.',
    en: 'A specialty with this name already exists.'
  },
  SPECIALTY_CODE_EXISTS: {
    ar: 'رمز التخصص مستخدم بالفعل.',
    en: 'A specialty with this code already exists.'
  },
  SPECIALTY_REFERENCED: {
    ar: 'لا يمكن حذف التخصص لوجود أطباء مرتبطين به.',
    en: 'Cannot delete specialty referenced by doctors.'
  },
  CATALOG_DUPLICATE: {
    ar: 'هذا البند موجود بالفعل في القائمة.',
    en: 'This item already exists in the catalog.'
  },
  ADMIN_REAUTHENTICATION_FAILED: {
    ar: 'فشل التحقق من هوية المسؤول. كلمة المرور أو رمز التحقق غير صحيح.',
    en: 'Administrator authentication failed. Password or MFA code is incorrect.'
  },
  SCHEDULE_PERIOD_OVERLAP: {
    ar: 'تتعارض فترات الدوام في نفس اليوم.',
    en: 'Schedule periods cannot overlap on the same day.'
  },
  SCHEDULE_VERSION_OVERLAP: {
    ar: 'يتعارض تاريخ سريان الجدول مع إصدار جدول آخر.',
    en: 'Schedule effective dates overlap with an existing schedule version.'
  },
  SCHEDULE_CURRENT_IMMUTABLE: {
    ar: 'لا يمكن تعديل الجدول الساري حالياً مباشرة. أنشئ إصداراً جديداً للجدول.',
    en: 'The current active schedule cannot be edited directly. Create a new schedule version.'
  },
  CONSULTATION_FEE_NOT_CONFIGURED: {
    ar: 'لم يتم تحديد رسوم الكشف الطبي لهذا الطبيب.',
    en: 'Doctor consultation fee is not configured.'
  },
  CONSULTATION_BILLING_INVALID_STATE: {
    ar: 'حالة الموعد لا تسمح بفوترة رسوم الكشف الطبي.',
    en: 'Consultation fee can only be billed for pending or confirmed appointments.'
  },
  INSURANCE_CONFIGURATION_INVALID: {
    ar: 'بيانات شركة التأمين غير صالحة أو غير نشطة.',
    en: 'Insurance configuration is invalid or inactive.'
  },
  LAB_PAYMENT_REQUIRED: {
    ar: 'يجب سداد رسوم الفحوصات المختبرية أولاً.',
    en: 'Payment is required before laboratory processing.'
  },
  LAB_REVIEW_PENDING: {
    ar: 'يتضمن طلب المختبر فحوصات مخصصة بانتظار المراجعة.',
    en: 'Lab order contains custom tests pending review.'
  },
  LAB_SAMPLE_COLLECTION_INVALID_STATE: {
    ar: 'حالة الطلب الحالية لا تسمح بجمع العينة.',
    en: 'Sample collection is not allowed in the current order state.'
  },
  LAB_SAMPLE_NOT_COLLECTED: {
    ar: 'يجب جمع العينة قبل تسجيل نتائج الفحص.',
    en: 'Sample must be collected before entering results.'
  },
  LAB_SERVICE_PRICE_NOT_CONFIGURED: {
    ar: 'لم يتم تحديد السعر الرسمي لهذه الخدمة المختبرية.',
    en: 'Official price is not configured for this laboratory service.'
  },
  LAB_SERVICE_ALREADY_EXISTS: {
    ar: 'توجد خدمة مختبرية مسجلة بنفس الرمز أو الاسم.',
    en: 'A laboratory service with this code or name already exists.'
  },
  LAB_ORDER_NOT_COMPLETE: {
    ar: 'يجب إدخال جميع نتائج الفحوصات قبل اعتماد الطلب.',
    en: 'All lab results must be entered before releasing the order.'
  },
  LAB_RESULT_FINALIZED: {
    ar: 'تم اعتماد نتائج المختبر مسبقاً ولا يمكن تعديلها.',
    en: 'Lab results have already been released and cannot be modified.'
  },
  LAB_RESULT_CONFLICT: {
    ar: 'تم تعديل نتيجة المختبر بواسطة مستخدم آخر. حدّث الصفحة وأعد المحاولة.',
    en: 'Lab result was modified by another user. Refresh and try again.'
  },
  LAB_RESULTS_NOT_READY: {
    ar: 'لا يمكن إكمال الزيارة الطبية قبل صدور نتائج الفحوصات المختبرية.',
    en: 'Cannot complete visit while ordered laboratory tests are pending.'
  },
  DIAGNOSIS_REQUIRED: {
    ar: 'التشخيص الطبي مطلوب لإكمال الزيارة.',
    en: 'Diagnosis is required to complete the visit.'
  },
  CONSULTATION_STATUS_INVALID: {
    ar: 'حالة الاستشارة الطبية لا تسمح بالتعديل.',
    en: 'Consultation is not in an editable state.'
  },
  VISIT_ALREADY_COMPLETED: {
    ar: 'تم إكمال هذه الاستشارة الطبية بالفعل.',
    en: 'This consultation has already been completed.'
  },
  FORMULARY_MEDICINE_INACTIVE: {
    ar: 'الدواء الموصوف غير نشط أو غير متوفر في قائمة الأدوية.',
    en: 'The prescribed medication is inactive or unavailable.'
  },
  CLINICAL_SERVICE_INACTIVE: {
    ar: 'الخدمة السريرية المطلوبة غير نشطة.',
    en: 'The requested clinical service is inactive.'
  },
  PATIENT_VERIFIED_EMAIL_REQUIRED: {
    ar: 'المريض ليس لديه بريد إلكتروني موثق لإرسال الملخص.',
    en: 'Patient does not have a verified email address.'
  },
  PHARMACY_PRICE_NOT_CONFIGURED: {
    ar: 'لم يتم تحديد السعر الرسمي لهذا الدواء.',
    en: 'Official price is not configured for this medication.'
  },
  PHARMACY_INSUFFICIENT_STOCK_FOR_APPROVAL: {
    ar: 'المخزون المتوفر غير كافٍ للموافقة على طلب الدواء.',
    en: 'Insufficient stock to approve this medication request.'
  },
  INSUFFICIENT_STOCK: {
    ar: 'المخزون القابل للصرف غير كافٍ لإتمام عملية الصرف.',
    en: 'Insufficient usable stock available to dispense.'
  },
  DISPENSING_VALIDATION_FAILED: {
    ar: 'فشل التحقق من صحة بيانات الصرف الدوائي.',
    en: 'Dispensing validation failed.'
  },
  PHARMACY_PAYMENT_REQUIRED: {
    ar: 'يجب سداد قيمة الوصفة الطبية قبل الصرف.',
    en: 'Payment is required before dispensing medications.'
  },
  MEDICATION_ALREADY_REVIEWED: {
    ar: 'تمت مراجعة طلب الدواء مسبقاً.',
    en: 'This medication request has already been reviewed.'
  },
  MEDICATION_REVIEW_CONFLICT: {
    ar: 'تم تعديل طلب مراجعة الدواء بواسطة مستخدم آخر.',
    en: 'Medication request was modified by another user.'
  }
};

export function apiErrorMessage(payload, fallback, language = i18n?.language) {
  const isAr = Boolean(language && language.startsWith('ar'));
  const code = payload?.error?.code ?? payload?.code;

  if (code && STAFF_ERROR_MESSAGES[code]) {
    const entry = STAFF_ERROR_MESSAGES[code];
    let message = isAr ? entry.ar : entry.en;

    if (code === 'VALIDATION_ERROR' && !isAr && Array.isArray(payload?.error?.details)) {
      const fieldNames = payload.error.details
        .map((detail) => detail?.field)
        .filter(Boolean);
      if (fieldNames.length > 0) {
        message = `${message} (fields: ${fieldNames.join(', ')})`;
      }
    }

    return message;
  }

  if (isAr) {
    return fallback;
  }

  const backendMessage = typeof payload?.error === 'string' ? payload.error : payload?.error?.message;
  return backendMessage || fallback;
}

export async function fetchWithAuth(url, options = {}) {
  const staffApiBase = import.meta.env?.VITE_STAFF_API_URL || import.meta.env?.VITE_API_BASE_URL || '';
  const { timeoutMs, ...fetchOptions } = options;

  if (fetchOptions.signal || typeof AbortController === 'undefined') {
    return apiFetch(url, fetchOptions, 'staff', staffApiBase);
  }

  const isFormData = typeof FormData !== 'undefined' && fetchOptions.body instanceof FormData;
  const timeoutDuration = timeoutMs ?? (isFormData ? 120000 : 30000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutDuration);

  try {
    return await apiFetch(url, { ...fetchOptions, signal: controller.signal }, 'staff', staffApiBase);
  } catch (error) {
    if (controller.signal.aborted) {
      throw Object.assign(new Error('The server took too long to respond.'), {
        name: 'TimeoutError',
        code: 'REQUEST_TIMEOUT'
      });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
