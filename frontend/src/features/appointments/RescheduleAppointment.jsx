import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { patientApiRequest as apiRequest } from '../../services/apiClient';
import { clinicDateString } from '../../utils/clinicTime';
import { ErrorState, Skeleton } from '../../components/feedback/States';

export default function RescheduleAppointment() {
  const { id } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [appointment, setAppointment] = useState(null);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [slots, setSlots] = useState([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setAppointment(null);
    setDate('');
    setError('');
    apiRequest(`/api/patient/appointments/${id}`)
      .then((value) => { if (current) { setAppointment(value); setDate(value.appointmentDate); } })
      .catch((requestError) => { if (current) setError(requestError.message); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [id]);

  useEffect(() => {
    let current = true;
    setSlots([]);
    setTime('');
    if (!appointment || !date) { setSlotsLoading(false); return; }
    setSlotsLoading(true);
    setError('');
    apiRequest(`/api/appointments/slots?doctorId=${appointment.doctor.id}&date=${date}`)
      .then(value => { if (current) setSlots(value); })
      .catch((requestError) => { if (current) setError(requestError.message); })
      .finally(() => { if (current) setSlotsLoading(false); });
    return () => { current = false; };
  }, [appointment, date]);

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await apiRequest(`/api/patient/appointments/${id}/reschedule`, {
        method: 'PUT',
        body: JSON.stringify({
          doctorId: appointment.doctor.id,
          appointmentDate: date,
          appointmentTime: time
        })
      });
      navigate(`/patient/appointments/${id}`);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="patient-card"><Skeleton/></div>;
  if (error && !appointment) return <ErrorState message={error}/>;
  return <section className="patient-card">
    <h1>{t('rescheduleAppointment')}</h1>
    <form onSubmit={submit}>
      <label className="patient-field">{t('selectDate')}<input type="date" min={clinicDateString()} value={date} onChange={(event) => setDate(event.target.value)} required /></label>
      <fieldset className="patient-card"><legend>{t('selectTime')}</legend><div className="patient-actions">{slots.map((slot) => <button type="button" aria-pressed={time === slot} className={`patient-button ${time === slot ? '' : 'secondary'}`} key={slot} onClick={() => setTime(slot)}>{slot}</button>)}</div>{slotsLoading ? <p role="status">{t('loading')}</p> : !slots.length && !error && <p>{t('noSlots')}</p>}</fieldset>
      {error && <div className="patient-alert error" role="alert">{error}</div>}
      <button className="patient-button" disabled={!time || saving || slotsLoading} aria-busy={saving}>{saving ? t('loading') : t('rescheduleAppointment')}</button>
    </form>
  </section>;
}
