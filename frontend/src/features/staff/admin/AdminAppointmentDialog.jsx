import { useCallback, useEffect, useState } from 'react';
import Dialog from '../../../components/ui/Dialog';
import { apiErrorMessage, fetchWithAuth } from '../../../services/staff/staffApi';
import { getAppointmentStatusLabel } from '../reception/receptionHelpers';

export default function AdminAppointmentDialog({
  request,
  lang = 'ar',
  onClose,
  onOpenPatientProfile
}) {
  const isAr = lang === 'ar';
  const [loading, setLoading] = useState(true);
  const [appointment, setAppointment] = useState(null);
  const [error, setError] = useState('');
  const [actionPending, setActionPending] = useState(false);
  const [actionMessage, setActionMessage] = useState('');

  const loadAppointment = useCallback(async () => {
    if (!request?.appointmentId) {
      setAppointment(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    setActionMessage('');

    try {
      const pendingRes = await fetchWithAuth('/api/appointments/pending');
      if (pendingRes.ok) {
        const pendingList = await pendingRes.json().catch(() => []);
        const pendingMatch = Array.isArray(pendingList)
          ? pendingList.find((item) => item.id === request.appointmentId)
          : null;
        if (pendingMatch) {
          setAppointment(pendingMatch);
          setLoading(false);
          return;
        }
      }

      if (request.doctorId && request.appointmentDate) {
        const queueRes = await fetchWithAuth(
          `/api/appointments/queue/${encodeURIComponent(request.doctorId)}?date=${encodeURIComponent(request.appointmentDate)}`
        );
        if (queueRes.ok) {
          const queueList = await queueRes.json().catch(() => []);
          const queueMatch = Array.isArray(queueList)
            ? queueList.find((item) => item.id === request.appointmentId)
            : null;
          if (queueMatch) {
            setAppointment(queueMatch);
            setLoading(false);
            return;
          }
        }
      }

      setAppointment(null);
    } catch {
      setError(
        isAr
          ? 'تعذر تحميل تفاصيل الموعد.'
          : 'Unable to load the referenced appointment.'
      );
    } finally {
      setLoading(false);
    }
  }, [isAr, request]);

  useEffect(() => {
    if (request) {
      loadAppointment();
    }
  }, [request, loadAppointment]);

  const handleStatusUpdate = async (nextStatus) => {
    if (!appointment || actionPending) return;
    setActionPending(true);
    setError('');
    setActionMessage('');
    try {
      const res = await fetchWithAuth(`/api/appointments/${appointment.id}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status: nextStatus })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          apiErrorMessage(
            data,
            isAr ? 'تعذر تحديث حالة الموعد.' : 'Failed to update appointment status.'
          )
        );
        return;
      }
      setAppointment(data);
      setActionMessage(
        nextStatus === 'CONFIRMED'
          ? (isAr ? 'تم تأكيد الموعد.' : 'Appointment confirmed.')
          : (isAr ? 'تم رفض الموعد.' : 'Appointment declined.')
      );
    } catch {
      setError(isAr ? 'تعذر الاتصال بالخادم.' : 'Unable to reach the server.');
    } finally {
      setActionPending(false);
    }
  };

  const patient = appointment?.patient;
  const doctor = appointment?.doctor;
  const patientId = patient?.id || request?.patientId || null;

  return (
    <Dialog
      open={Boolean(request)}
      onClose={onClose}
      title={isAr ? 'تفاصيل الموعد' : 'Appointment record'}
      description={
        appointment
          ? (isAr ? 'عرض مباشر لسجل الموعد المشار إليه.' : 'Live view of the referenced appointment record.')
          : undefined
      }
    >
      <div dir={isAr ? 'rtl' : 'ltr'}>
        {loading ? (
          <p role="status">{isAr ? 'جارٍ تحميل الموعد…' : 'Loading appointment…'}</p>
        ) : error ? (
          <div role="alert" className="patient-alert error">
            <span>{error}</span>
          </div>
        ) : !appointment ? (
          <div role="status" className="patient-alert warning">
            {isAr
              ? 'هذا الموعد لم يعد معلقاً أو نشطاً (ربما تم إلغاؤه أو إكماله أو إزالته).'
              : 'This appointment is no longer pending or active (it may have been cancelled, completed, or removed).'}
          </div>
        ) : (
          <div className="patient-panel" style={{ marginBottom: '12px' }}>
            <div className="patient-hairline-row">
              <span className="patient-detail-label">{isAr ? 'المريض' : 'Patient'}</span>
              <strong>
                {isAr
                  ? patient?.fullNameAr || patient?.fullNameEn || '—'
                  : patient?.fullNameEn || patient?.fullNameAr || '—'}
              </strong>
            </div>
            {patient?.fileNumber && (
              <div className="patient-hairline-row">
                <span className="patient-detail-label">{isAr ? 'رقم الملف' : 'File number'}</span>
                <span className="ui-mono" dir="ltr">{patient.fileNumber}</span>
              </div>
            )}
            <div className="patient-hairline-row">
              <span className="patient-detail-label">{isAr ? 'الطبيب' : 'Doctor'}</span>
              <strong>
                {isAr
                  ? doctor?.fullNameAr || doctor?.fullNameEn || '—'
                  : doctor?.fullNameEn || doctor?.fullNameAr || '—'}
              </strong>
            </div>
            <div className="patient-hairline-row">
              <span className="patient-detail-label">{isAr ? 'التاريخ والوقت' : 'Date & time'}</span>
              <span className="ui-mono" dir="ltr">
                {appointment.appointmentDate} · {appointment.appointmentTime}
              </span>
            </div>
            <div className="patient-hairline-row">
              <span className="patient-detail-label">{isAr ? 'الحالة' : 'Status'}</span>
              <strong>{getAppointmentStatusLabel(appointment.status, lang)}</strong>
            </div>
          </div>
        )}

        {actionMessage && (
          <div role="status" className="patient-alert success">
            {actionMessage}
          </div>
        )}

        <div className="dialog-actions" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'flex-end' }}>
          {appointment?.status === 'PENDING' && (
            <>
              <button
                type="button"
                className="btn btn-primary"
                disabled={actionPending}
                onClick={() => handleStatusUpdate('CONFIRMED')}
              >
                {isAr ? 'تأكيد الموعد' : 'Confirm'}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={actionPending}
                onClick={() => handleStatusUpdate('CANCELLED')}
              >
                {isAr ? 'رفض' : 'Decline'}
              </button>
            </>
          )}
          {patientId && typeof onOpenPatientProfile === 'function' && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                onClose();
                onOpenPatientProfile(patientId);
              }}
            >
              {isAr ? 'فتح ملف المريض' : 'Open Patient File'}
            </button>
          )}
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {isAr ? 'إغلاق' : 'Close'}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
