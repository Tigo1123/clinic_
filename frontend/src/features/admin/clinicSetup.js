export const clinicCopy = {
  en: {
    labTitle: 'Clinical services · Laboratory tests', addTest: 'Add Test', actions: 'Actions', activate: 'Activate', deactivate: 'Deactivate', unpriced: 'Pricing required', emptyTests: 'No laboratory tests yet. Add the clinic’s approved tests to begin.', noTests: 'No tests match your search or status filter.', labStatusHelp: 'Inactive tests cannot be ordered for new visits. Existing orders, results and invoice prices are preserved.',
    title: 'Clinic setup', insurance: 'Insurance companies', insuranceHelp: 'Configure patient copay and covered service categories. Deactivation affects new invoices; historical claims keep their issued amounts.', doctors: 'Doctors', specialties: 'Specialties', services: 'Medical services', labs: 'Laboratory tests', payments: 'Payment methods',
    add: 'Add', edit: 'Edit', save: 'Save', cancel: 'Cancel', search: 'Search by name or code', empty: 'No entries yet. Add the clinic’s actual information to get started.',
    failed: 'Unable to load clinic configuration. Please retry.', saveFailed: 'Unable to save. Check the fields and try again.', retry: 'Retry', saved: 'Changes saved.',
    labelAr: 'Arabic name', labelEn: 'English name', code: 'Code', price: 'Official price (whole SDG)', category: 'Category', status: 'Status', active: 'Active', inactive: 'Inactive',
    username: 'Account email', password: 'Temporary password', specialty: 'Specialty', choose: 'Choose a specialty', schedule: 'Working schedule', noSchedule: 'Schedule required',
    scheduleHelp: 'New doctors have no working hours. Set an explicit schedule before accepting bookings. Deactivation preserves existing appointments and records.',
    passwordHelp: '10–200 characters with an uppercase letter, a lowercase letter and a number. The doctor must change it at first sign-in.',
    confirm: 'Confirm configuration change', confirmText: 'This updates future availability or catalog selection. Historical appointments, invoices and results are preserved.',
    paymentHelp: 'Manual payment records only. Never enter card numbers, CVV, PINs or payment secrets. Insurance uses the existing claim and patient-share flow, not a payment method.',
    catalogHelp: 'Categories cannot change after creation. Archive entries instead of deleting them. Existing invoice lines keep their original prices and descriptions.',
    invalid: 'Complete the required fields. Prices must be whole SDG between 1 and 1,000,000,000.', account: 'Account', all: 'All statuses', previous: 'Previous', next: 'Next',
    CONSULTATION: 'Consultation', LABORATORY: 'Laboratory', RADIOLOGY: 'Radiology', CLINICAL_PROCEDURE: 'Clinical procedure',
  },
  ar: {
    labTitle: 'الخدمات السريرية · فحوص المختبر', addTest: 'إضافة فحص', actions: 'الإجراءات', activate: 'تفعيل', deactivate: 'تعطيل', unpriced: 'يلزم تحديد السعر', emptyTests: 'لا توجد فحوص مخبرية بعد. أضف فحوص العيادة المعتمدة للبدء.', noTests: 'لا توجد فحوص تطابق البحث أو الحالة.', labStatusHelp: 'لا يمكن طلب الفحوص المعطلة للزيارات الجديدة. تبقى الطلبات والنتائج وأسعار الفواتير السابقة محفوظة.',
    title: 'إعداد العيادة', insurance: 'شركات التأمين', insuranceHelp: 'حدّد مساهمة المريض وفئات الخدمات المغطاة. يؤثر التعطيل على الفواتير الجديدة وتبقى مبالغ المطالبات السابقة محفوظة.', doctors: 'الأطباء', specialties: 'التخصصات', services: 'الخدمات الطبية', labs: 'فحوص المختبر', payments: 'طرق الدفع',
    add: 'إضافة', edit: 'تعديل', save: 'حفظ', cancel: 'إلغاء', search: 'البحث بالاسم أو الرمز', empty: 'لا توجد بيانات بعد. أضف البيانات الفعلية للعيادة للبدء.',
    failed: 'تعذر تحميل إعدادات العيادة. يرجى إعادة المحاولة.', saveFailed: 'تعذر الحفظ. تحقق من الحقول وحاول مجدداً.', retry: 'إعادة المحاولة', saved: 'تم حفظ التغييرات.',
    labelAr: 'الاسم بالعربية', labelEn: 'الاسم بالإنجليزية', code: 'الرمز', price: 'السعر الرسمي (جنيه سوداني كامل)', category: 'الفئة', status: 'الحالة', active: 'نشط', inactive: 'غير نشط',
    username: 'البريد الإلكتروني للحساب', password: 'كلمة مرور مؤقتة', specialty: 'التخصص', choose: 'اختر التخصص', schedule: 'جدول العمل', noSchedule: 'يلزم تحديد جدول',
    scheduleHelp: 'لا تُحدَّد ساعات عمل تلقائية للطبيب الجديد. أضف جدولاً صريحاً قبل الحجز. التعطيل يحفظ المواعيد والسجلات الموجودة.',
    passwordHelp: 'من 10 إلى 200 حرف، تتضمن حرفاً إنجليزياً كبيراً وصغيراً ورقماً. يجب تغييرها عند أول دخول.',
    confirm: 'تأكيد تغيير الإعدادات', confirmText: 'يؤثر التعديل على الإتاحة والاختيارات الجديدة. تبقى المواعيد والفواتير والنتائج السابقة محفوظة.',
    paymentHelp: 'سجلات دفع يدوية فقط. لا تُدخل أرقام البطاقات أو رموز الأمان أو الأرقام السرية. التأمين يستخدم المطالبات وحصة المريض الحالية وليس طريقة دفع.',
    catalogHelp: 'لا تتغير الفئة بعد الإنشاء. عطّل المدخل بدلاً من حذفه. تحتفظ بنود الفواتير السابقة بأسعارها وأوصافها الأصلية.',
    invalid: 'أكمل الحقول المطلوبة. يجب أن يكون السعر بالجنيه الكامل من ١ إلى ١٬٠٠٠٬٠٠٠٬٠٠٠.', account: 'الحساب', all: 'كل الحالات', previous: 'السابق', next: 'التالي',
    CONSULTATION: 'استشارة', LABORATORY: 'مختبر', RADIOLOGY: 'أشعة', CLINICAL_PROCEDURE: 'إجراء سريري',
  },
};

