import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Search, UserRound } from 'lucide-react';
import { doctorMatchesDirectorySearch, doctorSpecialtyKey, doctorSpecialtyOptions, localizeDoctorSpecialty } from '../doctorSpecialty';
import { useApi, State, Empty, doctorName } from './shared.jsx';

export function Doctors(){
  const { t, i18n } = useTranslation();
  const { data, error, loading, reload } = useApi('/api/patient/doctors');
  const [query, setQuery] = useState('');
  const [specialty, setSpecialty] = useState('');
  const language = i18n.language?.startsWith('ar') ? 'ar' : 'en';

  const specialties = doctorSpecialtyOptions(data || [], language);

  const filtered = (data || []).filter((doctor) => {
    const matchesQuery = doctorMatchesDirectorySearch(doctor, query);

    const matchesSpecialty =
      !specialty ||
      doctorSpecialtyKey(doctor) === specialty;

    return matchesQuery && matchesSpecialty;
  });

  return (
    <State loading={loading} error={error} onRetry={reload}>
      <div className="patient-doctors-directory" dir={language === 'ar' ? 'rtl' : 'ltr'}>
      <header className="doctor-search-header">
        <div>
          <span>{t('healthServices')}</span>
          <h1>{t('doctors')}</h1>
        </div>

        <label className="doctor-search">
          <Search size={19}/>
          <span className="sr-only">{t('searchDoctors')}</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('searchDoctors')}
          />
        </label>
      </header>

      {specialties.length > 0 && (
        <div
          className="specialty-chips"
          aria-label={t('selectSpecialty')}
        >
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

      <div className="section-heading-row">
        <h2>{t('doctors')}</h2>
        <span>{filtered.length}</span>
      </div>

      {!filtered.length ? (
        <Empty>{t('noDoctors')}</Empty>
      ) : (
        <div className="doctor-list">
          {filtered.map((doctor) => (
            <article
              className="patient-card doctor-card"
              key={doctor.id}
            >
              <div className="doctor-card__avatar">
                <UserRound/>
              </div>

              <div className="doctor-card__body">
                <h2>{doctorName(doctor, i18n.language)}</h2>

                <p>
                  {localizeDoctorSpecialty(doctor, language)}
                </p>

                <strong>
                  {Number(doctor.consultationFee).toLocaleString(
                    i18n.language === 'ar' ? 'ar' : 'en'
                  )}{' '}
                  {i18n.language === 'ar' ? 'ج.س' : 'SDG'}
                </strong>

                <div className="patient-actions">
                  <Link
                    className="patient-button secondary"
                    to={`/patient/doctors/${doctor.id}`}
                  >
                    {t('details')}
                  </Link>

                  <Link
                    className="patient-button"
                    to={`/patient/book/${doctor.id}`}
                  >
                    {t('book')}
                  </Link>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
      </div>
    </State>
  );
}
