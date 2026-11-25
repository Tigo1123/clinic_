import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { patientApiRequest as apiRequest } from '../../../../services/apiClient';
import { patientSocket } from '../../../../services/patient/patientSocket';
import { patientErrorMessage } from '../../../../services/patientErrors';
import StatusBadge from '../../../../components/ui/StatusBadge';
import Dialog from '../../../../components/ui/Dialog';
import { EmptyState, ErrorState, Skeleton } from '../../../../components/feedback/States';
import { localizeDoctorSpecialty } from '../doctorSpecialty';
import { useApi, doctorName } from './shared.jsx';

export function AppointmentDetails() {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const language = i18n.language?.startsWith('ar') ? 'ar' : 'en';
  const { data: appointment, error, errorStatus, loading, reload } = useApi(`/api/patient/appointments/${id}`);
  const [actionError, setActionError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    setActionError('');
    setConfirming(false);
    setCancelling(false);
  }, [id]);

  useEffect(() => {
    const handleNotification = (notif) => {
      if (notif?.targetId === id || notif?.targetType === 'appointment') {
        reload();
      }
    };
    patientSocket.on('notification', handleNotification);
    return () => {
      patientSocket.off('notification', handleNotification);
    };
  }, [id, reload]);

  async function cancel() {
    setCancelling(true);
    setActionError('');
    try {
      await apiRequest(`/api/patient/appointments/${id}/cancel`, { method: 'POST' });
      setConfirming(false);
      reload();
    } catch (requestError) {
      setActionError(patientErrorMessage(requestError, t('cancelFailed')));
    } finally {
      setCancelling(false);
    }
  }

  if (loading) return <div className="patient-card"><Skeleton/></div>;
  if (errorStatus === 404) return <EmptyState title={t('appointmentNotFound')} message={t('appointmentNotFoundMessage')}/>;
  if (error) return <ErrorState message={error} onRetry={reload}/>;
  if (!appointment) return <EmptyState title={t('appointmentNotFound')} message={t('appointmentNotFoundMessage')}/>;

  const canModify = ['PENDING', 'SCHEDULED', 'CONFIRMED'].includes(appointment.status);

  return (
    <article className="patient-appointment-details">
      <header className="patient-appointment-details__header ui-page-header">
        <h1 className="patient-page-title ui-page-title">{t('appointmentDetails')}</h1>
        <div>
          <StatusBadge status={appointment.status} language={i18n.language}/>
        </div>
      </header>

      <div className="patient-panel">
        <div className="patient-hairline-row">
          <span className="patient-detail-label">{t('doctor')}</span>
          <div className="patient-appointment-details__end">
            <span className="patient-appointment-details__doc">{doctorName(appointment.doctor, i18n.language)}</span>
            <span className="patient-appointment-details__spec">{localizeDoctorSpecialty(appointment.doctor, language)}</span>
          </div>
        </div>

        <div className="patient-hairline-row">
          <span className="patient-detail-label">{t('dateAndTime', { defaultValue: 'Date & time' })}</span>
          <strong className="ui-mono patient-appointment-details__strong">
            <bdi dir="ltr">{appointment.appointmentDate} · {appointment.appointmentTime}</bdi>
          </strong>
        </div>

        <div className="patient-hairline-row">
          <span className="patient-detail-label">{t('appointmentId', { defaultValue: 'Reference' })}</span>
          <span className="ui-mono patient-detail-label">
            #{String(appointment.id).slice(0, 8).toUpperCase()}
          </span>
        </div>
      </div>

      {actionError && <div className="patient-alert error" role="alert">{actionError}</div>}

      {canModify && (
        <div className="patient-appointment-details__actions">
          <Link className="patient-button secondary patient-appointment-details__resched-btn" to={`/patient/appointments/${id}/reschedule`}>
            {t('rescheduleAppointment')}
          </Link>
          <button
            type="button"
            className="patient-button patient-button--danger patient-appointment-details__resched-btn"
            onClick={() => { setActionError(''); setConfirming(true); }}
          >
            {t('cancelAppointment')}
          </button>
        </div>
      )}

      <Dialog
        open={confirming}
        onClose={() => !cancelling && setConfirming(false)}
        title={t('cancelAppointmentQuestion')}
        description={t('cancelWarning')}
      >
        <div className="ui-dialog__details patient-dialog__details">
          <strong>{doctorName(appointment.doctor, i18n.language)}</strong>
          <span dir="ltr" className="ui-mono patient-detail-label">{appointment.appointmentDate} · {appointment.appointmentTime}</span>
        </div>
        {actionError && <div className="patient-alert error" role="alert">{actionError}</div>}
        <div className="ui-dialog__actions patient-dialog__actions">
          <button
            type="button"
            className="ui-button ui-button--outline patient-button secondary"
            onClick={() => setConfirming(false)}
            disabled={cancelling}
          >
            {t('keepAppointment')}
          </button>
          <button
            type="button"
            className="ui-button ui-button--danger patient-button patient-button--danger"
            onClick={cancel}
            disabled={cancelling}
            aria-busy={cancelling}
          >
            {cancelling ? t('loading') : t('cancelAppointment')}
          </button>
        </div>
      </Dialog>
    </article>
  );
}
