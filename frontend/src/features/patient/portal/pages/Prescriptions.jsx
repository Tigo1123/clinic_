import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Pill, X } from 'lucide-react';
import { patientSocket } from '../../../../services/patient/patientSocket';
import { useApi, State, Empty } from './shared.jsx';

export function Prescriptions() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith('ar') ? 'ar' : 'en';
  const [searchParams, setSearchParams] = useSearchParams();
  const targetPrescriptionId = searchParams.get('prescriptionId');
  const { data, error, loading, reload } = useApi('/api/patient/prescriptions');
  const [highlightedId, setHighlightedId] = useState(null);
  const [staleNotice, setStaleNotice] = useState(false);
  const rowRefs = useRef(new Map());

  useEffect(() => {
    const handleNotification = (notif) => {
      if (notif?.eventType === 'PRESCRIPTION_READY' || notif?.targetType === 'prescription') {
        reload();
      }
    };
    patientSocket.on('notification', handleNotification);
    return () => {
      patientSocket.off('notification', handleNotification);
    };
  }, [reload]);

  useEffect(() => {
    if (!targetPrescriptionId || loading || error || !Array.isArray(data)) return;
    const match = data.find((item) => item.id === targetPrescriptionId);
    if (match) {
      setStaleNotice(false);
      setHighlightedId(match.id);
      rowRefs.current.get(match.id)?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    } else {
      setHighlightedId(null);
      setStaleNotice(true);
    }
  }, [data, error, loading, targetPrescriptionId]);

  const dismissStaleNotice = () => {
    setStaleNotice(false);
    if (targetPrescriptionId) {
      const next = new URLSearchParams(searchParams);
      next.delete('prescriptionId');
      setSearchParams(next, { replace: true });
    }
  };

  return (
    <State loading={loading} error={error} onRetry={reload}>
      <div className="patient-prescriptions">
        <Link to="/patient" className="patient-back-link">
          <ArrowLeft size={18} strokeWidth={1.8} aria-hidden="true" />
          {t('patientBack')}
        </Link>

        <h1 className="patient-page-title ui-page-title">{t('prescriptions')}</h1>

        {staleNotice && (
          <div role="status" className="patient-alert warning patient-stale-notice">
            <span>
              {lang === 'ar'
                ? 'الوصفة الطبية المشار إليها لم تعد متاحة في حسابك.'
                : 'The referenced prescription is no longer available in your account.'}
            </span>
            <button
              type="button"
              className="patient-stale-notice__dismiss"
              onClick={dismissStaleNotice}
              aria-label={t('close')}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        )}

        {!data?.length ? (
          <Empty>{t('noRecords')}</Empty>
        ) : (
          <div className="patient-panel">
            {data.map((item) => {
              const isHighlighted = highlightedId === item.id;
              return (
                <div
                  key={item.id}
                  ref={(node) => {
                    if (node) rowRefs.current.set(item.id, node);
                    else rowRefs.current.delete(item.id);
                  }}
                  className={`patient-hairline-row patient-prescription-row${isHighlighted ? ' patient-prescription-row--highlighted' : ''}`}
                >
                  <div className="patient-prescription-row__header">
                    <Pill size={16} strokeWidth={1.8} className="patient-prescription-row__icon" aria-hidden="true" />
                    <h2 className="patient-prescription-row__date ui-mono">
                      {new Date(item.prescriptionDate).toLocaleDateString(i18n.language, { year: 'numeric', month: 'short', day: 'numeric' })}
                    </h2>
                  </div>

                  <div className="patient-prescription-row__medicines">
                    {(item.medicines || []).map((m) => {
                      const name = lang === 'ar'
                        ? m.medicine?.labelAr || m.medicine?.labelEn || m.customDrugName
                        : m.medicine?.labelEn || m.medicine?.labelAr || m.customDrugName;
                      const instructions = lang === 'ar'
                        ? m.instructionsAr || m.instructionsEn
                        : m.instructionsEn || m.instructionsAr;
                      const qty = m.qtyPrescribed ?? m.quantity;

                      return (
                        <div key={m.id} className="patient-prescription-row__item">
                          <p className="patient-prescription-row__main">
                            <strong>{name}</strong>
                            {' — '}
                            <span>{m.dosage}, {m.duration}</span>
                            {qty != null && (
                              <span className="patient-prescription-row__qty">
                                {lang === 'ar' ? ` · الكمية: ${qty}` : ` · Qty: ${qty}`}
                              </span>
                            )}
                          </p>
                          {instructions && (
                            <p className="patient-prescription-row__instructions">
                              <span className="patient-prescription-row__instructions-label">
                                {lang === 'ar' ? 'التعليمات: ' : 'Instructions: '}
                              </span>
                              {instructions}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </State>
  );
}
