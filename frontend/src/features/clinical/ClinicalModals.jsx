import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Calendar, Check, Copy, FileText, Mail, MessageCircle, Pill, Printer, Receipt, Shield, TestTube, User, X } from 'lucide-react';
import { fetchWithAuth } from '../../services/staffApi';
import { useAuth } from '../../app/auth/auth-context';
import './patientFile.css';

function getWhatsAppLink(phone, message) {
  if (!phone) return '#';
  let cleaned = phone.replace(/[^0-9]/g, '');
  if (cleaned.startsWith('0')) cleaned = '249' + cleaned.substring(1);
  else if (!cleaned.startsWith('249') && cleaned.length === 9) cleaned = '249' + cleaned;
  return `https://wa.me/${cleaned}?text=${encodeURIComponent(message || '')}`;
}

const STATUS_LABELS = {
  ACTIVE: ['نشط', 'Active'], ARCHIVED: ['مؤرشف', 'Archived'],
  SCHEDULED: ['مجدول', 'Scheduled'], PENDING: ['قيد الانتظار', 'Pending'],
  CONFIRMED: ['مؤكد', 'Confirmed'], CHECKED_IN: ['تم الوصول', 'Checked in'],
  IN_CONSULTATION: ['قيد الاستشارة', 'In consultation'], COMPLETED: ['مكتمل', 'Completed'],
  CANCELLED: ['ملغي', 'Cancelled'], NO_SHOW: ['لم يحضر', 'No show'],
  FILLED: ['صُرفت', 'Filled'], PARTIALLY_FILLED: ['صُرفت جزئياً', 'Partially filled'],
  PENDING_BILLING: ['بانتظار الفوترة', 'Pending billing'], PAID: ['مدفوع', 'Paid'],
  SAMPLE_COLLECTED: ['تم جمع العينة', 'Sample collected'], UNPAID: ['غير مدفوع', 'Unpaid'],
  PARTIALLY_PAID: ['مدفوع جزئياً', 'Partially paid'], PARTIALLY_REFUNDED: ['مسترد جزئياً', 'Partially refunded'],
  REFUNDED: ['مسترد', 'Refunded']
};

function localizedStatus(status, lang) {
  const labels = STATUS_LABELS[status];
  return labels ? labels[lang === 'ar' ? 0 : 1] : String(status || '—').replaceAll('_', ' ');
}

