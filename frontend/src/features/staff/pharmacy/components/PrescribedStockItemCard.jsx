import { authoritativeStockSummary, localizedStockState, stockPresentation } from '../pharmacyHelpers';

export default function PrescribedStockItemCard({ item, lang, authoritativeMedicine, onUnavailable }) {
  const isUnavailable = item.pharmacyReviewStatus === 'EXTERNAL';
  const stock = authoritativeStockSummary(authoritativeMedicine || {});
  const stockState = authoritativeMedicine ? stockPresentation(stock) : null;
  const isInsufficient = authoritativeMedicine && stock.usableStock < item.qtyPrescribed;
  const badgeTone = !authoritativeMedicine || isInsufficient || ['OUT_OF_STOCK', 'EXPIRED'].includes(stockState) ? 'danger' : ['LOW_STOCK', 'NEAR_EXPIRY'].includes(stockState) ? 'warning' : 'success';

  return (
    <div
      className="glass-panel"
      style={{
        padding: '0.75rem',
        marginBottom: '0.5rem',
        fontSize: '0.9rem',
        borderLeft:
          !authoritativeMedicine || isInsufficient || ['OUT_OF_STOCK', 'EXPIRED'].includes(stockState)
            ? '3px solid var(--danger)'
            : ['LOW_STOCK', 'NEAR_EXPIRY'].includes(stockState)
              ? '3px solid var(--warning)'
              : '3px solid var(--success)'
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>{lang === 'ar' ? item.drug.labelAr : item.drug.labelEn}</strong>
        <span style={{ color: 'var(--primary)', fontWeight: 'bold' }}>
          Qty: {item.qtyPrescribed}
        </span>
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: '0.8rem',
          color: 'var(--text-secondary)',
          marginTop: '0.25rem',
          alignItems: 'center'
        }}
      >
        <span>
          Dosage: {item.dosage} | Duration: {item.duration}
        </span>

        <span className={`badge badge-${badgeTone}`} style={{ fontSize: '0.7rem' }}>
          {!authoritativeMedicine ? (lang === 'ar' ? 'جارٍ التحقق من المخزون' : 'Checking stock') : isInsufficient ? (lang === 'ar' ? `غير كافٍ (${stock.usableStock})` : `Insufficient (${stock.usableStock})`) : `${localizedStockState(stockState, lang)} (${stock.usableStock})`}
        </span>
      </div>

      <div
        style={{
          fontSize: '0.75rem',
          color: 'var(--warning)',
          marginTop: '0.5rem'
        }}
      >
        {lang === 'ar' ? 'أقرب صلاحية سارية: ' : 'Nearest unexpired expiry: '}{stock.nearestUnexpiredExpiry || '—'}
      </div>
      {!isUnavailable && authoritativeMedicine && (isInsufficient || ['OUT_OF_STOCK', 'EXPIRED'].includes(stockState)) && (
        <div className="pharmacy-item-actions"><button type="button" className="btn" onClick={() => onUnavailable('OUT_OF_STOCK')}>{lang === 'ar' ? 'تعذر الصرف' : 'Unable to Dispense'}</button></div>
      )}
    </div>
  );
}
