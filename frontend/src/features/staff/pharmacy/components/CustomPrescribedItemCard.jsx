import { customMedicineRequiresReview } from '../pharmacyHelpers';

export default function CustomPrescribedItemCard({ item, lang, queueView, onReview, onUnavailable }) {
  const requiresReview = customMedicineRequiresReview(item);
  const isUnavailable = item.pharmacyReviewStatus === 'EXTERNAL';

  const doseDetails = [item.dosage, item.duration].filter(Boolean).join(' · ');

  return (
    <div className="pharmacy-grid-table__row">
      <div className="pharmacy-item-info">
        <strong>{item.customDrugName || (lang === 'ar' ? 'دواء مكتوب يدويًا' : 'Custom medication')}</strong>
        {doseDetails && <span>{doseDetails}</span>}
        {isUnavailable && item.pharmacyReviewNote && (
          <div className="pharmacy-resolution-note">{item.pharmacyReviewNote}</div>
        )}
      </div>

      <span className="pharmacy-item-qty ui-mono">
        {item.qtyPrescribed}
      </span>

      <div className="pharmacy-item-batch">
        <span>
          {isUnavailable
            ? (lang === 'ar' ? 'تعذر الصرف (غير متوفر)' : 'Unable to Dispense (Unavailable)')
            : (lang === 'ar' ? 'غير مرتبط بالمخزون' : 'Not linked to inventory')}
        </span>
        {requiresReview && (
          <div className="pharmacy-item-actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => onReview()}
            >
              {lang === 'ar' ? 'مراجعة الدواء' : 'Review medicine'}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => onUnavailable('DOCTOR_REVIEW_REQUIRED')}
            >
              {lang === 'ar' ? 'تعذر الصرف' : 'Unable to Dispense'}
            </button>
          </div>
        )}
        {isUnavailable && queueView === 'active' && (
          <div className="pharmacy-item-actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => onUnavailable('OTHER')}
            >
              {lang === 'ar' ? 'إكمال معالجة الوصفة' : 'Finalize Prescription Resolution'}
            </button>
          </div>
        )}
      </div>

      <span className={`ui-status ${isUnavailable ? 'ui-status--danger' : 'ui-status--warn'}`}>
        {isUnavailable
          ? (lang === 'ar' ? 'تعذر الصرف' : 'Unable to Dispense')
          : (lang === 'ar' ? 'يحتاج مراجعة' : 'Needs review')}
      </span>
    </div>
  );
}
