import { Search } from 'lucide-react';

export default function PatientDirectoryPanel({ lang, patientDirectoryQuery, patientDirectoryLoading, patientDirectoryLoaded, patientDirectoryBusy, visiblePatientDirectoryResults, visiblePatientDirectoryError, handlePatientDirectorySearch, loadPatientDirectory, setViewingProfilePatientId }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem',
        overflowY: 'auto'
      }}
    >
      <div>
        <h3 style={{ marginBottom: '0.35rem' }}>
          {lang === 'ar' ? 'المرضى' : 'Patients'}
        </h3>
        <p
          style={{
            margin: 0,
            color: 'var(--text-secondary)',
            fontSize: '0.9rem'
          }}
        >
          {lang === 'ar'
            ? 'ابحث عن مريض مسجل ثم افتح ملفه لإدارة بياناته وربط حساب بوابة المريض.'
            : 'Search for an existing patient and open their profile to manage their information and patient portal link.'}
        </p>
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '0.75rem',
          flexWrap: 'wrap'
        }}
      >
        <small style={{ color: 'var(--text-secondary)' }}>
          {lang === 'ar'
            ? `المرضى الظاهرون: ${visiblePatientDirectoryResults.length}`
            : `Visible patients: ${visiblePatientDirectoryResults.length}`}
        </small>

        <button
          type="button"
          className="btn btn-secondary"
          onClick={loadPatientDirectory}
          disabled={patientDirectoryLoading}
        >
          {lang === 'ar'
            ? 'تحديث القائمة'
            : 'Refresh list'}
        </button>
      </div>

      <div className="search-wrapper">
        <Search className="search-icon-svg" size={16} />

        <input
          type="text"
          className="search-input-field"
          placeholder={
            lang === 'ar'
              ? 'ابحث بالاسم أو رقم الهاتف أو SHF-000001...'
              : 'Search by patient name, phone or SHF-000001...'
          }
          value={patientDirectoryQuery}
          dir="auto"
          onChange={(e) =>
            handlePatientDirectorySearch(e.target.value)
          }
        />
      </div>

      {patientDirectoryBusy && (
        <div
          className="glass-panel"
          style={{
            padding: '1rem',
            textAlign: 'center',
            color: 'var(--text-secondary)'
          }}
        >
          {lang === 'ar'
            ? 'جارٍ البحث عن المرضى...'
            : 'Searching patients...'}
        </div>
      )}

      {visiblePatientDirectoryError && (
        <div
          className="badge badge-danger"
          style={{
            padding: '0.75rem',
            whiteSpace: 'normal'
          }}
        >
          {visiblePatientDirectoryError}
        </div>
      )}

      {!patientDirectoryBusy &&
        !visiblePatientDirectoryError &&
        patientDirectoryLoaded &&
        visiblePatientDirectoryResults.length === 0 && (
          <div
            className="glass-panel"
            style={{
              padding: '1rem',
              textAlign: 'center',
              color: 'var(--text-secondary)'
            }}
          >
            {lang === 'ar'
              ? 'لم يتم العثور على مرضى مطابقين.'
              : 'No matching patients found.'}
          </div>
        )}

      {visiblePatientDirectoryResults.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.75rem'
          }}
        >
          {visiblePatientDirectoryResults.map((patient) => (
            <article
              key={patient.id}
              className="glass-panel"
              style={{
                padding: '0.9rem',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '1rem',
                flexWrap: 'wrap'
              }}
            >
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.25rem'
                }}
              >
                <strong>
                  {lang === 'ar'
                    ? patient.fullNameAr ||
                      patient.fullNameEn
                    : patient.fullNameEn ||
                      patient.fullNameAr}
                </strong>

                <span style={{ fontWeight: 700, color: 'var(--primary)' }}>
                  {lang === 'ar' ? 'رقم الملف: ' : 'File number: '}<bdi dir="ltr">{patient.fileNumber || '—'}</bdi>
                </span>

                {patient.phone && (
                  <span
                    style={{
                      fontSize: '0.85rem',
                      color: 'var(--text-secondary)'
                    }}
                  >
                    {patient.phone}
                  </span>
                )}

                {patient.dateOfBirth && (
                  <span
                    style={{
                      fontSize: '0.8rem',
                      color: 'var(--text-secondary)'
                    }}
                  >
                    {lang === 'ar'
                      ? `تاريخ الميلاد: ${patient.dateOfBirth}`
                      : `Date of birth: ${patient.dateOfBirth}`}
                  </span>
                )}
              </div>

              <button
                type="button"
                className="btn btn-secondary"
                onClick={() =>
                  setViewingProfilePatientId(patient.id)
                }
              >
                {lang === 'ar'
                  ? 'فتح ملف المريض'
                  : 'Open Patient Profile'}
              </button>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
