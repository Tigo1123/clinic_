import i18n from '../i18n.js';

export const PATIENT_ERROR_MESSAGES = {
  APPOINTMENT_SLOT_UNAVAILABLE: {
    ar: 'تم حجز هذا الموعد للتو. يرجى اختيار موعد آخر.',
    en: 'This appointment slot is no longer available. Please select another slot.'
  },
  INVALID_APPOINTMENT_SLOT: {
    ar: 'وقت الموعد المحدد غير متاح في جدول الطبيب.',
    en: 'The selected appointment slot is not available in the doctor schedule.'
  },
  CANCELLATION_CUTOFF_REACHED: {
    ar: 'انتهت المهلة المسموح بها لإلغاء الموعد قبل ساعتين من موعد الكشف.',
    en: 'The appointment cancellation cutoff has passed (at least 2 hours prior).'
  },
  APPOINTMENT_CANNOT_BE_CANCELLED: {
    ar: 'لا يمكن إلغاء هذا الموعد في حالته الحالية.',
    en: 'This appointment can no longer be cancelled.'
  },
  APPOINTMENT_CANNOT_BE_RESCHEDULED: {
    ar: 'لا يمكن إعادة جدولة هذا الموعد في حالته الحالية.',
    en: 'This appointment can no longer be rescheduled.'
  },
  APPOINTMENT_STATE_CONFLICT: {
    ar: 'تغيرت حالة الموعد. يرجى تحديث الصفحة والمحاولة مجدداً.',
    en: 'Appointment state changed. Please refresh and try again.'
  },
  APPOINTMENT_DATE_IN_PAST: {
    ar: 'لا يمكن حجز موعد في تاريخ سابق.',
    en: 'Past appointment dates are not allowed.'
  },
  APPOINTMENT_NOT_FOUND: {
    ar: 'تعذر العثور على الموعد المطلوب.',
    en: 'Appointment not found.'
  },
  DOCTOR_NOT_FOUND: {
    ar: 'تعذر العثور على الطبيب أو الطبيب غير متاح حالياً.',
    en: 'Doctor not found or not currently active.'
  },
  PATIENT_RECORD_NOT_LINKED: {
    ar: 'هذا الحساب غير مرتبط بملف طبي في العيادة.',
    en: 'This account is not linked to a patient record.'
  },
  CLINICAL_DATA_UNREADABLE: {
    ar: 'تعذر قراءة البيانات السريرية.',
    en: 'Clinical information is unavailable.'
  },
  MEDICAL_RECORD_NOT_FOUND: {
    ar: 'تعذر العثور على السجل الطبي المطلوب.',
    en: 'Medical record not found.'
  },
  MEDICAL_RECORD_DETAIL_FAILED: {
    ar: 'تعذر تحميل تفاصيل السجل الطبي.',
    en: 'Failed to retrieve medical record details.'
  },
  VERIFICATION_EXPIRED: {
    ar: 'انتهت صلاحية رمز التحقق. يرجى طلب رمز جديد.',
    en: 'Verification code has expired. Please request a new code.'
  },
  VERIFICATION_CODE_INCORRECT: {
    ar: 'رمز التحقق غير صحيح. تحقق من الرمز وحاول مرة أخرى.',
    en: 'Verification code is incorrect. Check the code and try again.'
  },
  VERIFICATION_RESEND_COOLDOWN: {
    ar: 'يرجى الانتظار قليلاً قبل طلب رمز تحقق جديد.',
    en: 'Please wait before requesting another verification code.'
  },
  VERIFICATION_ATTEMPTS_EXCEEDED: {
    ar: 'تجاوزت الحد الأقصى لمحاولات التحقق. يرجى طلب رمز جديد.',
    en: 'Verification attempt limit exceeded. Please request a new code.'
  },
  VERIFICATION_INVALID: {
    ar: 'طلب التحقق غير صالح أو تم استخدامه مسبقاً.',
    en: 'Verification challenge is invalid or already used.'
  },
  VERIFICATION_UNAVAILABLE: {
    ar: 'خدمة التحقق غير متاحة حالياً. يرجى مراجعة الاستقبال لتفعيل الحساب.',
    en: 'Online verification is currently unavailable. Please contact reception.'
  },
  VERIFICATION_DELIVERY_FAILED: {
    ar: 'تعذر إرسال رمز التحقق. يرجى المحاولة مرة أخرى لاحقاً.',
    en: 'Verification code could not be delivered. Please try again.'
  },
  PHONE_ALREADY_REGISTERED: {
    ar: 'يوجد حساب مسجل بالفعل برقم الهاتف هذا.',
    en: 'An account already exists for this phone number.'
  },
  EMAIL_ALREADY_REGISTERED: {
    ar: 'يوجد حساب مسجل بالفعل بهذا البريد الإلكتروني.',
    en: 'An account already exists for this email.'
  },
  ACCOUNT_ALREADY_EXISTS: {
    ar: 'يوجد حساب مسجل بالفعل لهذه البيانات.',
    en: 'An account already exists for this identity.'
  },
  LOGIN_RATE_LIMITED: {
    ar: 'محاولات تسجيل دخول كثيرة. يرجى الانتظار قليلاً ثم المحاولة مرة أخرى.',
    en: 'Too many login attempts. Please try again later.'
  },
  RATE_LIMITED: {
    ar: 'طلبات كثيرة في وقت قصير. يرجى الانتظار قليلاً ثم المحاولة مرة أخرى.',
    en: 'Too many requests. Please wait a moment and try again.'
  },
  REAUTHENTICATION_FAILED: {
    ar: 'كلمة المرور الحالية غير صحيحة.',
    en: 'Current credentials are invalid.'
  },
  INVALID_CREDENTIALS: {
    ar: 'بيانات الدخول غير صحيحة. تحقق من اسم المستخدم وكلمة المرور.',
    en: 'Invalid username or password.'
  },
  PHONE_INVALID: {
    ar: 'رقم الهاتف المدخل غير صالح.',
    en: 'Phone number is invalid.'
  },
  INVALID_DATE_OF_BIRTH: {
    ar: 'تاريخ الميلاد يجب أن يكون في الماضي.',
    en: 'Date of birth must be in the past.'
  },
  INVALID_ADDRESS_STATE: {
    ar: 'المنطقة أو الولاية المختارة غير صالحة.',
    en: 'The selected address state is unavailable.'
  },
  VERIFIED_EMAIL_REQUIRED: {
    ar: 'يلزم توثيق البريد الإلكتروني أولاً قبل تعديل رقم الهاتف.',
    en: 'A verified email is required before changing the phone number.'
  },
  EMAIL_CHANGE_UNAVAILABLE: {
    ar: 'تعذر إتمام تغيير البريد الإلكتروني. قد يكون البريد مستخدماً بالفعل.',
    en: 'Unable to complete this email change.'
  },
  PHONE_CHANGE_UNAVAILABLE: {
    ar: 'تعذر إتمام تغيير رقم الهاتف. قد يكون الرقم مستخدماً بالفعل.',
    en: 'Unable to complete this phone change.'
  },
  GOOGLE_CREDENTIAL_INVALID: {
    ar: 'تعذر التحقق من بيانات تسجيل الدخول عبر Google.',
    en: 'Google credential could not be verified.'
  },
  GOOGLE_EMAIL_MISMATCH: {
    ar: 'البريد الإلكتروني لحساب Google لا يطابق بريد حسابك في العيادة.',
    en: 'Google account email does not match clinic account email.'
  },
  GOOGLE_IDENTITY_ALREADY_LINKED: {
    ar: 'حساب Google هذا مرتبط بمريض آخر بالفعل.',
    en: 'This Google account is already linked to another patient.'
  },
  GOOGLE_ALREADY_LINKED: {
    ar: 'يوجد حساب Google مرتبط بهذا الحساب بالفعل.',
    en: 'A Google account is already linked to this account.'
  },
  GOOGLE_NOT_LINKED: {
    ar: 'لا يوجد حساب Google مرتبط حالياً.',
    en: 'No Google account is currently linked.'
  },
  PRIMARY_AUTH_REQUIRED: {
    ar: 'لا يمكن إلغاء ربط حساب Google بدون تعيين كلمة مرور للحساب.',
    en: 'Cannot unlink Google account without a password.'
  },
  ACCOUNT_NOT_ACTIVE: {
    ar: 'حساب المريض غير نشط. يرجى التواصل مع الاستقبال.',
    en: 'The patient account is not active.'
  },
  PATIENT_ALREADY_LINKED: {
    ar: 'الحساب مرتبط بالفعل بسجل طبي.',
    en: 'Account is already linked to a patient record.'
  },
  CLAIM_VERIFICATION_FAILED: {
    ar: 'فشل التحقق من رمز المطالبة. تحقق من الرمز وتاريخ الميلاد.',
    en: 'Claim verification failed.'
  },
  OFFLINE_ACTIVATION_UNAVAILABLE: {
    ar: 'التفعيل عبر رمز الاستقبال غير متاح حالياً.',
    en: 'Clinic-assisted activation is not available while online verification is enabled.'
  },
  PATIENT_ALREADY_CLAIMED: {
    ar: 'تمت مطالبة هذا السجل الطبي بواسطة حساب آخر.',
    en: 'Patient record was claimed by another account.'
  },
  PATIENT_ACCOUNT_REQUIRED: {
    ar: 'يلزم استخدام حساب مريض للوصول إلى هذه الخدمة.',
    en: 'A patient account is required.'
  },
  ACCOUNT_ALREADY_VERIFIED: {
    ar: 'تم التحقق من هذا الحساب مسبقاً.',
    en: 'This account is already verified.'
  },
  ACCOUNT_NOT_PENDING_VERIFICATION: {
    ar: 'هذا الحساب لا يحتاج إلى تحقق.',
    en: 'This account does not require verification.'
  }
};

