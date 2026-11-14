import { RefreshCw, Search } from 'lucide-react';

export default function PatientDirectoryPanel({
  lang,
  patientDirectoryQuery,
  patientDirectoryLoading,
  patientDirectoryLoaded,
  patientDirectoryBusy,
  visiblePatientDirectoryResults,
  visiblePatientDirectoryError,
  handlePatientDirectorySearch,
  loadPatientDirectory,
  setViewingProfilePatientId
}) {
  return (
    <div className="reception-view-container">
      <header className="reception-view-header">
        <div className="reception-view-header-start">
          <h1 className="ui-page-title">{lang === 'ar' ? 'المرضى' : 'Patients'}</h1>
          <span className="reception-header-subtitle">
            {lang === 'ar'
              ? 'ابحث عن مريض مسجل ثم افتح ملفه لإدارة بياناته وربط حساب بوابة المريض.'
              : 'Search for an existing patient and open their profile to manage their information and patient portal link.'}
          </span>
        </div>
      </header>

      <div className="reception-patients-controls">
        <div className="reception-patients-search-wrap">
          <Search size={18} className="reception-patients-search-icon" aria-hidden="true" />
          <input
            type="search"
            className="form-input reception-patients-search-input"
            placeholder={
              lang === 'ar'
                ? 'ابحث بالاسم أو رقم الهاتف أو SHF-000001...'
                : 'Search by patient name, phone or SHF-000001...'
            }
            value={patientDirectoryQuery}
            dir="auto"
            onChange={(e) => handlePatientDirectorySearch(e.target.value)}
          />
        </div>

        <div className="reception-patients-actions-bar">
          <span className="reception-patients-count">
            {lang === 'ar'
              ? `المرضى الظاهرون: ${visiblePatientDirectoryResults.length}`
              : `Visible patients: ${visiblePatientDirectoryResults.length}`}
          </span>
          <button
            type="button"
            className="btn btn-secondary reception-refresh-btn"
            onClick={loadPatientDirectory}
            disabled={patientDirectoryLoading}
          >
            <RefreshCw size={14} className={patientDirectoryLoading ? 'spin' : ''} aria-hidden="true" />
            <span>{lang === 'ar' ? 'تحديث القائمة' : 'Refresh list'}</span>
          </button>
        </div>
      </div>

      {visiblePatientDirectoryError && (
        <div role="alert" className="reception-alert-danger">
          {visiblePatientDirectoryError}
        </div>
      )}

      <div className="ui-panel reception-directory-panel">
        {patientDirectoryBusy && (
          <div className="reception-panel-empty">
            <span>{lang === 'ar' ? 'جارٍ البحث عن المرضى...' : 'Searching patients...'}</span>
          </div>
        )}

        {!patientDirectoryBusy &&
          !visiblePatientDirectoryError &&
          patientDirectoryLoaded &&
          visiblePatientDirectoryResults.length === 0 && (
            <div className="reception-panel-empty">
              <span>{lang === 'ar' ? 'لم يتم العثور على مرضى مطابقين.' : 'No matching patients found.'}</span>
            </div>
          )}

        {!patientDirectoryBusy && visiblePatientDirectoryResults.length > 0 && (
          <div className="reception-directory-list">
            {visiblePatientDirectoryResults.map((patient) => {
              const displayName = lang === 'ar'
                ? patient.fullNameAr || patient.fullNameEn || '—'
                : patient.fullNameEn || patient.fullNameAr || '—';

              return (
                <article key={patient.id} className="reception-directory-row">
                  <div className="reception-directory-main">
                    <button
                      type="button"
                      className="reception-patient-link"
                      onClick={() => setViewingProfilePatientId(patient.id)}
                    >
                      {displayName}
                    </button>
                    <span className="reception-directory-mrn">
                      <span className="reception-directory-mrn-label">{lang === 'ar' ? 'رقم الملف: ' : 'File number: '}</span>
                      <bdi dir="ltr" className="ui-mono">{patient.fileNumber || '—'}</bdi>
                    </span>
                  </div>

                  <div className="reception-directory-meta">
                    {patient.phone && (
                      <span className="ui-mono" dir="ltr">
                        {patient.phone}
                      </span>
                    )}
                    {patient.dateOfBirth && (
                      <span className="ui-mono" dir="ltr">
                        {lang === 'ar' ? `تاريخ الميلاد: ${patient.dateOfBirth}` : `Date of birth: ${patient.dateOfBirth}`}
                      </span>
                    )}
                  </div>

                  <button
                    type="button"
                    className="btn btn-secondary reception-directory-action"
                    onClick={() => setViewingProfilePatientId(patient.id)}
                  >
                    {lang === 'ar' ? 'فتح ملف المريض' : 'Open Patient Profile'}
                  </button>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
