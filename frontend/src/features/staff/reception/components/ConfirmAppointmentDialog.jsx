import { useCallback, useRef, useState } from 'react';
import Dialog from '../../../../components/ui/Dialog';
import { apiErrorMessage, fetchWithAuth } from '../../../../services/staff/staffApi';

export default function ConfirmAppointmentDialog({ appointment, lang, onClose, onConfirmed }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const close = useCallback(() => {
    if (!inFlight.current) onClose();
  }, [onClose]);
  const ar = lang === 'ar';
  const name = (person) => (ar ? person?.fullNameAr || person?.fullNameEn : person?.fullNameEn || person?.fullNameAr) || '—';

  async function confirm() {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setError('');
    const fallback = ar ? 'تعذر تأكيد الموعد. يرجى المحاولة مرة أخرى.' : 'Could not confirm the appointment. Please try again.';
    try {
      const response = await fetchWithAuth(`/api/appointments/${appointment.id}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'CONFIRMED' })
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        onConfirmed(appointment, data);
      } else {
        setError(apiErrorMessage(data, fallback, lang));
      }
    } catch {
      setError(fallback);
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  return (
    <Dialog open title={ar ? 'تأكيد الموعد' : 'Confirm appointment'} onClose={close}>
      <dl className="ui-dialog__details reception-confirm-details">
        <dt>{ar ? 'المريض' : 'Patient'}</dt><dd>{name(appointment.patient)}</dd>
        <dt>{ar ? 'الطبيب' : 'Doctor'}</dt><dd>{name(appointment.doctor)}</dd>
        <dt>{ar ? 'التاريخ' : 'Date'}</dt><dd><bdi>{appointment.appointmentDate}</bdi></dd>
        <dt>{ar ? 'الوقت' : 'Time'}</dt><dd><bdi>{appointment.appointmentTime}</bdi></dd>
      </dl>
      {error && <p role="alert" className="patient-alert error">{error}</p>}
      <div className="ui-dialog__actions" aria-busy={saving}>
        <button type="button" className="btn btn-secondary" aria-disabled={saving} onClick={close}>
          {ar ? 'إلغاء' : 'Cancel'}
        </button>
        <button type="button" className="btn btn-primary" aria-disabled={saving} onClick={confirm}>
          {saving ? (ar ? 'جارٍ التأكيد…' : 'Confirming…') : (ar ? 'تأكيد الموعد' : 'Confirm appointment')}
        </button>
      </div>
    </Dialog>
  );
}