const CONNECTION_ERROR_MESSAGES = {
  ar: 'تعذر الاتصال بالخادم. تحقق من اتصال الإنترنت وحاول مرة أخرى.',
  en: 'Unable to connect to the server. Please check your internet connection and try again.'
};

const VALIDATION_ERROR_MESSAGES = {
  ar: 'البيانات المدخلة غير صحيحة.',
  en: 'Request validation failed.'
};

export function patientErrorMessage(error, fallback, language = i18n?.language) {
  const isAr = Boolean(language && language.startsWith('ar'));
  const code = error?.code;

  if (code && PATIENT_ERROR_MESSAGES[code]) {
    const entry = PATIENT_ERROR_MESSAGES[code];
    return isAr ? entry.ar : entry.en;
  }

  if (code === 'VALIDATION_ERROR') {
    let msg = isAr ? VALIDATION_ERROR_MESSAGES.ar : VALIDATION_ERROR_MESSAGES.en;
    if (!isAr && Array.isArray(error?.details)) {
      const fieldNames = error.details
        .map((d) => d?.field || (typeof d === 'string' ? d : null))
        .filter(Boolean);
      if (fieldNames.length > 0) {
        msg = `${msg} (fields: ${fieldNames.join(', ')})`;
      }
    }
    return msg;
  }

  if (code === 'REQUEST_TIMEOUT' || error instanceof TypeError || typeof error?.status !== 'number') {
    return isAr ? CONNECTION_ERROR_MESSAGES.ar : CONNECTION_ERROR_MESSAGES.en;
  }

  if (isAr) {
    return fallback;
  }

  return error?.message || fallback;
}