function patientAge(dateOfBirth) {
  if (!dateOfBirth) return null;
  const dateOnly = String(dateOfBirth).slice(0, 10);
  const birth = new Date(/^\d{4}-\d{2}-\d{2}$/.test(dateOnly) ? `${dateOnly}T00:00:00` : dateOfBirth);
  if (Number.isNaN(birth.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  if (today < new Date(today.getFullYear(), birth.getMonth(), birth.getDate())) age -= 1;
  return age >= 0 ? age : null;
}

export function PatientProfileModal({ patientId, onClose, lang, onSelectSummary }) {
  const { user } = useAuth();
  const dialogRef = useRef(null);
  const closeButtonRef = useRef(null);

  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [claimCode, setClaimCode] = useState('');
  const [claimExpiresIn, setClaimExpiresIn] = useState(null);
  const [claimLoading, setClaimLoading] = useState(false);
  const [claimError, setClaimError] = useState('');
  const [claimCopied, setClaimCopied] = useState(false);
  const [activeSection, setActiveSection] = useState('overview');
  const [fileCopied, setFileCopied] = useState(false);

  const canManagePortalLink =
    user?.role === 'ADMIN' ||
    user?.role === 'RECEPTIONIST';

  const loadProfile = useCallback(async () => {
    if (!patientId) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetchWithAuth(`/api/patients/${patientId}/profile`);
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}: Failed to load profile`);
      }
      const data = await res.json();
      setProfile(data);
    } catch (err) {
      console.error('Error fetching patient profile:', err);
      setError(
        err.message ||
          (lang === 'ar'
            ? 'تعذر تحميل ملف المريض.'
            : 'Failed to load patient profile.')
      );
    } finally {
      setLoading(false);
    }
  }, [patientId, lang]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus?.();
    };
  }, [onClose]);

  const handleGenerateClaimCode = async () => {
    if (!patientId || !canManagePortalLink || profile?.portalLinked) {
      return;
    }

    setClaimLoading(true);
    setClaimError('');
    setClaimCode('');
    setClaimExpiresIn(null);
    setClaimCopied(false);

    try {
      const res = await fetchWithAuth(
        `/api/patient-auth/claims/${patientId}/code`,
        {
          method: 'POST'
        }
      );

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const code =
          data?.error?.code ||
          data?.code;

        if (code === 'PATIENT_ALREADY_CLAIMED') {
          setClaimError(
            lang === 'ar'
              ? 'هذا السجل مرتبط بالفعل بحساب مريض ولا يمكن إصدار رمز جديد.'
              : 'This patient record is already linked to a portal account.'
          );

          await loadProfile();
          return;
        }

        const apiMessage =
          typeof data?.error === 'string'
            ? data.error
            : data?.error?.message;

        throw new Error(
          apiMessage ||
            (lang === 'ar'
              ? 'تعذر إصدار رمز ربط الحساب.'
              : 'Failed to generate a claim code.')
        );
      }

      setClaimCode(data.code || '');
      setClaimExpiresIn(
        Number(data.expiresInMinutes) || 30
      );
    } catch (err) {
      console.error('Generate patient claim code error:', err);

      setClaimError(
        err.message ||
          (lang === 'ar'
            ? 'تعذر إصدار رمز ربط الحساب.'
            : 'Failed to generate a claim code.')
      );
    } finally {
      setClaimLoading(false);
    }
  };

  const handleCopyClaimCode = async () => {
    if (!claimCode) return;

    try {
      await navigator.clipboard.writeText(claimCode);
      setClaimCopied(true);

      window.setTimeout(() => {
        setClaimCopied(false);
      }, 2000);
    } catch (err) {
      console.error('Copy claim code error:', err);

      setClaimError(
        lang === 'ar'
          ? 'تعذر نسخ الرمز تلقائيًا. يمكنك نسخه يدويًا.'
          : 'The code could not be copied automatically. You can copy it manually.'
      );
    }
  };

  const handleCopyFileNumber = async () => {
    if (!profile?.fileNumber) return;
    try {
      await navigator.clipboard.writeText(profile.fileNumber);
      setFileCopied(true);
      window.setTimeout(() => setFileCopied(false), 1800);
    } catch {
      setFileCopied(false);
    }
  };

  if (!patientId) return null;

  const displayName = profile
    ? (lang === 'ar' ? profile.fullNameAr || profile.fullNameEn : profile.fullNameEn || profile.fullNameAr)
    : (lang === 'ar' ? 'ملف المريض' : 'Patient File');
  const age = patientAge(profile?.dateOfBirth);
  const formattedDateOfBirth = profile?.dateOfBirth
    ? new Date(`${String(profile.dateOfBirth).slice(0, 10)}T00:00:00`).toLocaleDateString(lang === 'ar' ? 'ar' : 'en', {
        day: 'numeric', month: 'short', year: 'numeric'
      })
    : '—';
  const authorizedSections = profile?.availableSections || ['overview'];
  const preferredSectionOrder = ['overview', 'visits', 'appointments', 'prescriptions', 'laboratory', 'billing'];
  const visibleSections = profile
    ? preferredSectionOrder.filter((section) => section === 'visits' || authorizedSections.includes(section))
    : ['overview'];
  const canViewMedicalRecords = authorizedSections.includes('visits');
  const medicalRecordsError = canViewMedicalRecords && profile && !Array.isArray(profile.visits)
    ? (lang === 'ar' ? 'تعذر تحميل السجلات الطبية.' : 'Medical records could not be loaded.')
    : '';
  const medicalRecords = Array.isArray(profile?.visits) ? profile.visits : [];
  const handleSectionKeyDown = (event, index) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    let nextIndex = index;
    if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = visibleSections.length - 1;
    else {
      const visualStep = event.key === 'ArrowRight' ? 1 : -1;
      const step = lang === 'ar' ? -visualStep : visualStep;
      nextIndex = (index + step + visibleSections.length) % visibleSections.length;
    }
    const nextSection = visibleSections[nextIndex];
    setActiveSection(nextSection);
    window.requestAnimationFrame(() => document.getElementById(`patient-file-tab-${nextSection}`)?.focus());
  };

  return (
    <div className="modal-overlay patient-file-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }} style={{ zIndex: 1050 }}>
      <div
        ref={dialogRef}
        className="modal-content no-print-modal patient-file-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="patient-file-title"
        aria-describedby="patient-file-subtitle"
        dir={lang === 'ar' ? 'rtl' : 'ltr'}
      >
        <header className="patient-file-header">
          <div className="patient-file-identity">
            <div className="patient-file-avatar" aria-hidden="true">
              <User size={25} />
            </div>
            <div className="patient-file-identity-copy">
              <div className="patient-file-name-row">
                <h2 id="patient-file-title">{displayName}</h2>
                {profile?.status && <span className="patient-file-status">{localizedStatus(profile.status, lang)}</span>}
              </div>
              <p id="patient-file-subtitle">
                {lang === 'ar' ? 'ملف المريض' : 'Patient File'}
              </p>
            </div>
          </div>
          <button ref={closeButtonRef} type="button" className="patient-file-close" onClick={onClose} aria-label={lang === 'ar' ? 'إغلاق ملف المريض' : 'Close patient file'}>
            <X size={20} />
          </button>
        </header>

        <div className="modal-body patient-file-body">
          {loading ? (
            <div className="patient-file-state" role="status">
              <div className="spinner" style={{ margin: '0 auto 1rem' }}></div>
              <p>{lang === 'ar' ? 'جاري تحميل ملف المريض...' : 'Loading patient profile...'}</p>
            </div>
          ) : error ? (
            <div className="alert alert-error patient-file-state" role="alert">
              <AlertCircle size={32} />
              <p style={{ margin: 0 }}>{error}</p>
              <button type="button" className="btn btn-secondary" onClick={loadProfile}>
                {lang === 'ar' ? 'إعادة المحاولة' : 'Retry'}
              </button>
            </div>
          ) : profile ? (
            <div className="patient-file-content">
              {/* Demographics Summary Card */}
              <div className="patient-file-card">
                <section className="patient-file-number" aria-labelledby="patient-file-number-label">
                  <div className="patient-file-number-copy">
                    <span id="patient-file-number-label">{lang === 'ar' ? 'رقم الملف' : 'File number'}</span>
                    <strong dir="ltr">{profile.fileNumber || '—'}</strong>
                  </div>
                  <button type="button" className="patient-file-copy" onClick={handleCopyFileNumber} aria-label={lang === 'ar' ? 'نسخ رقم الملف' : 'Copy file number'} disabled={!profile.fileNumber}>
                    {fileCopied ? <Check size={16} /> : <Copy size={16} />}
                    <span>{fileCopied ? (lang === 'ar' ? 'تم النسخ' : 'Copied') : (lang === 'ar' ? 'نسخ' : 'Copy')}</span>
                  </button>
                </section>

                <section className="patient-file-details" aria-labelledby="patient-details-title">
                  <h3 id="patient-details-title">{lang === 'ar' ? 'بيانات المريض' : 'Patient details'}</h3>
                  <div className="patient-file-demographics">
                    <div className="patient-file-field">
                      <span>{lang === 'ar' ? 'رقم الهاتف' : 'Phone'}</span>
                      <strong dir="ltr">{profile.phone || '—'}</strong>
                    </div>
                    <div className="patient-file-field">
                      <span>{lang === 'ar' ? 'الجنس' : 'Gender'}</span>
                      <strong>{profile.gender === 'MALE' ? (lang === 'ar' ? 'ذكر' : 'Male') : profile.gender === 'FEMALE' ? (lang === 'ar' ? 'أنثى' : 'Female') : '—'}</strong>
                    </div>
                    <div className="patient-file-field">
                      <span>{lang === 'ar' ? 'تاريخ الميلاد' : 'Date of birth'}</span>
                      <strong>{formattedDateOfBirth}</strong>
                    </div>
                    <div className="patient-file-field">
                      <span>{lang === 'ar' ? 'العمر' : 'Age'}</span>
                      <strong>{age == null ? '—' : `${age} ${lang === 'ar' ? 'سنة' : 'years'}`}</strong>
                    </div>
                    <div className="patient-file-field">
                      <span>{lang === 'ar' ? 'الحالة' : 'Status'}</span>
                      <strong>{localizedStatus(profile.status, lang)}</strong>
                    </div>
                    <div className="patient-file-field patient-file-field--insurance">
                      <span className="patient-file-field-label"><Shield size={14} aria-hidden="true" />{lang === 'ar' ? 'التأمين' : 'Insurance'}</span>
                      <strong>{profile.insurance?.providerName || (lang === 'ar' ? 'غير متوفر' : 'Not available')}</strong>
                      {profile.insurance && <small>{lang === 'ar' ? 'نسبة التغطية' : 'Coverage'}: <bdi>{profile.insurance.coverageRate}%</bdi></small>}
                    </div>
                  </div>
                </section>

                <div className="patient-file-summary" aria-label={lang === 'ar' ? 'ملخص الملف' : 'File summary'}>
                  {[
                    ['appointments', lang === 'ar' ? 'المواعيد' : 'Appointments'],
                    ...(user?.role === 'DOCTOR' ? [
                      ['visits', lang === 'ar' ? 'السجلات الطبية' : 'Medical Records'],
                      ['prescriptions', lang === 'ar' ? 'الوصفات' : 'Prescriptions'],
                      ['labOrders', lang === 'ar' ? 'طلبات المختبر' : 'Lab orders']
                    ] : [['invoices', lang === 'ar' ? 'الفواتير' : 'Invoices']])
                  ].map(([key, label]) => <div key={key} className="patient-file-metric"><strong>{profile.summaryCounts?.[key] ?? 0}</strong><span>{label}</span></div>)}
                </div>

                {/* Patient Portal Link Management */}
                {canManagePortalLink && (
                  <div className={`patient-file-portal ${profile.portalLinked ? 'is-linked' : ''}`}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '1rem',
                        flexWrap: 'wrap'
                      }}
                    >
                      <div>
                        <strong
                          style={{
                            display: 'block',
                            marginBottom: '.25rem'
                          }}
                        >
                          {lang === 'ar'
                            ? 'ربط حساب بوابة المريض'
                            : 'Patient Portal Account Link'}
                        </strong>

                        <span
                          style={{
                            fontSize: '.85rem',
                            opacity: .8
                          }}
                        >
                          {profile.portalLinked
                            ? (
                              lang === 'ar'
                                ? 'هذا السجل مرتبط بالفعل بحساب مريض.'
                                : 'This patient record is already linked to a portal account.'
                            )
                            : (
                              lang === 'ar'
                                ? 'السجل غير مرتبط بحساب. يمكنك إصدار رمز آمن للمريض لربط حسابه بهذا السجل.'
                                : 'This record is not linked to an account. Generate a secure claim code for the patient.'
                            )}
                        </span>
                      </div>

                      {profile.portalLinked ? (
                        <span
                          className="badge badge-success"
                          style={{
                            padding: '6px 10px'
                          }}
                        >
                          {lang === 'ar'
                            ? 'مرتبط'
                            : 'Linked'}
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-primary"
                          disabled={claimLoading}
                          onClick={handleGenerateClaimCode}
                        >
                          {claimLoading
                            ? (
                              lang === 'ar'
                                ? 'جاري الإصدار...'
                                : 'Generating...'
                            )
                            : (
                              lang === 'ar'
                                ? 'إصدار رمز ربط'
                                : 'Generate Claim Code'
                            )}
                        </button>
                      )}
                    </div>

                    {claimError && (
                      <div
                        className="alert alert-error"
                        style={{
                          marginTop: '.75rem'
                        }}
                      >
                        {claimError}
                      </div>
                    )}

                    {!profile.portalLinked && claimCode && (
                      <div
                        style={{
                          marginTop: '1rem',
                          padding: '1rem',
                          borderRadius: '10px',
                          background: 'rgba(255,255,255,0.06)',
                          border: '1px dashed var(--border-color)'
                        }}
                      >
                        <span
                          style={{
                            display: 'block',
                            fontSize: '.8rem',
                            opacity: .75,
                            marginBottom: '.35rem'
                          }}
                        >
                          {lang === 'ar'
                            ? 'رمز ربط المريض'
                            : 'Patient Claim Code'}
                        </span>

                        <div
                          dir="ltr"
                          style={{
                            fontSize: '1.5rem',
                            fontWeight: 800,
                            letterSpacing: '.15em',
                            wordBreak: 'break-all'
                          }}
                        >
                          {claimCode}
                        </div>

                        <p
                          style={{
                            margin: '.6rem 0 0',
                            fontSize: '.85rem',
                            opacity: .8
                          }}
                        >
                          {lang === 'ar'
                            ? `الرمز صالح لمدة ${claimExpiresIn || 30} دقيقة ويُستخدم لربط هذا السجل بحساب المريض.`
                            : `This code is valid for ${claimExpiresIn || 30} minutes and can be used to link this record to the patient's account.`}
                        </p>

                        <div
                          style={{
                            display: 'flex',
                            gap: '.5rem',
                            marginTop: '.75rem',
                            flexWrap: 'wrap'
                          }}
                        >
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={handleCopyClaimCode}
                          >
                            {claimCopied
                              ? (
                                lang === 'ar'
                                  ? 'تم النسخ'
                                  : 'Copied'
                              )
                              : (
                                lang === 'ar'
                                  ? 'نسخ الرمز'
                                  : 'Copy Code'
                              )}
                          </button>

                          <button
                            type="button"
                            className="btn btn-secondary"
                            disabled={claimLoading}
                            onClick={handleGenerateClaimCode}
                          >
                            {lang === 'ar'
                              ? 'إصدار رمز جديد'
                              : 'Generate New Code'}
                          </button>
                        </div>

                        <p
                          style={{
                            margin: '.75rem 0 0',
                            fontSize: '.78rem',
                            opacity: .7
                          }}
                        >
                          {lang === 'ar'
                            ? 'أعطِ الرمز للمريض فقط بعد التأكد من هويته. سيحتاج أيضًا إلى إدخال تاريخ ميلاده عند الربط.'
                            : 'Only provide this code after verifying the patient’s identity. The patient must also enter their date of birth when linking the record.'}
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* Operational communication action; no fabricated health summary. */}
                <div className="patient-file-actions">
                  {profile.phone && (
                    <a
                      href={getWhatsAppLink(profile.phone, lang === 'ar' ? `مرحباً ${profile.fullNameAr}، نرحب بك في مركز الشفاء الطبي.` : `Hello ${profile.fullNameEn}, welcome to Al-Shifa Medical Center.`)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="patient-file-whatsapp"
                    >
                      <MessageCircle size={17} />
                      {lang === 'ar' ? 'واتساب' : 'WhatsApp'}
                    </a>
                  )}
                </div>
              </div>

              <nav className="patient-file-tabs" role="tablist" aria-label={lang === 'ar' ? 'أقسام ملف المريض' : 'Patient file sections'}>
                {visibleSections.map((section, index) => {
                  const labels = {
                    overview: lang === 'ar' ? 'نظرة عامة' : 'Overview',
                    appointments: lang === 'ar' ? 'المواعيد' : 'Appointments',
                    visits: lang === 'ar' ? 'السجلات الطبية' : 'Medical Records',
                    prescriptions: lang === 'ar' ? 'الوصفات' : 'Prescriptions',
                    laboratory: lang === 'ar' ? 'المختبر' : 'Laboratory',
                    billing: lang === 'ar' ? 'الفوترة' : 'Billing'
                  };
                  return <button key={section} id={`patient-file-tab-${section}`} type="button" role="tab" aria-selected={activeSection === section} aria-controls={`patient-file-panel-${section}`} tabIndex={activeSection === section ? 0 : -1} className={activeSection === section ? 'active' : ''} onClick={() => setActiveSection(section)} onKeyDown={(event) => handleSectionKeyDown(event, index)}>{labels[section]}</button>;
                })}
              </nav>

              {activeSection === 'overview' && (
                <section id="patient-file-panel-overview" role="tabpanel" aria-labelledby="patient-file-tab-overview" className="patient-file-section patient-file-overview">
                  <h4><FileText size={18} />{lang === 'ar' ? 'نظرة عامة' : 'Overview'}</h4>
                  <div className="patient-file-overview-grid">
                    <div><span>{lang === 'ar' ? 'الحالة الحالية' : 'Current status'}</span><strong>{localizedStatus(profile.status, lang)}</strong></div>
                    <div><span>{lang === 'ar' ? 'آخر موعد مسجل' : 'Latest appointment'}</span><strong>{profile.appointments?.[0]?.appointmentDate || '—'}</strong></div>
                    <div><span>{lang === 'ar' ? 'التغطية التأمينية' : 'Insurance coverage'}</span><strong>{profile.insurance ? `${profile.insurance.coverageRate}%` : '—'}</strong></div>
                  </div>
                </section>
              )}

              {activeSection === 'appointments' && (
                <section id="patient-file-panel-appointments" role="tabpanel" aria-labelledby="patient-file-tab-appointments" className="patient-file-section">
                  <h4><Calendar size={18} />{lang === 'ar' ? 'المواعيد' : 'Appointments'}</h4>
                  {!(profile.appointments || []).length ? <p className="patient-file-empty">{lang === 'ar' ? 'لا توجد مواعيد مسجلة.' : 'No appointments recorded.'}</p> : (
                    <div className="patient-file-list">{profile.appointments.map((appointment) => <article key={appointment.id} className="patient-file-list-item"><div><strong>{appointment.appointmentDate}</strong><span dir="ltr">{appointment.appointmentTime}</span></div><div>{appointment.doctor ? (lang === 'ar' ? appointment.doctor.fullNameAr : appointment.doctor.fullNameEn) : '—'}</div><span className="patient-file-status">{localizedStatus(appointment.status, lang)}</span></article>)}</div>
                  )}
                </section>
              )}

              {activeSection === 'billing' && (
                <section id="patient-file-panel-billing" role="tabpanel" aria-labelledby="patient-file-tab-billing" className="patient-file-section">
                  <h4><Receipt size={18} />{lang === 'ar' ? 'الفوترة' : 'Billing'}</h4>
                  {!(profile.invoices || []).length ? <p className="patient-file-empty">{lang === 'ar' ? 'لا توجد فواتير مسجلة.' : 'No invoices recorded.'}</p> : <div className="patient-file-list">{profile.invoices.map((invoice) => <article key={invoice.id} className="patient-file-list-item"><div><strong>{new Date(invoice.invoiceDate).toLocaleDateString(lang === 'ar' ? 'ar' : 'en')}</strong><span>{invoice.invoiceType}</span></div><strong>{invoice.totalAmountSdg.toLocaleString(lang === 'ar' ? 'ar' : 'en')} {lang === 'ar' ? 'ج.س' : 'SDG'}</strong><span className="patient-file-status">{localizedStatus(invoice.paymentStatus, lang)}</span></article>)}</div>}
                </section>
              )}

              {activeSection === 'prescriptions' && (
                <section id="patient-file-panel-prescriptions" role="tabpanel" aria-labelledby="patient-file-tab-prescriptions" className="patient-file-section">
                  <h4><Pill size={18} />{lang === 'ar' ? 'الوصفات' : 'Prescriptions'}</h4>
                  {!(profile.prescriptions || []).length ? <p className="patient-file-empty">{lang === 'ar' ? 'لا توجد وصفات ضمن السجل المصرح به.' : 'No prescriptions in the authorized record.'}</p> : <div className="patient-file-list">{profile.prescriptions.map((prescription) => <article key={prescription.id} className="patient-file-detail-card"><header><strong>{new Date(prescription.prescriptionDate).toLocaleDateString(lang === 'ar' ? 'ar' : 'en')}</strong><span className="patient-file-status">{localizedStatus(prescription.status, lang)}</span></header>{prescription.medicines.map((medicine, index) => <div className="patient-file-medicine" key={`${prescription.id}-${index}`}><strong>{lang === 'ar' ? medicine.nameAr || medicine.nameEn : medicine.nameEn || medicine.nameAr}</strong><span>{[medicine.strength, medicine.dosage, medicine.duration].filter(Boolean).join(' · ')}</span><small>{lang === 'ar' ? medicine.instructionsAr || medicine.instructionsEn : medicine.instructionsEn || medicine.instructionsAr}</small></div>)}</article>)}</div>}
                </section>
              )}

              {activeSection === 'laboratory' && (
                <section id="patient-file-panel-laboratory" role="tabpanel" aria-labelledby="patient-file-tab-laboratory" className="patient-file-section">
                  <h4><TestTube size={18} />{lang === 'ar' ? 'المختبر' : 'Laboratory'}</h4>
                  {!(profile.laboratory || []).length ? <p className="patient-file-empty">{lang === 'ar' ? 'لا توجد طلبات مختبر ضمن السجل المصرح به.' : 'No laboratory orders in the authorized record.'}</p> : <div className="patient-file-list">{profile.laboratory.map((order) => <article key={order.id} className="patient-file-detail-card"><header><strong>{new Date(order.orderDate).toLocaleDateString(lang === 'ar' ? 'ar' : 'en')}</strong><span className="patient-file-status">{localizedStatus(order.status, lang)}</span></header>{order.tests.map((test, index) => <div className="patient-file-lab" key={`${order.id}-${index}`}><strong>{lang === 'ar' ? test.nameAr || test.nameEn : test.nameEn || test.nameAr}</strong><span>{test.resultValue || (lang === 'ar' ? 'لا توجد نتيجة بعد' : 'No result yet')}</span></div>)}</article>)}</div>}
                </section>
              )}

              {activeSection === 'visits' && (
                <section id="patient-file-panel-visits" role="tabpanel" aria-labelledby="patient-file-tab-visits" className="patient-file-section patient-file-visits">
                  <div className="patient-file-section-heading">
                    <h4><FileText size={18} />{lang === 'ar' ? 'السجلات الطبية' : 'Medical Records'}</h4>
                    {canViewMedicalRecords && <span>{lang === 'ar' ? 'مرتبة من الأحدث للأقدم' : 'Newest first'}</span>}
                  </div>

                  {!canViewMedicalRecords ? (
                    <div className="patient-file-clinical-access" role="status">
                      <Shield size={28} aria-hidden="true" />
                      <p>{lang === 'ar' ? 'السجلات الطبية متاحة فقط للممارسين المصرح لهم.' : 'Medical records are available only to authorized clinical practitioners.'}</p>
                    </div>
                  ) : medicalRecordsError ? (
                    <div className="patient-file-clinical-access" role="alert">
                      <AlertCircle size={28} aria-hidden="true" />
                      <p>{medicalRecordsError}</p>
                      <button type="button" className="btn btn-secondary" onClick={loadProfile}>{lang === 'ar' ? 'إعادة المحاولة' : 'Retry'}</button>
                    </div>
                  ) : medicalRecords.length === 0 ? (
                    <div className="patient-file-clinical-access patient-file-clinical-empty">
                      <FileText size={30} aria-hidden="true" />
                      <p>{lang === 'ar' ? 'لا توجد سجلات طبية لهذا المريض حتى الآن.' : 'No medical records are available for this patient yet.'}</p>
                    </div>
                  ) : (
                    <div className="patient-file-records">
                      {medicalRecords.map((visit) => {
                        const visitDate = visit.visitDate ? new Date(visit.visitDate) : null;
                        const validVisitDate = visitDate && !Number.isNaN(visitDate.getTime());
                        const linkedAppointment = (profile.appointments || []).find((appointment) => appointment.id === visit.appointmentId);
                        const vitals = visit.vitals && typeof visit.vitals === 'object' ? visit.vitals : {};
                        const hasVitals = ['blood_pressure', 'heart_rate', 'temperature', 'weight'].some((key) => vitals[key]);
                        const doctorName = lang === 'ar'
                          ? visit.doctor?.fullNameAr || visit.doctor?.fullNameEn
                          : visit.doctor?.fullNameEn || visit.doctor?.fullNameAr;
                        const specialty = lang === 'ar'
                          ? visit.doctor?.specialtyAr || visit.doctor?.specialtyEn
                          : visit.doctor?.specialtyEn || visit.doctor?.specialtyAr;

                        return <article key={visit.id || visit.visitDate} className="patient-file-record-card">
                          <header>
                            <div className="patient-file-record-date">
                              <Calendar size={16} aria-hidden="true" />
                              <div>
                                <strong>{validVisitDate ? visitDate.toLocaleDateString(lang === 'ar' ? 'ar' : 'en') : (lang === 'ar' ? 'تاريخ غير متوفر' : 'Date unavailable')}</strong>
                                {validVisitDate && <span dir="ltr">{visitDate.toLocaleTimeString(lang === 'ar' ? 'ar' : 'en', { hour: '2-digit', minute: '2-digit' })}</span>}
                              </div>
                            </div>
                            {linkedAppointment?.status && <span className="patient-file-status">{localizedStatus(linkedAppointment.status, lang)}</span>}
                          </header>

                          {(doctorName || specialty) && <div className="patient-file-record-doctor"><strong>{lang === 'ar' ? 'الطبيب' : 'Doctor'}</strong><span>{[doctorName, specialty].filter(Boolean).join(' · ')}</span></div>}

                          {(visit.symptoms || visit.diagnosis || visit.treatment || visit.clinicalNotes) && <div className="patient-file-clinical-grid">
                            {visit.symptoms && <div><span>{lang === 'ar' ? 'الشكوى والأعراض' : 'Chief complaint / symptoms'}</span><p>{visit.symptoms}</p></div>}
                            {visit.diagnosis && <div><span>{lang === 'ar' ? 'التشخيص' : 'Diagnosis'}</span><p>{visit.diagnosis}</p></div>}
                            {visit.treatment && <div><span>{lang === 'ar' ? 'خطة العلاج' : 'Treatment plan'}</span><p>{visit.treatment}</p></div>}
                            {visit.clinicalNotes && <div><span>{lang === 'ar' ? 'الملاحظات السريرية' : 'Clinical notes'}</span><p>{visit.clinicalNotes}</p></div>}
                          </div>}

                          {hasVitals && <div className="patient-file-vitals" aria-label={lang === 'ar' ? 'العلامات الحيوية' : 'Vital signs'}>
                            {vitals.blood_pressure && <span><small>{lang === 'ar' ? 'ضغط الدم' : 'Blood pressure'}</small><strong dir="ltr">{vitals.blood_pressure}</strong></span>}
                            {vitals.heart_rate && <span><small>{lang === 'ar' ? 'النبض' : 'Heart rate'}</small><strong dir="ltr">{vitals.heart_rate} bpm</strong></span>}
                            {vitals.temperature && <span><small>{lang === 'ar' ? 'الحرارة' : 'Temperature'}</small><strong dir="ltr">{vitals.temperature} °C</strong></span>}
                            {vitals.weight && <span><small>{lang === 'ar' ? 'الوزن' : 'Weight'}</small><strong dir="ltr">{vitals.weight} kg</strong></span>}
                          </div>}

                          <footer className="patient-file-record-related">
                            {visit.prescriptionsCount > 0 && <span><Pill size={14} />{lang === 'ar' ? `الوصفات المرتبطة: ${visit.prescriptionsCount}` : `Related prescriptions: ${visit.prescriptionsCount}`}</span>}
                            {visit.labOrdersCount > 0 && <span><TestTube size={14} />{lang === 'ar' ? `طلبات المختبر: ${visit.labOrdersCount}` : `Laboratory orders: ${visit.labOrdersCount}`}</span>}
                            {typeof onSelectSummary === 'function' && <button type="button" className="btn btn-secondary" onClick={() => onSelectSummary(visit.recordId || visit.id || visit.appointmentId)}><Printer size={14} />{lang === 'ar' ? 'ملخص الزيارة والطباعة' : 'Visit Summary / Print'}</button>}
                          </footer>
                        </article>;
                      })}
                    </div>
                  )}
                </section>
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
export function PostVisitSummaryModal({ summaryId, onClose, lang }) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorDetails, setErrorDetails] = useState('');
  const [emailing, setEmailing] = useState(false);
  const [emailMsg, setEmailMsg] = useState('');

  const loadSummary = useCallback(async () => {
    if (!summaryId) return;
    const idToFetch = typeof summaryId === 'object' ? (summaryId.id || summaryId.recordId || summaryId.appointmentId) : summaryId;
    if (!idToFetch) return;
    setLoading(true);
    setErrorDetails('');
    try {
      const res = await fetchWithAuth(`/api/records/${idToFetch}/summary`);
      const contentType = res.headers.get('content-type') || '';
      if (!res.ok) {
        if (contentType.includes('application/json')) {
          const errData = await res.json();
          const message =
            typeof errData.error === 'object'
              ? errData.error?.message
              : errData.error;

          throw new Error(
            message || `HTTP ${res.status}: Failed to retrieve summary`
          );
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
    } catch (err) {
      console.error('Error fetching summary:', err);
      setErrorDetails(err.message || 'Network connection failed.');
    } finally {
      setLoading(false);
    }
  }, [summaryId]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  const handleEmailSummary = async () => {
    const idToFetch = typeof summaryId === 'object' ? (summaryId.id || summaryId.recordId || summaryId.appointmentId) : summaryId;
    if (!idToFetch) return;
    setEmailing(true);
    setEmailMsg('');
    try {
      const res = await fetchWithAuth(`/api/records/${idToFetch}/send-summary`, {
        method: 'POST',
        body: JSON.stringify({})
      });
      const contentType = res.headers.get('content-type') || '';
      if (!res.ok) {
        if (contentType.includes('application/json')) {
          const errData = await res.json();
          setEmailMsg(
          errData.error ||
            (lang === 'ar'
              ? 'تعذر إرسال البريد الإلكتروني.'
              : 'Failed to send email.')
        );
        } else {
          setEmailMsg(`Server returned status ${res.status}`);
        }
        return;
      }
      await res.json();
      setEmailMsg(lang === 'ar' ? 'تم إرسال ملخص الزيارة إلى البريد بنجاح.' : 'Post-visit summary emailed successfully!');
    } catch {
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
            <div><strong>{lang === 'ar' ? 'تاريخ الزيارة:' : 'Visit Date:'}</strong> {new Date(summary.visitDate).toLocaleDateString(
      lang === 'ar' ? 'ar' : 'en'
    )}</div>
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

          {/* Laboratory Results */}
          {summary.labOrders && summary.labOrders.length > 0 && (
            <div style={{ marginBottom: '1rem' }}>
              <h4
                style={{
                  fontSize: '0.9rem',
                  color: 'var(--primary)',
                  marginBottom: '0.4rem'
                }}
              >
                {lang === 'ar'
                  ? 'نتائج الفحوصات المخبرية'
                  : 'Laboratory Results'}
              </h4>

              <table className="staff-table" style={{ fontSize: '0.8rem' }}>
                <thead>
                  <tr>
                    <th>{lang === 'ar' ? 'الفحص' : 'Test'}</th>
                    <th>{lang === 'ar' ? 'النتيجة' : 'Result'}</th>
                    <th>{lang === 'ar' ? 'المجال المرجعي' : 'Reference Range'}</th>
                    <th>{lang === 'ar' ? 'الحالة' : 'Status'}</th>
                  </tr>
                </thead>

                <tbody>
                  {summary.labOrders.map((lab, idx) => {
                    const hasMin = lab.referenceRangeMin !== '';
                    const hasMax = lab.referenceRangeMax !== '';

                    let referenceRange = '—';

                    if (hasMin && hasMax) {
                      referenceRange = `${lab.referenceRangeMin} - ${lab.referenceRangeMax}`;
                    } else if (hasMin) {
                      referenceRange = `≥ ${lab.referenceRangeMin}`;
                    } else if (hasMax) {
                      referenceRange = `≤ ${lab.referenceRangeMax}`;
                    }

                    return (
                      <tr key={`${lab.serviceNameEn || lab.serviceNameAr}-${idx}`}>
                        <td>
                          {lang === 'ar'
                            ? lab.serviceNameAr
                            : lab.serviceNameEn}
                        </td>

                        <td>{lab.resultValue || '—'}</td>

                        <td>{referenceRange}</td>

                        <td>
                          {lab.isOutOfRange ? (
                            <span className="badge badge-danger">
                              {lang === 'ar' ? 'غير طبيعي' : 'Abnormal'}
                            </span>
                          ) : (
                            <span className="badge badge-success">
                              {lang === 'ar' ? 'طبيعي / غير محدد' : 'Normal / Not flagged'}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

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
