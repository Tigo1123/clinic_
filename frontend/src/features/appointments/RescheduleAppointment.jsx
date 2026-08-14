import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { apiRequest } from '../../services/apiClient';
import { clinicDateString } from '../../utils/clinicTime';

export default function RescheduleAppointment() {
  const { id } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [appointment, setAppointment] = useState(null);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [slots, setSlots] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiRequest(`/api/patient/appointments/${id}`)
      .then((value) => { setAppointment(value); setDate(value.appointmentDate); })
      .catch((requestError) => setError(requestError.message))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!appointment || !date) return;
    setTime('');
    apiRequest(`/api/appointments/slots?doctorId=${appointment.doctor.id}&date=${date}`)
      .then(setSlots)
      .catch((requestError) => setError(requestError.message));
  }, [appointment, date]);

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await apiRequest(`/api/patient/appointments/${id}/reschedule`, {
        method: 'PUT', body: JSON.stringify({ appointmentDate: date, appointmentTime: time })
      });
      navigate(`/patient/appointments/${id}`);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="patient-card">{t('loading')}</div>;
  if (error && !appointment) return <div className="patient-alert error" role="alert">{error}</div>;
  return <section className="patient-card">
    <h1>{t('rescheduleAppointment')}</h1>
    <form onSubmit={submit}>
      <label className="patient-field">{t('selectDate')}<input type="date" min={clinicDateString()} value={date} onChange={(event) => setDate(event.target.value)} required /></label>
      <fieldset className="patient-card"><legend>{t('selectTime')}</legend><div className="patient-actions">{slots.map((slot) => <button type="button" className={`patient-button ${time === slot ? '' : 'secondary'}`} key={slot} onClick={() => setTime(slot)}>{slot}</button>)}</div>{!slots.length && <p>{t('noSlots')}</p>}</fieldset>
      {error && <div className="patient-alert error" role="alert">{error}</div>}
      <button className="patient-button" disabled={!time || saving}>{saving ? t('loading') : t('rescheduleAppointment')}</button>
    </form>
  </section>;
}
