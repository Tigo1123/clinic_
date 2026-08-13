const tone = {
  COMPLETED: 'success', PAID: 'success', ACTIVE: 'success', RELEASED: 'success', CONFIRMED: 'info',
  CHECKED_IN: 'info', IN_CONSULTATION: 'info', SCHEDULED: 'info', PENDING: 'warning',
  PENDING_BILLING: 'warning', PARTIALLY_PAID: 'warning', SAMPLE_COLLECTED: 'warning',
  CANCELLED: 'danger', NO_SHOW: 'danger', UNPAID: 'danger', INACTIVE: 'neutral'
};
export default function StatusBadge({ status }) {
  const label = String(status || 'UNKNOWN').replaceAll('_', ' ');
  return <span className={`status-badge status-badge--${tone[status] || 'neutral'}`}>{label}</span>;
}
