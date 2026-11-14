import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';
import StatusBadge from '../../../../components/ui/StatusBadge';
import { hasPendingAppointments } from '../../../../utils/appointmentStatus';
import { localizeDoctorSpecialty } from '../doctorSpecialty';
import { useApi, State, Empty, doctorName } from './shared.jsx';

export function Appointments() {
  const { t, i18n } = useTranslation();
  const [group, setGroup] = useState('upcoming');
  const { data, error, loading, reload } = useApi(`/api/patient/appointments?group=${group}`, { pollWhen: hasPendingAppointments });
  const language = i18n.language?.startsWith('ar') ? 'ar' : 'en';

  return (
    <State loading={loading} error={error} onRetry={reload}>
      <div className="patient-visits">
        <h1 className="patient-page-title">{t('myAppointments')}</h1>

        <div className="patient-tabs ui-segmented" role="group" aria-label={t('myAppointments')}>
          {['upcoming', 'past', 'cancelled', 'all'].map((item) => (
            <button
              type="button"
              className={`patient-button ${group === item ? '' : 'secondary'}`}
              aria-pressed={group === item}
              onClick={() => setGroup(item)}
              key={item}
            >
              {t(item)}
            </button>
          ))}
        </div>

        {!data?.length ? (
          <Empty>{t('noAppointments')}</Empty>
        ) : (
          <div className="patient-panel">
            {data.map((appointment) => (
              <Link
                to={`/patient/appointments/${appointment.id}`}
                className="patient-hairline-row patient-visit__row"
                key={appointment.id}
                aria-label={`${t('details')}: ${doctorName(appointment.doctor, i18n.language)}`}
              >
                <div className="patient-visit__date-box">
                  <span className="patient-visit__month">
                    {new Date(`${appointment.appointmentDate}T00:00:00`).toLocaleDateString(language, { month: 'short' })}
                  </span>
                  <span className="patient-visit__day ui-mono">
                    {new Date(`${appointment.appointmentDate}T00:00:00`).getDate().toLocaleString(language)}
                  </span>
                </div>

                <div className="patient-visit__info">
                  <span className="patient-visit__doctor">
                    {doctorName(appointment.doctor, i18n.language)}
                  </span>
                  <span className="patient-visit__sub">
                    {localizeDoctorSpecialty(appointment.doctor, language)} · <bdi dir="ltr" className="ui-mono">{appointment.appointmentTime}</bdi>
                  </span>
                  <div className="patient-visit__status-wrap">
                    <StatusBadge status={appointment.status} language={i18n.language}/>
                  </div>
                </div>

                <ChevronRight size={18} strokeWidth={1.8} className="patient-row-link__arrow" aria-hidden="true" />
              </Link>
            ))}
          </div>
        )}
      </div>
    </State>
  );
}
