import { customMedicineRequiresReview } from '../pharmacyHelpers';

export default function CustomPrescribedItemCard({ item, lang, queueView, onReview, onUnavailable }) {
  const requiresReview = customMedicineRequiresReview(item);
  const isUnavailable = item.pharmacyReviewStatus === 'EXTERNAL';

  return (
    <div
      className="glass-panel"
      style={{
        padding: '0.75rem',
        marginBottom: '0.5rem',
        fontSize: '0.9rem',
        borderLeft: '3px solid var(--warning)'
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>{item.customDrugName || (lang === 'ar' ? 'دواء مكتوب يدويًا' : 'Custom medication')}</strong>
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
          alignItems: 'center',
          gap: '0.5rem'
        }}
      >
        <span>
          Dosage: {item.dosage} | Duration: {item.duration}
        </span>

        <span className={`badge badge-${isUnavailable ? 'danger' : 'warning'}`} style={{ fontSize: '0.7rem' }}>
          {isUnavailable ? (lang === 'ar' ? 'تعذر الصرف' : 'Unable to Dispense') : (lang === 'ar' ? 'دواء يدوي · غير مرتبط بالمخزون' : 'Manual medicine · Not linked to inventory')}
        </span>
      </div>

      <div style={{ fontSize: '0.75rem', color: 'var(--warning)', marginTop: '0.5rem' }}>
        {lang === 'ar'
          ? 'هذا الدواء تمت كتابته يدويًا بواسطة الطبيب ولن يتم خصمه تلقائيًا من مخزون العيادة.'
          : 'This medication was entered manually by the doctor and will not be deducted automatically from clinic inventory.'}
      </div>
      {requiresReview && (
        <div className="pharmacy-item-actions">
          <button type="button" className="btn btn-primary" onClick={() => onReview()}>{lang === 'ar' ? 'مراجعة / ربط الدواء' : 'Review / Link Medication'}</button>
          <button type="button" className="btn" onClick={() => onUnavailable('DOCTOR_REVIEW_REQUIRED')}>{lang === 'ar' ? 'تعذر الصرف' : 'Unable to Dispense'}</button>
        </div>
      )}
      {isUnavailable && queueView === 'active' && (
        <div className="pharmacy-item-actions"><button type="button" className="btn" onClick={() => onUnavailable('OTHER')}>{lang === 'ar' ? 'إكمال معالجة الوصفة' : 'Finalize Prescription Resolution'}</button></div>
      )}
      {isUnavailable && item.pharmacyReviewNote && <div className="pharmacy-resolution-note">{item.pharmacyReviewNote}</div>}
    </div>
  );
}
