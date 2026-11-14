import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Pill } from 'lucide-react';
import { useApi, State, Empty } from './shared.jsx';

export function Prescriptions() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith('ar') ? 'ar' : 'en';
  const { data, error, loading, reload } = useApi('/api/patient/prescriptions');

  return (
    <State loading={loading} error={error} onRetry={reload}>
      <div className="patient-prescriptions">
        <Link to="/patient" className="patient-back-link">
          <ArrowLeft size={18} strokeWidth={1.8} aria-hidden="true" />
          {t('patientBack')}
        </Link>

        <h1 className="patient-page-title">{t('prescriptions')}</h1>

        {!data?.length ? (
          <Empty>{t('noRecords')}</Empty>
        ) : (
          <div className="patient-panel">
            {data.map((item) => (
              <div key={item.id} className="patient-hairline-row patient-prescription-row">
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

                    return (
                      <div key={m.id} className="patient-prescription-row__item">
                        <p className="patient-prescription-row__main">
                          <strong>{name}</strong>
                          {' — '}
                          <span>{m.dosage}, {m.duration}</span>
                          {m.quantity != null && (
                            <span className="patient-prescription-row__qty">
                              {lang === 'ar' ? ` · الكمية: ${m.quantity}` : ` · Qty: ${m.quantity}`}
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
            ))}
          </div>
        )}
      </div>
    </State>
  );
}
