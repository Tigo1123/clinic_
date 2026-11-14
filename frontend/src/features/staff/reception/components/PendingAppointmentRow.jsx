import { Check, MessageCircle, X } from 'lucide-react';
import { getWhatsAppLink } from '../../../../utils/clinicData';

export default function PendingAppointmentRow({
  lang,
  app,
  branding,
  setViewingProfilePatientId,
  handleApproveAppointment,
  handleCancelAppointment
}) {
  const patient = app.patient || {};
  const patientName = lang === 'ar'
    ? patient.fullNameAr || patient.fullNameEn || '—'
    : patient.fullNameEn || patient.fullNameAr || '—';
  const doctorName = lang === 'ar'
    ? app.doctor?.fullNameAr || '—'
    : app.doctor?.fullNameEn || '—';

  return (
    <article className="reception-pending-item">
      <div className="reception-pending-header">
        <button
          type="button"
          className="reception-patient-link"
          onClick={() => setViewingProfilePatientId(patient.id)}
        >
          {patientName}
        </button>
        <span className="reception-pending-detail">
          {patient.fileNumber ? <><span className="ui-mono" dir="ltr">{patient.fileNumber}</span> · </> : null}
          {lang === 'ar'
            ? `د. ${doctorName} · ${app.appointmentDate} الساعة ${app.appointmentTime}`
            : `Dr. ${doctorName} · ${app.appointmentDate} at ${app.appointmentTime}`}
        </span>
      </div>

      <div className="reception-pending-actions">
        <button
          type="button"
          className="btn reception-btn-confirm"
          onClick={() => handleApproveAppointment(app.id)}
        >
          <Check size={14} aria-hidden="true" />
          <span>{lang === 'ar' ? 'تأكيد' : 'Confirm'}</span>
        </button>

        <button
          type="button"
          className="btn btn-secondary reception-btn-decline"
          onClick={() => handleCancelAppointment(app.id)}
        >
          <X size={14} aria-hidden="true" />
          <span>{lang === 'ar' ? 'رفض' : 'Decline'}</span>
        </button>

        {patient.phone && (
          <a
            href={getWhatsAppLink(
              patient.phone,
              lang === 'ar'
                ? `مرحباً ${patientName}، يرجى تأكيد موعدك في ${branding?.displayNameAr || 'شفاء'} مع د. ${doctorName} بتاريخ ${app.appointmentDate} الساعة ${app.appointmentTime}.`
                : `Hello ${patientName}, please confirm your appointment at ${branding?.displayNameEn || 'Shifa'} with Dr. ${doctorName} on ${app.appointmentDate} at ${app.appointmentTime}.`
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
