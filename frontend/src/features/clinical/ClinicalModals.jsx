import { useCallback, useEffect, useState } from 'react';
import { Activity, AlertCircle, AlertTriangle, Calendar, Clock, FileText, Mail, MessageCircle, MessageSquare, Printer, Shield, User, X } from 'lucide-react';
import { fetchWithAuth } from '../../services/staffApi';

function getWhatsAppLink(phone, message) {
  if (!phone) return '#';
  let cleaned = phone.replace(/[^0-9]/g, '');
  if (cleaned.startsWith('0')) cleaned = '249' + cleaned.substring(1);
  else if (!cleaned.startsWith('249') && cleaned.length === 9) cleaned = '249' + cleaned;
  return `https://wa.me/${cleaned}?text=${encodeURIComponent(message || '')}`;
}

export function PatientProfileModal({ patientId, onClose, lang, onSelectSummary }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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
      setError(err.message || 'Failed to load patient profile');
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

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
export function PostVisitSummaryModal({ summaryId, onClose, lang }) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorDetails, setErrorDetails] = useState('');
  const [emailing, setEmailing] = useState(false);
  const [emailMsg, setEmailMsg] = useState('');
  const [customEmail, setCustomEmail] = useState('');

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
      setCustomEmail('');
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
