import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import StatusBadge from '../../../../components/ui/StatusBadge';
import { hasPendingAppointments } from '../../../../utils/appointmentStatus';
import { useApi, State, Empty, doctorName } from './shared.jsx';

export function Appointments() {
  const { t, i18n } = useTranslation();
  const [group, setGroup] = useState('upcoming');
  const { data, error, loading, reload } = useApi(`/api/patient/appointments?group=${group}`, { pollWhen: hasPendingAppointments });
  return <State loading={loading} error={error} onRetry={reload}>
    <h1>{t('myAppointments')}</h1>
    <div className="patient-tabs" role="group" aria-label={t('myAppointments')}>{['upcoming', 'past', 'cancelled', 'all'].map((item) => <button className={`patient-button ${group === item ? '' : 'secondary'}`} aria-pressed={group === item} onClick={() => setGroup(item)} key={item}>{t(item)}</button>)}</div>
    {!data?.length ? <Empty>{t('noAppointments')}</Empty> : <div className="patient-list">{data.map((appointment) => <article className="patient-card patient-row" key={appointment.id}>
      <div>
        <h2>{doctorName(appointment.doctor, i18n.language)}</h2>
        <p><bdi dir="ltr">{appointment.appointmentDate} · {appointment.appointmentTime}</bdi></p>
        <StatusBadge status={appointment.status} language={i18n.language}/>
      </div>
      <Link className="patient-button secondary" to={`/patient/appointments/${appointment.id}`}>{t('details')}</Link>
    </article>)}</div>}
  </State>;
}
