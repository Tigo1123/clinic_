import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { patientApiRequest as apiRequest } from '../../../../services/apiClient';
import { CalendarDays } from 'lucide-react';
import Dialog from '../../../../components/ui/Dialog';
import { Skeleton } from '../../../../components/feedback/States';
import { formatPatientDateTime } from '../patientRecord';
import { useApi, State, Empty, doctorName } from './shared.jsx';

export function MedicalRecords(){
  const { t, i18n } = useTranslation();
  const {
    data,
    error,
    loading,
    reload
  } = useApi('/api/patient/medical-records');

  const [selectedRecord, setSelectedRecord] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const detailRequest = useRef(0);

  const lang =
    i18n.language?.startsWith('ar')
      ? 'ar'
      : 'en';

  const openRecord = async (recordId) => {
    const requestId = ++detailRequest.current;
    setDetailLoading(true);
    setDetailError('');
    setSelectedRecord({ id: recordId });

    try {
      const details = await apiRequest(
        `/api/patient/medical-records/${recordId}`
      );

      if (requestId === detailRequest.current) setSelectedRecord(details);
    } catch (requestError) {
      if (requestId === detailRequest.current) setDetailError(
        requestError?.message ||
        (
          lang === 'ar'
            ? 'تعذر تحميل تفاصيل السجل الطبي.'
            : 'Unable to load medical record details.'
        )
      );
    } finally {
      if (requestId === detailRequest.current) setDetailLoading(false);
    }
  };

  const closeRecord = () => {
    detailRequest.current += 1;
    setSelectedRecord(null);
    setDetailError('');
    setDetailLoading(false);
  };

  return (
    <State loading={loading} error={error} onRetry={reload}>
      <h1>{t('medicalRecords')}</h1>

      {!data?.length ? (
        <Empty>{t('noRecords')}</Empty>
      ) : (
        <div className="patient-list">
          {data.map((item) => (
            <button
              type="button"
              className="patient-card medical-record-card"
              key={item.id}
              onClick={() => openRecord(item.id)}
            >
              <div className="medical-record-card__header">
                <div>
                  <span className="medical-record-card__date">
                    <CalendarDays size={17}/>

                    {new Date(item.visitDate)
                      .toLocaleDateString(i18n.language)}
                  </span>

                  <h2>
                    {doctorName(
                      item.doctor,
                      i18n.language
                    )}
                  </h2>

                  <p>
                    {lang === 'ar'
                      ? (
                          item.doctor?.specialtyAr ||
                          item.doctor?.specialtyEn
                        )
                      : (
                          item.doctor?.specialtyEn ||
                          item.doctor?.specialtyAr
                        )}
                  </p>
                </div>

                <span className="medical-record-card__open">
                  {lang === 'ar'
                    ? 'عرض التفاصيل'
                    : 'View details'}
                </span>
              </div>

              <div className="medical-record-card__summary">
                <p>
                  <strong>
                    {t('diagnosisLabel')}:
                  </strong>{' '}
                  {item.diagnosis || '—'}
                </p>

                <p>
                  <strong>
                    {t('treatmentLabel')}:
                  </strong>{' '}
                  {item.treatment || '—'}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}

      <Dialog
        open={Boolean(selectedRecord)}
        title={
          lang === 'ar'
            ? 'تفاصيل السجل الطبي'
            : 'Medical Record Details'
        }
        description={
          lang === 'ar'
            ? 'تفاصيل الزيارة والتشخيص والعلاج والوصفات والنتائج المتاحة لك.'
            : 'Visit details, diagnosis, treatment, prescriptions and released results.'
        }
        onClose={closeRecord}
      >
        {detailLoading ? (
          <div style={{ padding: '1rem 0' }}>
            <Skeleton/>
          </div>
        ) : detailError ? (
          <div className="patient-alert error" role="alert">
            {detailError}
          </div>
        ) : selectedRecord?.visitDate ? (
          <div className="medical-record-details">

            <section>
              <h3>
                {lang === 'ar'
                  ? 'معلومات الزيارة'
                  : 'Visit Information'}
              </h3>

              <p>
                <strong>
                  {lang === 'ar'
                    ? 'التاريخ:'
                    : 'Date:'}
                </strong>{' '}

                {new Date(
                  selectedRecord.visitDate
                ).toLocaleString(i18n.language)}
              </p>

              <p>
                <strong>
                  {lang === 'ar'
                    ? 'الطبيب:'
                    : 'Doctor:'}
                </strong>{' '}

                {doctorName(
                  selectedRecord.doctor,
                  i18n.language
                )}
              </p>

              <p>
                <strong>
                  {lang === 'ar'
                    ? 'التخصص:'
                    : 'Specialty:'}
                </strong>{' '}

                {lang === 'ar'
                  ? (
                      selectedRecord.doctor
                        ?.specialtyAr ||
                      selectedRecord.doctor
                        ?.specialtyEn
                    )
                  : (
                      selectedRecord.doctor
                        ?.specialtyEn ||
                      selectedRecord.doctor
                        ?.specialtyAr
                    )}
              </p>
            </section>

            <section>
              <h3>
                {lang === 'ar'
                  ? 'التقييم الطبي'
                  : 'Clinical Assessment'}
              </h3>

              <p>
                <strong>
                  {lang === 'ar'
                    ? 'الأعراض:'
                    : 'Symptoms:'}
                </strong>{' '}

                {selectedRecord.symptoms || '—'}
              </p>

              <p>
                <strong>
                  {t('diagnosisLabel')}:
                </strong>{' '}

                {selectedRecord.diagnosis || '—'}
              </p>

              <p>
                <strong>
                  {t('treatmentLabel')}:
                </strong>{' '}

                {selectedRecord.treatment || '—'}
              </p>
            </section>

            {selectedRecord.vitalSigns &&
              Object.keys(
                selectedRecord.vitalSigns
              ).length > 0 && (
              <section>
                <h3>
                  {lang === 'ar'
                    ? 'العلامات الحيوية'
                    : 'Vital Signs'}
                </h3>

                <div className="medical-vitals-grid">
                  {Object.entries(
                    selectedRecord.vitalSigns
                  ).map(([key, value]) => (
                    <div key={key}>
                      <span>
                        {t(`patientVital_${key}`, { defaultValue: key.replaceAll('_', ' ') })}
                      </span>

                      <strong dir="ltr">
                        {value ?? '—'}
                      </strong>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section>
              <h3>
                {lang === 'ar'
                  ? 'الوصفات الطبية'
                  : 'Prescriptions'}
              </h3>

              {!selectedRecord.prescriptions
                ?.some(
                  (prescription) =>
                    prescription.medicines?.length
                ) ? (
                <p>
                  {lang === 'ar'
                    ? 'لا توجد أدوية في هذه الزيارة.'
                    : 'No medicines were prescribed during this visit.'}
                </p>
              ) : (
                selectedRecord.prescriptions
                  .flatMap(
                    (prescription) =>
                      prescription.medicines || []
                  )
                  .map((medicine) => (
                    <div
                      key={medicine.id}
                      className="medical-detail-item"
                    >
                      <strong>
                        {lang === 'ar'
                          ? (
                              medicine.medicine
                                ?.labelAr ||
                              medicine.medicine
                                ?.labelEn ||
                              medicine.customDrugName
                            )
                          : (
                              medicine.medicine
                                ?.labelEn ||
                              medicine.medicine
                                ?.labelAr ||
                              medicine.customDrugName
                            )}
                      </strong>

                      <p>
                        {lang === 'ar'
                          ? 'الجرعة'
                          : 'Dosage'}
                        :{' '}
                        {medicine.dosage || '—'}
                      </p>

                      <p>
                        {lang === 'ar'
                          ? 'المدة'
                          : 'Duration'}
                        :{' '}
                        {medicine.duration || '—'}
                      </p>

                      {(medicine.instructionsAr ||
                        medicine.instructionsEn) && (
                        <p>
                          {lang === 'ar'
                            ? 'التعليمات'
                            : 'Instructions'}
                          :{' '}

                          {lang === 'ar'
                            ? (
                                medicine.instructionsAr ||
                                medicine.instructionsEn
                              )
                            : (
                                medicine.instructionsEn ||
                                medicine.instructionsAr
                              )}
                        </p>
                      )}
                    </div>
                  ))
              )}
            </section>

            <section>
              <h3>
                {lang === 'ar'
                  ? 'نتائج المختبر'
                  : 'Laboratory Results'}
              </h3>

              {!selectedRecord
                .releasedLabResults?.length ? (
                <p>
                  {lang === 'ar'
                    ? 'لا توجد نتائج مختبر مفرج عنها لهذه الزيارة.'
                    : 'No released laboratory results are available for this visit.'}
                </p>
              ) : (
                selectedRecord.releasedLabResults
                  .map((result) => (
                    <div
                      key={result.id}
                      className="medical-detail-item"
                    >
                      <strong>
                        {lang === 'ar'
                          ? (
                              result.testNameAr ||
                              result.testNameEn
                            )
                          : (
                              result.testNameEn ||
                              result.testNameAr
                            )}
                      </strong>

                      <p>
                        {lang === 'ar'
                          ? 'النتيجة'
                          : 'Result'}
                        :{' '}
                        {result.resultValue ?? '—'}
                      </p>

                      {(result.referenceRangeMin != null ||
                        result.referenceRangeMax != null) && (
                        <p>
                          {lang === 'ar'
                            ? 'المدى المرجعي'
                            : 'Reference range'}
                          :{' '}

                          <bdi dir="ltr">{result.referenceRangeMin ?? '—'}
                          {' – '}
                          {result.referenceRangeMax ?? '—'}</bdi>
                        </p>
                      )}

                      {result.isOutOfRange && (
                        <span
                          className="badge badge-warning"
                        >
                          {lang === 'ar'
                            ? 'خارج المعدل المرجعي'
                            : 'Outside reference range'}
                        </span>
                      )}

                      {result.releasedToPatientAt && (
                        <p>
                          {lang === 'ar' ? 'تاريخ الإفراج' : 'Released'}:{' '}
                          {formatPatientDateTime(result.releasedToPatientAt, lang)}
                        </p>
                      )}
                    </div>
                  ))
              )}
            </section>

            {selectedRecord.attachmentPath && (
              <section>
                <a
                  className="patient-button secondary"
                  href={selectedRecord.attachmentPath}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {lang === 'ar'
                    ? 'فتح المرفق'
                    : 'Open Attachment'}
                </a>
              </section>
            )}

            <button
              type="button"
              className="patient-button secondary"
              onClick={closeRecord}
              style={{ width: '100%' }}
            >
              {lang === 'ar'
                ? 'إغلاق'
                : 'Close'}
            </button>
          </div>
        ) : null}
      </Dialog>
    </State>
  );
}
