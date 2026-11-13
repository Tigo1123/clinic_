import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Calendar, Check, Copy, FileText, MessageCircle, Pill, Printer, Receipt, Shield, TestTube, User, X } from 'lucide-react';
import { fetchWithAuth } from '../../../services/staff/staffApi';
import { useAuth } from '../../../app/auth/auth-context';
import './patientFile.css';
import { useFacilityBranding } from '../../../app/branding/FacilityBrandingContext.js';
import { getWhatsAppLink } from './clinicalShared.js';

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

export function PatientProfileModal({ patientId, onClose, lang, onSelectSummary, nestedModalOpen = false }) {
  const { user } = useAuth();
  const branding = useFacilityBranding();
  const dialogRef = useRef(null);
  const closeButtonRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const nestedModalOpenRef = useRef(nestedModalOpen);

  const [loadedProfile, setLoadedProfile] = useState(null);
  const [loadedProfilePatientId, setLoadedProfilePatientId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const profileRequestRef = useRef(0);
  const profile = loadedProfilePatientId === patientId ? loadedProfile : null;
  const profileLoading = loading || loadedProfilePatientId !== patientId;

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
    const requestId = ++profileRequestRef.current;
    setLoading(true);
    setError('');
    setLoadedProfile(null);
    setLoadedProfilePatientId(null);
    try {
      const res = await fetchWithAuth(`/api/patients/${patientId}/profile`);
      if (profileRequestRef.current !== requestId) return;
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const apiError = typeof errData.error === 'object' ? errData.error : null;
        if (apiError?.code === 'CLINICAL_DATA_UNREADABLE') {
          throw new Error(lang === 'ar' ? 'المعلومات السريرية غير متاحة حاليًا.' : 'Clinical information is unavailable.');
        }
        throw new Error(apiError?.message || errData.error || `HTTP ${res.status}: Failed to load profile`);
      }
      const data = await res.json();
      if (profileRequestRef.current !== requestId) return;
      setLoadedProfile(data);
      setLoadedProfilePatientId(patientId);
    } catch (err) {
      if (profileRequestRef.current !== requestId) return;
      setLoadedProfilePatientId(patientId);
      console.error('Error fetching patient profile:', err);
      setError(
        err.message ||
          (lang === 'ar'
            ? 'تعذر تحميل ملف المريض.'
            : 'Failed to load patient profile.')
      );
    } finally {
      if (profileRequestRef.current === requestId) setLoading(false);
    }
  }, [patientId, lang]);

  useEffect(() => {
    loadProfile();
    return () => { profileRequestRef.current += 1; };
  }, [loadProfile]);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    nestedModalOpenRef.current = nestedModalOpen;
  }, [nestedModalOpen]);

  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    (closeButtonRef.current || dialogRef.current)?.focus();

    const handleKeyDown = (event) => {
      if (nestedModalOpenRef.current) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
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
  }, []);

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
    <div className="modal-overlay patient-file-overlay modal-layer--patient-file" onMouseDown={(event) => { if (event.target === event.currentTarget && !nestedModalOpen) onClose(); }}>
      <div
        ref={dialogRef}
        className="modal-content no-print-modal patient-file-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="patient-file-title"
        aria-describedby="patient-file-subtitle"
        aria-hidden={nestedModalOpen || undefined}
        inert={nestedModalOpen ? '' : undefined}
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
          {profileLoading ? (
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
                    {Object.prototype.hasOwnProperty.call(profile, 'bloodType') && (
                      <div className="patient-file-field patient-file-field--blood-type">
                        <span>{lang === 'ar' ? 'فصيلة الدم' : 'Blood Type'}</span>
                        <strong dir="ltr">
                          {profile.bloodType || (lang === 'ar' ? 'غير مسجلة' : 'Not recorded')}
                        </strong>
                      </div>
                    )}
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
                      href={getWhatsAppLink(profile.phone, lang === 'ar' ? `مرحباً ${profile.fullNameAr}، نرحب بك في ${branding.displayNameAr}.` : `Hello ${profile.fullNameEn}, welcome to ${branding.displayNameEn}.`)}
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
                            {typeof onSelectSummary === 'function' && <button type="button" className="btn btn-secondary" onClick={(event) => onSelectSummary(visit.recordId || visit.id || visit.appointmentId, event.currentTarget)}><Printer size={14} />{lang === 'ar' ? 'ملخص الزيارة والطباعة' : 'Visit Summary / Print'}</button>}
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
