import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

const resources = {
  ar: {
    translation: {
      brandName: 'نظام الشفاء الطبي',
      patientPortal: 'بوابة حجز المرضى',
      receptionDashboard: 'لوحة الاستقبال',
      doctorDashboard: 'لوحة العيادة الطبية',
      adminSettings: 'إعدادات النظام',
      login: 'تسجيل الدخول',
      logout: 'تسجيل الخروج',
      username: 'اسم المستخدم',
      password: 'كلمة المرور',
      submit: 'حفظ وتأكيد',
      requiredField: 'هذا الحقل مطلوب',
      bookAppointment: 'حجز موعد طبي جديد',
      selectSpecialty: 'اختر التخصص الطبي',
      selectDoctor: 'اختر الطبيب المعالج',
      selectDate: 'اختر تاريخ الزيارة',
      selectTime: 'اختر موعد الكشف الشاغر',
      fullNameAr: 'الاسم الكامل باللغة العربية',
      fullNameEn: 'الاسم الكامل باللغة الإنجليزية',
      gender: 'النوع',
      male: 'ذكر',
      female: 'أنثى',
      phone: 'رقم الهاتف (سوداني)',
      nationalId: 'الرقم الوطني السوداني (اختياري)',
      addressState: 'ولاية الإقامة بالسودان',
      enterOtp: 'أدخل رمز التحقق (OTP) المرسل لهاتفك',
      verify: 'تأكيد الحجز',
      bookingSuccess: 'تم تأكيد حجز موعدك بنجاح في العيادة!',
      ticketNo: 'رقم تذكرة الانتظار',
      printTicket: 'طباعة تذكرة الحجز',
      activeQueue: 'طابور المرضى النشط اليوم',
      vitals: 'العلامات الحيوية',
      symptoms: 'الشكوى والأعراض',
      diagnosis: 'التشخيص الطبي (ICD-11)',
      treatment: 'الخطة العلاجية والجرعات',
      clinicalNotes: 'ملاحظات الطبيب السريرية',
      prescribe: 'إضافة دواء للوصفة',
      completeConsultation: 'إنهاء الزيارة وحفظ الملف',
      breakTheGlass: 'كسر الحماية (حالة طارئة)',
      emergency: 'طوارئ مستعجلة',
      paymentMethod: 'طريقة الدفع',
      bankakRef: 'رقم المعاملة (بنكك)',
      fawryRef: 'رقم معاملة فوري',
      splitPayment: 'تجزئة الدفع',
      invoiceTotal: 'إجمالي الفاتورة',
      trustedCare: 'رعاية آمنة وموثوقة', heroTitle: 'رعايتك الصحية، أصبحت أبسط.', heroDescription: 'احجز مع الطبيب المناسب وتابع مواعيدك ونتائجك الطبية بأمان من مكان واحد.', realAvailability: 'مواعيد فعلية', secureRecords: 'سجلات محمية', findCare: 'ابحث عن الرعاية', chooseDoctor: 'اختر الطبيب المناسب', manageAppointments: 'إدارة المواعيد', anyDevice: 'من أي جهاز', simpleHealthcare: 'رعاية صحية مبسطة', careJourney: 'من البحث إلى الموعد في خطوات واضحة', careJourneyText: 'تجربة رقمية آمنة تربط المرضى بفريق الرعاية.', findDoctor: 'ابحث عن طبيب', findDoctorText: 'استكشف الأطباء حسب التخصص واختر الأنسب لك.', chooseTime: 'اختر الوقت', chooseTimeText: 'اطلع على الأوقات الفعلية المتاحة واحجز بثقة.', manageCare: 'تابع رعايتك', manageCareText: 'راجع مواعيدك ونتائجك ووصفاتك في حساب آمن.', healthcareFooter: 'رعاية صحية مهنية وآمنة لكل مريض.', staffPortal: 'بوابة الموظفين', services: 'الخدمات',
      patientShare: 'حصة المريض للجمع',
      rescheduleAppointment: 'إعادة جدولة الموعد', accountSecurity: 'أمان الحساب',
      insuranceShare: 'حصة شركة التأمين',
      reconcile: 'تسوية الوردية', patientHome:'الرئيسية',doctors:'الأطباء',myAppointments:'مواعيدي',labResults:'نتائج المختبر',prescriptions:'الوصفات',medicalRecords:'السجلات الطبية',profile:'الملف الشخصي',patientNavigation:'تنقل بوابة المريض',patientLogin:'دخول المريض',phoneOrEmail:'الهاتف أو البريد الإلكتروني',createPatientAccount:'إنشاء حساب مريض',patientAccountRequired:'يتطلب حساب مريض',fullName:'الاسم الكامل',emailOptional:'البريد الإلكتروني (اختياري)',dateOfBirth:'تاريخ الميلاد',confirmPassword:'تأكيد كلمة المرور',passwordMismatch:'كلمتا المرور غير متطابقتين',loading:'جارٍ التحميل...',createAccount:'إنشاء الحساب',verificationCodePrompt:'أدخل رمز التحقق المرسل لهويتك.',developmentCode:'رمز التطوير فقط',verificationCode:'رمز التحقق',claimAfterLogin:'تم التحقق. سجل الدخول وأدخل رمز المطالبة من الاستقبال.',accountVerified:'تم التحقق من الحساب.',claimRecord:'ربط السجل الطبي',claimInstructions:'أدخل رمز المطالبة الذي أصدره موظف الاستقبال وتاريخ ميلادك.',claimCode:'رمز المطالبة',welcome:'مرحباً',upcomingAppointments:'المواعيد القادمة',recentLabResults:'أحدث النتائج',noDoctors:'لا يوجد أطباء متاحون.',details:'التفاصيل',book:'حجز',noSlots:'لا توجد أوقات متاحة.',confirmBooking:'تأكيد الحجز',upcoming:'القادمة',past:'السابقة',cancelled:'الملغاة',all:'الكل',noAppointments:'لا توجد مواعيد.',appointmentDetails:'تفاصيل الموعد',cancelAppointment:'إلغاء الموعد',noRecords:'لا توجد سجلات متاحة.',addressDetails:'تفاصيل العنوان',emergencyContact:'جهة اتصال الطوارئ',saved:'تم الحفظ',save:'حفظ'
    }
  },
  en: {
    translation: {
      brandName: 'Al-Shifa Medical CMS',
      patientPortal: 'Patient Booking Portal',
      receptionDashboard: 'Reception Dashboard',
      doctorDashboard: 'Clinical Workspace',
      adminSettings: 'Admin Settings',
      login: 'Login',
      logout: 'Logout',
      username: 'Username',
      password: 'Password',
      submit: 'Save & Confirm',
      requiredField: 'This field is required',
      bookAppointment: 'Book New Medical Appointment',
      selectSpecialty: 'Select Medical Specialty',
      selectDoctor: 'Select Practicing Doctor',
      selectDate: 'Select Appointment Date',
      selectTime: 'Select Free Time Slot',
      fullNameAr: 'Full Name (Arabic)',
      fullNameEn: 'Full Name (English)',
      gender: 'Gender',
      male: 'Male',
      female: 'Female',
      phone: 'Phone Number (Sudanese)',
      nationalId: 'Sudanese National ID (Optional)',
      addressState: 'Sudanese State of Residence',
      enterOtp: 'Enter validation code (OTP) sent to your phone',
      verify: 'Verify & Book Slot',
      bookingSuccess: 'Your appointment has been successfully booked!',
      ticketNo: 'Waiting Ticket No',
      printTicket: 'Print Ticket Receipt',
      activeQueue: 'Active Patient Queue Today',
      vitals: 'Vital Signs',
      symptoms: 'Patient Symptoms & History',
      diagnosis: 'Clinical Diagnosis (ICD-11)',
      treatment: 'Treatment Plan & Prescriptions',
      clinicalNotes: 'Internal Clinical Notes',
      prescribe: 'Add Prescription Item',
      completeConsultation: 'Complete Visit & Save EMR',
      breakTheGlass: 'Break-the-Glass (EMR Bypass)',
      emergency: 'Emergency Priority',
      paymentMethod: 'Payment Method',
      bankakRef: 'Bankak Transaction Ref',
      fawryRef: 'Fawry Transaction Ref',
      splitPayment: 'Split Payment Allocation',
      invoiceTotal: 'Invoice Total',
      trustedCare: 'Trusted, secure care', heroTitle: 'Your healthcare, made simpler.', heroDescription: 'Book the right doctor and manage appointments, results, and prescriptions securely in one place.', realAvailability: 'Real availability', secureRecords: 'Protected records', findCare: 'Find the right care', chooseDoctor: 'Choose your doctor', manageAppointments: 'Manage appointments', anyDevice: 'From any device', simpleHealthcare: 'Healthcare made simple', careJourney: 'From search to appointment in clear steps', careJourneyText: 'A secure digital experience connecting patients with their care team.', findDoctor: 'Find a doctor', findDoctorText: 'Explore real clinic doctors by specialty and choose the right care.', chooseTime: 'Choose a time', chooseTimeText: 'See live availability and reserve your appointment confidently.', manageCare: 'Manage your care', manageCareText: 'Review appointments, released results, and prescriptions securely.', healthcareFooter: 'Professional, secure healthcare for every patient.', staffPortal: 'Staff portal', services: 'Services',
      patientShare: 'Patient Share Copay',
      rescheduleAppointment: 'Reschedule appointment', accountSecurity: 'Account security',
      insuranceShare: 'Insurance Claim Share',
      reconcile: 'Reconcile Shift', patientHome:'Home',doctors:'Doctors',myAppointments:'My Appointments',labResults:'Lab Results',prescriptions:'Prescriptions',medicalRecords:'Medical Records',profile:'Profile',patientNavigation:'Patient navigation',patientLogin:'Patient Login',phoneOrEmail:'Phone or email',createPatientAccount:'Create patient account',patientAccountRequired:'A patient account is required.',fullName:'Full name',emailOptional:'Email (optional)',dateOfBirth:'Date of birth',confirmPassword:'Confirm password',passwordMismatch:'Passwords do not match.',loading:'Loading…',createAccount:'Create account',verificationCodePrompt:'Enter the verification code delivered to your identity.',developmentCode:'Development-only code',verificationCode:'Verification code',claimAfterLogin:'Verified. Sign in and enter the claim code issued by reception.',accountVerified:'Account verified.',claimRecord:'Link clinic record',claimInstructions:'Enter the claim code issued by reception and your date of birth.',claimCode:'Claim code',welcome:'Welcome',upcomingAppointments:'Upcoming appointments',recentLabResults:'Recent lab results',noDoctors:'No doctors are currently available.',details:'Details',book:'Book',noSlots:'No available times.',confirmBooking:'Confirm booking',upcoming:'Upcoming',past:'Past',cancelled:'Cancelled',all:'All',noAppointments:'No appointments found.',appointmentDetails:'Appointment details',cancelAppointment:'Cancel appointment',noRecords:'No records available.',addressDetails:'Address details',emergencyContact:'Emergency contact',saved:'Saved successfully.',save:'Save'
    }
  }
};

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: 'ar', // Default Language is Arabic (RTL) as per Sudan requirements
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false
    }
  });

export default i18n;
