import { guardFormSubmit } from '../../../utils/guardFormSubmit.js';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { patientApiRequest as apiRequest } from '../../../services/apiClient';
import { clinicDateString } from '../../../utils/clinicTime';
import { ErrorState, Skeleton } from '../../../components/feedback/States';
import { patientErrorMessage } from '../../../services/patientErrors';

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

  const loadAppointment = () => {
    setLoading(true);
    setAppointment(null);
    setDate('');
    setError('');
    apiRequest(`/api/patient/appointments/${id}`)
      .then((value) => { setAppointment(value); setDate(value.appointmentDate); })
      .catch((requestError) => { setError(patientErrorMessage(requestError, t('patientLoadError'))); })
      .finally(() => { setLoading(false); });
  };

  useEffect(() => {
    let current = true;
    setLoading(true);
    setAppointment(null);
    setDate('');
    setError('');
    apiRequest(`/api/patient/appointments/${id}`)
      .then((value) => { if (current) { setAppointment(value); setDate(value.appointmentDate); } })
      .catch((requestError) => { if (current) setError(patientErrorMessage(requestError, t('patientLoadError'))); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
    // `t` is intentionally omitted: refetching on every translation-function change would reset the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const [slotRevision, setSlotRevision] = useState(0);
  const [slotError, setSlotError] = useState(false);

  useEffect(() => {
    let current = true;
    setSlots([]);
    setTime('');
    if (!appointment || !date) { setSlotsLoading(false); return; }
    setSlotsLoading(true);
    setSlotError(false);
    apiRequest(`/api/appointments/slots?doctorId=${appointment.doctor.id}&date=${date}`)
      .then((value) => { if (current) setSlots(value); })
      .catch(() => { if (current) setSlotError(true); })
      .finally(() => { if (current) setSlotsLoading(false); });
    return () => { current = false; };
  }, [appointment, date, slotRevision]);

  async function submit(event) {
    event.preventDefault();
    if (!date || !slots.includes(time) || slotsLoading) return;
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
      setError(patientErrorMessage(requestError, t('rescheduleFailed')));
      if (requestError?.code === 'APPOINTMENT_SLOT_UNAVAILABLE' || requestError?.code === 'INVALID_APPOINTMENT_SLOT') {
        setTime('');
        setSlotsLoading(true);
        setSlotRevision(value => value + 1);
      }
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="patient-card"><Skeleton/></div>;
  if (error && !appointment) return <ErrorState message={error} onRetry={loadAppointment}/>;

  return (
    <section className="patient-reschedule">
      <h1 className="patient-page-title ui-page-title">{t('rescheduleAppointment')}</h1>

      <form onSubmit={event => guardFormSubmit(event, submit)} className="patient-reschedule__form">
        <label className="patient-field patient-reschedule__field">
          <span className="ui-section-label patient-reschedule__label">{t('selectDate')}</span>
          <input
            type="date"
            min={clinicDateString()}
            value={date}
            disabled={saving}
            onChange={(event) => { setDate(event.target.value); setError(''); }}
            required
            className="form-input patient-reschedule__input"
          />
        </label>

        <fieldset className="patient-reschedule__fieldset">
          <legend className="ui-section-label patient-reschedule__legend">{t('selectTime')}</legend>
          <div className="slot-grid">
            {slots.map((slot) => (
              <button
                type="button"
                aria-pressed={time === slot}
                className={`slot-chip ui-mono ${time === slot ? 'selected' : ''}`}
                key={slot}
                disabled={saving}
                onClick={() => { setTime(slot); setError(''); }}
              >
                {slot}
              </button>
            ))}
          </div>
          {slotsLoading ? (
            <p role="status" className="patient-reschedule__loading-text">{t('loading')}</p>
          ) : !slots.length && !error && !slotError && (
            <p className="patient-reschedule__empty-text">{t('noSlots')}</p>
          )}
        </fieldset>

        {slotError && <div role="alert" className="patient-alert error">
          {t('patientLoadError')} <button type="button" className="patient-button secondary" onClick={() => setSlotRevision(value => value + 1)}>{t('patientRetry')}</button>
        </div>}
        {error && <div className="patient-alert error" role="alert">{error}</div>}

        <button
          type="submit"
          className="patient-button patient-home__book-btn patient-reschedule__submit"
          disabled={!time || saving || slotsLoading}
          aria-busy={saving}
        >
          {saving ? t('loading') : t('rescheduleAppointment')}
        </button>
      </form>
    </section>
  );
}
