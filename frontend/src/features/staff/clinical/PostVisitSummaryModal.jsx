import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Mail, MessageCircle, Printer, X } from 'lucide-react';
import { fetchWithAuth } from '../../../services/staff/staffApi';
import './patientFile.css';
import { useFacilityBranding } from '../../../app/branding/FacilityBrandingContext.js';
import FacilityIdentityLine from '../components/FacilityIdentityLine';
import { getWhatsAppLink } from './clinicalShared.js';
import { lockPageScroll } from '../../../utils/scrollLock.js';

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
    const unlockScroll = lockPageScroll();
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
      unlockScroll();
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
        <div ref={dialogRef} tabIndex={-1} className="modal-content-panel visit-summary-dialog visit-summary-dialog--state" role="dialog" aria-modal="true" aria-label={lang === 'ar' ? 'ملخص الزيارة' : 'Visit Summary'}>
          <p>{lang === 'ar' ? 'جاري تحميل ملخص الزيارة...' : 'Loading Visit Summary...'}</p>
        </div>
      </div>
    );
  }

  if (!summary) {
    return renderModal(
      <div className={`${overlayClassName} no-print-section`} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
        <div ref={dialogRef} tabIndex={-1} className="modal-content-panel visit-summary-dialog visit-summary-dialog--state" role="dialog" aria-modal="true" aria-label={lang === 'ar' ? 'ملخص الزيارة' : 'Visit Summary'}>
          <p className="visit-summary-error-title">
            {lang === 'ar' ? 'تعذر تحميل ملخص الزيارة. حاول مرة أخرى.' : 'Unable to load the visit summary. Please try again.'}
          </p>
          {errorDetails && <p className="visit-summary-error-details">{errorDetails}</p>}
          <div className="visit-summary-error-actions">
            <button ref={closeButtonRef} type="button" className="btn btn-secondary" onClick={onClose}>{lang === 'ar' ? 'إغلاق' : 'Close'}</button>
            <button type="button" className="btn btn-primary" onClick={loadSummary}>{lang === 'ar' ? 'إعادة المحاولة' : 'Retry'}</button>
          </div>
        </div>
      </div>
    );
  }

  return renderModal(
    <div className={overlayClassName} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={dialogRef} tabIndex={-1} className="modal-content-panel visit-summary-dialog" role="dialog" aria-modal="true" aria-labelledby="visit-summary-title">
        {/* Actions bar (hidden during print) */}
        <div className="no-print-section visit-summary-header">
          <h3 id="visit-summary-title" className="visit-summary-title">
            {lang === 'ar' ? 'ملخص الزيارة' : 'Post-Visit Summary'}
          </h3>
          <button ref={closeButtonRef} type="button" className="patient-file-close" aria-label={lang === 'ar' ? 'إغلاق ملخص الزيارة' : 'Close visit summary'} onClick={onClose}><X size={20} /></button>
        </div>

        {/* Printable Area */}
        <div className="printable-visit-summary">
          <div className="printable-visit-summary__header">
            <FacilityIdentityLine language={lang} />
            <p className="visit-summary-subtitle">
              {lang === 'ar' ? 'ملخص زيارة المريض' : 'Patient Visit Summary'}
            </p>
          </div>

          <div className="printable-visit-summary__grid">
            <div><strong>{lang === 'ar' ? 'اسم المريض:' : 'Patient Name:'}</strong> {lang === 'ar' ? summary.patient.fullNameAr : summary.patient.fullNameEn}</div>
            <div><strong>{lang === 'ar' ? 'تاريخ الزيارة:' : 'Visit Date:'}</strong> {new Date(summary.visitDate).toLocaleDateString(
      lang === 'ar' ? 'ar' : 'en'
    )}</div>
            <div><strong>{lang === 'ar' ? 'الطبيب المعالج:' : 'Attending Doctor:'}</strong> {lang === 'ar' ? summary.doctor.fullNameAr : summary.doctor.fullNameEn}</div>
            <div><strong>{lang === 'ar' ? 'التخصص:' : 'Specialty:'}</strong> {lang === 'ar' ? summary.doctor.specialtyAr : summary.doctor.specialtyEn}</div>
          </div>

          {/* Vitals */}
          <div className="printable-visit-summary__vitals">
            <strong className="visit-summary-section-heading">{lang === 'ar' ? 'العلامات الحيوية (Vitals):' : 'Vital Signs:'}</strong>
            <div className="printable-visit-summary__vitals-grid">
              <div>BP: <strong className="ui-mono">{summary.vitals?.blood_pressure || 'N/A'}</strong></div>
              <div>HR: <strong className="ui-mono">{summary.vitals?.heart_rate || 'N/A'} bpm</strong></div>
              <div>Temp: <strong className="ui-mono">{summary.vitals?.temperature || 'N/A'} °C</strong></div>
              <div>Wt: <strong className="ui-mono">{summary.vitals?.weight || 'N/A'} kg</strong></div>
            </div>
          </div>

          {/* Clinical Details */}
          <div className="printable-visit-summary__clinical">
            <p className="visit-summary-text-row"><strong>{lang === 'ar' ? 'التشخيص الطبي:' : 'Diagnosis:'}</strong> {summary.diagnosis}</p>
            <p className="visit-summary-text-row"><strong>{lang === 'ar' ? 'العلاج والخطة:' : 'Treatment Plan:'}</strong> {summary.treatment}</p>
          </div>

          {/* Laboratory Results */}
          {summary.labOrders && summary.labOrders.length > 0 && (
            <div className="visit-summary-section-block">
              <h4 className="visit-summary-subsection-title">
                {lang === 'ar'
                  ? 'نتائج الفحوصات المخبرية'
                  : 'Laboratory Results'}
              </h4>

              <table className="staff-table visit-summary-table">
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

                        <td className="ui-mono">{lab.resultValue || '—'}</td>

                        <td className="ui-mono">{referenceRange}</td>

                        <td>
                          {lab.isOutOfRange ? (
                            <span className="ui-status ui-status--danger">
                              {lang === 'ar' ? 'غير طبيعي' : 'Abnormal'}
                            </span>
                          ) : (
                            <span className="ui-status ui-status--ok">
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
            <div className="visit-summary-section-block">
              <h4 className="visit-summary-subsection-title">{lang === 'ar' ? 'الأدوية الموصوفة' : 'Prescribed Medications'}</h4>
              <table className="staff-table visit-summary-table">
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
          {Array.isArray(summary.instructions) && summary.instructions.length > 0 && <div className="visit-summary-instructions">
            <strong className="visit-summary-section-heading">{lang === 'ar' ? 'توجيهات وإرشادات المريض:' : 'Post-Visit Care Instructions:'}</strong>
            <ul className="visit-summary-instructions-list">
              {summary.instructions.map((inst, i) => <li key={`${inst}-${i}`} className="visit-summary-instruction-item">{inst}</li>)}
            </ul>
          </div>}
        </div>

        {/* Email Controls & Print Buttons (Hidden on print) */}
        <div className="no-print-section visit-summary-footer">
          {emailMsg && <div className="badge badge-success visit-summary-alert">{emailMsg}</div>}

          <div className="visit-summary-footer-row">
            <button className="btn btn-secondary" onClick={handleEmailSummary} disabled={emailing}>
              <Mail size={16} />
              {emailing ? (lang === 'ar' ? 'جاري الإرسال...' : 'Sending...') : (lang === 'ar' ? 'إرسال بالبريد' : 'Email Summary')}
            </button>

            <div className="visit-summary-footer-actions">
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
    </div>
  );
}
