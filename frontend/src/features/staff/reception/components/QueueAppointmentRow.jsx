import { DollarSign, MessageCircle } from 'lucide-react';
import { getWhatsAppLink } from '../../../../utils/clinicData';
import { getAppointmentStatusLabel, queueRowStatusStyles } from '../receptionHelpers';

export default function QueueAppointmentRow({ lang, app, branding, selectedDoctor, setViewingProfilePatientId, handleCheckIn, handleQuickBill }) {
  const isEmergency = app.emergencyOverride;
  const statusStyles = queueRowStatusStyles(app.status);

  return (
    <article
      className={`reception-queue-row ${isEmergency ? 'emergency-border' : ''}`}
      style={statusStyles}
    >
      <div className="reception-queue-patient">
        <button type="button" className="reception-patient-link" onClick={() => setViewingProfilePatientId(app.patient.id)}>{lang === 'ar' ? app.patient.fullNameAr : app.patient.fullNameEn}</button>
        <small dir="ltr">{app.patient.fileNumber || '—'} · {app.patient.phone || '—'}</small>
      </div>
      <div className="reception-queue-doctor">
        <small>{lang === 'ar' ? 'الطبيب' : 'Doctor'}</small>
        <strong>{lang === 'ar' ? selectedDoctor.fullNameAr : selectedDoctor.fullNameEn}</strong>
      </div>
      <time className="reception-queue-time" dateTime={`${app.appointmentDate}T${app.appointmentTime}`} dir="ltr">{app.appointmentTime}</time>
      <div className="reception-queue-status">
        <span className={`badge ${app.status === 'COMPLETED' ? 'badge-success' :
          app.status === 'IN_CONSULTATION' ? 'badge-primary' :
            app.status === 'CHECKED_IN'
              ? (app.consultationReady ? 'badge-success' : 'badge-warning')
              : 'badge-secondary'
          }`}>
          {app.status === 'CHECKED_IN'
            ? (
              app.consultationReady
                ? (lang === 'ar' ? 'جاهز للطبيب' : 'Ready for Doctor')
                : (
                  app.consultationPaymentStatus === 'PARTIALLY_PAID'
                    ? (lang === 'ar' ? 'دفع جزئي' : 'Partially Paid')
                    : (lang === 'ar' ? 'بانتظار الدفع' : 'Payment Pending')
                )
            )
            : getAppointmentStatusLabel(app.status, lang)}
        </span>
        {isEmergency && <span className="emergency-tag">{lang === 'ar' ? 'طوارئ مستعجلة' : 'Emergency Priority'}</span>}
      </div>

      <div className="reception-row-actions">
        {(app.status === 'SCHEDULED' || app.status === 'CONFIRMED') && (
          <button
            type="button"
            className="btn btn-primary"
            style={{ flex: 1, padding: '4px 8px', fontSize: '0.75rem', margin: 0, minHeight: '32px' }}
            onClick={() => handleCheckIn(app.id)}
          >
            {lang === 'ar' ? 'تسجيل وصول' : 'Check In'}
          </button>
        )}
        {app.status === 'CHECKED_IN' && !app.consultationReady && (
          <button
            type="button"
            className="btn btn-secondary"
            style={{ flex: 1, padding: '4px 8px', fontSize: '0.75rem', margin: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', minHeight: '32px' }}
            onClick={() => handleQuickBill(app)}
          >
            <DollarSign size={12} />
            {app.consultationPaymentStatus === 'PARTIALLY_PAID'
              ? (lang === 'ar' ? 'إكمال الدفع' : 'Continue Payment')
              : (lang === 'ar' ? 'دفع رسوم الكشف' : 'Pay Consultation')}
          </button>
        )}
        <a
          href={getWhatsAppLink(
            app.patient?.phone,
            lang === 'ar'
              ? `${branding.displayNameAr}: تذكير بموعدك (${app.patient.fullNameAr}). الوقت: ${app.appointmentTime}.`
              : `${branding.displayNameEn}: Reminder for your appointment (${app.patient.fullNameEn}) at ${app.appointmentTime}.`
          )}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-whatsapp"
          style={{ padding: '4px 8px', fontSize: '0.75rem', minHeight: '32px' }}
        >
          <MessageCircle size={12} />
        </a>
      </div>
    </article>
  );
}
