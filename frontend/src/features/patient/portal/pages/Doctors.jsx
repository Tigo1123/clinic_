import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';
import { doctorMatchesDirectorySearch, doctorSpecialtyKey, doctorSpecialtyOptions, localizeDoctorSpecialty } from '../doctorSpecialty';
import { useApi, State, Empty, doctorName } from './shared.jsx';

export function Doctors() {
  const { t, i18n } = useTranslation();
  const { data, error, loading, reload } = useApi('/api/patient/doctors');
  const [query, setQuery] = useState('');
  const [specialty, setSpecialty] = useState('');
  const language = i18n.language?.startsWith('ar') ? 'ar' : 'en';

  const specialties = doctorSpecialtyOptions(data || [], language);

  const filtered = (data || []).filter((doctor) => {
    const matchesQuery = doctorMatchesDirectorySearch(doctor, query);
    const matchesSpecialty = !specialty || doctorSpecialtyKey(doctor) === specialty;
    return matchesQuery && matchesSpecialty;
  });

  return (
    <State loading={loading} error={error} onRetry={reload}>
      <div className="patient-doctors-directory patient-doctors" dir={language === 'ar' ? 'rtl' : 'ltr'}>
        <h1 className="patient-page-title ui-page-title">{t('doctors')}</h1>

        <label className="patient-field patient-doctors__search-field">
          <span className="sr-only">{t('searchDoctors')}</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('searchDoctors')}
            className="patient-doctors__search-input"
          />
        </label>

        {specialties.length > 0 && (
          <div className="specialty-chips" aria-label={t('selectSpecialty')}>
            <button
              className={!specialty ? 'selected' : ''}
              aria-pressed={!specialty}
              onClick={() => setSpecialty('')}
            >
              {t('all')}
            </button>
            {specialties.map((item) => (
              <button
                className={specialty === item.key ? 'selected' : ''}
                aria-pressed={specialty === item.key}
                onClick={() => setSpecialty(item.key)}
                key={item.key}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}

        {!filtered.length ? (
          <Empty>{t('noDoctors')}</Empty>
        ) : (
          <div className="patient-panel">
            {filtered.map((doctor) => {
              const name = doctorName(doctor, language);
              return (
                <div
                  className="patient-hairline-row patient-doctors__row"
                  key={doctor.id}
                >
                  <div className="patient-doctors__info">
                    <span className="patient-doctors__name">{name}</span>
                    <span className="patient-doctors__meta">
                      {localizeDoctorSpecialty(doctor, language)}
                      {doctor.consultationFee ? <> · <span className="ui-mono">{Number(doctor.consultationFee).toLocaleString(language === 'ar' ? 'ar' : 'en')} {language === 'ar' ? 'ج.س' : 'SDG'}</span></> : ''}
                    </span>
                  </div>

                  <div className="patient-doctors__actions">
                    <Link
                      className="patient-button secondary patient-doctors__details-btn"
                      to={`/patient/doctors/${doctor.id}`}
                      aria-label={`${t('details')} ${name}`}
                    >
                      {t('details')}
                    </Link>
                    <Link
                      to={`/patient/book/${doctor.id}`}
                      aria-label={`${t('book')} ${name}`}
                      className="patient-button patient-doctors__book-btn"
                    >
                      <span>{t('book')}</span>
                      <ChevronRight size={16} strokeWidth={1.8} className="patient-row-link__arrow" aria-hidden="true" />
                    </Link>
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
