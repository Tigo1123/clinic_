import { useCallback, useEffect, useRef, useState } from 'react';
import Dialog from '../../components/ui/Dialog';
import { fetchWithAuth } from '../../services/staffApi';
import { cancelReceptionAppointment, cancellationErrorMessage } from './receptionCancellation.js';

export default function ReceptionCancellationDialog({ appointment, lang, onClose, onCommitted, onRevalidate, fallbackFocusRef }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const inFlight = useRef(false);
  const mounted = useRef(false);
  const back = useRef(null);
  const pendingMessage = useRef(null);
  const trigger = useRef(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setError(null); if (appointment) trigger.current = document.activeElement; }, [appointment]);
  useEffect(() => { if (pending) pendingMessage.current?.focus(); }, [pending]);
  const close = useCallback(() => {
    if (inFlight.current) return;
    onClose();
    requestAnimationFrame(() => { if (!trigger.current?.isConnected) fallbackFocusRef.current?.focus(); });
  }, [onClose, fallbackFocusRef]);
  const submit = async event => {
    event.preventDefault();
    if (!appointment || inFlight.current) return;
    inFlight.current = true; setPending(true); setError(null);
    try {
      const committed = await cancelReceptionAppointment(fetchWithAuth, appointment.id);
      if (!mounted.current) return;
      onCommitted(committed);
      requestAnimationFrame(() => fallbackFocusRef.current?.focus());
    } catch (requestError) {
      if (!mounted.current) return;
      setError(requestError);
      if ([404, 409].includes(requestError.status) || !requestError.status) onRevalidate();
    } finally {
      inFlight.current = false;
      if (mounted.current) setPending(false);
    }
  };
  const ar = lang === 'ar';
  return <Dialog open={Boolean(appointment)} title={ar ? 'إلغاء الموعد' : 'Cancel appointment'}
    description={ar ? 'هل تريد إلغاء هذا الموعد؟ لن يظهر في قائمة المواعيد النشطة بعد الإلغاء.' : 'Cancel this appointment? It will be removed from the active appointment list.'}
    onClose={close} initialFocusRef={back}>
    <form className="reception-cancellation" dir={ar ? 'rtl' : 'ltr'} aria-busy={pending} onSubmit={submit}>
      <dl><dt>{ar ? 'المريض' : 'Patient'}</dt><dd><bdi>{ar ? appointment?.patient?.fullNameAr : appointment?.patient?.fullNameEn}</bdi></dd>
        <dt>{ar ? 'الموعد' : 'Appointment'}</dt><dd><bdi dir="ltr">{appointment?.appointmentDate} · {appointment?.appointmentTime}</bdi></dd></dl>
      {pending && <p ref={pendingMessage} tabIndex={-1} role="status" aria-live="polite">{ar ? 'جارٍ إلغاء الموعد…' : 'Cancelling appointment…'}</p>}
      {error && <p role="alert">{cancellationErrorMessage(error, lang)}</p>}
      <div className="dialog-actions">
        <button ref={back} type="button" className="btn btn-secondary" disabled={pending} onClick={close}>{ar ? 'رجوع' : 'Back'}</button>
        <button type="submit" className="btn btn-danger" disabled={pending}>{pending ? (ar ? 'جارٍ الإلغاء…' : 'Cancelling…') : error ? (ar ? 'إعادة محاولة الإلغاء' : 'Retry cancellation') : (ar ? 'تأكيد الإلغاء' : 'Confirm cancellation')}</button>
      </div>
    </form>
  </Dialog>;
}
