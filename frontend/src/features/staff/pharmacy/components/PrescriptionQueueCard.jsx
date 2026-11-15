export default function PrescriptionQueueCard({ rx, lang, queueView, selected, onSelect }) {
  const isPaid = rx.billingStatus === 'PAID';
  const isPartial = rx.billingStatus === 'PARTIALLY_PAID' || rx.billingStatus === 'PARTIAL';
  const isUnpaid = rx.billingStatus === 'UNPAID';
  const isDispensed = rx.status === 'DISPENSED' || queueView === 'history';

  const statusText = isDispensed
    ? (lang === 'ar' ? 'تم الصرف' : 'Dispensed')
    : isPaid
      ? (lang === 'ar' ? 'مدفوع · جاهز للصرف' : 'Paid · ready to dispense')
      : isPartial
        ? (lang === 'ar' ? 'مدفوع جزئياً' : 'Part paid')
        : isUnpaid
          ? (lang === 'ar' ? 'بانتظار الدفع' : 'Awaiting payment')
          : (lang === 'ar' ? 'غير مفوتر' : 'Unbilled');

  const statusToneClass = isDispensed
    ? 'ui-status--muted'
    : isPaid
      ? 'ui-status--ok'
      : (isPartial || isUnpaid)
        ? 'ui-status--warn'
        : 'ui-status--muted';

  const timeString = new Date(rx.prescriptionDate).toLocaleTimeString(
    lang === 'ar' ? 'ar-SD' : 'en-GB',
    { hour: '2-digit', minute: '2-digit' }
  );

  return (
    <button
      type="button"
      className={`pharmacy-queue-item ${selected ? 'is-selected selected' : ''}`}
      onClick={onSelect}
    >
      <span className="pharmacy-queue-item__info">
        <span className="pharmacy-queue-item__name">
          {lang === 'ar' ? rx.patient.fullNameAr : rx.patient.fullNameEn}
        </span>
        <span className={`ui-status ${statusToneClass} pharmacy-queue-item__status`}>
          {statusText}
        </span>
      </span>
      <span className="pharmacy-queue-item__time ui-mono">
        {timeString}
      </span>
    </button>
  );
}
