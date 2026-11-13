import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { patientApiRequest as apiRequest } from '../../../../services/apiClient';
import { clinicCalendarDays } from '../../../../utils/clinicTime';

export function BookAppointment() {
  const { doctorId } = useParams();
  const { t, i18n } = useTranslation();
  const [date, setDate] = useState('');
  const [slots, setSlots] = useState([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [time, setTime] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [successAppointmentId, setSuccessAppointmentId] = useState('');
  const days = clinicCalendarDays(7);

  useEffect(() => {
    let current = true;
    setSlots([]);
    setTime('');
    setError('');
    if (date) {
      setSlotsLoading(true);
      apiRequest(`/api/appointments/slots?doctorId=${doctorId}&date=${date}`)
        .then(value => { if (current) setSlots(value); })
        .catch((requestError) => { if (current) setError(requestError.message); })
        .finally(() => { if (current) setSlotsLoading(false); });
    } else {
      setSlotsLoading(false);
    }
    return () => { current = false; };
  }, [doctorId, date]);

  async function submit(event) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const appointment = await apiRequest('/api/patient/appointments', {
        method: 'POST',
        body: JSON.stringify({ doctorId, appointmentDate: date, appointmentTime: time })
      });
      setSuccessAppointmentId(appointment.id);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  if (successAppointmentId) {
    return <section className="patient-card patient-booking-pending">
      <div className="patient-alert success" role="status">
        <strong>{t('bookingRequestSent')}</strong>
        <p>{t('bookingPendingReview')}</p>
        <p>{t('bookingFollowStatus')}</p>
      </div>
      <div className="patient-actions">
        <Link className="patient-button" to="/patient/appointments">{t('followMyAppointments')}</Link>
        <Link className="patient-button secondary" to={`/patient/appointments/${successAppointmentId}`}>{t('details')}</Link>
      </div>
    </section>;
  }

  return <section className="patient-card">
    <h1>{t('bookAppointment')}</h1>
    <form onSubmit={submit}>
      <div className="section-heading-row"><h2>{t('selectDate')}</h2></div>
      <div className="date-strip">{days.map((day) => {
        const value = day.date;
        return <button type="button" className={`date-chip ${date === value ? 'selected' : ''}`} key={value} onClick={() => { setDate(value); setTime(''); }} aria-pressed={date === value} aria-label={day.calendarDate.toLocaleDateString(i18n.language, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })}>
          <span>{day.calendarDate.toLocaleDateString(i18n.language, { weekday: 'short', timeZone: 'UTC' })}</span>
          <strong>{day.calendarDate.getUTCDate().toLocaleString(i18n.language)}</strong>
          <span>{day.calendarDate.toLocaleDateString(i18n.language, { month: 'short', timeZone: 'UTC' })}</span>
        </button>;
      })}</div>
      {date && <fieldset className="patient-card">
        <legend>{t('selectTime')}</legend>
        <div className="slot-grid">{slots.map((slot) => <button type="button" className={`slot-chip ${time === slot ? 'selected' : ''}`} key={slot} onClick={() => setTime(slot)} aria-pressed={time === slot}>{slot}</button>)}</div>
        {slotsLoading ? <p role="status">{t('loading')}</p> : !slots.length && !error && <p>{t('noSlots')}</p>}
      </fieldset>}
      {error && <div className="patient-alert error" role="alert">{error}</div>}
      <button className="patient-button" style={{ width: '100%' }} disabled={!time || loading || slotsLoading} aria-busy={loading}>{loading ? t('loading') : t('confirmBooking')}</button>
    </form>
  </section>;
}
