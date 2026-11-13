import { Search, UserPlus } from 'lucide-react';

export default function ReceptionToolbar({ lang, patientDirectoryQuery, patientDirectorySearchActive, patientDirectorySearchLoading, patientDirectorySearchResults, patientDirectoryError, handlePatientDirectorySearch, setViewingProfilePatientId, setActiveTab }) {
  return (
    <section className="reception-toolbar" aria-label={lang === 'ar' ? 'الوصول السريع للمرضى' : 'Quick patient access'}>
      <div className="reception-global-search">
        <Search size={18} aria-hidden="true" />
        <input
          type="search"
          value={patientDirectoryQuery}
          onChange={(event) => handlePatientDirectorySearch(event.target.value)}
          placeholder={lang === 'ar' ? 'البحث عن مريض بالاسم / الهاتف / SHF-000001' : 'Search by patient name / phone / SHF-000001'}
          aria-label={lang === 'ar' ? 'البحث عن مريض' : 'Search patients'}
          dir="auto"
        />
        {patientDirectorySearchLoading && <span className="reception-search-loading" role="status">{lang === 'ar' ? 'جارٍ البحث…' : 'Searching…'}</span>}
        {patientDirectorySearchActive && patientDirectorySearchResults.length > 0 && (
          <div className="reception-search-results">
            {patientDirectorySearchResults.slice(0, 8).map((patient) => (
              <button key={patient.id} type="button" onClick={() => { setViewingProfilePatientId(patient.id); handlePatientDirectorySearch(''); }}>
                <span><strong>{lang === 'ar' ? patient.fullNameAr || patient.fullNameEn : patient.fullNameEn || patient.fullNameAr}</strong><small dir="ltr">{patient.fileNumber || '—'} · {patient.phone || '—'}</small></span>
                <span>{lang === 'ar' ? 'فتح الملف' : 'Open file'}</span>
              </button>
            ))}
          </div>
        )}
        {patientDirectorySearchActive && !patientDirectorySearchLoading && patientDirectorySearchResults.length === 0 && (
          <div className="reception-search-results reception-search-message" role={patientDirectoryError ? 'alert' : 'status'}>
            <span>{patientDirectoryError || (lang === 'ar' ? 'لم يتم العثور على مريض مطابق.' : 'No matching patient found.')}</span>
            {patientDirectoryError && <button type="button" onClick={() => handlePatientDirectorySearch(patientDirectoryQuery)}>{lang === 'ar' ? 'إعادة المحاولة' : 'Retry'}</button>}
          </div>
        )}
      </div>
      <button type="button" className="reception-register-action" onClick={() => setActiveTab('register')}>
        <UserPlus size={18} aria-hidden="true" />
        {lang === 'ar' ? 'تسجيل مريض' : 'Register patient'}
      </button>
    </section>
  );
}