export function setupPayload(resource, draft, editing) {
  if (resource === 'insurance') return { labelAr: draft.labelAr.trim(), labelEn: draft.labelEn.trim(), active: draft.active, copayPercentage: Number(draft.copayPercentage), billingCycleDays: Number(draft.billingCycleDays), coveredCategories: draft.coveredCategories };
  if (resource === 'payments') return { labelAr: draft.labelAr.trim(), labelEn: draft.labelEn.trim(), active: draft.active };
  if (resource === 'specialties') return { code: draft.code.trim(), nameAr: draft.labelAr.trim(), nameEn: draft.labelEn.trim(), active: draft.active };
  if (resource === 'doctors') {
    const profile = { fullNameAr: draft.labelAr.trim(), fullNameEn: draft.labelEn.trim(), specialtyId: draft.specialtyId, consultationFee: Number(draft.priceSdg) };
    return editing ? { ...profile, status: draft.active ? 'ACTIVE' : 'INACTIVE' } : { ...profile, username: draft.username.trim(), password: draft.password, role: 'DOCTOR' };
  }
  return { code: draft.code.normalize('NFKC').trim().toLowerCase(), labelAr: draft.labelAr.trim(), labelEn: draft.labelEn.trim(), priceSdg: draft.priceSdg, status: draft.active ? 'ACTIVE' : 'INACTIVE', ...(!editing ? { category: resource === 'labs' ? 'LABORATORY' : draft.category } : {}) };
}
