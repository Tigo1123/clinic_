import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Mail, MessageCircle, Printer } from 'lucide-react';
import { fetchWithAuth } from '../../../services/staff/staffApi';
import './patientFile.css';
import { useFacilityBranding } from '../../../app/branding/FacilityBrandingContext.js';
import FacilityIdentityLine from '../components/FacilityIdentityLine';
import { getWhatsAppLink } from './clinicalShared.js';

/* ==========================================
   POST-VISIT SUMMARY & INSTRUCTIONS MODAL
   ========================================== */
export function PostVisitSummaryModal({ summaryId, onClose, lang, modalLayer = 'base', returnFocusTo = null }) {
  const branding = useFacilityBranding();
  const dialogRef = useRef(null);
  const closeButtonRef = useRef(null);
  const activeSummaryId = typeof summaryId === 'object' ? (summaryId?.id || summaryId?.recordId || summaryId?.appointmentId) : summaryId;
  const [loadedSummary, setLoadedSummary] = useState(null);
  const [loadedSummaryId, setLoadedSummaryId] = useState(null);
  const summary = loadedSummaryId === activeSummaryId ? loadedSummary : null;
  const [loading, setLoading] = useState(true);
  const [errorDetails, setErrorDetails] = useState('');
  const [emailing, setEmailing] = useState(false);
  const [emailMsg, setEmailMsg] = useState('');
  const summaryRequestRef = useRef(0);
  const summaryLoading = loading || loadedSummaryId !== activeSummaryId;

  const loadSummary = useCallback(async () => {
    if (!summaryId) return;
    const idToFetch = typeof summaryId === 'object' ? (summaryId.id || summaryId.recordId || summaryId.appointmentId) : summaryId;
    if (!idToFetch) return;
    const requestId = ++summaryRequestRef.current;
    setLoadedSummary(null);
    setLoadedSummaryId(null);
    setLoading(true);
    setErrorDetails('');
    setEmailMsg('');
    setEmailing(false);
    try {
      const res = await fetchWithAuth(`/api/records/${idToFetch}/summary`);
      if (summaryRequestRef.current !== requestId) return;
      const contentType = res.headers.get('content-type') || '';
      if (!res.ok) {
        if (contentType.includes('application/json')) {
          const errData = await res.json();
          if (summaryRequestRef.current !== requestId) return;
          const apiError = typeof errData.error === 'object' ? errData.error : null;
          const message = apiError?.code === 'CLINICAL_DATA_UNREADABLE'
            ? (lang === 'ar' ? 'المعلومات السريرية غير متاحة. لم يتم تحميل الملخص أو بدء الطباعة.' : 'Clinical information is unavailable. The summary was not loaded or prepared for printing.')
            : (apiError?.message || errData.error);

          throw new Error(
            message || `HTTP ${res.status}: Failed to retrieve summary`
          );
        } else {
          const htmlText = await res.text();
          if (summaryRequestRef.current !== requestId) return;
          throw new Error(`Server returned non-JSON error (${res.status}): ${htmlText.substring(0, 100)}...`);
        }
      }
      if (!contentType.includes('application/json')) {
        const text = await res.text();
        if (summaryRequestRef.current !== requestId) return;
        throw new Error(`Expected JSON response but received: ${text.substring(0, 100)}...`);
      }
      const data = await res.json();
      if (summaryRequestRef.current !== requestId) return;
      setLoadedSummary(data);
      setLoadedSummaryId(idToFetch);
    } catch (err) {
      if (summaryRequestRef.current !== requestId) return;
      setLoadedSummaryId(idToFetch);
      console.error('Error fetching summary:', err);
      setErrorDetails(err.message || 'Network connection failed.');
    } finally {
      if (summaryRequestRef.current === requestId) setLoading(false);
    }
  }, [summaryId, lang]);

  useEffect(() => {
    loadSummary();
    return () => { summaryRequestRef.current += 1; };
  }, [loadSummary]);

  useEffect(() => {
    const previousFocus = returnFocusTo || document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    (closeButtonRef.current || dialogRef.current)?.focus();

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
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

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus?.();
    };
  }, [onClose, returnFocusTo]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      (closeButtonRef.current || dialogRef.current)?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [loading]);

  const overlayClassName = `modal-overlay visit-summary-overlay modal-layer--${modalLayer === 'nested' ? 'nested' : 'base'}`;
  const renderModal = (content) => createPortal(content, document.body);

  const handleEmailSummary = async () => {
    const idToFetch = activeSummaryId;
    if (!idToFetch || !summary || summaryLoading) return;
    const requestId = summaryRequestRef.current;
    setEmailing(true);
    setEmailMsg('');
    try {
      const res = await fetchWithAuth(`/api/records/${idToFetch}/send-summary`, {
        method: 'POST',
        body: JSON.stringify({})
      });
      if (summaryRequestRef.current !== requestId) return;
      const contentType = res.headers.get('content-type') || '';
      if (!res.ok) {
        if (contentType.includes('application/json')) {
          const errData = await res.json();
          if (summaryRequestRef.current !== requestId) return;
          const apiError = typeof errData.error === 'object' ? errData.error : null;
          setEmailMsg(apiError?.code === 'CLINICAL_DATA_UNREADABLE'
            ? (lang === 'ar' ? 'المعلومات السريرية غير متاحة. لم يتم إرسال البريد الإلكتروني.' : 'Clinical information is unavailable. No email was sent.')
            : (apiError?.message || errData.error ||
            (lang === 'ar'
              ? 'تعذر إرسال البريد الإلكتروني.'
              : 'Failed to send email.')));
        } else {
          setEmailMsg(`Server returned status ${res.status}`);
        }
        return;
      }
      await res.json();
      if (summaryRequestRef.current !== requestId) return;
      setEmailMsg(lang === 'ar' ? 'تم إرسال ملخص الزيارة إلى البريد بنجاح.' : 'Post-visit summary emailed successfully!');
    } catch {
      if (summaryRequestRef.current === requestId) setEmailMsg('Error connecting to mail server.');
    } finally {
      if (summaryRequestRef.current === requestId) setEmailing(false);
    }
  };

  if (summaryLoading) {
    return renderModal(
      <div className={`${overlayClassName} no-print-section`} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
        <div ref={dialogRef} tabIndex={-1} className="modal-content-panel glass-panel" role="dialog" aria-modal="true" aria-label={lang === 'ar' ? 'ملخص الزيارة' : 'Visit Summary'} style={{ textAlign: 'center', padding: '2rem' }}>
          <p>{lang === 'ar' ? 'جاري تحميل ملخص الزيارة...' : 'Loading Visit Summary...'}</p>
        </div>
      </div>
    );
  }

  if (!summary) {
    return renderModal(
      <div className={`${overlayClassName} no-print-section`} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
        <div ref={dialogRef} tabIndex={-1} className="modal-content-panel glass-panel" role="dialog" aria-modal="true" aria-label={lang === 'ar' ? 'ملخص الزيارة' : 'Visit Summary'} style={{ textAlign: 'center', padding: '2rem' }}>
          <p style={{ color: 'var(--danger)', fontWeight: 'bold' }}>
            {lang === 'ar' ? 'تعذر تحميل ملخص الزيارة. حاول مرة أخرى.' : 'Unable to load the visit summary. Please try again.'}
          </p>
          {errorDetails && <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>{errorDetails}</p>}
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', marginTop: '1.25rem' }}>
            <button ref={closeButtonRef} type="button" className="btn btn-secondary" onClick={onClose}>{lang === 'ar' ? 'إغلاق' : 'Close'}</button>
            <button type="button" className="btn btn-primary" onClick={loadSummary}>{lang === 'ar' ? 'إعادة المحاولة' : 'Retry'}</button>
          </div>
        </div>
      </div>
    );
  }

  return renderModal(
    <div className={overlayClassName} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={dialogRef} tabIndex={-1} className="modal-content-panel glass-panel" role="dialog" aria-modal="true" aria-labelledby="visit-summary-title" style={{ maxWidth: '650px', maxHeight: '90vh', overflowY: 'auto' }}>
        {/* Actions bar (hidden during print) */}
        <div className="no-print-section" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem' }}>
          <h3 id="visit-summary-title" style={{ margin: 0, color: 'var(--primary)' }}>
            {lang === 'ar' ? 'ملخص الزيارة' : 'Post-Visit Summary'}
          </h3>
          <button ref={closeButtonRef} type="button" className="btn btn-secondary" aria-label={lang === 'ar' ? 'إغلاق ملخص الزيارة' : 'Close visit summary'} style={{ padding: '4px 8px' }} onClick={onClose}>✕</button>
        </div>

        {/* Printable Area */}
        <div className="printable-visit-summary" style={{ padding: '1rem', background: 'rgba(0,0,0,0.15)', borderRadius: 'var(--radius-md)' }}>
          <div style={{ textAlign: 'center', borderBottom: '2px solid var(--primary)', paddingBottom: '0.75rem', marginBottom: '1rem' }}>
            <FacilityIdentityLine language={lang} />
            <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
              {lang === 'ar' ? 'ملخص زيارة المريض' : 'Patient Visit Summary'}
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
                    <th>{lang === 'ar' ? 'تعليمات الدواء' : 'Medication Instructions'}</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.prescriptions.map((rx, idx) => (
                    <tr key={idx}>
                      <td>{lang === 'ar' ? rx.drugNameAr : rx.drugNameEn}</td>
                      <td>{rx.dosage}</td>
                      <td>{rx.duration}</td>
                      <td>{lang === 'ar' ? rx.instructionsAr || rx.instructionsEn || '—' : rx.instructionsEn || rx.instructionsAr || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Clinician-authored patient instructions only. The current schema has
              no dedicated field, so an absent/empty value is intentionally hidden. */}
          {Array.isArray(summary.instructions) && summary.instructions.length > 0 && <div style={{ fontSize: '0.85rem', borderTop: '1px dashed var(--border-color)', paddingTop: '0.75rem' }}>
            <strong style={{ color: 'var(--primary)' }}>{lang === 'ar' ? 'توجيهات وإرشادات المريض:' : 'Post-Visit Care Instructions:'}</strong>
            <ul style={{ margin: '0.4rem 0 0 1.2rem', padding: 0 }}>
              {summary.instructions.map((inst, i) => <li key={`${inst}-${i}`} style={{ marginBottom: '0.2rem' }}>{inst}</li>)}
            </ul>
          </div>}
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
                    ? `${branding.displayNameAr}: ملخص زيارة المريض (${summary.patient.fullNameAr}).\nالتشخيص: ${summary.diagnosis}.\nالعلاج: ${summary.treatment}.\nالوصفة: ${(summary.prescriptions || []).map(p => `${p.drugNameAr} (${p.dosage}، ${p.duration}${p.instructionsAr || p.instructionsEn ? `، ${p.instructionsAr || p.instructionsEn}` : ''})`).join(', ')}.`
                    : `${branding.displayNameEn}: Post-visit summary for ${summary.patient.fullNameEn}.\nDiagnosis: ${summary.diagnosis}.\nTreatment: ${summary.treatment}.\nPrescriptions: ${(summary.prescriptions || []).map(p => `${p.drugNameEn} (${p.dosage}, ${p.duration}${p.instructionsEn || p.instructionsAr ? `, ${p.instructionsEn || p.instructionsAr}` : ''})`).join(', ')}.`
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
