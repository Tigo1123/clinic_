import { Check, MessageCircle } from 'lucide-react';
import { getWhatsAppLink } from '../../../../utils/clinicData';
import { getAppointmentStatusLabel } from '../receptionHelpers';

export default function PendingAppointmentRow({ lang, app, branding, setViewingProfilePatientId, handleApproveAppointment, handleCancelAppointment }) {
  return (
    <article
      className="reception-request-row"
    >
      <div className="reception-request-title">
        <button type="button" className="reception-patient-link" onClick={() => setViewingProfilePatientId(app.patient.id)}>{lang === 'ar' ? app.patient.fullNameAr : app.patient.fullNameEn}</button>
        <span className="badge badge-warning">
          {getAppointmentStatusLabel('PENDING', lang)}
        </span>
      </div>
      <div className="reception-request-meta">
        <span dir="ltr">{app.patient?.fileNumber || '—'} · {app.patient?.phone || '—'}</span>
        <div><strong>{lang === 'ar' ? 'الطبيب:' : 'Doctor:'}</strong> {lang === 'ar' ? app.doctor?.fullNameAr : app.doctor?.fullNameEn}</div>
        <div>
          <strong>
            {lang === 'ar' ? 'الموعد:' : 'Appointment:'}
          </strong>{' '}
          {app.appointmentDate}{' '}
          {lang === 'ar' ? 'الساعة' : 'at'}{' '}
          {app.appointmentTime}
        </div>
      </div>

      <div className="reception-row-actions">
        <button
          type="button"
          className="btn btn-primary"
          style={{ flex: 1, padding: '4px 8px', fontSize: '0.75rem', minHeight: '34px' }}
          onClick={() => handleApproveAppointment(app.id)}
        >
          <Check size={12} />
          {lang === 'ar' ? 'تأكيد الموعد' : 'Confirm Appointment'}
        </button>

        <a
          href={getWhatsAppLink(
            app.patient?.phone,
            lang === 'ar'
              ? `مرحباً ${app.patient?.fullNameAr}، يرجى تأكيد موعدك في ${branding.displayNameAr} مع ${app.doctor?.fullNameAr} بتاريخ ${app.appointmentDate} الساعة ${app.appointmentTime}.`
              : `Hello ${app.patient?.fullNameEn}, please confirm your appointment at ${branding.displayNameEn} with ${app.doctor?.fullNameEn} on ${app.appointmentDate} at ${app.appointmentTime}.`
          )}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-whatsapp"
          style={{ padding: '4px 8px', fontSize: '0.75rem', minHeight: '34px' }}
        >
          <MessageCircle size={12} />
          {lang === 'ar' ? 'واتساب' : 'WhatsApp'}
        </a>

        <button
          type="button"
          className="btn btn-danger"
          style={{ padding: '4px 8px', fontSize: '0.75rem', minHeight: '34px' }}
          onClick={() => handleCancelAppointment(app.id)}
        >
          {lang === 'ar' ? 'رفض الطلب' : 'Reject Request'}
        </button>
      </div>
    </article>
  );
}
