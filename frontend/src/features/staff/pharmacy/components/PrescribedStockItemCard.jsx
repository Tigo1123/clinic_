import { authoritativeStockSummary, localizedStockState, stockPresentation } from '../pharmacyHelpers';

export default function PrescribedStockItemCard({ item, lang, authoritativeMedicine, onUnavailable }) {
  const isUnavailable = item.pharmacyReviewStatus === 'EXTERNAL';
  const stock = authoritativeStockSummary(authoritativeMedicine || {});
  const stockState = authoritativeMedicine ? stockPresentation(stock) : null;
  const isInsufficient = authoritativeMedicine && stock.usableStock < item.qtyPrescribed;

  const statusToneClass = !authoritativeMedicine
    ? 'ui-status--wait'
    : (isInsufficient || ['OUT_OF_STOCK', 'EXPIRED'].includes(stockState))
      ? 'ui-status--danger'
      : ['LOW_STOCK', 'NEAR_EXPIRY'].includes(stockState)
        ? 'ui-status--warn'
        : 'ui-status--ok';

  const statusText = !authoritativeMedicine
    ? (lang === 'ar' ? 'جارٍ التحقق' : 'Checking')
    : isInsufficient
      ? (lang === 'ar' ? `غير كافٍ (${stock.usableStock})` : `Insufficient (${stock.usableStock})`)
      : ['OUT_OF_STOCK', 'EXPIRED'].includes(stockState)
        ? localizedStockState(stockState, lang)
        : ['LOW_STOCK', 'NEAR_EXPIRY'].includes(stockState)
          ? localizedStockState(stockState, lang)
          : (lang === 'ar' ? 'جاهز' : 'Ready');

  const doseDetails = [item.dosage, item.duration].filter(Boolean).join(' · ');

  return (
    <div className="pharmacy-grid-table__row">
      <div className="pharmacy-item-info">
        <strong>{lang === 'ar' ? item.drug?.labelAr : item.drug?.labelEn}</strong>
        {doseDetails && <span>{doseDetails}</span>}
      </div>

      <span className="pharmacy-item-qty ui-mono">
        {item.qtyPrescribed}
      </span>

      <div className="pharmacy-item-batch">
        <span>
          {!authoritativeMedicine
            ? (lang === 'ar' ? 'جارٍ التحقق من المخزون…' : 'Checking stock…')
            : `${lang === 'ar' ? 'أقرب صلاحية سارية: ' : 'Nearest unexpired expiry: '}${stock.nearestUnexpiredExpiry || '—'} · ${stock.usableStock} ${lang === 'ar' ? 'في المخزون' : 'in stock'}`}
        </span>
        {!isUnavailable && authoritativeMedicine && (isInsufficient || ['OUT_OF_STOCK', 'EXPIRED'].includes(stockState)) && (
          <div className="pharmacy-item-actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => onUnavailable('OUT_OF_STOCK')}
            >
              {lang === 'ar' ? 'تعذر الصرف' : 'Unable to Dispense'}
            </button>
          </div>
        )}
      </div>

      <span className={`ui-status ${statusToneClass}`}>
        {statusText}
      </span>
    </div>
  );
}
