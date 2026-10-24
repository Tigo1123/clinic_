export const staffRoles = ['ADMIN', 'RECEPTIONIST', 'DOCTOR', 'PHARMACIST', 'LAB_TECH'];
export const staffCopy = {
 en: {
  title: 'Staff accounts', subtitle: 'Manage staff access and account security.', directory: 'Staff Directory', add: 'Add Staff Member', closeForm: 'Close form',
  username: 'Username / Email', password: 'Password', role: 'Role', status: 'Status', allRoles: 'All roles', allStatuses: 'All statuses', active: 'Active', inactive: 'Inactive',
  ADMIN: 'Administrator', RECEPTIONIST: 'Receptionist', DOCTOR: 'Doctor', PHARMACIST: 'Pharmacist', LAB_TECH: 'Lab Technician',
  search: 'Search by username', count: 'staff members', loaded: 'loaded', more: 'More actions', you: 'You', loading: 'Loading staff…', empty: 'No staff accounts yet.', noResults: 'No staff match these filters.', loadError: 'Unable to load staff. Please try again.', retry: 'Retry', loadMore: 'Load more staff',
  create: 'Create account', creating: 'Creating…', created: 'Staff account created successfully.', saved: 'Account updated.', deleted: 'Staff account deleted.', resetDone: 'Password reset. The staff member must change it at sign-in.', revoked: 'All active sessions for this user have been ended.',
  reset: 'Reset password', revoke: 'Terminate sessions', disable: 'Disable account', enable: 'Enable account', delete: 'Delete account', cancel: 'Cancel', confirmDelete: 'Delete permanently', pending: 'Please wait…',
  deleteTitle: 'Delete staff account?', deleteDescription: 'This account will be permanently deleted only if it has no protected historical records.',
  disableTitle: 'Disable this staff account?', disableDescription: 'The staff member will lose access and active sessions will end. System history will be kept.',
  enableTitle: 'Enable this staff account?', enableDescription: 'The staff member will be able to sign in again.',
  revokeTitle: 'Terminate all sessions?', revokeDescription: 'This ends active sessions only. It does not deactivate the account, reset the password, or change the role.',
  resetTitle: 'Reset staff password', resetDescription: 'Confirm the new password and verify your administrator credentials. Existing sessions will end.',
  newPassword: 'New password', confirmPassword: 'Confirm new password', adminPassword: 'Current administrator password', mfa: 'Authenticator code',
  fullNameAr: 'Full name (Arabic)', fullNameEn: 'Full name (English)', specialty: 'Specialty', chooseSpecialty: 'Select an active specialty', fee: 'Consultation fee (SDG)',
  showPassword: 'Show password', hidePassword: 'Hide password', minimumLength: '10+ characters', maximumLength: '200 maximum', uppercase: 'Uppercase', lowercase: 'Lowercase', number: 'Number', symbols: 'Symbols are optional.',
  invalidPassword: 'Use 10–200 characters, including an uppercase letter, a lowercase letter, and a number.', mismatch: 'New passwords do not match.', invalidForm: 'Complete the required fields with valid values.',
  failure: 'Unable to complete this action. Please try again.', network: 'Unable to connect to the server. Please try again.',
  USERNAME_ALREADY_REGISTERED: 'Username is already registered.', STAFF_HAS_HISTORY: 'This account cannot be permanently deleted because it is linked to historical records. Disable it instead.',
  STAFF_DELETE_SELF: 'You cannot delete your own account.', STAFF_PROTECTED_ADMIN: 'The primary administrator cannot be deleted.', STAFF_LAST_ACTIVE_ADMIN: 'The last active administrator must remain enabled.',
  STAFF_USER_NOT_FOUND: 'This staff account no longer exists. Refresh the directory.', USER_NOT_FOUND: 'This staff account no longer exists. Refresh the directory.',
  ADMIN_REAUTHENTICATION_FAILED: 'Administrator verification failed. Check your password and authenticator code.', MFA_CONFIGURATION_INVALID: 'Administrator multi-factor authentication is unavailable.',
  VALIDATION_ERROR: 'Check the required fields and password rules.', SPECIALTY_INACTIVE_OR_NOT_FOUND: 'The selected specialty is no longer available.', DOCTOR_CONFIGURATION_REQUIRED: 'Choose an active specialty and a valid consultation fee.',
  STAFF_PASSWORD_RESET_CONFLICT: 'This account changed during password reset. Please retry.', USER_SESSION_REVOCATION_NOT_APPLICABLE: 'Inactive accounts have no active sessions to terminate.',
  STAFF_DELETE_ACTOR_CHANGED: 'Your permissions changed. Sign in again.', STAFF_DELETE_CONFLICT: 'This account changed during deletion. Please retry.', FORBIDDEN: 'Only an administrator can perform this action.',
  AUTHENTICATION_REQUIRED: 'Your session has expired. Sign in again.', RATE_LIMITED: 'Too many requests. Please wait and try again.'
 },
 ar: {
  title: 'حسابات الموظفين', subtitle: 'إدارة وصول الموظفين وأمان حساباتهم.', directory: 'سجل الموظفين', add: 'إضافة موظف', closeForm: 'إغلاق النموذج',
  username: 'اسم المستخدم / البريد الإلكتروني', password: 'كلمة المرور', role: 'الدور', status: 'الحالة', allRoles: 'جميع الأدوار', allStatuses: 'جميع الحالات', active: 'نشط', inactive: 'غير نشط',
  ADMIN: 'مدير النظام', RECEPTIONIST: 'موظف الاستقبال', DOCTOR: 'طبيب', PHARMACIST: 'صيدلي', LAB_TECH: 'فني مختبر',
  search: 'البحث باسم المستخدم', count: 'موظفين', loaded: 'تم تحميلهم', more: 'المزيد من الإجراءات', you: 'أنت', loading: 'جارٍ تحميل الموظفين…', empty: 'لا توجد حسابات موظفين بعد.', noResults: 'لا يوجد موظفون يطابقون البحث والفلاتر.', loadError: 'تعذر تحميل الموظفين. يرجى المحاولة مرة أخرى.', retry: 'إعادة المحاولة', loadMore: 'تحميل المزيد من الموظفين',
  create: 'إنشاء الحساب', creating: 'جارٍ الإنشاء…', created: 'تم إنشاء حساب الموظف بنجاح.', saved: 'تم تحديث الحساب.', deleted: 'تم حذف حساب الموظف.', resetDone: 'تمت إعادة تعيين كلمة المرور. يجب على الموظف تغييرها عند تسجيل الدخول.', revoked: 'تم إنهاء جميع جلسات المستخدم النشطة.',
  reset: 'إعادة تعيين كلمة المرور', revoke: 'إنهاء الجلسات', disable: 'تعطيل الحساب', enable: 'تفعيل الحساب', delete: 'حذف الحساب', cancel: 'إلغاء', confirmDelete: 'حذف نهائي', pending: 'يرجى الانتظار…',
  deleteTitle: 'حذف حساب الموظف؟', deleteDescription: 'سيتم حذف هذا الحساب نهائياً إذا لم يكن مرتبطاً بسجلات سابقة.',
  disableTitle: 'تعطيل حساب الموظف؟', disableDescription: 'سيفقد الموظف إمكانية الدخول وتنتهي جلساته النشطة. ستبقى سجلات النظام محفوظة.',
  enableTitle: 'تفعيل حساب الموظف؟', enableDescription: 'سيتمكن الموظف من تسجيل الدخول مجدداً.',
  revokeTitle: 'إنهاء جميع الجلسات؟', revokeDescription: 'ينهي هذا الإجراء الجلسات النشطة فقط، ولا يعطّل الحساب أو يعيد تعيين كلمة المرور أو يغيّر الدور.',
  resetTitle: 'إعادة تعيين كلمة مرور الموظف', resetDescription: 'أكد كلمة المرور الجديدة وتحقق من بيانات المدير. ستنتهي الجلسات الحالية.',
  newPassword: 'كلمة المرور الجديدة', confirmPassword: 'تأكيد كلمة المرور الجديدة', adminPassword: 'كلمة مرور المدير الحالية', mfa: 'رمز المصادقة',
  fullNameAr: 'الاسم الكامل (عربي)', fullNameEn: 'الاسم الكامل (إنجليزي)', specialty: 'التخصص', chooseSpecialty: 'اختر تخصصاً مفعّلاً', fee: 'رسوم الكشف (جنيه سوداني)',
  showPassword: 'إظهار كلمة المرور', hidePassword: 'إخفاء كلمة المرور', minimumLength: '10 أحرف على الأقل', maximumLength: '200 حرف كحد أقصى', uppercase: 'حرف إنجليزي كبير', lowercase: 'حرف إنجليزي صغير', number: 'رقم', symbols: 'الرموز الخاصة اختيارية.',
  invalidPassword: 'استخدم 10 إلى 200 حرف، مع حرف إنجليزي كبير وحرف صغير ورقم.', mismatch: 'كلمتا المرور الجديدتان غير متطابقتين.', invalidForm: 'أكمل الحقول المطلوبة بقيم صحيحة.',
  failure: 'تعذر إكمال هذا الإجراء. يرجى المحاولة مرة أخرى.', network: 'تعذر الاتصال بالخادم. يرجى المحاولة مرة أخرى.',
  USERNAME_ALREADY_REGISTERED: 'اسم المستخدم مسجل بالفعل.', STAFF_HAS_HISTORY: 'لا يمكن حذف هذا الحساب نهائياً لأنه مرتبط بسجلات سابقة. يمكنك تعطيله بدلاً من ذلك.',
  STAFF_DELETE_SELF: 'لا يمكنك حذف حسابك الحالي.', STAFF_PROTECTED_ADMIN: 'لا يمكن حذف حساب مدير النظام الأساسي.', STAFF_LAST_ACTIVE_ADMIN: 'يجب الإبقاء على مدير نظام نشط واحد على الأقل.',
  STAFF_USER_NOT_FOUND: 'لم يعد حساب الموظف موجوداً. حدّث السجل.', USER_NOT_FOUND: 'لم يعد حساب الموظف موجوداً. حدّث السجل.',
  ADMIN_REAUTHENTICATION_FAILED: 'فشل التحقق من هوية المدير. تحقق من كلمة المرور ورمز المصادقة.', MFA_CONFIGURATION_INVALID: 'المصادقة المتعددة غير متاحة لحساب المدير.',
  VALIDATION_ERROR: 'تحقق من الحقول المطلوبة وشروط كلمة المرور.', SPECIALTY_INACTIVE_OR_NOT_FOUND: 'التخصص المحدد لم يعد متاحاً.', DOCTOR_CONFIGURATION_REQUIRED: 'اختر تخصصاً مفعّلاً ورسوم كشف صحيحة.',
  STAFF_PASSWORD_RESET_CONFLICT: 'تغيّر الحساب أثناء إعادة تعيين كلمة المرور. يرجى المحاولة مرة أخرى.', USER_SESSION_REVOCATION_NOT_APPLICABLE: 'الحسابات غير النشطة ليس لها جلسات نشطة لإنهائها.',
  STAFF_DELETE_ACTOR_CHANGED: 'تغيّرت صلاحيات حسابك. سجّل الدخول مجدداً.', STAFF_DELETE_CONFLICT: 'تغيّر الحساب أثناء الحذف. يرجى المحاولة مرة أخرى.', FORBIDDEN: 'هذا الإجراء متاح لمدير النظام فقط.',
  AUTHENTICATION_REQUIRED: 'انتهت جلستك. سجّل الدخول مجدداً.', RATE_LIMITED: 'طلبات كثيرة. انتظر قليلاً ثم حاول مجدداً.'
 }
};
export function staffErrorMessage(data, lang, status) {
 const text = staffCopy[lang === 'ar' ? 'ar' : 'en'];
 const code = data?.error?.code;
 // Support the old duplicate response without exposing arbitrary server text.
 if (data?.error === 'Username is already registered.') return text.USERNAME_ALREADY_REGISTERED;
 return text[code] || (status === 401 ? text.AUTHENTICATION_REQUIRED : status === 403 ? text.FORBIDDEN : status === 429 ? text.RATE_LIMITED : text.failure);
}
