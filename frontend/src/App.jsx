import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  Lock,
  Plus,
  Trash2,
  Users,
  Settings,
  DollarSign,
  FileText,
  CheckCircle,
  Calendar,
  Clock,
  LogOut,
  RefreshCw,
  Sliders,
  Download,
  AlertTriangle,
  HeartPulse,
  Stethoscope,
  FileSpreadsheet,
  User,
  Shield,
  Search,
  Building,
  Check,
  AlertCircle,
  Eye,
  HelpCircle,
  Briefcase,
  Printer,
  Mail,
  MessageCircle,
  MessageSquare, // <--- تم إضافة الأيقونة الناقصة
  X
} from 'lucide-react';

import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, BarChart, Bar, Legend, LineChart, Line } from 'recharts';
import NotificationDropdown from './components/NotificationDropdown';

import './App.css';
import { io } from 'socket.io-client';

const socket = io(
  window.location.hostname === 'localhost'
    ? 'http://localhost:5000'
    : `${window.location.protocol}//${window.location.hostname}:5000`
);

/**
 * Utility to generate WhatsApp Web click-to-chat links
 */
function getWhatsAppLink(phone, message) {
  if (!phone) return '#';
  let cleaned = phone.replace(/[^0-9]/g, '');
  if (cleaned.startsWith('0')) {
    cleaned = '249' + cleaned.substring(1);
  } else if (!cleaned.startsWith('249') && cleaned.length === 9) {
    cleaned = '249' + cleaned;
  }
  return `https://wa.me/${cleaned}?text=${encodeURIComponent(message || '')}`;
}

// Base fetch helper with JWT header
const fetchWithAuth = async (url, options = {}) => {
  const token = localStorage.getItem('cms_token');
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...options.headers,
  };

  let targetUrl = url;
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    const cleanPath = url.startsWith('/') ? url : `/${url}`;
    const backendHost = window.location.hostname === 'localhost' ? 'localhost' : window.location.hostname;
    targetUrl = `http://${backendHost}:5000${cleanPath}`;
  }

  try {
    const res = await fetch(targetUrl, { ...options, headers });
    if (res.status === 401) {
      localStorage.removeItem('cms_user');
      localStorage.removeItem('cms_token');
      if (token) {
        window.location.href = '/';
      }
    }
    return res;
  } catch (error) {
    console.error('fetchWithAuth error:', error);
    throw error;
  }
};

// 18 Sudanese States List
const SUDANESE_STATES = [
  { id: 1, labelAr: 'الخرطوم', labelEn: 'Khartoum' },
  { id: 2, labelAr: 'الجزيرة', labelEn: 'Gezira' },
  { id: 3, labelAr: 'البحر الأحمر', labelEn: 'Red Sea' },
  { id: 4, labelAr: 'كسلا', labelEn: 'Kassala' },
  { id: 5, labelAr: 'القضارف', labelEn: 'Al Qadarif' },
  { id: 6, labelAr: 'سنار', labelEn: 'Sennar' },
  { id: 7, labelAr: 'النيل الأزرق', labelEn: 'Blue Nile' },
  { id: 8, labelAr: 'النيل الأبيض', labelEn: 'White Nile' },
  { id: 9, labelAr: 'نهر النيل', labelEn: 'River Nile' },
  { id: 10, labelAr: 'الشمالية', labelEn: 'Northern' },
  { id: 11, labelAr: 'غرب كردفان', labelEn: 'West Kordofan' },
  { id: 12, labelAr: 'شمال كردفان', labelEn: 'North Kordofan' },
  { id: 13, labelAr: 'جنوب كردفان', labelEn: 'South Kordofan' },
  { id: 14, labelAr: 'شمال دارفور', labelEn: 'North Darfur' },
  { id: 15, labelAr: 'غرب دارفور', labelEn: 'West Darfur' },
  { id: 16, labelAr: 'جنوب دارفور', labelEn: 'South Darfur' },
  { id: 17, labelAr: 'شرق دارفور', labelEn: 'East Darfur' },
  { id: 18, labelAr: 'وسط دارفور', labelEn: 'Central Darfur' }
];

export default function App() {
  const { t, i18n } = useTranslation();
  const [user, setUser] = useState(null);
  const [view, setView] = useState('portal'); // 'portal', 'login', 'dashboard'
  const [lang, setLang] = useState('ar');
  const [theme, setTheme] = useState('dark');

  // Load state on mount
  useEffect(() => {
    const savedUser = localStorage.getItem('cms_user');
    const savedToken = localStorage.getItem('cms_token');
    const savedTheme = localStorage.getItem('cms_theme') || 'dark';

    if (savedUser && savedToken) {
      setUser(JSON.parse(savedUser));
      setView('dashboard');
    }
    setTheme(savedTheme);
    document.documentElement.setAttribute('data-theme', savedTheme);

    // Default to Arabic/RTL
    const currentLang = i18n.language || 'ar';
    setLang(currentLang);
    document.documentElement.dir = currentLang === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = currentLang;
  }, [i18n.language]);

  const toggleLanguage = () => {
    const nextLang = lang === 'ar' ? 'en' : 'ar';
    i18n.changeLanguage(nextLang);
    setLang(nextLang);
    document.documentElement.dir = nextLang === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = nextLang;
  };

  const toggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    localStorage.setItem('cms_theme', nextTheme);
    document.documentElement.setAttribute('data-theme', nextTheme);
  };

  const handleLogin = (userData, token) => {
    localStorage.setItem('cms_user', JSON.stringify(userData));
    localStorage.setItem('cms_token', token);
    setUser(userData);
    setView('dashboard');
  };

  const handleLogout = () => {
    localStorage.removeItem('cms_user');
    localStorage.removeItem('cms_token');
    setUser(null);
    setView('portal');
  };

  return (
    <div className="app-layout">
      {/* Global Navbar */}
      <header className="nav-header no-print-section">
        <div className="brand-section">
          <HeartPulse className="logo-icon" size={28} />
          <span className="brand-title">{t('brandName')}</span>
        </div>
        <div className="header-actions">
          <button className="lang-toggle-btn" onClick={toggleLanguage}>
            {lang === 'ar' ? 'English' : 'العربية'}
          </button>
          <button className="lang-toggle-btn" style={{ padding: '0.5rem' }} onClick={toggleTheme}>
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>

          {user ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <NotificationDropdown userId={user?.id} lang={lang} />
              <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                {user.username} ({user.role})
              </span>
              <button className="btn btn-secondary" onClick={handleLogout}>
                <LogOut size={16} />
                {t('logout')}
              </button>
            </div>
          ) : (
            view === 'portal' ? (
              <button className="btn btn-primary" onClick={() => setView('login')}>
                <Lock size={16} />
                {t('login')}
              </button>
            ) : (
              <button className="btn btn-secondary" onClick={() => setView('portal')}>
                {t('patientPortal')}
              </button>
            )
          )}
        </div>
      </header>

      {/* Main Container */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {view === 'portal' && <PatientPortal lang={lang} t={t} />}
        {view === 'login' && <LoginView onLogin={handleLogin} t={t} />}
        {view === 'dashboard' && user && (
          <DashboardContainer user={user} lang={lang} t={t} onLogout={handleLogout} />
        )}
      </main>
    </div>
  );
}

/* ==========================================
   PATIENT PUBLIC BOOKING PORTAL
   ========================================== */
