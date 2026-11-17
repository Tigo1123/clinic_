import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from 'lucide-react';
import { patientApiRequest as apiRequest } from '../../../../services/apiClient';
import { patientErrorMessage } from '../../../../services/patientErrors';
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
        .then((value) => { if (current) setSlots(value); })
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
      setError(patientErrorMessage(requestError, t('bookingFailed')));
      if (requestError?.code === 'APPOINTMENT_SLOT_UNAVAILABLE' || requestError?.code === 'INVALID_APPOINTMENT_SLOT') {
        setTime('');
        if (date) {
          setSlotsLoading(true);
          apiRequest(`/api/appointments/slots?doctorId=${doctorId}&date=${date}`)
            .then((value) => setSlots(value))
            .catch(() => {})
            .finally(() => setSlotsLoading(false));
        }
      }
    } finally {
      setLoading(false);
    }
  }

  if (successAppointmentId) {
    return (
      <section className="patient-card patient-booking-pending patient-book__success-panel">
        <div className="patient-alert success" role="status">
          <strong>{t('bookingRequestSent')}</strong>
          <p>{t('bookingPendingReview')}</p>
          <p>{t('bookingFollowStatus')}</p>
        </div>
        <div className="patient-actions patient-actions-group">
          <Link className="patient-button" to="/patient/appointments">{t('followMyAppointments')}</Link>
          <Link className="patient-button secondary" to={`/patient/appointments/${successAppointmentId}`}>{t('details')}</Link>
        </div>
      </section>
    );
  }

  return (
    <section className="patient-book">
      <Link to="/patient/doctors" className="patient-back-link">
        <ArrowLeft size={18} strokeWidth={1.8} aria-hidden="true" />
        {t('patientBack')}
      </Link>

      <header className="patient-book__doctor-summary">
        <h1 className="patient-page-title ui-page-title">
          {t('bookAppointment')}
        </h1>
      </header>

      <form onSubmit={submit} className="patient-book__form">
        <section aria-labelledby="day-title" className="patient-book__field-title">
          <h2 id="day-title" className="ui-section-label">{t('selectDate')}</h2>
          <div className="date-strip">
            {days.map((day) => {
              const value = day.date;
              const isSelected = date === value;
              return (
                <button
                  type="button"
                  className={`date-chip ${isSelected ? 'selected' : ''}`}
                  key={value}
                  onClick={() => { setDate(value); setTime(''); }}
                  aria-pressed={isSelected}
                  aria-label={day.calendarDate.toLocaleDateString(i18n.language, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })}
                >
                  <span>{day.calendarDate.toLocaleDateString(i18n.language, { weekday: 'short', timeZone: 'UTC' })}</span>
                  <span className="date-chip__num ui-mono">{day.calendarDate.getUTCDate().toLocaleString(i18n.language)}</span>
                  <span>{day.calendarDate.toLocaleDateString(i18n.language, { month: 'short', timeZone: 'UTC' })}</span>
                </button>
              );
            })}
          </div>
        </section>

        {date && (
          <fieldset className="patient-book-fieldset patient-reschedule__fieldset">
            <legend className="ui-section-label patient-reschedule__legend">{t('selectTime')}</legend>
            <div className="slot-grid">
              {slots.map((slot) => (
                <button
                  type="button"
                  className={`slot-chip ui-mono ${time === slot ? 'selected' : ''}`}
                  key={slot}
                  onClick={() => setTime(slot)}
                  aria-pressed={time === slot}
                >
                  {slot}
                </button>
              ))}
            </div>
            {slotsLoading ? (
              <p role="status" className="patient-reschedule__loading-text">{t('loading')}</p>
            ) : !slots.length && !error && (
              <p className="patient-reschedule__empty-text">{t('noSlots')}</p>
            )}
          </fieldset>
        )}

        {error && <div className="patient-alert error" role="alert">{error}</div>}

        <button
          type="submit"
          className="patient-button patient-home__book-btn patient-reschedule__submit"
          disabled={!time || loading || slotsLoading}
          aria-busy={loading}
        >
          {loading ? t('loading') : t('confirmBooking')}
        </button>
      </form>
    </section>
  );
}
