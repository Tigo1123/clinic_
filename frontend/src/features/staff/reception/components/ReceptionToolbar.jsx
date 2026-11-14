import { Search } from 'lucide-react';

export default function ReceptionToolbar({
  lang,
  patientDirectoryQuery,
  patientDirectorySearchActive,
  patientDirectorySearchLoading,
  patientDirectorySearchResults,
  patientDirectoryError,
  handlePatientDirectorySearch,
  setViewingProfilePatientId
}) {
  return (
    <div className="reception-search-container">
      <label className="reception-search-label">
        <span className="ui-section-label">
          {lang === 'ar' ? 'البحث عن مريض' : 'Find a patient'}
        </span>
        <div className="reception-global-search">
          <Search size={18} aria-hidden="true" />
          <input
            type="search"
            value={patientDirectoryQuery}
            onChange={(event) => handlePatientDirectorySearch(event.target.value)}
            placeholder={lang === 'ar' ? 'الاسم، الهاتف أو SHF-000001' : 'Name, phone or SHF-000001'}
            aria-label={lang === 'ar' ? 'البحث عن مريض' : 'Find a patient'}
            dir="auto"
            className="form-input"
          />
          {patientDirectorySearchLoading && (
            <span className="reception-search-loading" role="status">
              {lang === 'ar' ? 'جارٍ البحث…' : 'Searching…'}
            </span>
          )}
          {patientDirectorySearchActive && patientDirectorySearchResults.length > 0 && (
            <div className="reception-search-results">
              {patientDirectorySearchResults.slice(0, 8).map((patient) => (
                <button
                  key={patient.id}
                  type="button"
                  onClick={() => {
                    setViewingProfilePatientId(patient.id);
                    handlePatientDirectorySearch('');
                  }}
                >
                  <span className="reception-search-item-info">
                    <strong>
                      {lang === 'ar'
                        ? patient.fullNameAr || patient.fullNameEn
                        : patient.fullNameEn || patient.fullNameAr}
                    </strong>
                    <small className="ui-mono" dir="ltr">
                      {patient.fileNumber || '—'} · {patient.phone || '—'}
                    </small>
                  </span>
                  <span className="reception-search-item-action">
                    {lang === 'ar' ? 'فتح الملف' : 'Open file'}
                  </span>
                </button>
              ))}
            </div>
          )}
          {patientDirectorySearchActive && !patientDirectorySearchLoading && patientDirectorySearchResults.length === 0 && (
            <div
              className="reception-search-results reception-search-message"
              role={patientDirectoryError ? 'alert' : 'status'}
            >
              <span>
                {patientDirectoryError ||
                  (lang === 'ar'
                    ? 'لم يتم العثور على مريض مطابق.'
                    : 'No matching patient found.')}
              </span>
              {patientDirectoryError && (
                <button
                  type="button"
                  onClick={() => handlePatientDirectorySearch(patientDirectoryQuery)}
                >
                  {lang === 'ar' ? 'إعادة المحاولة' : 'Retry'}
                </button>
              )}
            </div>
          )}
        </div>
      </label>
    </div>
  );
}
