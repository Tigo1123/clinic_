export default function PrescriptionQueueCard({ rx, lang, queueView, selected, onSelect }) {
  return (
    <div
      className={`queue-card-item glass-panel ${selected ? 'selected' : ''}`}
      onClick={onSelect}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: '0.75rem'
        }}
      >
        <strong>
          {lang === 'ar'
            ? rx.patient.fullNameAr
            : rx.patient.fullNameEn}
        </strong>

        <span
          className={`badge ${
            rx.billingStatus === 'PAID'
              ? 'badge-success'
              : 'badge-warning'
          }`}
          style={{
            fontSize: '0.68rem',
            whiteSpace: 'nowrap'
          }}
        >
          {rx.billingStatus === 'PAID'
            ? (lang === 'ar' ? 'مدفوع' : 'PAID')
            : rx.billingStatus === 'PARTIALLY_PAID'
              ? (lang === 'ar' ? 'مدفوع جزئياً' : 'PARTIAL')
              : rx.billingStatus === 'UNPAID'
                ? (lang === 'ar' ? 'غير مدفوع' : 'UNPAID')
                : queueView === 'history'
                  ? rx.status
                  : (lang === 'ar' ? 'غير مفوتر' : 'UNBILLED')}
        </span>
      </div>

      <div
        style={{
          marginTop: '0.55rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.3rem'
        }}
      >
        {(rx.prescribedDrugs || []).map((item) => {
          const remainingQty = Math.max(
            0,
            Number(item.qtyPrescribed || 0) -
              Number(item.qtyDispensed || 0)
          );

          const drugName = item.drug
            ? (
                lang === 'ar'
                  ? item.drug.labelAr
                  : item.drug.labelEn
              )
            : item.customDrugName;

          return (
            <div
              key={item.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '0.5rem',
                fontSize: '0.8rem'
              }}
            >
              <span>
                {drugName ||
                  (lang === 'ar'
                    ? 'دواء غير مسمى'
                    : 'Unnamed medication')}
              </span>

              <span
                style={{
                  fontWeight: 600,
                  color: 'var(--primary)'
                }}
              >
                {item.pharmacyReviewStatus === 'EXTERNAL'
                  ? (lang === 'ar' ? 'تعذر الصرف' : 'Unavailable')
                  : `${lang === 'ar' ? 'المتبقي:' : 'Remaining:'} ${remainingQty}`}
              </span>
            </div>
          );
        })}
      </div>

      <div
        style={{
          fontSize: '0.74rem',
          color: 'var(--text-secondary)',
          marginTop: '0.55rem'
        }}
      >
        {new Date(rx.prescriptionDate).toLocaleString(
          lang === 'ar' ? 'ar-SD' : 'en-GB',
          {
            dateStyle: 'medium',
            timeStyle: 'short'
          }
        )}
      </div>
    </div>
  );
}