function PatientPortal({ lang, t }) {
  const [step, setStep] = useState(1);
  const [specialty, setSpecialty] = useState('');
  const [allDoctors, setAllDoctors] = useState([]);
  const [specialties, setSpecialties] = useState([]);
  const [selectedDoctor, setSelectedDoctor] = useState(null);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [availableSlots, setAvailableSlots] = useState([]);
  const [selectedSlot, setSelectedSlot] = useState('');

  // Form states
  const [fullNameAr, setFullNameAr] = useState('');
  const [fullNameEn, setFullNameEn] = useState('');
  const [gender, setGender] = useState('MALE');
  const [dob, setDob] = useState('');
  const [phone, setPhone] = useState('');
  const [nationalId, setNationalId] = useState('');
  const [stateId, setStateId] = useState('1');

  // Security/OTP
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [ticketDetails, setTicketDetails] = useState(null);

  // Fetch all doctors and extract unique specialties dynamically
  useEffect(() => {
    fetch('/api/appointments/doctors')
      .then((res) => res.json())
      .then((data) => {
        setAllDoctors(data);
        const uniqueSpecsMap = {};
        data.forEach((d) => {
          const key = d.specialtyEn || d.specialtyAr;
          if (key && !uniqueSpecsMap[key]) {
            uniqueSpecsMap[key] = {
              key: key,
              ar: d.specialtyAr || d.specialtyEn,
              en: d.specialtyEn || d.specialtyAr
            };
          }
        });
        setSpecialties(Object.values(uniqueSpecsMap));
      })
      .catch((err) => console.error(err));
  }, []);

  const doctors = allDoctors.filter(
    (d) => d.specialtyEn === specialty || d.specialtyAr === specialty
  );

  // Fetch available slots when doctor and date are selected
  useEffect(() => {
    if (selectedDoctor && selectedDate) {
      fetch(`/api/appointments/slots?doctorId=${selectedDoctor.id}&date=${selectedDate}`)
        .then((res) => res.json())
        .then((data) => {
          setAvailableSlots(data);
        })
        .catch((err) => console.error(err));
    }
  }, [selectedDoctor, selectedDate]);

  const handleSendOtp = async () => {
    if (!fullNameAr || !fullNameEn || !phone || !dob) {
      setErrorMsg(t('requiredField'));
      return;
    }
    // Simple Sudanese phone regex validation: start with 09 or 01, 10 digits
    const phoneRegex = /^(09|01)\d{8}$/;
    if (!phoneRegex.test(phone)) {
      setErrorMsg(
        lang === 'ar'
          ? 'رقم الهاتف غير صالح، يجب أن يتكون من 10 أرقام ويبدأ بـ 09 أو 01'
          : 'Invalid phone number. Must be 10 digits starting with 09 or 01'
      );
      return;
    }

    try {
      const res = await fetch('/api/appointments/otp/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone })
      });
      if (res.ok) {
        setOtpSent(true);
        setErrorMsg('');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleBookAppointment = async () => {
    if (otpCode !== '1234') {
      setErrorMsg(
        lang === 'ar'
          ? 'رمز التحقق غير صحيح، يرجى المحاولة مرة أخرى (استخدم الرمز 1234 للترخيص)'
          : 'Incorrect verification code, please try again (Use code 1234 for verification)'
      );
      return;
    }

    try {
      const res = await fetch('/api/appointments/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          doctorId: selectedDoctor.id,
          appointmentDate: selectedDate,
          appointmentTime: selectedSlot,
          fullNameAr,
          fullNameEn,
          gender,
          dateOfBirth: dob,
          nationalId: nationalId || undefined,
          phone,
          addressStateId: parseInt(stateId),
          otpCode
        })
      });

      const data = await res.json();
      if (res.ok) {
        setTicketDetails(data);
        setStep(6);
      } else {
        setErrorMsg(data.error || 'Booking failed.');
      }
    } catch (err) {
      console.error(err);
      setErrorMsg('Failed to connect to the server.');
    }
  };

  return (
    <div className="portal-container glass-panel">
      <h2 style={{ textAlign: 'center', marginBottom: '1.5rem' }}>{t('bookAppointment')}</h2>

      {/* Progress nodes bar */}
      <div className="wizard-steps no-print-section">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div
            key={i}
            className={`step-node ${step === i ? 'active' : step > i ? 'completed' : ''}`}
          >
            {i}
          </div>
        ))}
      </div>

      {errorMsg && (
        <div
          className="badge badge-danger"
          style={{ width: '100%', padding: '0.75rem', marginBottom: '1.5rem', fontSize: '0.9rem' }}
        >
          <AlertTriangle size={16} style={{ marginInlineEnd: '0.5rem' }} />
          {errorMsg}
        </div>
      )}

      {/* STEP 1: SELECT SPECIALTY */}
      {step === 1 && (
        <div>
          <h3 style={{ marginBottom: '1rem' }}>{t('selectSpecialty')}</h3>
          <div className="grid-cards">
            {specialties.map((spec) => (
              <div
                key={spec.key}
                className={`card-item glass-panel ${specialty === spec.key ? 'selected' : ''}`}
                onClick={() => {
                  setSpecialty(spec.key);
                  setStep(2);
                }}
              >
                <Stethoscope size={36} color="var(--primary)" style={{ marginBottom: '0.5rem' }} />
                <h4>{lang === 'ar' ? spec.ar : spec.en}</h4>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* STEP 2: SELECT DOCTOR & ROSTER DATE */}
      {step === 2 && (
        <div>
          <h3 style={{ marginBottom: '1rem' }}>{t('selectDoctor')}</h3>
          {doctors.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem' }}>
              <AlertCircle size={48} color="var(--text-muted)" style={{ marginBottom: '1rem' }} />
              <p>{lang === 'ar' ? 'لا يوجد أطباء متاحون في هذا التخصص حالياً.' : 'No doctors are currently available in this specialty.'}</p>
              <button className="btn btn-secondary" onClick={() => setStep(1)} style={{ marginTop: '1rem' }}>
                {lang === 'ar' ? 'الرجوع للخلف' : 'Go Back'}
              </button>
            </div>
          ) : (
            <div>
              {doctors.map((doc) => (
                <div
                  key={doc.id}
                  className={`doctor-item-card glass-panel ${selectedDoctor?.id === doc.id ? 'selected' : ''}`}
                  onClick={() => setSelectedDoctor(doc)}
                >
                  <div>
                    <h4>{lang === 'ar' ? doc.fullNameAr : doc.fullNameEn}</h4>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                      {lang === 'ar' ? doc.specialtyAr : doc.specialtyEn}
                    </p>
                  </div>
                  <div style={{ textAlign: 'end' }}>
                    <span style={{ fontWeight: 'bold', color: 'var(--primary)' }}>
                      {parseFloat(doc.consultationFee).toLocaleString()} SDG
                    </span>
                  </div>
                </div>
              ))}

              {selectedDoctor && (
                <div className="form-group" style={{ marginTop: '1.5rem' }}>
                  <label className="form-label">{t('selectDate')}</label>
                  <input
                    type="date"
                    className="form-input"
                    value={selectedDate}
                    min={new Date().toISOString().split('T')[0]}
                    onChange={(e) => setSelectedDate(e.target.value)}
                  />
                </div>
              )}

              <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem' }}>
                <button className="btn btn-secondary" onClick={() => setStep(1)}>
                  {lang === 'ar' ? 'السابق' : 'Previous'}
                </button>
                <button
                  className="btn btn-primary"
                  disabled={!selectedDoctor || !selectedDate}
                  onClick={() => setStep(3)}
                >
                  {lang === 'ar' ? 'التالي' : 'Next'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* STEP 3: SELECT TIME SLOT */}
      {step === 3 && (
        <div>
          <h3 style={{ marginBottom: '1rem' }}>{t('selectTime')}</h3>
          {availableSlots.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem' }}>
              <Clock size={48} color="var(--text-muted)" style={{ marginBottom: '1rem' }} />
              <p>{lang === 'ar' ? 'لا توجد مواعيد متاحة في هذا اليوم. يرجى اختيار تاريخ آخر.' : 'No slots available on this date. Please select another date.'}</p>
              <button className="btn btn-secondary" onClick={() => setStep(2)} style={{ marginTop: '1rem' }}>
                {lang === 'ar' ? 'تغيير التاريخ' : 'Change Date'}
              </button>
            </div>
          ) : (
            <div>
              <div className="slots-grid">
                {availableSlots.map((slot) => (
                  <button
                    key={slot}
                    className={`slot-btn ${selectedSlot === slot ? 'selected' : ''}`}
                    onClick={() => setSelectedSlot(slot)}
                  >
                    {slot}
                  </button>
                ))}
              </div>

              <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem' }}>
                <button className="btn btn-secondary" onClick={() => setStep(2)}>
                  {lang === 'ar' ? 'السابق' : 'Previous'}
                </button>
                <button
                  className="btn btn-primary"
                  disabled={!selectedSlot}
                  onClick={() => setStep(4)}
                >
                  {lang === 'ar' ? 'التالي' : 'Next'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* STEP 4: PATIENT DEMOGRAPHICS */}
      {step === 4 && (
        <div>
          <h3 style={{ marginBottom: '1.5rem' }}>{lang === 'ar' ? 'أدخل معلومات المريض' : 'Enter Patient Information'}</h3>
          <div className="form-row-2col" style={{ marginTop: 0 }}>
            <div className="form-group">
              <label className="form-label">{t('fullNameAr')} *</label>
              <input
                type="text"
                className="form-input"
                required
                value={fullNameAr}
                onChange={(e) => setFullNameAr(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">{t('fullNameEn')} *</label>
              <input
                type="text"
                className="form-input"
                required
                value={fullNameEn}
                onChange={(e) => setFullNameEn(e.target.value)}
              />
            </div>
          </div>

          <div className="form-row-2col">
            <div className="form-group">
              <label className="form-label">{t('gender')} *</label>
              <select className="form-input" value={gender} onChange={(e) => setGender(e.target.value)}>
                <option value="MALE">{t('male')}</option>
                <option value="FEMALE">{t('female')}</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">{lang === 'ar' ? 'تاريخ الميلاد' : 'Date of Birth'} *</label>
              <input
                type="date"
                className="form-input"
                required
                value={dob}
                onChange={(e) => setDob(e.target.value)}
              />
            </div>
          </div>

          <div className="form-row-2col">
            <div className="form-group">
              <label className="form-label">{t('phone')} *</label>
              <input
                type="tel"
                placeholder="0912345678"
                className="form-input"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">{t('nationalId')}</label>
              <input
                type="text"
                maxLength={11}
                className="form-input"
                value={nationalId}
                onChange={(e) => setNationalId(e.target.value)}
              />
            </div>
          </div>

          <div className="form-group" style={{ marginTop: '1rem' }}>
            <label className="form-label">{t('addressState')} *</label>
            <select className="form-input" value={stateId} onChange={(e) => setStateId(e.target.value)}>
              {SUDANESE_STATES.map((st) => (
                <option key={st.id} value={st.id}>
                  {lang === 'ar' ? st.labelAr : st.labelEn}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', gap: '1rem', marginTop: '2rem' }}>
            <button className="btn btn-secondary" onClick={() => setStep(3)}>
              {lang === 'ar' ? 'السابق' : 'Previous'}
            </button>
            <button className="btn btn-primary" onClick={handleSendOtp}>
              {lang === 'ar' ? 'إرسال رمز التحقق (OTP)' : 'Send Verification OTP'}
            </button>
          </div>
        </div>
      )}

      {/* STEP 5: OTP VERIFICATION */}
      {step === 4 && otpSent && (
        <div className="modal-overlay">
          <div className="modal-content-panel glass-panel">
            <h3>{t('enterOtp')}</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              {lang === 'ar' ? 'تم إرسال رمز تحقق مؤقت إلى هاتفك. أدخل الرمز (1234) للتجربة.' : 'A mock verification code has been sent. Enter (1234) to confirm.'}
            </p>
            <div className="form-group">
              <input
                type="text"
                placeholder="XXXX"
                className="form-input"
                style={{ textAlign: 'center', fontSize: '1.5rem', letterSpacing: '0.5rem' }}
                maxLength={4}
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value)}
              />
            </div>
            <div style={{ display: 'flex', gap: '1rem' }}>
              <button className="btn btn-secondary" onClick={() => setOtpSent(false)}>
                {lang === 'ar' ? 'إلغاء' : 'Cancel'}
              </button>
              <button className="btn btn-primary" onClick={handleBookAppointment}>
                {t('verify')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* STEP 6: CONFIRMATION TICKET */}
      {step === 6 && ticketDetails && (
        <div style={{ textAlign: 'center', padding: '1.5rem' }}>
          <CheckCircle size={64} color="var(--primary)" style={{ marginBottom: '1.5rem' }} />
          <h3 style={{ color: 'var(--primary)', marginBottom: '1rem' }}>{t('bookingSuccess')}</h3>

          {/* Printable Ticket */}
          <div className="receipt-box glass-panel" style={{ maxWidth: '400px', margin: '2rem auto', padding: '1.5rem', textAlign: 'start' }}>
            <h4 style={{ textAlign: 'center', marginBottom: '1rem', borderBottom: '1px dashed var(--border-color)', paddingBottom: '0.5rem' }}>
              {lang === 'ar' ? 'تذكرة تأكيد الموعد' : 'Appointment Booking Ticket'}
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.9rem' }}>
              <div>
                <strong>{lang === 'ar' ? 'اسم المريض:' : 'Patient Name:'}</strong>{' '}
                {lang === 'ar' ? ticketDetails.patient?.fullNameAr : ticketDetails.patient?.fullNameEn}
              </div>
              <div>
                <strong>{lang === 'ar' ? 'الطبيب المعالج:' : 'Doctor:'}</strong>{' '}
                {lang === 'ar' ? ticketDetails.doctor?.fullNameAr : ticketDetails.doctor?.fullNameEn}
              </div>
              <div>
                <strong>{lang === 'ar' ? 'تاريخ الكشف:' : 'Date:'}</strong> {ticketDetails.appointmentDate}
              </div>
              <div>
                <strong>{lang === 'ar' ? 'حالة الموعد:' : 'Booking Status:'}</strong>{' '}
                <span className="badge badge-warning" style={{ fontWeight: 'bold' }}>
                  {lang === 'ar' ? 'قيد المراجعة والتأكيد (PENDING)' : 'Pending Reception Approval'}
                </span>
              </div>
              <div style={{ borderTop: '1px dashed var(--border-color)', paddingTop: '0.75rem', marginTop: '0.5rem', textAlign: 'center' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{t('ticketNo')}</span>
                <h2 style={{ color: 'var(--primary)', margin: '0.25rem 0' }}>#{ticketDetails.id.substring(0, 8).toUpperCase()}</h2>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }} className="no-print-section">
            {ticketDetails.whatsAppLinkAr && (
              <a
                href={ticketDetails.whatsAppLinkAr}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-whatsapp"
              >
                <MessageCircle size={16} />
                {lang === 'ar' ? 'إرسال تفاصيل الموعد عبر الواتساب' : 'Send WhatsApp Confirmation Request'}
              </a>
            )}
            <button className="btn btn-secondary" onClick={() => window.print()}>
              <Download size={16} />
              {t('printTicket')}
            </button>
            <button
              className="btn btn-primary"
              onClick={() => {
                setStep(1);
                setSpecialty('');
                setSelectedDoctor(null);
                setSelectedDate('');
                setSelectedSlot('');
                setFullNameAr('');
                setFullNameEn('');
                setPhone('');
                setOtpCode('');
                setOtpSent(false);
              }}
            >
              {lang === 'ar' ? 'حجز موعد آخر' : 'Book Another'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ==========================================
   LOGIN MODULE
   ========================================== */
function LoginView({ onLogin, t }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (res.ok) {
        onLogin(data.user, data.token);
      } else {
        setErrorMsg(data.error || 'Login failed.');
      }
    } catch (err) {
      console.error(err);
      setErrorMsg('Cannot connect to authorization service.');
    }
  };

  return (
    <div className="portal-container glass-panel" style={{ maxWidth: '450px' }}>
      <h3 style={{ textAlign: 'center', marginBottom: '2rem' }}>{t('login')}</h3>
      {errorMsg && (
        <div className="badge badge-danger" style={{ width: '100%', padding: '0.75rem', marginBottom: '1rem' }}>
          {errorMsg}
        </div>
      )}
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        <div className="form-group">
          <label className="form-label">{t('username')}</label>
          <input
            type="email"
            required
            className="form-input"
            placeholder="staff@cms.com"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </div>
        <div className="form-group">
          <label className="form-label">{t('password')}</label>
          <input
            type="password"
            required
            className="form-input"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '1rem' }}>
          {t('login')}
        </button>
      </form>
    </div>
  );
}

/* ==========================================
   ROLE DASHBOARDS CONTAINER
   ========================================== */
function DashboardContainer({ user, lang, t, onLogout }) {
  if (user.role === 'ADMIN') {
    return <AdminDashboard lang={lang} t={t} />;
  }
  if (user.role === 'RECEPTIONIST') {
    return <ReceptionistDashboard lang={lang} t={t} />;
  }
  if (user.role === 'DOCTOR') {
    return <DoctorDashboard user={user} lang={lang} t={t} />;
  }
  if (user.role === 'PHARMACIST') {
    return <PharmacistDashboard lang={lang} t={t} />;
  }
  if (user.role === 'LAB_TECH') {
    return <LabTechDashboard lang={lang} t={t} />;
  }
  return (
    <div style={{ padding: '3rem', textAlign: 'center' }}>
      <h3>Unknown User Role. Contact administrator.</h3>
    </div>
  );
}

/* ==========================================
   1. ADMIN DASHBOARD
   ========================================== */
function AdminDashboard({ lang, t }) {
  const [activeTab, setActiveTab] = useState('profile');
  const [logs, setLogs] = useState([]);
  const [users, setUsers] = useState([]);
  const [analyticsData, setAnalyticsData] = useState(null);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);
  const [analyticsError, setAnalyticsError] = useState('');

  const [config, setConfig] = useState({
    clinicNameAr: 'نظام الشفاء الطبي',
    clinicNameEn: 'Al-Shifa Medical CMS',
    vatPercent: 15,
    stampDutySdg: 500,
    exchangeRate: 1500
  });

  // User form states
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState('RECEPTIONIST');
  const [newFullNameAr, setNewFullNameAr] = useState('');
  const [newFullNameEn, setNewFullNameEn] = useState('');
  const [newSpecialtyAr, setNewSpecialtyAr] = useState('طب عام');
  const [newSpecialtyEn, setNewSpecialtyEn] = useState('General Medicine');
  const [newConsultationFee, setNewConsultationFee] = useState('20000');
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Fetch users & logs on tab switch
  useEffect(() => {
    if (activeTab === 'logs') {
      fetchWithAuth('/api/auth/audit-logs')
        .then((res) => res.ok ? res.json() : [])
        .then((data) => setLogs(Array.isArray(data) ? data : []))
        .catch((err) => {
          console.error(err);
          setLogs([]);
        });
    }
    if (activeTab === 'users') {
      fetchWithAuth('/api/auth/users')
        .then((res) => res.ok ? res.json() : [])
        .then((data) => setUsers(Array.isArray(data) ? data : []))
        .catch((err) => {
          console.error(err);
          setUsers([]);
        });
    }
    if (activeTab === 'analytics') {
      setLoadingAnalytics(true);
      setAnalyticsError('');
      fetchWithAuth('/api/admin/analytics')
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to fetch analytics`);
          return res.json();
        })
        .then((data) => {
          setAnalyticsData(data);
          setLoadingAnalytics(false);
        })
        .catch((err) => {
          console.error('Analytics fetch error:', err);
          setAnalyticsError(err.message || 'Failed to fetch analytics');
          setAnalyticsData(null);
          setLoadingAnalytics(false);
        });
    }
  }, [activeTab]);

  const handleCreateUser = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const res = await fetchWithAuth('/api/auth/users', {
        method: 'POST',
        body: JSON.stringify({
          username: newUsername,
          password: newPassword,
          role: newRole,
          fullNameAr: newFullNameAr,
          fullNameEn: newFullNameEn,
          specialtyAr: newSpecialtyAr,
          specialtyEn: newSpecialtyEn,
          consultationFee: newConsultationFee
        })
      });
      const data = await res.json();
      if (res.ok) {
        setSuccessMsg(lang === 'ar' ? 'تم إنشاء حساب الموظف بنجاح' : 'Staff account created successfully.');
        setNewUsername('');
        setNewPassword('');
        setNewFullNameAr('');
        setNewFullNameEn('');
        setNewSpecialtyAr('طب عام');
        setNewSpecialtyEn('General Medicine');
        setNewConsultationFee('20000');
        // Reload list
        fetchWithAuth('/api/auth/users')
          .then((r) => r.json())
          .then((d) => setUsers(d));
      } else {
        setErrorMsg(data.error || 'Failed to create user.');
      }
    } catch (err) {
      console.error(err);
      setErrorMsg('Failed to connect to the backend server.');
    }
  };

  const handleToggleUserStatus = async (userId, currentStatus) => {
    const nextStatus = currentStatus === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    try {
      const res = await fetchWithAuth(`/api/auth/users/${userId}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status: nextStatus })
      });
      if (res.ok) {
        setUsers(
          users.map((u) => (u.id === userId ? { ...u, status: nextStatus } : u))
        );
      }
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="dashboard-wrapper">
      {/* Side menu */}
      <aside className="sidebar-menu no-print-section">
        <div className="menu-items">
          <button
            className={`menu-btn ${activeTab === 'profile' ? 'active' : ''}`}
            onClick={() => setActiveTab('profile')}
          >
            <Building size={18} />
            {lang === 'ar' ? 'الملف التعريفي للعيادة' : 'Clinic Profile'}
          </button>
          <button
            className={`menu-btn ${activeTab === 'users' ? 'active' : ''}`}
            onClick={() => setActiveTab('users')}
          >
            <Users size={18} />
            {lang === 'ar' ? 'حسابات الموظفين' : 'Staff Accounts'}
          </button>
          <button
            className={`menu-btn ${activeTab === 'analytics' ? 'active' : ''}`}
            onClick={() => setActiveTab('analytics')}
          >
            <Activity size={18} />
            {lang === 'ar' ? 'التقارير والتحليلات' : 'Reports & Analytics'}
          </button>
          <button
            className={`menu-btn ${activeTab === 'logs' ? 'active' : ''}`}
            onClick={() => setActiveTab('logs')}
          >
            <Sliders size={18} />
            {lang === 'ar' ? 'سجلات تدقيق الأمان' : 'Security Audit Logs'}
          </button>
        </div>
      </aside>

      {/* Main Panel Content */}
      <div className="workspace-panel">
        {activeTab === 'profile' && (
          <div className="glass-panel" style={{ padding: '2rem' }}>
            <h3 style={{ marginBottom: '1.5rem' }}>{lang === 'ar' ? 'إعدادات العيادة العامة' : 'Clinic Global Settings'}</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
              <div className="form-group">
                <label className="form-label">{lang === 'ar' ? 'اسم العيادة (عربي)' : 'Clinic Name (Arabic)'}</label>
                <input
                  type="text"
                  className="form-input"
                  value={config.clinicNameAr}
                  onChange={(e) => setConfig({ ...config, clinicNameAr: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">{lang === 'ar' ? 'اسم العيادة (إنجليزي)' : 'Clinic Name (English)'}</label>
                <input
                  type="text"
                  className="form-input"
                  value={config.clinicNameEn}
                  onChange={(e) => setConfig({ ...config, clinicNameEn: e.target.value })}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1.5rem', marginTop: '1.5rem' }}>
              <div className="form-group">
                <label className="form-label">{lang === 'ar' ? 'نسبة ضريبة القيمة المضافة (%)' : 'VAT Percentage (%)'}</label>
                <input
                  type="number"
                  className="form-input"
                  value={config.vatPercent}
                  onChange={(e) => setConfig({ ...config, vatPercent: parseFloat(e.target.value) })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">{lang === 'ar' ? 'قيمة دمغة الشهادة (SDG)' : 'Stamp Duty (SDG)'}</label>
                <input
                  type="number"
                  className="form-input"
                  value={config.stampDutySdg}
                  onChange={(e) => setConfig({ ...config, stampDutySdg: parseFloat(e.target.value) })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">{lang === 'ar' ? 'سعر صرف الدولار (1 USD = X SDG)' : 'Exchange Rate (1 USD = X SDG)'}</label>
                <input
                  type="number"
                  className="form-input"
                  value={config.exchangeRate}
                  onChange={(e) => setConfig({ ...config, exchangeRate: parseFloat(e.target.value) })}
                />
              </div>
            </div>

            <button className="btn btn-primary" style={{ marginTop: '2rem' }}>
              {lang === 'ar' ? 'حفظ التعديلات' : 'Save Configurations'}
            </button>
          </div>
        )}

        {activeTab === 'users' && (
          <div style={{ display: 'grid', gridTemplateColumns: '350px 1fr', gap: '2rem' }}>
            <div className="glass-panel" style={{ padding: '1.5rem' }}>
              <h4 style={{ marginBottom: '1.5rem' }}>{lang === 'ar' ? 'إضافة موظف جديد' : 'Add New Staff'}</h4>
              {errorMsg && <div className="badge badge-danger" style={{ width: '100%', marginBottom: '1rem', padding: '0.5rem' }}>{errorMsg}</div>}
              {successMsg && <div className="badge badge-success" style={{ width: '100%', marginBottom: '1rem', padding: '0.5rem' }}>{successMsg}</div>}

              <form onSubmit={handleCreateUser} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div className="form-group">
                  <label className="form-label">{t('username')}</label>
                  <input
                    type="email"
                    required
                    placeholder="staff@cms.com"
                    className="form-input"
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">{t('password')}</label>
                  <input
                    type="password"
                    required
                    placeholder="••••••••"
                    className="form-input"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">{lang === 'ar' ? 'الدور الوظيفي' : 'Role'}</label>
                  <select className="form-input" value={newRole} onChange={(e) => setNewRole(e.target.value)}>
                    <option value="ADMIN">ADMIN</option>
                    <option value="RECEPTIONIST">RECEPTIONIST</option>
                    <option value="DOCTOR">DOCTOR</option>
                    <option value="PHARMACIST">PHARMACIST</option>
                    <option value="LAB_TECH">LAB_TECH</option>
                  </select>
                </div>
                {newRole === 'DOCTOR' && (
                  <>
                    <div className="form-group">
                      <label className="form-label">{lang === 'ar' ? 'الاسم الكامل (عربي)' : 'Full Name (Arabic)'}</label>
                      <input
                        type="text"
                        required
                        placeholder={lang === 'ar' ? 'د. محمد أحمد' : 'Dr. Mohamed Ahmed'}
                        className="form-input"
                        value={newFullNameAr}
                        onChange={(e) => setNewFullNameAr(e.target.value)}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">{lang === 'ar' ? 'الاسم الكامل (إنجليزي)' : 'Full Name (English)'}</label>
                      <input
                        type="text"
                        required
                        placeholder="Dr. Mohamed Ahmed"
                        className="form-input"
                        value={newFullNameEn}
                        onChange={(e) => setNewFullNameEn(e.target.value)}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">{lang === 'ar' ? 'التخصص (عربي)' : 'Specialty (Arabic)'}</label>
                      <input
                        type="text"
                        required
                        className="form-input"
                        value={newSpecialtyAr}
                        onChange={(e) => setNewSpecialtyAr(e.target.value)}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">{lang === 'ar' ? 'التخصص (إنجليزي)' : 'Specialty (English)'}</label>
                      <input
                        type="text"
                        required
                        className="form-input"
                        value={newSpecialtyEn}
                        onChange={(e) => setNewSpecialtyEn(e.target.value)}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">{lang === 'ar' ? 'رسوم الكشف (جنيه سوداني)' : 'Consultation Fee (SDG)'}</label>
                      <input
                        type="number"
                        required
                        className="form-input"
                        value={newConsultationFee}
                        onChange={(e) => setNewConsultationFee(e.target.value)}
                      />
                    </div>
                  </>
                )}
                <button type="submit" className="btn btn-primary" style={{ marginTop: '1rem' }}>
                  {lang === 'ar' ? 'إنشاء الحساب' : 'Create Account'}
                </button>
              </form>
            </div>

            <div className="glass-panel" style={{ padding: '1.5rem' }}>
              <h4 style={{ marginBottom: '1.5rem' }}>{lang === 'ar' ? 'سجل موظفي النظام' : 'Staff Directory'}</h4>
              <table className="staff-table">
                <thead>
                  <tr>
                    <th>{t('username')}</th>
                    <th>{lang === 'ar' ? 'الدور' : 'Role'}</th>
                    <th>{lang === 'ar' ? 'الحالة' : 'Status'}</th>
                    <th>{lang === 'ar' ? 'إجراءات' : 'Actions'}</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td>{u.username}</td>
                      <td>
                        <span className="badge badge-success" style={{ fontSize: '0.8rem' }}>{u.role}</span>
                      </td>
                      <td>
                        <span className={`badge ${u.status === 'ACTIVE' ? 'badge-success' : 'badge-danger'}`}>
                          {u.status}
                        </span>
                      </td>
                      <td>
                        <button
                          className={`btn ${u.status === 'ACTIVE' ? 'btn-danger' : 'btn-primary'}`}
                          style={{ padding: '4px 8px', fontSize: '0.8rem' }}
                          onClick={() => handleToggleUserStatus(u.id, u.status)}
                        >
                          {u.status === 'ACTIVE' ? (lang === 'ar' ? 'تعطيل' : 'Deactivate') : (lang === 'ar' ? 'تفعيل' : 'Activate')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'analytics' && (
          <div className="glass-panel" style={{ padding: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.75rem' }}>
              <div>
                <h3 style={{ margin: 0, color: 'var(--primary)' }}>
                  {lang === 'ar' ? 'لوحة تحليلات وإحصائيات العيادة' : 'Clinic Operational & Analytics Dashboard'}
                </h3>
                <p style={{ margin: 0, fontSize: '0.85rem', opacity: 0.75 }}>
                  {lang === 'ar' ? 'مؤشرات الأداء الرئيسية والتحليلات التشغيلية' : 'Real-time Key Performance Indicators & Clinical Overview'}
                </p>
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ fontSize: '0.8rem', padding: '6px 12px', display: 'flex', alignItems: 'center', gap: '4px' }}
                onClick={() => {
                  setLoadingAnalytics(true);
                  fetchWithAuth('/api/admin/analytics')
                    .then((r) => r.json())
                    .then((d) => {
                      setAnalyticsData(d);
                      setLoadingAnalytics(false);
                    })
                    .catch(() => setLoadingAnalytics(false));
                }}
              >
                <Activity size={14} />
                {lang === 'ar' ? 'تحديث البيانات' : 'Refresh Metrics'}
              </button>
            </div>

            {loadingAnalytics ? (
              <div style={{ textAlign: 'center', padding: '3rem' }}>
                <div className="spinner" style={{ margin: '0 auto 1rem' }}></div>
                <p>{lang === 'ar' ? 'جاري حساب ومعالجة إحصائيات النظام...' : 'Computing system operational metrics...'}</p>
              </div>
            ) : analyticsError ? (
              <div className="alert alert-error" style={{ textAlign: 'center', padding: '2rem' }}>
                <AlertCircle size={36} style={{ marginBottom: '0.5rem', color: '#ef4444' }} />
                <p>{analyticsError}</p>
              </div>
            ) : analyticsData ? (
              <div>
                {/* 1. KPI Summaries Grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.25rem', marginBottom: '2rem' }}>
                  {/* Card 1: Total Registered Patients */}
                  <div className="glass-card" style={{ padding: '1.25rem', borderRadius: '12px', border: '1px solid var(--border-color)', background: 'rgba(255,255,255,0.04)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.85rem', opacity: 0.75 }}>{lang === 'ar' ? 'إجمالي المرضى المسجلين' : 'Total Patients'}</span>
                      <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: 'rgba(2, 132, 199, 0.15)', color: '#0284c7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Users size={20} />
                      </div>
                    </div>
                    <h2 style={{ fontSize: '1.8rem', fontWeight: 'bold', margin: '0.5rem 0 0', color: '#0284c7' }}>
                      {analyticsData.totalPatients || 0}
                    </h2>
                  </div>

                  {/* Card 2: Monthly Visits */}
                  <div className="glass-card" style={{ padding: '1.25rem', borderRadius: '12px', border: '1px solid var(--border-color)', background: 'rgba(255,255,255,0.04)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.85rem', opacity: 0.75 }}>{lang === 'ar' ? 'زيارات هذا الشهر' : 'Monthly Visits'}</span>
                      <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: 'rgba(13, 148, 136, 0.15)', color: '#0d9488', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Calendar size={20} />
                      </div>
                    </div>
                    <h2 style={{ fontSize: '1.8rem', fontWeight: 'bold', margin: '0.5rem 0 0', color: '#0d9488' }}>
                      {analyticsData.monthlyVisits || 0}
                    </h2>
                  </div>

                  {/* Card 3: Completion Rate */}
                  <div className="glass-card" style={{ padding: '1.25rem', borderRadius: '12px', border: '1px solid var(--border-color)', background: 'rgba(255,255,255,0.04)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.85rem', opacity: 0.75 }}>{lang === 'ar' ? 'نسبة الإنجاز الطبية' : 'Completion Rate'}</span>
                      <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: 'rgba(16, 185, 129, 0.15)', color: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <CheckCircle size={20} />
                      </div>
                    </div>
                    <h2 style={{ fontSize: '1.8rem', fontWeight: 'bold', margin: '0.5rem 0 0', color: '#10b981' }}>
                      {analyticsData.completionRate || 0}%
                    </h2>
                  </div>

                  {/* Card 4: Financial Revenues */}
                  <div className="glass-card" style={{ padding: '1.25rem', borderRadius: '12px', border: '1px solid var(--border-color)', background: 'rgba(255,255,255,0.04)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.85rem', opacity: 0.75 }}>{lang === 'ar' ? 'إجمالي المحصل المالي' : 'Total Revenue'}</span>
                      <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <DollarSign size={20} />
                      </div>
                    </div>
                    <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', margin: '0.5rem 0 0', color: '#f59e0b' }}>
                      {(analyticsData.financials?.totalRevenueSdg || 0).toLocaleString()} <span style={{ fontSize: '0.8rem' }}>SDG</span>
                    </h2>
                  </div>
                </div>

                {/* 2. Visual Charts & Breakdowns Section */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '2rem' }}>
                  {/* Left Column: Doctor Clinical Volume Breakdown */}
                  <div className="glass-card" style={{ padding: '1.25rem', borderRadius: '12px', border: '1px solid var(--border-color)', background: 'rgba(255,255,255,0.03)' }}>
                    <h4 style={{ margin: '0 0 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <Stethoscope size={18} color="var(--primary)" />
                      {lang === 'ar' ? 'عدد الزيارات لكل طبيب' : 'Visits Breakdown per Doctor'}
                    </h4>

                    {!analyticsData.doctorVisits || analyticsData.doctorVisits.length === 0 ? (
                      <p style={{ opacity: 0.6, fontSize: '0.9rem' }}>{lang === 'ar' ? 'لا يوجد سجلات زيارات للأطباء بعد.' : 'No doctor visit logs recorded yet.'}</p>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        {analyticsData.doctorVisits.map((doc) => {
                          const maxVisits = Math.max(...analyticsData.doctorVisits.map((d) => d.visitsCount), 1);
                          const pct = Math.round((doc.visitsCount / maxVisits) * 100);
                          return (
                            <div key={doc.doctorId || doc.fullNameEn}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.3rem' }}>
                                <strong>
                                  {lang === 'ar' ? doc.fullNameAr : doc.fullNameEn}{' '}
                                  <span style={{ fontWeight: 'normal', opacity: 0.7 }}>({lang === 'ar' ? doc.specialtyAr : doc.specialtyEn})</span>
                                </strong>
                                <span className="badge badge-info">
                                  {doc.visitsCount} {lang === 'ar' ? 'زيارة' : 'visits'}
                                </span>
                              </div>
                              <div style={{ width: '100%', height: '8px', background: 'rgba(255,255,255,0.08)', borderRadius: '4px', overflow: 'hidden' }}>
                                <div style={{ width: `${pct}%`, height: '100%', background: 'linear-gradient(90deg, #0284c7, #0d9488)', borderRadius: '4px', transition: 'width 0.3s ease' }}></div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Right Column: Appointment Status Distribution */}
                  <div className="glass-card" style={{ padding: '1.25rem', borderRadius: '12px', border: '1px solid var(--border-color)', background: 'rgba(255,255,255,0.03)' }}>
                    <h4 style={{ margin: '0 0 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <Activity size={18} color="var(--success)" />
                      {lang === 'ar' ? 'توزيع حالات الحجوزات والمواعيد' : 'Appointment Status Distribution'}
                    </h4>

                    {analyticsData.statusBreakdown && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', fontSize: '0.85rem' }}>
                        {/* Completed */}
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.2rem' }}>
                            <span>{lang === 'ar' ? 'الحالات المنجزة (Completed)' : 'Completed'}</span>
                            <span style={{ fontWeight: 'bold', color: '#10b981' }}>{analyticsData.statusBreakdown.completed}</span>
                          </div>
                          <div style={{ width: '100%', height: '6px', background: 'rgba(255,255,255,0.08)', borderRadius: '3px' }}>
                            <div
                              style={{
                                width: `${analyticsData.totalAppointments > 0 ? Math.round((analyticsData.statusBreakdown.completed / analyticsData.totalAppointments) * 100) : 0}%`,
                                height: '100%',
                                background: '#10b981',
                                borderRadius: '3px'
                              }}
                            ></div>
                          </div>
                        </div>

                        {/* In Consultation */}
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.2rem' }}>
                            <span>{lang === 'ar' ? 'في غرفة الكشف (In Consultation)' : 'In Consultation'}</span>
                            <span style={{ fontWeight: 'bold', color: '#0284c7' }}>{analyticsData.statusBreakdown.inConsultation}</span>
                          </div>
                          <div style={{ width: '100%', height: '6px', background: 'rgba(255,255,255,0.08)', borderRadius: '3px' }}>
                            <div
                              style={{
                                width: `${analyticsData.totalAppointments > 0 ? Math.round((analyticsData.statusBreakdown.inConsultation / analyticsData.totalAppointments) * 100) : 0}%`,
                                height: '100%',
                                background: '#0284c7',
                                borderRadius: '3px'
                              }}
                            ></div>
                          </div>
                        </div>

                        {/* Waiting Room */}
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.2rem' }}>
                            <span>{lang === 'ar' ? 'صالة الانتظار (Waiting)' : 'Waiting Room'}</span>
                            <span style={{ fontWeight: 'bold', color: '#f59e0b' }}>{analyticsData.statusBreakdown.waiting}</span>
                          </div>
                          <div style={{ width: '100%', height: '6px', background: 'rgba(255,255,255,0.08)', borderRadius: '3px' }}>
                            <div
                              style={{
                                width: `${analyticsData.totalAppointments > 0 ? Math.round((analyticsData.statusBreakdown.waiting / analyticsData.totalAppointments) * 100) : 0}%`,
                                height: '100%',
                                background: '#f59e0b',
                                borderRadius: '3px'
                              }}
                            ></div>
                          </div>
                        </div>

                        {/* Pending Approval */}
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.2rem' }}>
                            <span>{lang === 'ar' ? 'طلبات قيد المراجعة (Pending)' : 'Pending Approvals'}</span>
                            <span style={{ fontWeight: 'bold', color: '#8b5cf6' }}>{analyticsData.statusBreakdown.pending}</span>
                          </div>
                          <div style={{ width: '100%', height: '6px', background: 'rgba(255,255,255,0.08)', borderRadius: '3px' }}>
                            <div
                              style={{
                                width: `${analyticsData.totalAppointments > 0 ? Math.round((analyticsData.statusBreakdown.pending / analyticsData.totalAppointments) * 100) : 0}%`,
                                height: '100%',
                                background: '#8b5cf6',
                                borderRadius: '3px'
                              }}
                            ></div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        )}

        {activeTab === 'logs' && (
          <div className="glass-panel" style={{ padding: '1.5rem' }}>
            <h4 style={{ marginBottom: '1.5rem' }}>{lang === 'ar' ? 'سجل العمليات والتدقيق الأمني' : 'System Activity Audit Log'}</h4>
            <table className="staff-table" style={{ fontSize: '0.85rem' }}>
              <thead>
                <tr>
                  <th>{lang === 'ar' ? 'التاريخ والوقت' : 'Timestamp'}</th>
                  <th>{lang === 'ar' ? 'المستخدم' : 'Actor'}</th>
                  <th>{lang === 'ar' ? 'الحدث' : 'Event Action'}</th>
                  <th>{lang === 'ar' ? 'التفاصيل' : 'Details'}</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => {
                  const isBypass = log.action.startsWith('EMR_BREAK_THE_GLASS_BYPASS');
                  return (
                    <tr key={log.id} style={isBypass ? { background: 'rgba(239, 68, 68, 0.08)' } : {}}>
                      <td>{new Date(log.timestamp).toLocaleString()}</td>
                      <td>{log.userId || 'System'}</td>
                      <td>
                        <span className={`badge ${isBypass ? 'badge-danger' : 'badge-success'}`}>
                          {log.action}
                        </span>
                      </td>
                      <td style={{ color: isBypass ? 'var(--danger)' : 'inherit' }}>{log.details}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* ==========================================
   2. RECEPTIONIST DASHBOARD
   ========================================== */
function ReceptionistDashboard({ lang, t }) {
  const [doctors, setDoctors] = useState([]);
  const [selectedDoctor, setSelectedDoctor] = useState(null);
  const [appointments, setAppointments] = useState([]);
  const [activeTab, setActiveTab] = useState('register'); // 'register', 'billing', 'reconcile'

  // Global search states
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);

  // Registration Form States
  const [fullNameAr, setFullNameAr] = useState('');
  const [fullNameEn, setFullNameEn] = useState('');
  const [gender, setGender] = useState('MALE');
  const [dob, setDob] = useState('');
  const [phone, setPhone] = useState('');
  const [nationalId, setNationalId] = useState('');
  const [addressStateId, setAddressStateId] = useState('1');
  const [addressDetails, setAddressDetails] = useState('');
  const [emergencyContact, setEmergencyContact] = useState('');

  // Selected Patient for Billing
  const [billingPatient, setBillingPatient] = useState(null);
  const [insuranceCompanyId, setInsuranceCompanyId] = useState('');
  const [insuranceCompanies, setInsuranceCompanies] = useState([]);
  const [clinicalServices, setClinicalServices] = useState([]);
  const [addedServices, setAddedServices] = useState([]);

  // Payment Allocation
  const [paymentRows, setPaymentRows] = useState([{ amountSdg: '', paymentMethod: 'CASH', transactionReference: '' }]);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Shift cash ledger
  const [physicalCash, setPhysicalCash] = useState('');
  const [reconcileResult, setReconcileResult] = useState(null);
  const [filterDate, setFilterDate] = useState(new Date().toISOString().split('T')[0]);
  const [activeSummaryId, setActiveSummaryId] = useState(null);
  const [viewingProfilePatientId, setViewingProfilePatientId] = useState(null);

  // Pending Approvals State
  const [pendingAppointments, setPendingAppointments] = useState([]);
  const [queueTab, setQueueTab] = useState('queue'); // 'queue' | 'pending'

  const fetchPendingAppointments = () => {
    fetchWithAuth('/api/appointments/pending')
      .then((res) => res.ok ? res.json() : [])
      .then((data) => setPendingAppointments(Array.isArray(data) ? data : []))
      .catch((err) => console.error('Pending fetch error:', err));
  };

  const handleApproveAppointment = async (appId) => {
    try {
      const res = await fetchWithAuth(`/api/appointments/${appId}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'CONFIRMED' })
      });
      const data = await res.json();
      if (res.ok) {
        setSuccessMsg(lang === 'ar' ? 'تم تأكيد الموعد بنجاح.' : 'Appointment confirmed successfully.');
        fetchPendingAppointments();
        refreshDoctorQueue();
        if (data.whatsAppLinkAr) {
          window.open(data.whatsAppLinkAr, '_blank');
        }
      } else {
        setErrorMsg(data.error || 'Failed to confirm appointment.');
      }
    } catch (err) {
      console.error(err);
      setErrorMsg('Failed to approve appointment.');
    }
  };

  const handleCancelAppointment = async (appId) => {
    try {
      const res = await fetchWithAuth(`/api/appointments/${appId}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'CANCELLED' })
      });
      if (res.ok) {
        setSuccessMsg(lang === 'ar' ? 'تم إلغاء الموعد.' : 'Appointment cancelled.');
        fetchPendingAppointments();
        refreshDoctorQueue();
      }
    } catch (err) {
      console.error(err);
      setErrorMsg('Failed to cancel appointment.');
    }
  };

  // Fetch doctors & services on mount
  useEffect(() => {
    fetchPendingAppointments();

    fetch('/api/appointments/doctors')
      .then((res) => res.ok ? res.json() : [])
      .then((data) => setDoctors(Array.isArray(data) ? data : []))
      .catch((err) => {
        console.error(err);
        setDoctors([]);
      });

    fetch('/api/billing/services')
      .then((res) => res.ok ? res.json() : [])
      .then((data) => setClinicalServices(Array.isArray(data) ? data : []))
      .catch((err) => {
        console.error(err);
        setClinicalServices([]);
      });

    fetch('/api/billing/insurance-companies')
      .then((res) => res.ok ? res.json() : [])
      .then((data) => setInsuranceCompanies(Array.isArray(data) ? data : []))
      .catch((err) => {
        console.error(err);
        setInsuranceCompanies([]);
      });
  }, []);

  // Fetch queue when doctor or date changes
  const refreshDoctorQueue = () => {
    if (selectedDoctor) {
      fetchWithAuth(`/api/appointments/queue/${selectedDoctor.id}?date=${filterDate}`)
        .then((res) => res.json())
        .then((data) => {
          if (Array.isArray(data)) {
            setAppointments(data);
          } else {
            setAppointments([]);
            console.error('Queue response is not an array:', data);
          }
        })
        .catch((err) => {
          console.error(err);
          setAppointments([]);
        });
    }
  };

  useEffect(() => {
    refreshDoctorQueue();
  }, [selectedDoctor, filterDate]);

  useEffect(() => {
    const handleQueueUpdate = (data) => {
      console.log('[Socket.io] Queue update received in Receptionist:', data);
      refreshDoctorQueue();
      fetchPendingAppointments();
    };

    socket.on('queueUpdated', handleQueueUpdate);
    return () => {
      socket.off('queueUpdated', handleQueueUpdate);
    };
  }, [selectedDoctor, filterDate]);

  const handlePatientSearch = async (val) => {
    setSearchQuery(val);
    if (val.length > 2) {
      const res = await fetchWithAuth(`/api/patients/search?q=${encodeURIComponent(val)}`);
      const data = await res.json();
      setSearchResults(data);
    } else {
      setSearchResults([]);
    }
  };

  const handleRegisterPatient = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const res = await fetchWithAuth('/api/patients', {
        method: 'POST',
        body: JSON.stringify({
          fullNameAr,
          fullNameEn,
          gender,
          dateOfBirth: dob,
          nationalId: nationalId || undefined,
          phone,
          addressStateId: parseInt(addressStateId),
          addressDetails,
          emergencyContact: emergencyContact || 'Self'
        })
      });
      const data = await res.json();
      if (res.ok) {
        setSuccessMsg(lang === 'ar' ? 'تم تسجيل المريض بنجاح.' : 'Patient registered successfully.');
        setBillingPatient(data);
        setActiveTab('billing'); // Redirect to billing tab
        // Clear fields
        setFullNameAr('');
        setFullNameEn('');
        setPhone('');
        setDob('');
        setNationalId('');
        setAddressDetails('');
        setEmergencyContact('');
      } else {
        setErrorMsg(data.error || 'Registration failed.');
      }
    } catch (err) {
      console.error(err);
      setErrorMsg('Failed to connect to the backend server.');
    }
  };

  const handleCheckIn = async (appointmentId) => {
    try {
      const res = await fetchWithAuth(`/api/appointments/${appointmentId}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'CHECKED_IN' })
      });
      if (res.ok) {
        refreshDoctorQueue();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleQuickBill = (app) => {
    if (!app.patient) return;
    setBillingPatient(app.patient);
    setActiveTab('billing');

    const consultService = clinicalServices.find(s =>
      s.labelEn.toLowerCase().includes('consult') ||
      s.labelAr.includes('كشف')
    );

    const docFee = app.doctor?.consultationFee ? parseFloat(app.doctor.consultationFee) : 5000;

    if (consultService) {
      setAddedServices([{
        id: consultService.id,
        labelAr: `${consultService.labelAr} - د. ${lang === 'ar' ? app.doctor.fullNameAr : app.doctor.fullNameEn}`,
        labelEn: `${consultService.labelEn} - Dr. ${app.doctor.fullNameEn}`,
        baseFeeSdg: docFee,
        qty: 1
      }]);
    } else {
      setAddedServices([{
        id: 'temp-consult',
        labelAr: `معاينة - د. ${lang === 'ar' ? app.doctor.fullNameAr : app.doctor.fullNameEn}`,
        labelEn: `Consultation - Dr. ${app.doctor.fullNameEn}`,
        baseFeeSdg: docFee,
        qty: 1
      }]);
    }
    setPaymentRows([{ amountSdg: docFee.toString(), paymentMethod: 'CASH', transactionReference: '' }]);
  };

  // Add consultation/service to billing list
  const handleAddBillingService = (service) => {
    setAddedServices([...addedServices, { ...service, qty: 1 }]);
  };

  const handleRemoveBillingService = (index) => {
    setAddedServices(addedServices.filter((_, idx) => idx !== index));
  };

  const calculateInvoiceTotals = () => {
    const totalSdg = addedServices.reduce((sum, s) => sum + parseFloat(s.baseFeeSdg) * s.qty, 0);
    // Fixed conversion rate of 1500 locked at checkout
    const totalUsd = totalSdg / 1500;
    return { totalSdg, totalUsd };
  };

  const handleCreateInvoice = async () => {
    setErrorMsg('');
    setSuccessMsg('');
    const { totalSdg } = calculateInvoiceTotals();
    if (addedServices.length === 0 || !billingPatient) {
      setErrorMsg('Choose a patient and add at least one clinical service.');
      return;
    }

    try {
      const res = await fetchWithAuth('/api/billing/invoice', {
        method: 'POST',
        body: JSON.stringify({
          patientId: billingPatient.id,
          insuranceCompanyId: insuranceCompanyId || undefined,
          items: addedServices.map((s) => ({
            descriptionAr: s.labelAr,
            descriptionEn: s.labelEn,
            qty: s.qty,
            unitPriceSdg: parseFloat(s.baseFeeSdg)
          }))
        })
      });
      const data = await res.json();
      if (res.ok) {
        // Record split payments
        const paymentRes = await fetchWithAuth(`/api/billing/invoice/${data.invoice.id}/payments`, {
          method: 'POST',
          body: JSON.stringify({
            payments: paymentRows.map((p) => ({
              amountSdg: parseFloat(p.amountSdg),
              paymentMethod: p.paymentMethod,
              transactionReference: p.transactionReference || undefined
            }))
          })
        });

        if (paymentRes.ok) {
          setSuccessMsg(lang === 'ar' ? 'تم إصدار الفاتورة وإتمام الدفع بنجاح.' : 'Invoice issued and paid successfully.');
          setAddedServices([]);
          setBillingPatient(null);
          setPaymentRows([{ amountSdg: '', paymentMethod: 'CASH', transactionReference: '' }]);
        } else {
          const payError = await paymentRes.json();
          setErrorMsg(payError.error || 'Failed to apply payments.');
        }
      } else {
        setErrorMsg(data.error || 'Invoice creation failed.');
      }
    } catch (err) {
      console.error(err);
      setErrorMsg('Failed to process billing checkout.');
    }
  };

  const handleReconcileShift = async (e) => {
    e.preventDefault();
    try {
      const res = await fetchWithAuth('/api/billing/shift/reconcile', {
        method: 'POST',
        body: JSON.stringify({
          expectedAmountSdg: 150000.0, // Mock shift expectations
          actualAmountSdg: parseFloat(physicalCash),
          note: 'Daily receptionist shift reconciliation close'
        })
      });
      const data = await res.json();
      if (res.ok) {
        setReconcileResult(data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="dashboard-wrapper">
      {/* 3 COLUMN GRID WORKSPACE */}
      <div className="workspace-panel" style={{ padding: '1rem' }}>
        <div className="panel-grid">
          {/* COLUMN 1: DOCTORS ROSTER */}
          <div className="panel-column glass-panel" style={{ padding: '1rem' }}>
            <div className="panel-header">
              <span className="panel-title">
                <Users size={18} />
                {lang === 'ar' ? 'الأطباء المناوبين' : 'On-Duty Doctors'}
              </span>
            </div>
            {doctors.map((doc) => (
              <div
                key={doc.id}
                className={`queue-card-item glass-panel ${selectedDoctor?.id === doc.id ? 'selected' : ''}`}
                onClick={() => setSelectedDoctor(doc)}
              >
                <h4>{lang === 'ar' ? doc.fullNameAr : doc.fullNameEn}</h4>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  {lang === 'ar' ? doc.specialtyAr : doc.specialtyEn}
                </p>
              </div>
            ))}
          </div>

          {/* COLUMN 2: DAILY QUEUE MANAGER & PENDING APPROVALS */}
          <div className="panel-column glass-panel" style={{ padding: '1rem' }}>
            <div className="panel-header" style={{ flexDirection: 'column', gap: '0.5rem', alignItems: 'stretch' }}>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  type="button"
                  className={`btn ${queueTab === 'queue' ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ flex: 1, padding: '4px 8px', fontSize: '0.8rem', minHeight: '36px' }}
                  onClick={() => setQueueTab('queue')}
                >
                  <Clock size={14} />
                  {lang === 'ar' ? 'الطابور اليومي' : 'Live Queue'}
                </button>
                <button
                  type="button"
                  className={`btn ${queueTab === 'pending' ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ flex: 1, padding: '4px 8px', fontSize: '0.8rem', minHeight: '36px', position: 'relative' }}
                  onClick={() => setQueueTab('pending')}
                >
                  <AlertCircle size={14} />
                  {lang === 'ar' ? 'طلبات بانتظار التأكيد' : 'Pending Approvals'}
                  {pendingAppointments.length > 0 && (
                    <span className="badge badge-danger" style={{ marginLeft: '4px', fontSize: '0.7rem', padding: '1px 5px' }}>
                      {pendingAppointments.length}
                    </span>
                  )}
                </button>
              </div>

              {queueTab === 'queue' && (
                <input
                  type="date"
                  className="form-input"
                  style={{ padding: '4px 8px', fontSize: '0.85rem' }}
                  value={filterDate}
                  onChange={(e) => setFilterDate(e.target.value)}
                />
              )}
            </div>

            {queueTab === 'pending' ? (
              pendingAppointments.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
                  <CheckCircle size={36} color="var(--primary)" />
                  <p style={{ marginTop: '0.5rem' }}>{lang === 'ar' ? 'لا توجد طلبات مواعيد معلقة حالياً.' : 'No pending appointment requests.'}</p>
                </div>
              ) : (
                pendingAppointments.map((app) => (
                  <div
                    key={app.id}
                    className="queue-card-item glass-panel"
                    style={{ borderLeft: '4px solid var(--warning)', padding: '0.75rem', marginBottom: '0.75rem' }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <strong>{lang === 'ar' ? app.patient.fullNameAr : app.patient.fullNameEn}</strong>
                      <span className="badge badge-warning">{lang === 'ar' ? 'قيد المراجعة' : 'PENDING'}</span>
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.4rem' }}>
                      <div><strong>{lang === 'ar' ? 'الطبيب:' : 'Doctor:'}</strong> {lang === 'ar' ? app.doctor?.fullNameAr : app.doctor?.fullNameEn}</div>
                      <div><strong>{lang === 'ar' ? 'الموعد:' : 'Slot:'}</strong> {app.appointmentDate} الساعة {app.appointmentTime}</div>
                      <div><strong>{lang === 'ar' ? 'الهاتف:' : 'Phone:'}</strong> {app.patient?.phone}</div>
                    </div>

                    <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="btn btn-primary"
                        style={{ flex: 1, padding: '4px 8px', fontSize: '0.75rem', minHeight: '34px' }}
                        onClick={() => handleApproveAppointment(app.id)}
                      >
                        <Check size={12} />
                        {lang === 'ar' ? 'تأكيد الموعد' : 'Approve'}
                      </button>

                      <a
                        href={getWhatsAppLink(
                          app.patient?.phone,
                          lang === 'ar'
                            ? `مرحباً ${app.patient?.fullNameAr}، يرجى تأكيد موعدك بمركز الشفاء الطبي مع ${app.doctor?.fullNameAr} بتاريخ ${app.appointmentDate} الساعة ${app.appointmentTime}.`
                            : `Hello ${app.patient?.fullNameEn}, please confirm your appointment at Al-Shifa Clinic with ${app.doctor?.fullNameEn} on ${app.appointmentDate} at ${app.appointmentTime}.`
                        )}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-whatsapp"
                        style={{ padding: '4px 8px', fontSize: '0.75rem', minHeight: '34px' }}
                      >
                        <MessageCircle size={12} />
                        {lang === 'ar' ? 'واتساب' : 'WhatsApp'}
                      </a>

                      <button
                        type="button"
                        className="btn btn-danger"
                        style={{ padding: '4px 8px', fontSize: '0.75rem', minHeight: '34px' }}
                        onClick={() => handleCancelAppointment(app.id)}
                      >
                        {lang === 'ar' ? 'إلغاء' : 'Reject'}
                      </button>
                    </div>
                  </div>
                ))
              )
            ) : selectedDoctor ? (
              appointments.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
                  <HelpCircle size={36} />
                  <p style={{ marginTop: '0.5rem' }}>{lang === 'ar' ? 'لا توجد مواعيد مسجلة لهذا الطبيب اليوم.' : 'No appointments scheduled for this doctor today.'}</p>
                </div>
              ) : (
                appointments.map((app) => {
                  const isEmergency = app.emergencyOverride;
                  const statusStyles = (() => {
                    switch (app.status) {
                      case 'SCHEDULED':
                      case 'CONFIRMED':
                        return { borderLeft: '4px solid #9ca3af', background: 'rgba(156, 163, 175, 0.05)' };
                      case 'CHECKED_IN':
                        return { borderLeft: '4px solid var(--warning)', background: 'rgba(245, 158, 11, 0.08)' };
                      case 'IN_CONSULTATION':
                        return { borderLeft: '4px solid var(--primary)', background: 'rgba(20, 184, 166, 0.08)' };
                      case 'COMPLETED':
                        return { borderLeft: '4px solid var(--success)', background: 'rgba(16, 185, 129, 0.08)' };
                      default:
                        return { borderLeft: '4px solid var(--border-color)' };
                    }
                  })();

                  return (
                    <div
                      key={app.id}
                      className={`queue-card-item glass-panel ${isEmergency ? 'emergency-border' : ''}`}
                      style={{ ...statusStyles, padding: '0.75rem', marginBottom: '0.5rem' }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <strong>{lang === 'ar' ? app.patient.fullNameAr : app.patient.fullNameEn}</strong>
                        <span className={`badge ${app.status === 'COMPLETED' ? 'badge-success' :
                          app.status === 'IN_CONSULTATION' ? 'badge-primary' :
                            app.status === 'CHECKED_IN' ? 'badge-warning' : 'badge-secondary'
                          }`}>
                          {app.status === 'CHECKED_IN' ? (lang === 'ar' ? 'انتظار' : 'Waiting') :
                            app.status === 'IN_CONSULTATION' ? (lang === 'ar' ? 'عيادة' : 'Consulting') :
                              app.status === 'COMPLETED' ? (lang === 'ar' ? 'مكتمل' : 'Completed') : app.status}
                        </span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.4rem', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        <span>{app.appointmentTime}</span>
                        {isEmergency && <span className="emergency-tag">{lang === 'ar' ? 'طوارئ مستعجلة' : 'Emergency Priority'}</span>}
                      </div>

                      <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.6rem', flexWrap: 'wrap' }}>
                        {(app.status === 'SCHEDULED' || app.status === 'CONFIRMED') && (
                          <button
                            className="btn btn-primary"
                            style={{ flex: 1, padding: '4px 8px', fontSize: '0.75rem', margin: 0, minHeight: '32px' }}
                            onClick={() => handleCheckIn(app.id)}
                          >
                            {lang === 'ar' ? 'تسجيل دخول' : 'Check In'}
                          </button>
                        )}
                        <button
                          className="btn btn-secondary"
                          style={{ flex: 1, padding: '4px 8px', fontSize: '0.75rem', margin: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', minHeight: '32px' }}
                          onClick={() => handleQuickBill(app)}
                        >
                          <DollarSign size={12} />
                          {lang === 'ar' ? 'فوترة سريعة' : 'Quick Bill'}
                        </button>
                        <a
                          href={getWhatsAppLink(
                            app.patient?.phone,
                            lang === 'ar'
                              ? `مركز الشفاء الطبي: تذكير بموعدك (${app.patient.fullNameAr}). الوقت: ${app.appointmentTime}.`
                              : `Al-Shifa Clinic: Reminder for your appointment (${app.patient.fullNameEn}) at ${app.appointmentTime}.`
                          )}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn btn-whatsapp"
                          style={{ padding: '4px 8px', fontSize: '0.75rem', minHeight: '32px' }}
                        >
                          <MessageCircle size={12} />
                        </a>
                        {app.status === 'COMPLETED' && (
                          <button
                            className="btn btn-secondary"
                            style={{ flex: 1, padding: '4px 8px', fontSize: '0.75rem', margin: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', minHeight: '32px' }}
                            onClick={() => setActiveSummaryId(app.id)}
                          >
                            <Printer size={12} />
                            {lang === 'ar' ? 'ملخص' : 'Summary'}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )
            ) : (
              <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
                <Users size={36} />
                <p style={{ marginTop: '0.5rem' }}>{lang === 'ar' ? 'يرجى اختيار طبيب من القائمة لعرض طابور الانتظار.' : 'Please select a doctor from the list to view the live queue.'}</p>
              </div>
            )}
          </div>

          {/* COLUMN 3: BILLING & REGISTRATION */}
          <div className="panel-column glass-panel" style={{ padding: '1rem' }}>
            <div className="tabs-header">
              <button
                className={`tab-select-btn ${activeTab === 'register' ? 'active' : ''}`}
                onClick={() => setActiveTab('register')}
              >
                {lang === 'ar' ? 'تسجيل مريض' : 'Register'}
              </button>
              <button
                className={`tab-select-btn ${activeTab === 'billing' ? 'active' : ''}`}
                onClick={() => setActiveTab('billing')}
              >
                {lang === 'ar' ? 'فوترة وبيع' : 'Billing'}
              </button>
              <button
                className={`tab-select-btn ${activeTab === 'reconcile' ? 'active' : ''}`}
                onClick={() => setActiveTab('reconcile')}
              >
                {lang === 'ar' ? 'إقفال الوردية' : 'Reconcile'}
              </button>
            </div>

            {errorMsg && <div className="badge badge-danger" style={{ padding: '0.5rem' }}>{errorMsg}</div>}
            {successMsg && <div className="badge badge-success" style={{ padding: '0.5rem' }}>{successMsg}</div>}

            {/* TAB: REGISTER PATIENT */}
            {activeTab === 'register' && (
              <form onSubmit={handleRegisterPatient} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', overflowY: 'auto' }}>
                <div className="form-group">
                  <label className="form-label">{t('fullNameAr')} *</label>
                  <input
                    type="text"
                    required
                    className="form-input"
                    value={fullNameAr}
                    onChange={(e) => setFullNameAr(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">{t('fullNameEn')} *</label>
                  <input
                    type="text"
                    required
                    className="form-input"
                    value={fullNameEn}
                    onChange={(e) => setFullNameEn(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">{t('phone')} *</label>
                  <input
                    type="tel"
                    required
                    className="form-input"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">{lang === 'ar' ? 'تاريخ الميلاد' : 'DOB'} *</label>
                  <input
                    type="date"
                    required
                    className="form-input"
                    value={dob}
                    onChange={(e) => setDob(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">{t('gender')}</label>
                  <select className="form-input" value={gender} onChange={(e) => setGender(e.target.value)}>
                    <option value="MALE">{t('male')}</option>
                    <option value="FEMALE">{t('female')}</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">{t('addressState')}</label>
                  <select className="form-input" value={addressStateId} onChange={(e) => setAddressStateId(e.target.value)}>
                    {SUDANESE_STATES.map((st) => (
                      <option key={st.id} value={st.id}>
                        {lang === 'ar' ? st.labelAr : st.labelEn}
                      </option>
                    ))}
                  </select>
                </div>
                <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>
                  {lang === 'ar' ? 'حفظ ملف المريض' : 'Save Patient Profile'}
                </button>
              </form>
            )}

            {/* TAB: BILLING & CHECKOUT */}
            {activeTab === 'billing' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', overflowY: 'auto' }}>
                {/* Search Patient */}
                <div className="search-wrapper">
                  <Search className="search-icon-svg" size={16} />
                  <input
                    type="text"
                    placeholder={lang === 'ar' ? 'ابحث عن مريض بالاسم أو الهاتف...' : 'Search patient...'}
                    className="search-input-field"
                    value={searchQuery}
                    onChange={(e) => handlePatientSearch(e.target.value)}
                  />
                  {searchResults.length > 0 && (
                    <ul className="dropdown-results">
                      {searchResults.map((p) => (
                        <li
                          key={p.id}
                          className="dropdown-item-patient"
                          onClick={() => {
                            setBillingPatient(p);
                            setSearchResults([]);
                            setSearchQuery('');
                          }}
                        >
                          <strong>{lang === 'ar' ? p.fullNameAr : p.fullNameEn}</strong>
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{p.phone}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {billingPatient && (
                  <div className="glass-panel" style={{ padding: '0.75rem', fontSize: '0.9rem' }}>
                    <strong>{lang === 'ar' ? 'العميل المختار:' : 'Selected Client:'}</strong>{' '}
                    {lang === 'ar' ? billingPatient.fullNameAr : billingPatient.fullNameEn}
                  </div>
                )}

                {/* Services Catalog */}
                <div>
                  <label className="form-label">{lang === 'ar' ? 'اختر الخدمة الطبية' : 'Choose Service'}</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.5rem' }}>
                    {clinicalServices.map((svc) => (
                      <button
                        key={svc.id}
                        type="button"
                        className="btn btn-secondary"
                        style={{ padding: '4px 8px', fontSize: '0.75rem' }}
                        onClick={() => handleAddBillingService(svc)}
                      >
                        {lang === 'ar' ? svc.labelAr : svc.labelEn}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Added services list */}
                {addedServices.length > 0 && (
                  <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '0.75rem' }}>
                    <strong>{lang === 'ar' ? 'الخدمات المضافة:' : 'Invoice Services:'}</strong>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem' }}>
                      {addedServices.map((item, idx) => (
                        <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem' }}>
                          <span>{lang === 'ar' ? item.labelAr : item.labelEn}</span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span>{parseFloat(item.baseFeeSdg).toLocaleString()} SDG</span>
                            <button
                              type="button"
                              style={{ background: 'transparent', border: 'none', color: 'var(--danger)', cursor: 'pointer' }}
                              onClick={() => handleRemoveBillingService(idx)}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Copay selector */}
                    <div className="form-group" style={{ marginTop: '1rem' }}>
                      <label className="form-label">{lang === 'ar' ? 'الضمان الصحي' : 'Health Insurance'}</label>
                      <select
                        className="form-input"
                        value={insuranceCompanyId}
                        onChange={(e) => setInsuranceCompanyId(e.target.value)}
                      >
                        <option value="">{lang === 'ar' ? 'دفع شخصي مباشر' : 'Out-of-Pocket Cash'}</option>
                        {insuranceCompanies.map((c) => (
                          <option key={c.id} value={c.id}>
                            {lang === 'ar' ? c.labelAr : c.labelEn} ({parseFloat(c.copayPercentage)}% Copay)
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Totals */}
                    <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '0.5rem', marginTop: '0.5rem', display: 'flex', justifyContent: 'space-between', fontSize: '1rem', fontWeight: 'bold' }}>
                      <span>{t('invoiceTotal')}:</span>
                      <span style={{ color: 'var(--primary)' }}>
                        {calculateInvoiceTotals().totalSdg.toLocaleString()} SDG
                      </span>
                    </div>

                    {/* Split Payments row configuration */}
                    <div style={{ marginTop: '1rem' }}>
                      <label className="form-label">{lang === 'ar' ? 'توزيع وتجزئة الدفع' : 'Payment Breakdowns'}</label>
                      {paymentRows.map((row, idx) => (
                        <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.25rem', marginTop: '0.25rem' }}>
                          <input
                            type="number"
                            placeholder="Amount SDG"
                            className="form-input"
                            style={{ padding: '6px' }}
                            value={row.amountSdg}
                            onChange={(e) => {
                              const updated = [...paymentRows];
                              updated[idx].amountSdg = e.target.value;
                              setPaymentRows(updated);
                            }}
                          />
                          <select
                            className="form-input"
                            style={{ padding: '6px' }}
                            value={row.paymentMethod}
                            onChange={(e) => {
                              const updated = [...paymentRows];
                              updated[idx].paymentMethod = e.target.value;
                              setPaymentRows(updated);
                            }}
                          >
                            <option value="CASH">Cash</option>
                            <option value="CARD">Card</option>
                            <option value="BANKAK">Bankak</option>
                            <option value="FAWRY">Fawry</option>
                          </select>
                          <input
                            type="text"
                            placeholder="Ref ID"
                            className="form-input"
                            style={{ padding: '6px' }}
                            value={row.transactionReference}
                            onChange={(e) => {
                              const updated = [...paymentRows];
                              updated[idx].transactionReference = e.target.value;
                              setPaymentRows(updated);
                            }}
                          />
                        </div>
                      ))}
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ padding: '4px', fontSize: '0.75rem', marginTop: '0.5rem', width: '100%' }}
                        onClick={() => setPaymentRows([...paymentRows, { amountSdg: '', paymentMethod: 'CASH', transactionReference: '' }])}
                      >
                        {lang === 'ar' ? '+ إضافة دفعة مجزأة' : '+ Add Payment Split'}
                      </button>
                    </div>

                    <button className="btn btn-primary" style={{ width: '100%', marginTop: '1.5rem' }} onClick={handleCreateInvoice}>
                      {lang === 'ar' ? 'إصدار الفاتورة وتأكيد الدفع' : 'Checkout & Print Invoice'}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* TAB: SHIFT RECONCILE */}
            {activeTab === 'reconcile' && (
              <form onSubmit={handleReconcileShift} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div className="form-group">
                  <label className="form-label">{lang === 'ar' ? 'المبلغ الفعلي بالصندوق (SDG)' : 'Actual Cash in Register (SDG)'}</label>
                  <input
                    type="number"
                    required
                    className="form-input"
                    placeholder="Enter cash amount"
                    value={physicalCash}
                    onChange={(e) => setPhysicalCash(e.target.value)}
                  />
                </div>
                <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>
                  {t('reconcile')}
                </button>

                {reconcileResult && (
                  <div className="glass-panel" style={{ padding: '1rem', marginTop: '1rem', textAlign: 'center' }}>
                    <h4>{lang === 'ar' ? 'نتيجة مطابقة الوردية' : 'Reconciliation Output'}</h4>
                    <h3 style={{ color: reconcileResult.discrepancy === 0 ? 'var(--primary)' : 'var(--danger)', marginTop: '0.5rem' }}>
                      {reconcileResult.discrepancy === 0
                        ? (lang === 'ar' ? 'متطابقة تماماً (0)' : 'Perfectly Balanced (0)')
                        : `${reconcileResult.discrepancy.toLocaleString()} SDG Diff`}
                    </h3>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
                      {reconcileResult.message}
                    </p>
                  </div>
                )}
              </form>
            )}
          </div>
        </div>
      </div>
      {viewingProfilePatientId && (
        <PatientProfileModal
          patientId={viewingProfilePatientId}
          onClose={() => setViewingProfilePatientId(null)}
          lang={lang}
          onSelectSummary={(recId) => setActiveSummaryId(recId)}
        />
      )}
      {activeSummaryId && <PostVisitSummaryModal summaryId={activeSummaryId} onClose={() => setActiveSummaryId(null)} lang={lang} />}
    </div>
  );
}

/* ==========================================
   PATIENT PROFILE & VISIT HISTORY MODAL
   ========================================== */
function PatientProfileModal({ patientId, onClose, lang, onSelectSummary }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadProfile = async () => {
    if (!patientId) return;
    setLoading(true);
    setError('');
    try {
      const backendHost = window.location.hostname === 'localhost' ? 'localhost' : window.location.hostname;
      const res = await fetchWithAuth(`http://${backendHost}:5000/api/patients/${patientId}/profile`);
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}: Failed to load profile`);
      }
      const data = await res.json();
      setProfile(data);
    } catch (err) {
      console.error('Error fetching patient profile:', err);
      setError(err.message || 'Failed to load patient profile');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProfile();
  }, [patientId]);

  if (!patientId) return null;

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 1050 }}>
      <div
        className="modal-content glass-panel no-print-modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '850px', width: '95%', maxHeight: '90vh', overflowY: 'auto' }}
      >
        <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: 'linear-gradient(135deg, #0284c7, #0d9488)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 'bold', fontSize: '1.2rem' }}>
              <User size={24} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.25rem' }}>
                {lang === 'ar' ? profile?.fullNameAr || profile?.fullNameEn : profile?.fullNameEn || profile?.fullNameAr || (lang === 'ar' ? 'ملف المريض' : 'Patient Profile')}
              </h3>
              <p style={{ margin: 0, fontSize: '0.85rem', opacity: 0.75 }}>
                {lang === 'ar' ? 'السجل الطبي المتكامل والتاريخ المرضي' : 'Comprehensive Electronic Medical Profile'}
              </p>
            </div>
          </div>
          <button type="button" className="btn-close" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem' }}>
            <X size={20} />
          </button>
        </div>

        <div className="modal-body" style={{ paddingTop: '1rem' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '2rem' }}>
              <div className="spinner" style={{ margin: '0 auto 1rem' }}></div>
              <p>{lang === 'ar' ? 'جاري تحميل ملف المريض...' : 'Loading patient profile...'}</p>
            </div>
          ) : error ? (
            <div className="alert alert-error" style={{ textAlign: 'center', padding: '1.5rem' }}>
              <AlertCircle size={32} style={{ marginBottom: '0.5rem', color: '#ef4444' }} />
              <p style={{ margin: 0 }}>{error}</p>
              <button className="btn btn-secondary" onClick={loadProfile} style={{ marginTop: '1rem' }}>
                {lang === 'ar' ? 'إعادة المحاولة' : 'Retry'}
              </button>
            </div>
          ) : profile ? (
            <div>
              {/* Demographics Summary Card */}
              <div className="glass-card" style={{ padding: '1rem', borderRadius: '12px', marginBottom: '1.25rem', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem', fontSize: '0.9rem' }}>
                  <div>
                    <span style={{ opacity: 0.75 }}>{lang === 'ar' ? 'رقم الهاتف:' : 'Phone:'}</span>{' '}
                    <strong>{profile.phone}</strong>
                  </div>
                  <div>
                    <span style={{ opacity: 0.75 }}>{lang === 'ar' ? 'الرقم القومي:' : 'National ID:'}</span>{' '}
                    <strong>{profile.nationalId || 'N/A'}</strong>
                  </div>
                  <div>
                    <span style={{ opacity: 0.75 }}>{lang === 'ar' ? 'الجنس / تاريخ الميلاد:' : 'Gender / DOB:'}</span>{' '}
                    <strong>{profile.gender} ({profile.dateOfBirth ? new Date(profile.dateOfBirth).toLocaleDateString() : 'N/A'})</strong>
                  </div>
                  <div>
                    <span style={{ opacity: 0.75 }}>{lang === 'ar' ? 'فصيلة الدم:' : 'Blood Type:'}</span>{' '}
                    <span className="badge badge-info" style={{ background: '#0284c7', color: '#fff', padding: '2px 8px', borderRadius: '12px', fontSize: '0.8rem' }}>{profile.bloodType}</span>
                  </div>
                </div>

                {/* Risk Flags & Insurance */}
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
                  {profile.allergies && (
                    <span style={{ background: '#ef444422', border: '1px solid #ef4444', color: '#ef4444', padding: '3px 8px', borderRadius: '8px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <AlertTriangle size={12} />
                      <strong>{lang === 'ar' ? 'الحساسية:' : 'Allergies:'}</strong> {profile.allergies}
                    </span>
                  )}
                  {profile.chronicConditions && (
                    <span style={{ background: '#f59e0b22', border: '1px solid #f59e0b', color: '#f59e0b', padding: '3px 8px', borderRadius: '8px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Activity size={12} />
                      <strong>{lang === 'ar' ? 'أمراض مزمنة:' : 'Chronic:'}</strong> {profile.chronicConditions}
                    </span>
                  )}
                  {profile.insurance && (
                    <span style={{ background: '#10b98122', border: '1px solid #10b981', color: '#10b981', padding: '3px 8px', borderRadius: '8px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Shield size={12} />
                      <strong>{profile.insurance.providerName}</strong> ({profile.insurance.coverageRate}%)
                    </span>
                  )}
                  {profile.phone && (
                    <a
                      href={getWhatsAppLink(profile.phone, lang === 'ar' ? `مرحباً ${profile.fullNameAr}، نرحب بك في مركز الشفاء الطبي.` : `Hello ${profile.fullNameEn}, welcome to Al-Shifa Medical Center.`)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-whatsapp"
                      style={{ padding: '2px 8px', fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: '4px', textDecoration: 'none' }}
                    >
                      <MessageSquare size={12} />
                      {lang === 'ar' ? 'واتساب' : 'WhatsApp'}
                    </a>
                  )}
                </div>
              </div>

              {/* Visits History Timeline Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <h4 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Clock size={18} />
                  {lang === 'ar' ? `الزيارات السابقة (${profile.visitsCount})` : `Previous Visits (${profile.visitsCount})`}
                </h4>
                <span style={{ fontSize: '0.8rem', opacity: 0.7 }}>
                  {lang === 'ar' ? 'مرتبة من الأحدث للأقدم' : 'Sorted newest to oldest'}
                </span>
              </div>

              {/* Visits List */}
              {profile.visits.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '2rem', opacity: 0.6 }}>
                  <FileText size={32} style={{ marginBottom: '0.5rem' }} />
                  <p>{lang === 'ar' ? 'لا توجد زيارات مسجلة لهذا المريض حتى الآن.' : 'No recorded visits for this patient yet.'}</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {profile.visits.map((visit) => (
                    <div
                      key={visit.id}
                      className="glass-card"
                      style={{
                        padding: '0.85rem 1rem',
                        borderRadius: '10px',
                        border: '1px solid var(--border-color)',
                        background: 'rgba(255,255,255,0.03)',
                        transition: 'transform 0.15s ease'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem' }}>
                        <div>
                          <div style={{ fontWeight: 'bold', fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <Calendar size={14} style={{ opacity: 0.7 }} />
                            {new Date(visit.visitDate).toLocaleDateString()}
                            <span style={{ fontSize: '0.8rem', opacity: 0.6, fontWeight: 'normal' }}>
                              ({new Date(visit.visitDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})
                            </span>
                          </div>
                          <div style={{ fontSize: '0.85rem', opacity: 0.8, marginTop: '2px' }}>
                            <strong>{lang === 'ar' ? 'الطبيب:' : 'Doctor:'}</strong> {lang === 'ar' ? visit.doctor.fullNameAr : visit.doctor.fullNameEn} ({lang === 'ar' ? visit.doctor.specialtyAr : visit.doctor.specialtyEn})
                          </div>
                        </div>

                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={{ padding: '4px 10px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '4px' }}
                          onClick={() => {
                            const targetId = visit.recordId || visit.id || visit.appointmentId;
                            onSelectSummary(targetId);
                          }}
                        >
                          <Printer size={14} />
                          {lang === 'ar' ? 'ملخص الزيارة والطباعة' : 'Visit Summary / Print'}
                        </button>
                      </div>

                      {/* Clinical Preview */}
                      <div style={{ marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px dashed rgba(255,255,255,0.1)', fontSize: '0.85rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.5rem' }}>
                        <div>
                          <strong>{lang === 'ar' ? 'التشخيص:' : 'Diagnosis:'}</strong> {visit.diagnosis || 'N/A'}
                        </div>
                        <div>
                          <strong>{lang === 'ar' ? 'الأعراض:' : 'Symptoms:'}</strong> {visit.symptoms || 'N/A'}
                        </div>
                      </div>

                      {/* Vitals & Counts Badges */}
                      <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.5rem', flexWrap: 'wrap', fontSize: '0.75rem', opacity: 0.85 }}>
                        {visit.vitals?.blood_pressure && <span className="badge" style={{ background: 'rgba(255,255,255,0.1)', padding: '2px 6px', borderRadius: '4px' }}>BP: {visit.vitals.blood_pressure}</span>}
                        {visit.vitals?.heart_rate && <span className="badge" style={{ background: 'rgba(255,255,255,0.1)', padding: '2px 6px', borderRadius: '4px' }}>HR: {visit.vitals.heart_rate} bpm</span>}
                        {visit.vitals?.temperature && <span className="badge" style={{ background: 'rgba(255,255,255,0.1)', padding: '2px 6px', borderRadius: '4px' }}>Temp: {visit.vitals.temperature} °C</span>}
                        {visit.prescriptionsCount > 0 && <span className="badge badge-success" style={{ background: '#10b98133', color: '#10b981', padding: '2px 6px', borderRadius: '4px' }}>{lang === 'ar' ? `وصفات: ${visit.prescriptionsCount}` : `Rx: ${visit.prescriptionsCount}`}</span>}
                        {visit.labOrdersCount > 0 && <span className="badge badge-info" style={{ background: '#0284c733', color: '#0284c7', padding: '2px 6px', borderRadius: '4px' }}>{lang === 'ar' ? `فحوصات: ${visit.labOrdersCount}` : `Labs: ${visit.labOrdersCount}`}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ==========================================
   POST-VISIT SUMMARY & INSTRUCTIONS MODAL
   ========================================== */
function PostVisitSummaryModal({ summaryId, onClose, lang }) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorDetails, setErrorDetails] = useState('');
  const [emailing, setEmailing] = useState(false);
  const [emailMsg, setEmailMsg] = useState('');
  const [customEmail, setCustomEmail] = useState('');

  const loadSummary = async () => {
    if (!summaryId) return;
    const idToFetch = typeof summaryId === 'object' ? (summaryId.id || summaryId.recordId || summaryId.appointmentId) : summaryId;
    if (!idToFetch) return;
    setLoading(true);
    setErrorDetails('');
    try {
      const backendHost = window.location.hostname === 'localhost' ? 'localhost' : window.location.hostname;
      const targetUrl = `http://${backendHost}:5000/api/records/${idToFetch}/summary`;
      console.log('[PostVisitSummaryModal] Fetching absolute URL:', targetUrl);
      const res = await fetchWithAuth(targetUrl);
      const contentType = res.headers.get('content-type') || '';
      if (!res.ok) {
        if (contentType.includes('application/json')) {
          const errData = await res.json();
          throw new Error(errData.error || `HTTP ${res.status}: Failed to retrieve summary`);
        } else {
          const htmlText = await res.text();
          throw new Error(`Server returned non-JSON error (${res.status}): ${htmlText.substring(0, 100)}...`);
        }
      }
      if (!contentType.includes('application/json')) {
        const text = await res.text();
        throw new Error(`Expected JSON response but received: ${text.substring(0, 100)}...`);
      }
      const data = await res.json();
      setSummary(data);
      if (data.patient?.phone) {
        setCustomEmail(`${data.patient.phone}@patient.cms.local`);
      }
    } catch (err) {
      console.error('Error fetching summary:', err);
      setErrorDetails(err.message || 'Network connection failed.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSummary();
  }, [summaryId]);

  const handleEmailSummary = async () => {
    const idToFetch = typeof summaryId === 'object' ? (summaryId.id || summaryId.recordId || summaryId.appointmentId) : summaryId;
    if (!idToFetch) return;
    setEmailing(true);
    setEmailMsg('');
    try {
      const res = await fetchWithAuth(`/api/records/${idToFetch}/send-summary`, {
        method: 'POST',
        body: JSON.stringify({ email: customEmail })
      });
      const contentType = res.headers.get('content-type') || '';
      if (!res.ok) {
        if (contentType.includes('application/json')) {
          const errData = await res.json();
          setEmailMsg(errData.error || 'Failed to send email.');
        } else {
          setEmailMsg(`Server returned status ${res.status}`);
        }
        return;
      }
      const data = await res.json();
      setEmailMsg(lang === 'ar' ? 'تم إرسال ملخص الزيارة إلى البريد بنجاح.' : 'Post-visit summary emailed successfully!');
    } catch (err) {
      setEmailMsg('Error connecting to mail server.');
    } finally {
      setEmailing(false);
    }
  };

  if (loading) {
    return (
      <div className="modal-overlay no-print-section">
        <div className="modal-content-panel glass-panel" style={{ textAlign: 'center', padding: '2rem' }}>
          <p>{lang === 'ar' ? 'جاري تحميل ملخص الزيارة...' : 'Loading Visit Summary...'}</p>
        </div>
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="modal-overlay no-print-section">
        <div className="modal-content-panel glass-panel" style={{ textAlign: 'center', padding: '2rem' }}>
          <p style={{ color: 'var(--danger)', fontWeight: 'bold' }}>
            {lang === 'ar' ? 'تعذر العثور على ملخص الزيارة.' : 'Visit Summary not found.'}
          </p>
          {errorDetails && <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>{errorDetails}</p>}
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', marginTop: '1.25rem' }}>
            <button className="btn btn-secondary" onClick={onClose}>{lang === 'ar' ? 'إغلاق' : 'Close'}</button>
            <button className="btn btn-primary" onClick={loadSummary}>{lang === 'ar' ? 'إعادة المحاولة' : 'Retry'}</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay">
      <div className="modal-content-panel glass-panel" style={{ maxWidth: '650px', maxHeight: '90vh', overflowY: 'auto' }}>
        {/* Actions bar (hidden during print) */}
        <div className="no-print-section" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem' }}>
          <h3 style={{ margin: 0, color: 'var(--primary)' }}>
            {lang === 'ar' ? 'ملخص الزيارة والتوصيات الطبية' : 'Post-Visit Summary & Care Plan'}
          </h3>
          <button className="btn btn-secondary" style={{ padding: '4px 8px' }} onClick={onClose}>✕</button>
        </div>

        {/* Printable Area */}
        <div className="printable-visit-summary" style={{ padding: '1rem', background: 'rgba(0,0,0,0.15)', borderRadius: 'var(--radius-md)' }}>
          <div style={{ textAlign: 'center', borderBottom: '2px solid var(--primary)', paddingBottom: '0.75rem', marginBottom: '1rem' }}>
            <h2 style={{ margin: 0, color: 'var(--primary)', fontSize: '1.4rem' }}>Al-Shifa Medical Center</h2>
            <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
              {lang === 'ar' ? 'ملخص زيارة المريض والتوصيات الطبية' : 'Patient Visit Summary & Clinical Instructions'}
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', fontSize: '0.85rem', marginBottom: '1rem' }}>
            <div><strong>{lang === 'ar' ? 'اسم المريض:' : 'Patient Name:'}</strong> {lang === 'ar' ? summary.patient.fullNameAr : summary.patient.fullNameEn}</div>
            <div><strong>{lang === 'ar' ? 'تاريخ الزيارة:' : 'Visit Date:'}</strong> {new Date(summary.visitDate).toLocaleDateString()}</div>
            <div><strong>{lang === 'ar' ? 'الطبيب المعالج:' : 'Attending Doctor:'}</strong> {lang === 'ar' ? summary.doctor.fullNameAr : summary.doctor.fullNameEn}</div>
            <div><strong>{lang === 'ar' ? 'التخصص:' : 'Specialty:'}</strong> {lang === 'ar' ? summary.doctor.specialtyAr : summary.doctor.specialtyEn}</div>
          </div>

          {/* Vitals */}
          <div style={{ background: 'rgba(20, 184, 166, 0.08)', border: '1px solid var(--border-color)', padding: '0.75rem', borderRadius: 'var(--radius-sm)', marginBottom: '1rem', fontSize: '0.85rem' }}>
            <strong style={{ color: 'var(--primary)' }}>{lang === 'ar' ? 'العلامات الحيوية (Vitals):' : 'Vital Signs:'}</strong>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.5rem', marginTop: '0.4rem', textAlign: 'center' }}>
              <div>BP: <strong>{summary.vitals?.blood_pressure || 'N/A'}</strong></div>
              <div>HR: <strong>{summary.vitals?.heart_rate || 'N/A'} bpm</strong></div>
              <div>Temp: <strong>{summary.vitals?.temperature || 'N/A'} °C</strong></div>
              <div>Wt: <strong>{summary.vitals?.weight || 'N/A'} kg</strong></div>
            </div>
          </div>

          {/* Clinical Details */}
          <div style={{ fontSize: '0.85rem', marginBottom: '1rem' }}>
            <p style={{ margin: '0 0 0.4rem 0' }}><strong>{lang === 'ar' ? 'التشخيص الطبي:' : 'Diagnosis:'}</strong> {summary.diagnosis}</p>
            <p style={{ margin: 0 }}><strong>{lang === 'ar' ? 'العلاج والخطة:' : 'Treatment Plan:'}</strong> {summary.treatment}</p>
          </div>

          {/* Prescriptions */}
          {summary.prescriptions && summary.prescriptions.length > 0 && (
            <div style={{ marginBottom: '1rem' }}>
              <h4 style={{ fontSize: '0.9rem', color: 'var(--primary)', marginBottom: '0.4rem' }}>{lang === 'ar' ? 'الأدوية الموصوفة' : 'Prescribed Medications'}</h4>
              <table className="staff-table" style={{ fontSize: '0.8rem' }}>
                <thead>
                  <tr>
                    <th>{lang === 'ar' ? 'الدواء' : 'Medication'}</th>
                    <th>{lang === 'ar' ? 'الجرعة' : 'Dosage'}</th>
                    <th>{lang === 'ar' ? 'المدة' : 'Duration'}</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.prescriptions.map((rx, idx) => (
                    <tr key={idx}>
                      <td>{lang === 'ar' ? rx.drugNameAr : rx.drugNameEn}</td>
                      <td>{rx.dosage}</td>
                      <td>{rx.duration}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Post-Visit Advice */}
          <div style={{ fontSize: '0.85rem', borderTop: '1px dashed var(--border-color)', paddingTop: '0.75rem' }}>
            <strong style={{ color: 'var(--primary)' }}>{lang === 'ar' ? 'توجيهات وإرشادات المريض:' : 'Post-Visit Care Instructions:'}</strong>
            <ul style={{ margin: '0.4rem 0 0 1.2rem', padding: 0 }}>
              {summary.instructions.map((inst, i) => (
                <li key={i} style={{ marginBottom: '0.2rem' }}>{inst}</li>
              ))}
            </ul>
          </div>
        </div>

        {/* Email Controls & Print Buttons (Hidden on print) */}
        <div className="no-print-section" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '1rem' }}>
          {emailMsg && <div className="badge badge-success" style={{ padding: '0.5rem' }}>{emailMsg}</div>}

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <input
              type="email"
              className="form-input"
              style={{ flex: 1 }}
              placeholder="Patient email address..."
              value={customEmail}
              onChange={(e) => setCustomEmail(e.target.value)}
            />
            <button className="btn btn-primary" onClick={handleEmailSummary} disabled={emailing}>
              <Mail size={16} />
              {emailing ? (lang === 'ar' ? 'جاري الإرسال...' : 'Sending...') : (lang === 'ar' ? 'إرسال بالبريد' : 'Email Summary')}
            </button>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', flexWrap: 'wrap' }}>
            <button className="btn btn-secondary" onClick={onClose}>{lang === 'ar' ? 'إغلاق' : 'Close'}</button>
            {summary.patient?.phone && (
              <a
                href={getWhatsAppLink(
                  summary.patient.phone,
                  lang === 'ar'
                    ? `مركز الشفاء الطبي: ملخص زيارة المريض (${summary.patient.fullNameAr}).\nالتشخيص: ${summary.diagnosis}.\nالعلاج: ${summary.treatment}.\nالوصفة: ${(summary.prescriptions || []).map(p => `${p.drugNameAr} (${p.dosage})`).join(', ')}.\nنتمنى لك الشفاء العاجل!`
                    : `Al-Shifa Clinic: Post-visit summary for ${summary.patient.fullNameEn}.\nDiagnosis: ${summary.diagnosis}.\nTreatment: ${summary.treatment}.\nPrescriptions: ${(summary.prescriptions || []).map(p => `${p.drugNameEn} (${p.dosage})`).join(', ')}.\nGet well soon!`
                )}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-whatsapp"
              >
                <MessageCircle size={16} />
                {lang === 'ar' ? 'إرسال الملخص بالواتساب' : 'Send via WhatsApp'}
              </a>
            )}
            <button className="btn btn-primary" onClick={() => window.print()}>
              <Printer size={16} />
              {lang === 'ar' ? 'طباعة / تصدير PDF' : 'Print / Export PDF'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ==========================================
   3. DOCTOR DASHBOARD & CLINICAL EMR WORKSPACE
   ========================================== */
function DoctorDashboard({ user, lang, t }) {
  const [queue, setQueue] = useState([]);
  const [filterDate, setFilterDate] = useState(new Date().toISOString().split('T')[0]);
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [selectedAppointmentId, setSelectedAppointmentId] = useState('');
  const [activeTab, setActiveTab] = useState('history'); // Keep activeTab state for backwards compatibility if needed

  // EMR Details
  const [historyData, setHistoryData] = useState([]);
  const [hasFullAccess, setHasFullAccess] = useState(false);
  const [activeSummaryId, setActiveSummaryId] = useState(null);
  const [viewingProfilePatientId, setViewingProfilePatientId] = useState(null);

  // Consult records entry
  const [symptoms, setSymptoms] = useState('');
  const [diagnosis, setDiagnosis] = useState('');
  const [treatment, setTreatment] = useState('');
  const [clinicalNotes, setClinicalNotes] = useState('');
  const [vitals, setVitals] = useState({ blood_pressure: '120/80', heart_rate: '75', temperature: '37.0', weight: '70' });

  // Prescription builder
  const [drugs, setDrugs] = useState([]);
  const [selectedDrug, setSelectedDrug] = useState('');
  const [dosage, setDosage] = useState('');
  const [duration, setDuration] = useState('');
  const [instrAr, setInstrAr] = useState('');
  const [instrEn, setInstrEn] = useState('');
  const [prescribedItems, setPrescribedItems] = useState([]);

  // Lab services selectors
  const [clinicalServices, setClinicalServices] = useState([]);
  const [orderedTests, setOrderedTests] = useState([]);

  // Break-the-Glass States
  const [showBypassModal, setShowBypassModal] = useState(false);
  const [bypassJustification, setBypassJustification] = useState('');
  const [bypassError, setBypassError] = useState('');

  // Messages
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Diagnosis, Dosage and Vitals presets
  const commonDiagnoses = [
    { labelAr: "ضغط الدم", labelEn: "Hypertension (I10)", val: "Essential Hypertension (I10)" },
    { labelAr: "السكري", labelEn: "Type 2 Diabetes (E11)", val: "Type 2 Diabetes Mellitus (E11)" },
    { labelAr: "التهاب اللوزتين", labelEn: "Tonsillitis (J03)", val: "Acute Tonsillitis (J03)" },
    { labelAr: "النزلة المعوية", labelEn: "Gastroenteritis (A09)", val: "Gastroenteritis (A09)" },
    { labelAr: "الربو الشعبى", labelEn: "Asthma (J45)", val: "Bronchial Asthma (J45)" }
  ];

  const quickDosagePresets = ["1x3 daily", "1x2 daily", "1 daily", "500mg 1x3"];
  const quickDurationPresets = ["3 Days", "5 Days", "7 Days", "10 Days"];

  const handlePopulateNormalVitals = () => {
    setVitals({ blood_pressure: '120/80', heart_rate: '72', temperature: '36.8', weight: '70' });
  };

  const fetchDoctorQueue = () => {
    if (user.doctorId) {
      fetchWithAuth(`/api/appointments/queue/${user.doctorId}?date=${filterDate}`)
        .then((res) => res.json())
        .then((data) => {
          if (Array.isArray(data)) {
            setQueue(data);
          } else {
            setQueue([]);
            console.error('Queue response is not an array:', data);
          }
        })
        .catch((err) => {
          console.error(err);
          setQueue([]);
        });
    }
  };

  // Fetch queue on filterDate change
  useEffect(() => {
    fetchDoctorQueue();
  }, [filterDate]);

  useEffect(() => {
    const handleQueueUpdate = (data) => {
      console.log('[Socket.io] Queue update received in Doctor:', data);
      if (!data || !data.doctorId || data.doctorId === user.doctorId || data.targetDoctorId === user.doctorId) {
        fetchDoctorQueue();
      }
    };

    socket.on('queueUpdated', handleQueueUpdate);
    return () => {
      socket.off('queueUpdated', handleQueueUpdate);
    };
  }, [filterDate, user.doctorId]);

  // Fetch lists on load
  useEffect(() => {
    fetch('/api/records/drugs')
      .then((res) => res.ok ? res.json() : [])
      .then((data) => setDrugs(Array.isArray(data) ? data : []))
      .catch((err) => {
        console.error(err);
        setDrugs([]);
      });

    fetch('/api/billing/services')
      .then((res) => res.ok ? res.json() : [])
      .then((data) => setClinicalServices(Array.isArray(data) ? data : []))
      .catch((err) => {
        console.error(err);
        setClinicalServices([]);
      });
  }, []);

  const fetchPatientHistory = (patientId) => {
    fetchWithAuth(`/api/patients/${patientId}/history`)
      .then((res) => res.ok ? res.json() : {})
      .then((data) => {
        setHistoryData(data.history || []);
        setHasFullAccess(data.hasFullAccess);
      })
      .catch((err) => {
        console.error(err);
        setHistoryData([]);
      });
  };

  const handlePatientSelect = (appt) => {
    setSelectedPatient(appt.patient);
    setSelectedAppointmentId(appt.id);
    fetchPatientHistory(appt.patient.id);
    // Auto status change to IN_CONSULTATION
    fetchWithAuth(`/api/appointments/${appt.id}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status: 'IN_CONSULTATION' })
    }).then(() => fetchDoctorQueue());
  };

  const handleBreakTheGlass = async () => {
    setBypassError('');
    if (bypassJustification.length < 20) {
      setBypassError(lang === 'ar' ? 'الرجاء توفير شرح طارئ كافٍ (20 حرفاً على الأقل)' : 'Please provide sufficient justification (minimum 20 characters)');
      return;
    }

    try {
      const res = await fetchWithAuth('/api/records/bypass', {
        method: 'POST',
        body: JSON.stringify({
          patientId: selectedPatient.id,
          justification: bypassJustification
        })
      });
      if (res.ok) {
        setShowBypassModal(false);
        setBypassJustification('');
        fetchPatientHistory(selectedPatient.id);
      } else {
        const errData = await res.json();
        setBypassError(errData.error || 'Bypass failed.');
      }
    } catch (err) {
      console.error(err);
      setBypassError('Bypass request failed.');
    }
  };

  const handleAddDrugToRx = () => {
    if (!selectedDrug || !dosage || !duration) return;
    const drugObj = drugs.find((d) => d.id === selectedDrug);
    setPrescribedItems([
      ...prescribedItems,
      {
        drugId: selectedDrug,
        nameAr: drugObj.labelAr,
        nameEn: drugObj.labelEn,
        dosage,
        duration,
        instructionsAr: instrAr,
        instructionsEn: instrEn,
        qtyPrescribed: 15 // Mock prescribed total quantity
      }
    ]);
    setSelectedDrug('');
    setDosage('');
    setDuration('');
    setInstrAr('');
    setInstrEn('');
  };

  const handleToggleTest = (serviceId) => {
    if (orderedTests.includes(serviceId)) {
      setOrderedTests(orderedTests.filter((id) => id !== serviceId));
    } else {
      setOrderedTests([...orderedTests, serviceId]);
    }
  };

  const handleSaveConsultation = async () => {
    setErrorMsg('');
    setSuccessMsg('');
    if (!diagnosis) {
      setErrorMsg(t('requiredField'));
      return;
    }

    try {
      const res = await fetchWithAuth('/api/records', {
        method: 'POST',
        body: JSON.stringify({
          patientId: selectedPatient.id,
          appointmentId: selectedAppointmentId,
          symptoms,
          diagnosis,
          treatment,
          clinicalNotes,
          vitalSigns: vitals,
          prescribedDrugs: prescribedItems,
          orderedServices: orderedTests
        })
      });

      const data = await res.json();
      if (res.ok) {
        setSuccessMsg(lang === 'ar' ? 'تم إنهاء الزيارة وحفظ الملف الطبي للمريض بنجاح.' : 'EMR Consultation saved successfully.');
        const recId = data.recordId || data.record?.id || data.data?.record?.id || data.data?.id || selectedAppointmentId;
        setActiveSummaryId(recId);
        setSelectedPatient(null);
        setSymptoms('');
        setDiagnosis('');
        setTreatment('');
        setClinicalNotes('');
        setPrescribedItems([]);
        setOrderedTests([]);
        fetchDoctorQueue();
      } else {
        setErrorMsg(data.error || 'Failed to save EMR.');
      }
    } catch (err) {
      console.error(err);
      setErrorMsg('EMR saving failed.');
    }
  };

  return (
    <div className="dashboard-wrapper">
      <div className="workspace-panel" style={{ padding: '1rem' }}>
        <div className="panel-grid-2">
          {/* COLUMN 1: LIVE QUEUE & PATIENT INFO */}
          <div className="panel-column glass-panel" style={{ padding: '1.25rem' }}>
            <div className="panel-header" style={{ flexDirection: 'column', gap: '0.5rem', alignItems: 'stretch' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="panel-title">
                  <Activity size={18} />
                  {lang === 'ar' ? 'طابور الطبيب' : 'Doctor Patient Waitlist'}
                </span>
              </div>
              <input
                type="date"
                className="form-input"
                style={{ padding: '4px 8px', fontSize: '0.85rem' }}
                value={filterDate}
                onChange={(e) => setFilterDate(e.target.value)}
              />
            </div>

            {queue.map((appt) => {
              const isEmergency = appt.emergencyOverride;
              return (
                <div
                  key={appt.id}
                  className={`queue-card-item glass-panel ${isEmergency ? 'emergency-border' : ''} ${selectedAppointmentId === appt.id ? 'selected' : ''}`}
                  onClick={() => handlePatientSelect(appt)}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong>{lang === 'ar' ? appt.patient.fullNameAr : appt.patient.fullNameEn}</strong>
                    <span className="badge badge-success">{appt.status}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5rem', fontSize: '0.8rem' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>{appt.appointmentTime}</span>
                    {isEmergency && <span className="emergency-tag">{lang === 'ar' ? 'طوارئ' : 'Emergency'}</span>}
                  </div>
                </div>
              );
            })}

            {selectedPatient && (
              <div className="glass-panel" style={{ padding: '1rem', marginTop: '1.5rem', fontSize: '0.85rem' }}>
                <h4 style={{ marginBottom: '0.75rem' }}>{lang === 'ar' ? 'ملف المريض الحالي' : 'Patient Summary'}</h4>
                <p>
                  <strong>{lang === 'ar' ? 'الاسم:' : 'Name:'}</strong>{' '}
                  {lang === 'ar' ? selectedPatient.fullNameAr : selectedPatient.fullNameEn}
                </p>
                <p><strong>{lang === 'ar' ? 'تاريخ الميلاد:' : 'DOB:'}</strong> {selectedPatient.dateOfBirth}</p>
                <p><strong>{lang === 'ar' ? 'الهاتف:' : 'Phone:'}</strong> {selectedPatient.phone}</p>

                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
                  <button className="btn btn-danger" style={{ width: '100%', fontSize: '0.8rem' }} onClick={() => setShowBypassModal(true)}>
                    <Shield size={14} />
                    {t('breakTheGlass')}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* COLUMN 2: CLINICAL WORKSPACE */}
          <div className="panel-column glass-panel" style={{ padding: '1.25rem' }}>
            {selectedPatient ? (
              <div>
                <div style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem', marginBottom: '1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div>
                    <h3 style={{ color: 'var(--primary)', margin: 0 }}>
                      {lang === 'ar' ? 'ملف الكشف الطبي الموحد:' : 'Unified Clinical Workspace:'}{' '}
                      {lang === 'ar' ? selectedPatient.fullNameAr : selectedPatient.fullNameEn}
                    </h3>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                      {lang === 'ar' ? 'الجنس:' : 'Gender:'} {selectedPatient.gender} | {lang === 'ar' ? 'تاريخ الميلاد:' : 'DOB:'} {selectedPatient.dateOfBirth}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ fontSize: '0.8rem', padding: '6px 12px', display: 'flex', alignItems: 'center', gap: '6px' }}
                    onClick={() => setViewingProfilePatientId(selectedPatient.id)}
                  >
                    <User size={14} />
                    {lang === 'ar' ? 'عرض الملف الشامل' : 'View Full Profile'}
                  </button>
                </div>

                {errorMsg && <div className="badge badge-danger" style={{ padding: '0.5rem', width: '100%', marginBottom: '1rem' }}>{errorMsg}</div>}
                {successMsg && <div className="badge badge-success" style={{ padding: '0.5rem', width: '100%', marginBottom: '1rem' }}>{successMsg}</div>}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: '1.5rem', alignItems: 'start' }}>
                  {/* Left Column: Full Patient History at a glance */}
                  <div className="glass-panel" style={{ padding: '1rem', maxHeight: '70vh', overflowY: 'auto' }}>
                    <h4 style={{ marginBottom: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <Activity size={18} color="var(--primary)" />
                      {lang === 'ar' ? 'سجل الزيارات السابقة' : 'Patient EMR History'}
                    </h4>
                    <div className="emr-timeline">
                      {historyData.length === 0 ? (
                        <p style={{ opacity: 0.6 }}>{lang === 'ar' ? 'لا يوجد زيارات سابقة مسجلة.' : 'No historical visits logged.'}</p>
                      ) : (
                        historyData.map((rec) => (
                          <div key={rec.id} className="timeline-card glass-panel" style={{ marginBottom: '1rem', padding: '0.75rem', borderLeft: '3px solid var(--primary)', position: 'relative' }}>
                            {rec.isLocked && (
                              <div className="lock-container-block" style={{ position: 'absolute', right: '10px', top: '10px', display: 'flex', gap: '4px', alignItems: 'center', background: 'rgba(0,0,0,0.5)', padding: '2px 6px', borderRadius: '4px' }}>
                                <Lock size={12} color="var(--danger)" />
                                <span style={{ fontSize: '0.65rem', color: 'var(--danger)' }}>{t('breakTheGlass')}</span>
                              </div>
                            )}
                            <div className={`timeline-details ${rec.isLocked ? 'locked-overlay' : ''}`} style={{ fontSize: '0.8rem' }}>
                              <div className="timeline-header" style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold' }}>
                                <span>{new Date(rec.visitDate).toLocaleDateString()}</span>
                                <span style={{ color: 'var(--primary)' }}>
                                  {lang === 'ar' ? rec.doctorNameAr : rec.doctorNameEn}
                                </span>
                              </div>
                              <div className="timeline-vitals" style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem', opacity: 0.8 }}>
                                <span>BP: {rec.vitalSigns?.blood_pressure}</span>
                                <span>HR: {rec.vitalSigns?.heart_rate} bpm</span>
                                <span>Temp: {rec.vitalSigns?.temperature} °C</span>
                              </div>
                              <div style={{ marginTop: '0.25rem' }}>
                                <strong>{t('symptoms')}:</strong> {rec.symptoms}
                              </div>
                              <div style={{ marginTop: '0.25rem' }}>
                                <strong>{t('diagnosis')}:</strong> {rec.diagnosis}
                              </div>
                              <div style={{ marginTop: '0.25rem' }}>
                                <strong>{t('treatment')}:</strong> {rec.treatment}
                              </div>
                              {!rec.isLocked && (
                                <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                                  <button
                                    type="button"
                                    className="btn btn-secondary"
                                    style={{ padding: '2px 6px', fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: '4px' }}
                                    onClick={() => {
                                      const targetId = rec.id || rec.recordId || rec.appointmentId;
                                      console.log('[DoctorDashboard] Opening Visit Summary for rec:', targetId, rec);
                                      setActiveSummaryId(targetId);
                                    }}
                                  >
                                    <Printer size={12} />
                                    {lang === 'ar' ? 'ملخص الزيارة والطباعة' : 'Visit Summary / Print'}
                                  </button>

                                  {selectedPatient?.phone && (
                                    <a
                                      href={getWhatsAppLink(
                                        selectedPatient.phone,
                                        lang === 'ar'
                                          ? `مركز الشفاء الطبي - ملخص الزيارة:\nالتشخيص: ${rec.diagnosis}\nالعلاج: ${rec.treatment}`
                                          : `Al-Shifa Clinic - Visit Summary:\nDiagnosis: ${rec.diagnosis}\nTreatment: ${rec.treatment}`
                                      )}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="btn btn-whatsapp"
                                      style={{ padding: '2px 6px', fontSize: '0.7rem' }}
                                    >
                                      <MessageCircle size={12} />
                                      {lang === 'ar' ? 'واتساب' : 'WhatsApp'}
                                    </a>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Right Column: Active Consultation & Prescription Builder */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                    {/* Vitals Section */}
                    <div className="glass-panel" style={{ padding: '1rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                        <h4 style={{ margin: 0 }}>{lang === 'ar' ? 'العلامات الحيوية الحالية' : 'Current Vitals'}</h4>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={{ padding: '2px 8px', fontSize: '0.75rem' }}
                          onClick={handlePopulateNormalVitals}
                        >
                          {lang === 'ar' ? 'علامات حيوية طبيعية' : 'Normal Vitals Preset'}
                        </button>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '0.5rem' }}>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label className="form-label" style={{ fontSize: '0.75rem' }}>BP</label>
                          <input
                            type="text"
                            className="form-input"
                            style={{ padding: '6px' }}
                            value={vitals.blood_pressure}
                            onChange={(e) => setVitals({ ...vitals, blood_pressure: e.target.value })}
                          />
                        </div>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label className="form-label" style={{ fontSize: '0.75rem' }}>HR (bpm)</label>
                          <input
                            type="text"
                            className="form-input"
                            style={{ padding: '6px' }}
                            value={vitals.heart_rate}
                            onChange={(e) => setVitals({ ...vitals, heart_rate: e.target.value })}
                          />
                        </div>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label className="form-label" style={{ fontSize: '0.75rem' }}>Temp (°C)</label>
                          <input
                            type="text"
                            className="form-input"
                            style={{ padding: '6px' }}
                            value={vitals.temperature}
                            onChange={(e) => setVitals({ ...vitals, temperature: e.target.value })}
                          />
                        </div>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label className="form-label" style={{ fontSize: '0.75rem' }}>Wt (kg)</label>
                          <input
                            type="text"
                            className="form-input"
                            style={{ padding: '6px' }}
                            value={vitals.weight}
                            onChange={(e) => setVitals({ ...vitals, weight: e.target.value })}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Symptoms & Diagnosis */}
                    <div className="glass-panel" style={{ padding: '1rem' }}>
                      <div className="form-group" style={{ marginBottom: '0.75rem' }}>
                        <label className="form-label">{t('symptoms')}</label>
                        <textarea
                          rows={2}
                          className="form-input"
                          value={symptoms}
                          onChange={(e) => setSymptoms(e.target.value)}
                        />
                      </div>

                      <div className="form-group" style={{ marginBottom: '0.75rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                          <label className="form-label" style={{ margin: 0 }}>{t('diagnosis')} *</label>
                          <span style={{ fontSize: '0.7rem', opacity: 0.8 }}>{lang === 'ar' ? 'نماذج تشخيص سريعة:' : 'Quick Diagnoses:'}</span>
                        </div>

                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', marginBottom: '0.5rem' }}>
                          {commonDiagnoses.map((cd) => (
                            <button
                              key={cd.val}
                              type="button"
                              className="btn btn-secondary"
                              style={{ padding: '2px 6px', fontSize: '0.7rem', textTransform: 'none', background: 'rgba(255,255,255,0.05)' }}
                              onClick={() => setDiagnosis(cd.val)}
                            >
                              {lang === 'ar' ? cd.labelAr : cd.labelEn}
                            </button>
                          ))}
                        </div>

                        <input
                          type="text"
                          placeholder="ICD-11 Code / Diagnosis description"
                          className="form-input"
                          required
                          value={diagnosis}
                          onChange={(e) => setDiagnosis(e.target.value)}
                        />
                      </div>

                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label">{t('treatment')}</label>
                        <textarea
                          rows={2}
                          className="form-input"
                          value={treatment}
                          onChange={(e) => setTreatment(e.target.value)}
                        />
                      </div>
                    </div>

                    {/* Prescription Builder */}
                    <div className="glass-panel" style={{ padding: '1rem' }}>
                      <h4 style={{ marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <Sliders size={16} color="var(--primary)" />
                        {lang === 'ar' ? 'الوصفة الطبية السريعة' : 'Rapid Prescription Builder'}
                      </h4>
                      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: '0.5rem' }}>
                        <select className="form-input" value={selectedDrug} onChange={(e) => setSelectedDrug(e.target.value)}>
                          <option value="">{lang === 'ar' ? 'اختر الدواء...' : 'Medication...'}</option>
                          {drugs.map((d) => (
                            <option key={d.id} value={d.id}>
                              {lang === 'ar' ? d.labelAr : d.labelEn}
                            </option>
                          ))}
                        </select>

                        <div>
                          <input
                            type="text"
                            placeholder="Dosage (500mg)"
                            className="form-input"
                            value={dosage}
                            onChange={(e) => setDosage(e.target.value)}
                          />
                          <div style={{ display: 'flex', gap: '2px', marginTop: '4px', flexWrap: 'wrap' }}>
                            {quickDosagePresets.map(p => (
                              <button
                                key={p}
                                type="button"
                                style={{ padding: '2px 4px', fontSize: '0.65rem', border: '1px solid var(--border-color)', borderRadius: '4px', background: 'rgba(255,255,255,0.03)', cursor: 'pointer', color: 'var(--text-secondary)' }}
                                onClick={() => setDosage(p)}
                              >
                                {p}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div>
                          <input
                            type="text"
                            placeholder="Duration (5 Days)"
                            className="form-input"
                            value={duration}
                            onChange={(e) => setDuration(e.target.value)}
                          />
                          <div style={{ display: 'flex', gap: '2px', marginTop: '4px', flexWrap: 'wrap' }}>
                            {quickDurationPresets.map(p => (
                              <button
                                key={p}
                                type="button"
                                style={{ padding: '2px 4px', fontSize: '0.65rem', border: '1px solid var(--border-color)', borderRadius: '4px', background: 'rgba(255,255,255,0.03)', cursor: 'pointer', color: 'var(--text-secondary)' }}
                                onClick={() => setDuration(p)}
                              >
                                {p}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginTop: '0.75rem' }}>
                        <input
                          type="text"
                          placeholder="Instructions (Arabic)"
                          className="form-input"
                          value={instrAr}
                          onChange={(e) => setInstrAr(e.target.value)}
                        />
                        <input
                          type="text"
                          placeholder="Instructions (English)"
                          className="form-input"
                          value={instrEn}
                          onChange={(e) => setInstrEn(e.target.value)}
                        />
                      </div>
                      <button type="button" className="btn btn-secondary" style={{ width: '100%', marginTop: '0.5rem', padding: '6px' }} onClick={handleAddDrugToRx}>
                        {t('prescribe')}
                      </button>

                      {/* Prescribed Items Table */}
                      {prescribedItems.length > 0 && (
                        <table className="staff-table" style={{ fontSize: '0.75rem', marginTop: '0.75rem' }}>
                          <thead>
                            <tr>
                              <th>Drug</th>
                              <th>Dosage</th>
                              <th>Duration</th>
                            </tr>
                          </thead>
                          <tbody>
                            {prescribedItems.map((item, idx) => (
                              <tr key={idx}>
                                <td>{lang === 'ar' ? item.nameAr : item.nameEn}</td>
                                <td>{item.dosage}</td>
                                <td>{item.duration}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>

                    {/* Labs orders */}
                    <div className="glass-panel" style={{ padding: '1rem' }}>
                      <h4 style={{ marginBottom: '0.5rem' }}>{lang === 'ar' ? 'طلب فحوصات مخبرية / أشعة' : 'Order Diagnostic Tests'}</h4>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                        {clinicalServices
                          .filter((s) => s.category === 'LABORATORY' || s.category === 'RADIOLOGY')
                          .map((svc) => (
                            <label
                              key={svc.id}
                              className="glass-panel"
                              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', cursor: 'pointer', padding: '4px 8px', margin: 0, background: orderedTests.includes(svc.id) ? 'rgba(20, 184, 166, 0.15)' : 'rgba(255,255,255,0.03)' }}
                            >
                              <input
                                type="checkbox"
                                checked={orderedTests.includes(svc.id)}
                                onChange={() => handleToggleTest(svc.id)}
                              />
                              <span>{lang === 'ar' ? svc.labelAr : svc.labelEn}</span>
                            </label>
                          ))}
                      </div>
                    </div>

                    <button type="button" className="btn btn-primary" style={{ width: '100%', padding: '12px', fontSize: '1rem', fontWeight: 'bold' }} onClick={handleSaveConsultation}>
                      {lang === 'ar' ? 'حفظ الكشف الطبي وإغلاق الجلسة' : 'Save Consultation & Lock File'}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '5rem', color: 'var(--text-secondary)' }}>
                <Stethoscope size={64} />
                <p style={{ marginTop: '1rem' }}>{lang === 'ar' ? 'يرجى اختيار مريض من الطابور لبدء الكشف الطبي.' : 'Please select a patient from the queue to start the consultation.'}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Break-the-Glass warning Modal */}
      {showBypassModal && (
        <div className="modal-overlay">
          <div className="modal-content-panel glass-panel" style={{ maxWidth: '450px' }}>
            <h3 style={{ color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Shield size={24} />
              {lang === 'ar' ? 'تحذير كسر حماية الخصوصية' : 'Bypass Privacy Alert'}
            </h3>
            {bypassError && <div className="badge badge-danger" style={{ padding: '0.5rem' }}>{bypassError}</div>}
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              {lang === 'ar'
                ? 'تحذير: أنت على وشك تجاوز خصوصية المريض والولوج إلى السجل الكامل. سيتم تسجيل هذا الإجراء وإبلاغ الإدارة فوراً.'
                : 'Warning: You are about to bypass patient privacy. This action will be logged and reported to the Administrator.'}
            </p>
            <div className="form-group">
              <label className="form-label">{lang === 'ar' ? 'مبرر الحالة الطارئة (20 حرفاً كحد أدنى)' : 'Emergency Justification (Min 20 chars)'}</label>
              <textarea
                rows={3}
                required
                className="form-input"
                value={bypassJustification}
                onChange={(e) => setBypassJustification(e.target.value)}
              />
            </div>
            <div style={{ display: 'flex', gap: '1rem' }}>
              <button className="btn btn-secondary" onClick={() => setShowBypassModal(false)}>
                {lang === 'ar' ? 'إلغاء' : 'Cancel'}
              </button>
              <button className="btn btn-danger" onClick={handleBreakTheGlass}>
                {lang === 'ar' ? 'تأكيد الباي-باس' : 'Confirm Bypass'}
              </button>
            </div>
          </div>
        </div>
      )}
      {viewingProfilePatientId && (
        <PatientProfileModal
          patientId={viewingProfilePatientId}
          onClose={() => setViewingProfilePatientId(null)}
          lang={lang}
          onSelectSummary={(recId) => setActiveSummaryId(recId)}
        />
      )}
      {activeSummaryId && <PostVisitSummaryModal summaryId={activeSummaryId} onClose={() => setActiveSummaryId(null)} lang={lang} />}
    </div>
  );
}

/* ==========================================
   4. PHARMACIST DASHBOARD
   ========================================== */
function PharmacistDashboard({ lang, t }) {
  const [prescriptions, setPrescriptions] = useState([]);
  const [selectedRx, setSelectedRx] = useState(null);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Inventory warnings
  const [lowStockAlerts, setLowStockAlerts] = useState([]);

  const fetchPendingRx = () => {
    fetchWithAuth('/api/records/prescriptions/pending')
      .then((res) => res.ok ? res.json() : [])
      .then((data) => setPrescriptions(Array.isArray(data) ? data : []))
      .catch((err) => {
        console.error(err);
        setPrescriptions([]);
      });
  };

  useEffect(() => {
    fetchPendingRx();

    fetch('/api/records/drugs')
      .then((res) => res.ok ? res.json() : [])
      .then((data) => {
        if (Array.isArray(data)) {
          // filter low stock items (qty <= min level)
          const lowStock = data.filter((d) =>
            d.inventoryBatches && d.inventoryBatches.some((b) => b.qtyOnHand <= b.minReorderLevel)
          );
          setLowStockAlerts(lowStock);
        } else {
          setLowStockAlerts([]);
        }
      })
      .catch((err) => {
        console.error(err);
        setLowStockAlerts([]);
      });
  }, []);

  const handleDispense = async (rx) => {
    setErrorMsg('');
    setSuccessMsg('');
    const items = rx.prescribedDrugs.map((item) => {
      // Find default batch
      const batch = item.drug.inventoryBatches[0];
      return {
        prescribedDrugId: item.id,
        qtyToDispense: item.qtyPrescribed - item.qtyDispensed,
        batchId: batch ? batch.id : null
      };
    });

    try {
      const res = await fetchWithAuth(`/api/records/prescriptions/${rx.id}/dispense`, {
        method: 'POST',
        body: JSON.stringify({ items })
      });
      if (res.ok) {
        setSuccessMsg(lang === 'ar' ? 'تم صرف الوصفة الطبية وإنقاص المخزون بنجاح.' : 'Prescription dispensed successfully.');
        setSelectedRx(null);
        fetchPendingRx();
      } else {
        const err = await res.json();
        setErrorMsg(err.error || 'Dispense failed.');
      }
    } catch (e) {
      console.error(e);
      setErrorMsg('Dispensing transaction failed.');
    }
  };

  return (
    <div className="dashboard-wrapper">
      <div className="workspace-panel" style={{ padding: '1rem' }}>
        <div className="panel-grid">
          {/* COLUMN 1: ACTIVE RX QUEUE */}
          <div className="panel-column glass-panel" style={{ padding: '1rem' }}>
            <div className="panel-header">
              <span className="panel-title">
                <FileText size={18} />
                {lang === 'ar' ? 'الوصفات الطبية المعلقة' : 'Pending Rx Queue'}
              </span>
            </div>
            {prescriptions.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
                <HelpCircle size={36} />
                <p style={{ marginTop: '0.5rem' }}>{t('pharmacyQueueEmpty')}</p>
              </div>
            ) : (
              prescriptions.map((rx) => (
                <div
                  key={rx.id}
                  className={`queue-card-item glass-panel ${selectedRx?.id === rx.id ? 'selected' : ''}`}
                  onClick={() => setSelectedRx(rx)}
                >
                  <strong>{lang === 'ar' ? rx.patient.fullNameAr : rx.patient.fullNameEn}</strong>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                    <span>{new Date(rx.prescriptionDate).toLocaleDateString()}</span>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* COLUMN 2: PRESCRIPTION DISPENSER */}
          <div className="panel-column glass-panel" style={{ padding: '1rem' }}>
            <div className="panel-header">
              <span className="panel-title">
                <Sliders size={18} />
                {lang === 'ar' ? 'شاشة صرف الأدوية' : 'Rx Dispensation Desk'}
              </span>
            </div>
            {errorMsg && <div className="badge badge-danger" style={{ padding: '0.5rem' }}>{errorMsg}</div>}
            {successMsg && <div className="badge badge-success" style={{ padding: '0.5rem' }}>{successMsg}</div>}

            {selectedRx ? (
              <div>
                <h4>
                  {lang === 'ar' ? 'المريض:' : 'Patient:'}{' '}
                  {lang === 'ar' ? selectedRx.patient.fullNameAr : selectedRx.patient.fullNameEn}
                </h4>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                  {lang === 'ar' ? 'الطبيب المعالج:' : 'Doctor:'} {lang === 'ar' ? selectedRx.doctor.fullNameAr : selectedRx.doctor.fullNameEn}
                </p>

                {selectedRx.prescribedDrugs.map((item) => {
                  const qtyOnHand = item.drug.inventoryBatches?.reduce((sum, b) => sum + (b.qtyOnHand || 0), 0) || 0;
                  const isOutOfStock = qtyOnHand === 0;
                  const isInsufficient = qtyOnHand < item.qtyPrescribed;
                  const isLowStock = qtyOnHand < 25;

                  return (
                    <div key={item.id} className="glass-panel" style={{ padding: '0.75rem', marginBottom: '0.5rem', fontSize: '0.9rem', borderLeft: isOutOfStock || isInsufficient ? '3px solid var(--danger)' : isLowStock ? '3px solid var(--warning)' : '3px solid var(--success)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <strong>{lang === 'ar' ? item.drug.labelAr : item.drug.labelEn}</strong>
                        <span style={{ color: 'var(--primary)', fontWeight: 'bold' }}>Qty: {item.qtyPrescribed}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.25rem', alignItems: 'center' }}>
                        <span>Dosage: {item.dosage} | Duration: {item.duration}</span>
                        {isOutOfStock ? (
                          <span className="badge badge-danger" style={{ fontSize: '0.7rem' }}>{lang === 'ar' ? 'غير متوفر' : 'Out of Stock'}</span>
                        ) : isInsufficient ? (
                          <span className="badge badge-danger" style={{ fontSize: '0.7rem' }}>{lang === 'ar' ? 'غير كافٍ' : `Insufficient (${qtyOnHand})`}</span>
                        ) : isLowStock ? (
                          <span className="badge badge-warning" style={{ fontSize: '0.7rem' }}>{lang === 'ar' ? 'مخزون منخفض' : `Low Stock (${qtyOnHand})`}</span>
                        ) : (
                          <span className="badge badge-success" style={{ fontSize: '0.7rem' }}>{lang === 'ar' ? 'متوفر' : `In Stock (${qtyOnHand})`}</span>
                        )}
                      </div>
                      {/* Batch FIFO suggestion indicator */}
                      <div style={{ fontSize: '0.75rem', color: 'var(--warning)', marginTop: '0.5rem' }}>
                        FIFO Suggestion: Batch{' '}
                        {item.drug.inventoryBatches[0]?.batchNumber || 'N/A'} (Exp: {item.drug.inventoryBatches[0]?.expiryDate || 'N/A'})
                      </div>
                    </div>
                  );
                })}

                <button className="btn btn-primary" style={{ width: '100%', marginTop: '1.5rem' }} onClick={() => handleDispense(selectedRx)}>
                  {lang === 'ar' ? 'صرف الأدوية وتحديث المستودع' : 'Confirm Dispensation'}
                </button>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '5rem', color: 'var(--text-secondary)' }}>
                <Stethoscope size={64} />
                <p style={{ marginTop: '1rem' }}>{lang === 'ar' ? 'يرجى اختيار وصفة طبية من القائمة للمتابعة.' : 'Please select an active prescription from the list.'}</p>
              </div>
            )}
          </div>

          {/* COLUMN 3: ALERTS & INVENTORY */}
          <div className="panel-column glass-panel" style={{ padding: '1rem' }}>
            <div className="panel-header">
              <span className="panel-title">
                <AlertTriangle size={18} color="var(--warning)" />
                {lang === 'ar' ? 'تنبيهات المخازن والصلاحية' : 'Stock Alerts & Expiry'}
              </span>
            </div>
            {lowStockAlerts.map((d) => {
              const qty = d.inventoryBatches[0]?.qtyOnHand || 0;
              const isZero = qty === 0;
              return (
                <div key={d.id} className="glass-panel" style={{ padding: '0.75rem', borderLeft: isZero ? '4px solid var(--danger)' : '4px solid var(--warning)', fontSize: '0.85rem', marginBottom: '0.5rem', background: isZero ? 'rgba(239, 68, 68, 0.05)' : 'rgba(245, 158, 11, 0.05)' }}>
                  <strong>{lang === 'ar' ? d.labelAr : d.labelEn}</strong>
                  <p style={{ color: isZero ? 'var(--danger)' : 'var(--warning)', marginTop: '0.25rem', fontWeight: 'bold' }}>
                    {isZero
                      ? (lang === 'ar' ? 'نفذ تماماً من المخزن!' : 'OUT OF STOCK!')
                      : `${lang === 'ar' ? 'مستوى حرج للمخزون:' : 'Critical low stock:'} ${qty} left`}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ==========================================
   5. LAB TECHNICIAN DASHBOARD
   ========================================== */
function LabTechDashboard({ lang, t }) {
  const [orders, setOrders] = useState([]);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [resultVal, setResultVal] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const fetchPendingLabOrders = () => {
    fetchWithAuth('/api/records/lab-orders/pending')
      .then((res) => res.ok ? res.json() : [])
      .then((data) => setOrders(Array.isArray(data) ? data : []))
      .catch((err) => {
        console.error(err);
        setOrders([]);
      });
  };

  useEffect(() => {
    fetchPendingLabOrders();
  }, []);

  const handleSubmitResult = async (item) => {
    setErrorMsg('');
    setSuccessMsg('');
    if (!resultVal) return;

    // Simple bounds check: hemoglobin normal is 12-16. If <12 or >16, flag out of range
    const isOut = parseFloat(resultVal) < 12.0 || parseFloat(resultVal) > 16.0;

    try {
      const res = await fetchWithAuth(`/api/records/lab-orders/items/${item.id}/results`, {
        method: 'PUT',
        body: JSON.stringify({
          resultValue: resultVal,
          referenceRangeMin: 12.0,
          referenceRangeMax: 16.0,
          isOutOfRange: isOut
        })
      });
      if (res.ok) {
        setSuccessMsg(lang === 'ar' ? 'تم تسجيل النتيجة وتنبيه الطبيب بنجاح.' : 'Lab results logged and doctor notified.');
        setResultVal('');
        setSelectedOrder(null);
        fetchPendingLabOrders();
      } else {
        setErrorMsg('Failed to save lab results.');
      }
    } catch (e) {
      console.error(e);
      setErrorMsg('Transaction failed.');
    }
  };

  return (
    <div className="dashboard-wrapper">
      <div className="workspace-panel" style={{ padding: '1rem' }}>
        <div className="panel-grid-2">
          {/* COLUMN 1: PENDING ORDERS QUEUE */}
          <div className="panel-column glass-panel" style={{ padding: '1rem' }}>
            <div className="panel-header">
              <span className="panel-title">
                <FileSpreadsheet size={18} />
                {lang === 'ar' ? 'الفحوصات الطبية المطلوبة' : 'Pending Lab/Rad Orders'}
              </span>
            </div>
            {orders.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
                <HelpCircle size={36} />
                <p style={{ marginTop: '0.5rem' }}>{lang === 'ar' ? 'لا توجد فحوصات مطلوبة بانتظار الإجراء حالياً.' : 'No pending test orders to perform.'}</p>
              </div>
            ) : (
              orders.map((ord) => (
                <div
                  key={ord.id}
                  className={`queue-card-item glass-panel ${selectedOrder?.id === ord.id ? 'selected' : ''}`}
                  onClick={() => setSelectedOrder(ord)}
                >
                  <strong>{lang === 'ar' ? ord.patient.fullNameAr : ord.patient.fullNameEn}</strong>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                    <span>{new Date(ord.orderDate).toLocaleDateString()}</span>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* COLUMN 2: RESULTS ENTRY FORM */}
          <div className="panel-column glass-panel" style={{ padding: '1rem' }}>
            <div className="panel-header">
              <span className="panel-title">
                <Sliders size={18} />
                {lang === 'ar' ? 'تسجيل نتائج الفحوصات' : 'Test Findings Entry Desk'}
              </span>
            </div>
            {errorMsg && <div className="badge badge-danger" style={{ padding: '0.5rem' }}>{errorMsg}</div>}
            {successMsg && <div className="badge badge-success" style={{ padding: '0.5rem' }}>{successMsg}</div>}

            {selectedOrder ? (
              <div>
                <h4>
                  {lang === 'ar' ? 'المريض:' : 'Patient:'}{' '}
                  {lang === 'ar' ? selectedOrder.patient.fullNameAr : selectedOrder.patient.fullNameEn}
                </h4>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
                  {lang === 'ar' ? 'الطبيب الطالب:' : 'Ordering Physician:'} {lang === 'ar' ? selectedOrder.doctor.fullNameAr : selectedOrder.doctor.fullNameEn}
                </p>

                {selectedOrder.items.map((item) => {
                  const valParsed = parseFloat(resultVal);
                  const isOutOfRange = resultVal !== '' && !isNaN(valParsed) && (valParsed < 12.0 || valParsed > 16.0);

                  return (
                    <div key={item.id} className="glass-panel" style={{ padding: '1rem', marginBottom: '1rem', borderLeft: isOutOfRange ? '4px solid var(--danger)' : '1px solid var(--border-color)' }}>
                      <strong>{lang === 'ar' ? item.service.labelAr : item.service.labelEn}</strong>
                      <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginTop: '0.75rem', flexWrap: 'wrap' }}>
                        <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                          <input
                            type="text"
                            placeholder="Result value (e.g. 13.5)"
                            className="form-input"
                            style={isOutOfRange ? { border: '1px solid var(--danger)', boxShadow: '0 0 8px rgba(239, 68, 68, 0.3)', color: 'var(--danger)', fontWeight: 'bold' } : {}}
                            value={resultVal}
                            onChange={(e) => setResultVal(e.target.value)}
                          />
                        </div>
                        <div style={{ fontSize: '0.85rem', color: isOutOfRange ? 'var(--danger)' : 'var(--text-secondary)', fontWeight: isOutOfRange ? 'bold' : 'normal' }}>
                          Normal Range: 12.0 - 16.0 g/dL
                        </div>
                      </div>

                      {isOutOfRange && (
                        <div style={{ color: 'var(--danger)', fontSize: '0.8rem', marginTop: '0.5rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <AlertTriangle size={14} />
                          {lang === 'ar' ? 'تنبيه: نتيجة غير طبيعية (خارج المعدل المرجعي)' : 'Abnormal Test Finding (Out of normal range!)'}
                        </div>
                      )}

                      <button className="btn btn-primary" style={{ width: '100%', marginTop: '1rem' }} onClick={() => handleSubmitResult(item)}>
                        {lang === 'ar' ? 'إرسال التقرير وتحديث السجل' : 'Save Findings'}
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '5rem', color: 'var(--text-secondary)' }}>
                <Stethoscope size={64} />
                <p style={{ marginTop: '1rem' }}>{lang === 'ar' ? 'يرجى اختيار فحص مخبري من القائمة للمتابعة.' : 'Please select an active test order from the list.'}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
