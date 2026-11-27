import { guardFormSubmit } from '../../../../utils/guardFormSubmit.js';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Check } from 'lucide-react';
import { patientApiRequest as apiRequest } from '../../../../services/apiClient';
import { patientErrorMessage } from '../../../../services/patientErrors';
import { clinicCalendarDays } from '../../../../utils/clinicTime';
import { EmptyState, ErrorState, Skeleton } from '../../../../components/feedback/States';
import StatusBadge from '../../../../components/ui/StatusBadge';
import { localizeDoctorSpecialty } from '../doctorSpecialty';
import { doctorName, useApi } from './shared.jsx';
import './BookAppointment.css';

function formatConsultationFee(doctor, language, fallbackLabel) {
  const raw = doctor?.consultationFee;
  if (raw === null || raw === undefined || raw === '') return fallbackLabel;
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return fallbackLabel;
  const formatted = numeric.toLocaleString(language === 'ar' ? 'ar' : 'en');
  return `${formatted} ${language === 'ar' ? 'ج.س' : 'SDG'}`;
}

function formatSubmittedDate(dateString, language) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateString || ''))) return dateString || '';
  const [year, month, day] = dateString.split('-').map(Number);
  const utcDate = new Date(Date.UTC(year, month - 1, day, 12));
  return utcDate.toLocaleDateString(language, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC'
  });
}

function DoctorSummaryRows({ doctor, language, t }) {
  const specialty = localizeDoctorSpecialty({
    specialtyEn: doctor.specialty?.nameEn || doctor.specialtyEn,
    specialtyAr: doctor.specialty?.nameAr || doctor.specialtyAr
  }, language);
  return (
    <>
      <div className="patient-hairline-row patient-book__doctor-row">
        <span className="patient-detail-label">{t('doctor')}</span>
        <strong className="patient-book__doctor-name">
          {doctorName(doctor, language) || t('notAvailable')}
        </strong>
      </div>
      <div className="patient-hairline-row patient-book__doctor-row">
        <span className="patient-detail-label">{t('specialty')}</span>
        <span className="patient-book__doctor-value">
          {specialty || t('notAvailable')}
        </span>
      </div>
      <div className="patient-hairline-row patient-book__doctor-row">
        <span className="patient-detail-label">{t('consultationFee')}</span>
        <strong className="ui-mono patient-book__doctor-value">
          {formatConsultationFee(doctor, language, t('notAvailable'))}
        </strong>
      </div>
    </>
  );
}

export function BookAppointment() {
  const { doctorId } = useParams();
  return <DoctorBooking key={doctorId} doctorId={doctorId} />;
}

