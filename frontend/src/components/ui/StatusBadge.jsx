import { localizedAppointmentStatus } from '../../utils/appointmentStatus';
import './statusBadge.css';

const toneToModifier = {
  COMPLETED: 'ok',
  PAID: 'ok',
  ACTIVE: 'ok',
  RELEASED: 'ok',
  CONFIRMED: 'ok',
  CHECKED_IN: 'wait',
  IN_CONSULTATION: 'wait',
  SCHEDULED: 'wait',
  WAITING_LAB: 'wait',
  PENDING: 'warn',
  PENDING_BILLING: 'warn',
  PARTIALLY_PAID: 'warn',
  SAMPLE_COLLECTED: 'warn',
  CANCELLED: 'danger',
  NO_SHOW: 'danger',
  UNPAID: 'danger',
  INACTIVE: 'muted',
};

const tone = {
  COMPLETED: 'success', PAID: 'success', ACTIVE: 'success', RELEASED: 'success', CONFIRMED: 'info',
  CHECKED_IN: 'info', IN_CONSULTATION: 'info', SCHEDULED: 'info', WAITING_LAB: 'info', PENDING: 'warning',
  PENDING_BILLING: 'warning', PARTIALLY_PAID: 'warning', SAMPLE_COLLECTED: 'warning',
  CANCELLED: 'danger', NO_SHOW: 'danger', UNPAID: 'danger', INACTIVE: 'neutral'
};

export default function StatusBadge({ status, language }) {
  const normStatus = typeof status === 'string' ? status.toUpperCase() : '';
  const label = language ? localizedAppointmentStatus(status, language) : String(status || 'UNKNOWN').replaceAll('_', ' ');
  const modifier = toneToModifier[normStatus] || 'muted';
  const toneClass = tone[normStatus] || 'neutral';
  return (
    <span className={`status-badge ui-status ui-status--${modifier} status-badge--${toneClass}`}>
      {label}
    </span>
  );
}
