import { useTranslation } from 'react-i18next';
import { formatPatientDateTime } from '../patientRecord';
import { doctorName, Collection } from './shared.jsx';

export function LabResults() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith('ar') ? 'ar' : 'en';

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

    if (min == null && max == null) {
      return t('notAvailable');
    }

    if (min != null && max != null) {
      return `${min} – ${max}`;
    }

    if (min != null) {
      return `${t('greaterThanOrEqual')} ${min}`;
    }

    return `${t('lessThanOrEqual')} ${max}`;
  };

  const formatDate = (value) => {
    if (!value) return t('notAvailable');

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return t('notAvailable');
    }

    return date.toLocaleDateString(
      lang === 'ar' ? 'ar' : 'en',
      {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      }
    );
  };

  return (
    <Collection
      path="/api/patient/lab-results"
      titleKey="labResults"
      render={(item) => {
        const doctor = item?.doctor;
        const doctorDisplayName = doctor
          ? doctorName(doctor, lang)
          : t('notAvailable');

        return (
          <div className="patient-lab-result">
            <div className="patient-lab-result__header">
              <div>
                <span className="patient-lab-result__eyebrow">
                  {t('laboratoryReport')}
                </span>

                <h2>
                  {t('labOrderDate')}: {formatDate(item.orderDate)}
                </h2>
              </div>

              <span className="patient-lab-result__released">
                {t('released')}
              </span>
            </div>

            <div className="patient-lab-result__meta">
              <div>
                <span>{t('doctor')}</span>
                <strong>{doctorDisplayName}</strong>
              </div>

              <div>
                <span>{t('releasedAt')}</span>
                <strong>{formatPatientDateTime(item.releasedAt, lang, t('notAvailable'))}</strong>
              </div>

              <div>
                <span>{t('testsCount')}</span>
                <strong>{item.tests?.length || 0}</strong>
              </div>
            </div>

            <div className="patient-lab-tests">
              {(item.tests || []).map((test) => {
                const abnormal = Boolean(test.isOutOfRange);

                return (
                  <article
                    className={`patient-lab-test ${
                      abnormal
                        ? 'patient-lab-test--abnormal'
                        : 'patient-lab-test--normal'
                    }`}
                    key={test.id}
                  >
                    <div className="patient-lab-test__heading">
                      <div>
                        <span className="patient-lab-test__category">
                          {t('laboratoryReport')}
                        </span>

                        <h3>{getTestName(test)}</h3>
                      </div>

                      <span
                        className={`patient-lab-status ${
                          abnormal
                            ? 'patient-lab-status--abnormal'
                            : 'patient-lab-status--normal'
                        }`}
                      >
                        {abnormal
                          ? t('abnormalResult')
                          : t('normalResult')}
                      </span>
                    </div>

                    <div className="patient-lab-test__result">
                      <span>{t('result')}</span>
                      <strong><bdi dir="auto">{test.resultValue ?? t('notAvailable')}</bdi></strong>
                    </div>

                    <div className="patient-lab-test__details">
                      <div>
                        <span>{t('referenceRange')}</span>
                        <strong><bdi dir="ltr">{getReferenceRange(test)}</bdi></strong>
                      </div>

                      <div>
                        <span>{t('resultStatus')}</span>
                        <strong>
                          {abnormal
                            ? t('outsideReferenceRange')
                            : t('withinReferenceRange')}
                        </strong>
                      </div>
                    </div>

                    {test.attachmentPath && (
                      <div className="patient-lab-test__actions">
                        <a
                          className="patient-button secondary"
                          href={test.attachmentPath}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
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
        );
      }}
    />
  );
}
