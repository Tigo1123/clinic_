import { DollarSign, MessageCircle } from 'lucide-react';
import { getWhatsAppLink } from '../../../../utils/clinicData';
import { getAppointmentStatusLabel } from '../receptionHelpers';

export default function QueueAppointmentRow({
  index = 0,
  lang,
  app,
  branding,
  selectedDoctor,
  setViewingProfilePatientId,
  handleCheckIn,
  handleQuickBill,
  isActionPending = false
}) {
  const isEmergency = app.emergencyOverride;
  const patient = app.patient || {};
  const patientName = lang === 'ar'
    ? patient.fullNameAr || patient.fullNameEn || '—'
    : patient.fullNameEn || patient.fullNameAr || '—';
  const doctorName = lang === 'ar'
    ? app.doctor?.fullNameAr || selectedDoctor?.fullNameAr || '—'
    : app.doctor?.fullNameEn || selectedDoctor?.fullNameEn || '—';

  let statusClass = 'ui-status--wait';
  let statusText = getAppointmentStatusLabel(app.status, lang);

  if (app.status === 'COMPLETED') {
    statusClass = 'ui-status--muted';
    statusText = lang === 'ar' ? 'مكتمل' : 'Completed';
  } else if (app.status === 'IN_CONSULTATION') {
    statusClass = 'ui-status--ok';
    statusText = lang === 'ar' ? 'داخل العيادة' : 'With doctor';
  } else if (app.status === 'CHECKED_IN') {
    if (app.consultationReady) {
      statusClass = 'ui-status--ok';
      statusText = lang === 'ar' ? 'جاهز للطبيب' : 'Ready for Doctor';
    } else if (app.consultationPaymentStatus === 'PARTIALLY_PAID') {
      statusClass = 'ui-status--warn';
      statusText = lang === 'ar' ? 'دفع جزئي' : 'Partially Paid';
    } else {
      statusClass = 'ui-status--warn';
      statusText = lang === 'ar' ? 'بانتظار الدفع' : 'Payment due';
    }
  } else if (app.status === 'CANCELLED' || app.status === 'NO_SHOW') {
    statusClass = 'ui-status--danger';
  }

  const isPaymentDue = app.status === 'CHECKED_IN' && !app.consultationReady;
  const isCheckInAvailable = app.status === 'SCHEDULED' || app.status === 'CONFIRMED';

  return (
    <article
      className={`reception-queue-row ${isEmergency ? 'emergency-border' : ''}`}
    >
      <span className="ui-mono reception-queue-col-no" dir="ltr">
        {String(index + 1).padStart(2, '0')}
      </span>

      <div className="reception-queue-col-patient">
        <button
          type="button"
          className="reception-patient-link"
          onClick={() => setViewingProfilePatientId(patient.id)}
        >
          {patientName}
        </button>
        <span className="ui-mono reception-patient-id" dir="ltr">
          {patient.fileNumber || '—'}
        </span>
      </div>

      <span className="reception-queue-col-doctor">
        {doctorName}
      </span>

      <span className="ui-mono reception-queue-col-time" dir="ltr">
        {app.appointmentTime || '—'}
      </span>

      <span className={`ui-status ${statusClass} reception-queue-col-status`}>
        {statusText}
        {isEmergency && (
          <span className="reception-emergency-tag emergency-tag">
            {lang === 'ar' ? 'طوارئ مستعجلة' : 'Emergency Priority'}
          </span>
        )}
      </span>

      <div className="reception-queue-col-action">
        {isPaymentDue && (
          <button
            type="button"
            className="btn btn-secondary reception-action-btn"
            onClick={() => handleQuickBill(app)}
          >
            <DollarSign size={14} aria-hidden="true" />
            <span>
              {app.consultationPaymentStatus === 'PARTIALLY_PAID'
                ? (lang === 'ar' ? 'إكمال الدفع' : 'Continue Payment')
                : (lang === 'ar' ? 'دفع رسوم الكشف' : 'Pay Consultation')}
            </span>
          </button>
        )}

        {isCheckInAvailable && (
          <button
            type="button"
            className="btn btn-secondary reception-action-btn"
            disabled={isActionPending}
            onClick={() => handleCheckIn(app.id)}
          >
            {lang === 'ar' ? 'تسجيل وصول' : 'Check In'}
          </button>
        )}

        {!isPaymentDue && !isCheckInAvailable && (
          <button
            type="button"
            className="btn btn-secondary reception-action-btn"
            onClick={() => setViewingProfilePatientId(patient.id)}
          >
            {lang === 'ar' ? 'فتح الملف' : 'Open'}
          </button>
        )}

        {patient.phone && (
          <a
            href={getWhatsAppLink(
              patient.phone,
              lang === 'ar'
                ? `${branding?.displayNameAr || 'شفاء'}: تذكير بموعدك (${patientName}). الوقت: ${app.appointmentTime}.`
                : `${branding?.displayNameEn || 'Shifa'}: Reminder for your appointment (${patientName}) at ${app.appointmentTime}.`
            )}
            target="_blank"
            rel="noopener noreferrer"
            className="reception-whatsapp-btn"
            aria-label={lang === 'ar' ? 'واتساب' : 'WhatsApp'}
          >
            <MessageCircle size={15} aria-hidden="true" />
          </a>
        )}
      </div>
    </article>
  );
}
