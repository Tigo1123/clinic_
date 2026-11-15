import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { patientApiRequest as apiRequest } from '../../../../services/apiClient';
import { ChevronRight } from 'lucide-react';
import Dialog from '../../../../components/ui/Dialog';
import { Skeleton } from '../../../../components/feedback/States';
import { formatPatientDateTime } from '../patientRecord';
import { useApi, State, Empty, doctorName } from './shared.jsx';

export function MedicalRecords() {
  const { t, i18n } = useTranslation();
  const { data, error, loading, reload } = useApi('/api/patient/medical-records');

  const [selectedRecord, setSelectedRecord] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const detailRequest = useRef(0);

  const lang = i18n.language?.startsWith('ar') ? 'ar' : 'en';

  const openRecord = async (recordId) => {
    const requestId = ++detailRequest.current;
    setDetailLoading(true);
    setDetailError('');
    setSelectedRecord({ id: recordId });

    try {
      const details = await apiRequest(`/api/patient/medical-records/${recordId}`);
      if (requestId === detailRequest.current) setSelectedRecord(details);
    } catch (requestError) {
      if (requestId === detailRequest.current) {
        setDetailError(
          requestError?.message ||
          (lang === 'ar' ? 'تعذر تحميل تفاصيل السجل الطبي.' : 'Unable to load medical record details.')
        );
      }
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
      <div className="patient-records">
        <h1 className="patient-page-title ui-page-title">{t('medicalRecords')}</h1>

        {!data?.length ? (
          <Empty>{t('noRecords')}</Empty>
        ) : (
          <div className="patient-panel">
            {data.map((item) => (
              <button
                type="button"
                className="patient-hairline-row medical-record-card patient-records__row"
                key={item.id}
                onClick={() => openRecord(item.id)}
              >
                <div className="patient-records__row-info">
                  <span className="patient-records__date ui-mono">
                    {new Date(item.visitDate).toLocaleDateString(i18n.language, { year: 'numeric', month: 'short', day: 'numeric' })}
                  </span>
                  <span className="patient-records__doctor">
                    {doctorName(item.doctor, i18n.language)}
                  </span>
                  <span className="patient-records__diag">
                    {lang === 'ar' ? (item.doctor?.specialtyAr || item.doctor?.specialtyEn) : (item.doctor?.specialtyEn || item.doctor?.specialtyAr)}
                  </span>
                  <span className="patient-records__diag">
                    {t('diagnosisLabel')}: {item.diagnosis || '—'}
                  </span>
                  <span className="patient-records__diag">
                    {t('treatmentLabel')}: {item.treatment || '—'}
                  </span>
                </div>

                <ChevronRight size={18} strokeWidth={1.8} className="patient-row-link__arrow" aria-hidden="true" />
              </button>
            ))}
          </div>
        )}

        <Dialog
          open={Boolean(selectedRecord)}
          title={lang === 'ar' ? 'تفاصيل السجل الطبي' : 'Medical Record Details'}
          description={lang === 'ar' ? 'تفاصيل الزيارة والتشخيص والعلاج والوصفات والنتائج المتاحة لك.' : 'Visit details, diagnosis, treatment, prescriptions and released results.'}
          onClose={closeRecord}
        >
          {detailLoading ? (
            <div className="patient-loading-box">
              <Skeleton/>
            </div>
          ) : detailError ? (
            <div className="patient-alert error" role="alert">
              {detailError}
            </div>
          ) : selectedRecord?.visitDate ? (
            <div className="medical-record-details patient-records__details">
              <section className="patient-records__section">
                <h3 className="ui-section-label">
                  {lang === 'ar' ? 'معلومات الزيارة' : 'Visit Information'}
                </h3>
                <p className="patient-records__field">
                  <strong className="patient-records__field-label">{lang === 'ar' ? 'التاريخ: ' : 'Date: '}</strong>
                  <span className="ui-mono">{new Date(selectedRecord.visitDate).toLocaleString(i18n.language)}</span>
                </p>
                <p className="patient-records__field">
                  <strong className="patient-records__field-label">{lang === 'ar' ? 'الطبيب: ' : 'Doctor: '}</strong>
                  <span>{doctorName(selectedRecord.doctor, i18n.language)}</span>
                </p>
                <p className="patient-records__field">
                  <strong className="patient-records__field-label">{lang === 'ar' ? 'التخصص: ' : 'Specialty: '}</strong>
                  <span>{lang === 'ar' ? (selectedRecord.doctor?.specialtyAr || selectedRecord.doctor?.specialtyEn) : (selectedRecord.doctor?.specialtyEn || selectedRecord.doctor?.specialtyAr)}</span>
                </p>
              </section>

              <section className="patient-records__section">
                <h3 className="ui-section-label">
                  {lang === 'ar' ? 'التقييم الطبي' : 'Clinical Assessment'}
                </h3>
                <p className="patient-records__field">
                  <strong className="patient-records__field-label">{lang === 'ar' ? 'الأعراض: ' : 'Symptoms: '}</strong>
                  <span>{selectedRecord.symptoms || '—'}</span>
                </p>
                <p className="patient-records__field">
                  <strong className="patient-records__field-label">{t('diagnosisLabel')}: </strong>
                  <span>{selectedRecord.diagnosis || '—'}</span>
                </p>
                <p className="patient-records__field">
                  <strong className="patient-records__field-label">{t('treatmentLabel')}: </strong>
                  <span>{selectedRecord.treatment || '—'}</span>
                </p>
              </section>

              {selectedRecord.vitalSigns && Object.keys(selectedRecord.vitalSigns).length > 0 && (
                <section className="patient-records__section">
                  <h3 className="ui-section-label">
                    {lang === 'ar' ? 'العلامات الحيوية' : 'Vital Signs'}
                  </h3>
                  <div className="medical-vitals-grid">
                    {Object.entries(selectedRecord.vitalSigns).map(([key, value]) => (
                      <div key={key}>
                        <span>{t(`patientVital_${key}`, { defaultValue: key.replaceAll('_', ' ') })}</span>
                        <strong dir="ltr" className="ui-mono">{value ?? '—'}</strong>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <section className="patient-records__section">
                <h3 className="ui-section-label">
                  {lang === 'ar' ? 'الوصفات الطبية' : 'Prescriptions'}
                </h3>
                {!selectedRecord.prescriptions?.some((p) => p.medicines?.length) ? (
                  <p className="patient-records__empty-text">
                    {lang === 'ar' ? 'لا توجد أدوية في هذه الزيارة.' : 'No medicines were prescribed during this visit.'}
                  </p>
                ) : (
                  selectedRecord.prescriptions.flatMap((p) => p.medicines || []).map((medicine) => (
                    <div key={medicine.id} className="patient-records__rx-item">
                      <strong>{lang === 'ar' ? (medicine.medicine?.labelAr || medicine.medicine?.labelEn || medicine.customDrugName) : (medicine.medicine?.labelEn || medicine.medicine?.labelAr || medicine.customDrugName)}</strong>
                      <p>
                        <span className="patient-records__field-label">{lang === 'ar' ? 'الجرعة: ' : 'Dosage: '}</span>
                        {medicine.dosage || '—'}
                      </p>
                      <p>
                        <span className="patient-records__field-label">{lang === 'ar' ? 'المدة: ' : 'Duration: '}</span>
                        {medicine.duration || '—'}
                      </p>
                      {(medicine.instructionsAr || medicine.instructionsEn) && (
                        <p>
                          <span className="patient-records__field-label">{lang === 'ar' ? 'التعليمات: ' : 'Instructions: '}</span>
                          {lang === 'ar' ? (medicine.instructionsAr || medicine.instructionsEn) : (medicine.instructionsEn || medicine.instructionsAr)}
                        </p>
                      )}
                    </div>
                  ))
                )}
              </section>

              <section className="patient-records__section">
                <h3 className="ui-section-label">
                  {lang === 'ar' ? 'نتائج المختبر' : 'Laboratory Results'}
                </h3>
                {!selectedRecord.releasedLabResults?.length ? (
                  <p className="patient-records__empty-text">
                    {lang === 'ar' ? 'لا توجد نتائج مختبر مفرج عنها لهذه الزيارة.' : 'No released laboratory results are available for this visit.'}
                  </p>
                ) : (
                  selectedRecord.releasedLabResults.map((result) => (
                    <div key={result.id} className="patient-records__lab-item">
                      <div className="patient-records__lab-header">
                        <strong>{lang === 'ar' ? (result.testNameAr || result.testNameEn) : (result.testNameEn || result.testNameAr)}</strong>
                        <span className="ui-mono">{result.resultValue ?? '—'}</span>
                      </div>
                      <p>
                        <span className="patient-records__field-label">{lang === 'ar' ? 'النتيجة: ' : 'Result: '}</span>
                        <span className="ui-mono">{result.resultValue ?? '—'}</span>
                      </p>
                      {(result.referenceRangeMin != null || result.referenceRangeMax != null) && (
                        <p className="patient-records__lab-range">
                          <span className="patient-records__field-label">{lang === 'ar' ? 'المدى المرجعي: ' : 'Reference range: '}</span>
                          <bdi dir="ltr" className="ui-mono">{result.referenceRangeMin ?? '—'} – {result.referenceRangeMax ?? '—'}</bdi>
                        </p>
                      )}
                      {result.isOutOfRange && (
                        <span className="ui-status ui-status--warn">
                          {lang === 'ar' ? 'خارج المعدل المرجعي' : 'Outside reference range'}
                        </span>
                      )}
                      {result.releasedToPatientAt && (
                        <p>
                          <span className="patient-records__field-label">{lang === 'ar' ? 'تاريخ الإفراج: ' : 'Released: '}</span>
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
                    {lang === 'ar' ? 'فتح المرفق' : 'Open Attachment'}
                  </a>
                </section>
              )}

              <button
                type="button"
                className="patient-button secondary patient-dialog__close-btn"
                onClick={closeRecord}
              >
                {lang === 'ar' ? 'إغلاق' : 'Close'}
              </button>
            </div>
          ) : null}
        </Dialog>
      </div>
    </State>
  );
}
