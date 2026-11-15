import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ChevronDown, ChevronRight, FileText } from 'lucide-react';
import { formatPatientDateTime } from '../patientRecord';
import { useApi, State, Empty, doctorName } from './shared.jsx';

export function LabResults() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith('ar') ? 'ar' : 'en';
  const { data, error, loading, reload } = useApi('/api/patient/lab-results');
  const [expandedId, setExpandedId] = useState(null);

  const getTestName = (test) => {
    if (test?.service) {
      return lang === 'ar'
        ? test.service.labelAr || test.service.labelEn
        : test.service.labelEn || test.service.labelAr;
    }
    return test?.customTestName || t('customLabTest');
  };

  const getReferenceRange = (test) => {
    const min = test?.referenceRangeMin;
    const max = test?.referenceRangeMax;
    if (min == null && max == null) return t('notAvailable');
    if (min != null && max != null) return `${min} – ${max}`;
    if (min != null) return `${t('greaterThanOrEqual')} ${min}`;
    return `${t('lessThanOrEqual')} ${max}`;
  };

  const formatDate = (value) => {
    if (!value) return t('notAvailable');
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return t('notAvailable');
    return date.toLocaleDateString(lang === 'ar' ? 'ar' : 'en', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const toggleExpand = (id) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  return (
    <State loading={loading} error={error} onRetry={reload}>
      <div className="patient-lab-results">
        <Link to="/patient" className="patient-back-link">
          <ArrowLeft size={18} strokeWidth={1.8} aria-hidden="true" />
          {t('patientBack')}
        </Link>

        <h1 className="patient-page-title ui-page-title">{t('labResults')}</h1>

        {!data?.length ? (
          <Empty>{t('noRecords')}</Empty>
        ) : (
          <div className="patient-panel">
            {data.map((item) => {
              const isExpanded = expandedId === item.id;
              const doctor = item?.doctor;
              const doctorDisplayName = doctor ? doctorName(doctor, lang) : t('notAvailable');
              const testsSummary = (item.tests || []).map(getTestName).join(', ') || t('laboratoryReport');
              const hasAbnormal = (item.tests || []).some((test) => Boolean(test.isOutOfRange));

              return (
                <div key={item.id} className="patient-lab-row">
                  <button
                    type="button"
                    onClick={() => toggleExpand(item.id)}
                    aria-expanded={isExpanded}
                    className="patient-lab-row__trigger"
                  >
                    <div className="patient-lab-row__content">
                      <span className="patient-lab-row__tests">
                        {testsSummary}
                      </span>
                      <span className="patient-lab-row__sub">
                        <span className="ui-mono">
                          {t('labOrderDate')}: {formatDate(item.orderDate)}
                        </span>
                        {' · '}{doctorDisplayName}
                      </span>
                      <span className={`ui-status ${hasAbnormal ? 'ui-status--danger' : 'ui-status--ok'} patient-lab-row__status`}>
                        <span aria-hidden="true" className="patient-lab-row__dot" />
                        {hasAbnormal ? t('abnormalResult') : t('released')}
                      </span>
                    </div>

                    <div className="patient-lab-row__arrow">
                      {isExpanded ? (
                        <ChevronDown size={18} strokeWidth={1.8} aria-hidden="true" />
                      ) : (
                        <ChevronRight size={18} strokeWidth={1.8} className="patient-row-link__arrow" aria-hidden="true" />
                      )}
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="patient-lab-expanded">
                      <div className="patient-lab-meta">
                        <div>
                          <span>{t('doctor')}:</span>
                          <strong>{doctorDisplayName}</strong>
                        </div>
                        <div>
                          <span>{t('releasedAt')}:</span>
                          <strong className="ui-mono">{formatPatientDateTime(item.releasedAt, lang, t('notAvailable'))}</strong>
                        </div>
                        <div>
                          <span>{t('testsCount')}:</span>
                          <strong className="ui-mono">{item.tests?.length || 0}</strong>
                        </div>
                      </div>

                      <div className="patient-lab-tests-list">
                        {(item.tests || []).map((test) => {
                          const abnormal = Boolean(test.isOutOfRange);
                          return (
                            <article
                              key={test.id}
                              className="patient-lab-card"
                            >
                              <div className="patient-lab-card__header">
                                <div>
                                  <span className="patient-lab-card__eyebrow">
                                    {t('laboratoryReport')}
                                  </span>
                                  <h3 className="patient-lab-card__title">
                                    {getTestName(test)}
                                  </h3>
                                </div>
                                <span className={`ui-status ${abnormal ? 'ui-status--danger' : 'ui-status--ok'} patient-lab-card__badge`}>
                                  {abnormal ? t('abnormalResult') : t('normalResult')}
                                </span>
                              </div>

                              <div className="patient-lab-card__row">
                                <span>
                                  {t('result')}:{' '}
                                  <strong className="ui-mono" dir="auto">
                                    {test.resultValue ?? t('notAvailable')}
                                  </strong>
                                </span>
                                <span className="patient-lab-card__ref">
                                  {t('referenceRange')}:{' '}
                                  <bdi dir="ltr" className="ui-mono">
                                    {getReferenceRange(test)}
                                  </bdi>
                                </span>
                              </div>

                              <div className="patient-lab-card__status-line">
                                <span>{t('resultStatus')}: </span>
                                <strong>
                                  {abnormal
                                    ? t('outsideReferenceRange')
                                    : t('withinReferenceRange')}
                                </strong>
                              </div>

                              {test.attachmentPath && (
                                <div className="patient-lab-card__attach-wrap">
                                  <a
                                    className="patient-button secondary patient-lab-card__attach-btn"
                                    href={test.attachmentPath}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    <FileText size={14} aria-hidden="true" />
                                    {t('viewLabAttachment')}
                                  </a>
                                </div>
                              )}
                            </article>
                          );
                        })}
                      </div>

                      <p className="patient-lab-disclaimer">
                        {t('labResultDisclaimer')}
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </State>
  );
}
