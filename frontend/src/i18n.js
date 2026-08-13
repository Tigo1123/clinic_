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
      patientShare: 'حصة المريض للجمع',
      insuranceShare: 'حصة شركة التأمين',
      reconcile: 'تسوية الوردية'
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
      patientShare: 'Patient Share Copay',
      insuranceShare: 'Insurance Claim Share',
      reconcile: 'Reconcile Shift'
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
