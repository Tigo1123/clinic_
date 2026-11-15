import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, CalendarDays } from 'lucide-react';
import { EmptyState, ErrorState, Skeleton } from '../../../../components/feedback/States';
import { localizeDoctorSpecialty } from '../doctorSpecialty';
import { useApi, doctorName } from './shared.jsx';

export function DoctorDetails() {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const { data, error, loading, reload } = useApi(`/api/patient/doctors/${id}`);
  const language = i18n.language?.startsWith('ar') ? 'ar' : 'en';

  if (loading) return <div className="patient-card"><Skeleton/></div>;
  if (error) return <ErrorState message={error} onRetry={reload}/>;
  if (!data) return <EmptyState title={t('doctorNotFound')}/>;

  return (
    <article className="patient-doctor-details">
      <Link to="/patient/doctors" className="patient-back-link">
        <ArrowLeft size={16} strokeWidth={1.8} aria-hidden="true" />
        {t('doctors')}
      </Link>

      <header className="patient-doctor-details__header">
        <h1 className="patient-page-title ui-page-title">{doctorName(data, i18n.language)}</h1>
        <span className="patient-doctor-details__spec">
          {localizeDoctorSpecialty(data, language)}
        </span>
      </header>

      <div className="patient-panel">
        <div className="patient-hairline-row">
          <span className="patient-detail-label">{t('specialty', { defaultValue: 'Specialty' })}</span>
          <strong className="patient-doctor-details__strong">{localizeDoctorSpecialty(data, language)}</strong>
        </div>
        <div className="patient-hairline-row">
          <span className="patient-detail-label">{t('consultationFee', { defaultValue: 'Consultation fee' })}</span>
          <strong className="ui-mono patient-doctor-details__strong">
            {Number(data.consultationFee).toLocaleString(language === 'ar' ? 'ar' : 'en')} {language === 'ar' ? 'ج.س' : 'SDG'}
          </strong>
        </div>
      </div>

      <Link
        className="patient-button patient-home__book-btn patient-doctor-details__book-btn"
        to={`/patient/book/${id}`}
      >
        <CalendarDays size={20} aria-hidden="true" />
        {t('bookAppointment')}
      </Link>
    </article>
  );
}