function DoctorBooking({ doctorId }) {
  const { t, i18n } = useTranslation();
  const language = (i18n.resolvedLanguage || i18n.language || 'ar').startsWith('ar') ? 'ar' : 'en';
  const direction = language === 'ar' ? 'rtl' : 'ltr';

  const {
    data: doctor,
    error: doctorError,
    errorCode: doctorErrorCode,
    errorStatus: doctorErrorStatus,
    loading: doctorLoading,
    reload: reloadDoctor
  } = useApi(`/api/patient/doctors/${doctorId}`);

  const doctorNotFound = doctorErrorStatus === 404 || doctorErrorCode === 'DOCTOR_NOT_FOUND';
  const [date, setDate] = useState('');
  const [slots, setSlots] = useState([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [time, setTime] = useState('');
  const [submitError, setSubmitError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [submittedBooking, setSubmittedBooking] = useState(null);
  const days = clinicCalendarDays(7);

  const [slotRevision, setSlotRevision] = useState(0);
  const [slotError, setSlotError] = useState(null);

  useEffect(() => {
    let current = true;
    setSlots([]);
    setTime('');
    setSlotError(null);
    if (doctorId && date && !doctorNotFound) {
      setSlotsLoading(true);
      apiRequest(`/api/appointments/slots?doctorId=${encodeURIComponent(doctorId)}&date=${encodeURIComponent(date)}`)
        .then((value) => { if (current) setSlots(Array.isArray(value) ? value : []); })
        .catch((requestError) => { if (current) setSlotError(requestError || { message: '' }); })
        .finally(() => { if (current) setSlotsLoading(false); });
    } else {
      setSlotsLoading(false);
    }
    return () => { current = false; };
  }, [doctorId, date, slotRevision, doctorNotFound]);

  async function submitBooking() {
    if (!doctor || !date || !slots.includes(time) || slotsLoading || loading) return;
    setLoading(true);
    setSubmitError(null);

    try {
      const appointment = await apiRequest('/api/patient/appointments', {
        method: 'POST',
        body: JSON.stringify({ doctorId, appointmentDate: date, appointmentTime: time })
      });
      if (!appointment?.id) throw new Error('Missing booking response');
      setSubmittedBooking({
        ...appointment,
        doctor: appointment.doctor || doctor,
        appointmentDate: appointment.appointmentDate || date,
        appointmentTime: appointment.appointmentTime || time
      });
    } catch (requestError) {
      setSubmitError(requestError || { message: '' });
      if (requestError?.code === 'APPOINTMENT_SLOT_UNAVAILABLE' || requestError?.code === 'INVALID_APPOINTMENT_SLOT') {
        setTime('');
        setSlotsLoading(true);
        setSlotRevision((value) => value + 1);
      }
    } finally {
      setLoading(false);
    }
  }

  const error = submitError ? patientErrorMessage(submitError, t('bookingFailed'), language) : '';
  const slotErrorMessage = slotError ? patientErrorMessage(slotError, t('patientLoadError'), language) : '';
  const localizedDoctorError = patientErrorMessage(
    { code: doctorErrorCode, status: doctorErrorStatus, message: doctorError },
    t('patientLoadError'),
    language
  );

  if (submittedBooking) {
    return (
      <section className="patient-book patient-card patient-booking-pending patient-book__success-panel" dir={direction}>
        <div className="patient-alert success" role="status">
          <strong>{t('bookingRequestSent')}</strong>
          <p>{t('bookingPendingReview')}</p>
          <p>{t('bookingFollowStatus')}</p>
        </div>

        <div className="patient-panel patient-book__summary-panel">
          <div className="patient-hairline-row patient-book__doctor-row">
            <span className="patient-detail-label">{t('bookingStatus')}</span>
            <StatusBadge status={submittedBooking.status} language={language} />
          </div>
          <DoctorSummaryRows
            doctor={submittedBooking.doctor}
            language={language}
            t={t}
          />
          <div className="patient-hairline-row patient-book__doctor-row">
            <span className="patient-detail-label">{t('date')}</span>
            <span className="patient-book__doctor-value">
              {formatSubmittedDate(submittedBooking.appointmentDate, language)}
            </span>
          </div>
          <div className="patient-hairline-row patient-book__doctor-row">
            <span className="patient-detail-label">{t('appointmentTime')}</span>
            <strong className="ui-mono patient-book__doctor-value">
              <bdi dir="ltr">{submittedBooking.appointmentTime}</bdi>
            </strong>
          </div>
        </div>

        <div className="patient-actions patient-actions-group patient-book__success-actions">
          <Link className="patient-button" to="/patient/appointments">{t('followMyAppointments')}</Link>
          <Link className="patient-button secondary" to={`/patient/appointments/${submittedBooking.id}`}>
            {t('details')}
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="patient-book" dir={direction}>
      <Link to="/patient/doctors" className="patient-back-link">
        <ArrowLeft size={18} strokeWidth={1.8} aria-hidden="true" />
        {t('patientBack')}
      </Link>

      <header className="patient-book__header">
        <h1 className="patient-page-title ui-page-title">
          {t('bookAppointment')}
        </h1>
      </header>

      {doctorLoading ? (
        <div className="patient-card patient-book__loading-card" role="status">
          <Skeleton rows={2} />
          <p className="patient-reschedule__loading-text">{t('loading')}</p>
        </div>
      ) : doctorNotFound ? (
        <EmptyState title={t('doctorNotFound')} message={localizedDoctorError} />
      ) : !doctor ? (
        <ErrorState message={localizedDoctorError} onRetry={reloadDoctor} />
      ) : (
        <div className="patient-panel patient-book__doctor-card">
          <DoctorSummaryRows doctor={doctor} language={language} t={t} />
        </div>
      )}

      <form onSubmit={(event) => guardFormSubmit(event, submitBooking)} className="patient-book__form">
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
                  disabled={loading || doctorNotFound}
                  onClick={() => {
                    if (isSelected) return;
                    setDate(value);
                    setTime('');
                    setSubmitError(null);
                  }}
                  aria-pressed={isSelected}
                  aria-label={day.calendarDate.toLocaleDateString(language, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })}
                >
                  {isSelected && (
                    <span className="patient-book__chip-check" aria-hidden="true">
                      <Check size={12} strokeWidth={2.75} />
                    </span>
                  )}
                  <span>{day.calendarDate.toLocaleDateString(language, { weekday: 'short', timeZone: 'UTC' })}</span>
                  <span className="date-chip__num ui-mono">{day.calendarDate.getUTCDate().toLocaleString(language)}</span>
                  <span>{day.calendarDate.toLocaleDateString(language, { month: 'short', timeZone: 'UTC' })}</span>
                </button>
              );
            })}
          </div>
        </section>

        {date && !doctorNotFound && (
          <fieldset className="patient-book-fieldset patient-reschedule__fieldset">
            <legend className="ui-section-label patient-reschedule__legend">{t('selectTime')}</legend>
            <div className="slot-grid">
              {slots.map((slot) => {
                const isSelected = time === slot;
                return (
                  <button
                    type="button"
                    className={`slot-chip ui-mono ${isSelected ? 'selected' : ''}`}
                    key={slot}
                    disabled={loading}
                    onClick={() => { setTime(slot); setSubmitError(null); }}
                    aria-pressed={isSelected}
                  >
                    {isSelected && (
                      <Check size={15} strokeWidth={2.5} className="patient-book__slot-check" aria-hidden="true" />
                    )}
                    <bdi dir="ltr">{slot}</bdi>
                  </button>
                );
              })}
            </div>
            {slotsLoading ? (
              <p role="status" className="patient-reschedule__loading-text">{t('loading')}</p>
            ) : !slots.length && !error && !slotError && (
              <p className="patient-reschedule__empty-text">{t('noSlots')}</p>
            )}
          </fieldset>
        )}

        {slotError && !doctorNotFound && (
          <div role="alert" className="patient-alert error patient-book__alert-row">
            <span className="patient-book__alert-message">{slotErrorMessage}</span>
            <button
              type="button"
              className="patient-button secondary patient-book__retry-btn"
              onClick={() => setSlotRevision((value) => value + 1)}
            >
              {t('patientRetry')}
            </button>
          </div>
        )}
        {error && <div className="patient-alert error" role="alert">{error}</div>}

        <button
          type="submit"
          className="patient-button patient-home__book-btn patient-reschedule__submit"
          disabled={!doctor || doctorLoading || !time || loading || slotsLoading}
          aria-busy={loading}
        >
          {loading ? t('loading') : t('sendBookingRequest')}
        </button>
      </form>
    </section>
  );
}
