import { clinicTomorrowDateString, usableStockFromBatches } from '../pharmacyHelpers';
import { CreateFormularyForm, ExternalMedicationForm, LinkExistingForm } from './MedicationReviewForms';

export default function MedicationReviewCard({ item, lang, form, mode, drugCatalog, saving, onSetMode, onFieldChange, onSubmit }) {
  const remainingQty =
    Number(item.qtyPrescribed || 0) -
    Number(item.qtyDispensed || 0);

  const selectedExistingDrug = drugCatalog.find((drug) => drug.id === form.drugId);
  const selectedStock = selectedExistingDrug
    ? usableStockFromBatches(selectedExistingDrug)
    : 0;
  const tomorrow = clinicTomorrowDateString();

  const patientName = lang === 'ar'
    ? (item.patient?.fullNameAr || item.patient?.fullNameEn)
    : (item.patient?.fullNameEn || item.patient?.fullNameAr);

  return (
    <div
      id={`medication-review-${item.id}`}
      className="ui-panel pharmacy-review-card"
    >
      <div className="pharmacy-review-card__header">
        <div>
          <strong className="pharmacy-review-title">{item.customDrugName}</strong>
          <div className="pharmacy-cell-meta">
            {lang === 'ar' ? 'المريض:' : 'Patient:'} <strong>{patientName}</strong>
          </div>
        </div>

        <span className="ui-status ui-status--warn">
          {lang === 'ar' ? 'بانتظار مراجعة الصيدلية' : 'AWAITING PHARMACY REVIEW'}
        </span>
      </div>

      <div className="pharmacy-totals-row ui-mono">
        <span>{lang === 'ar' ? 'الكمية:' : 'Quantity:'} <strong>{remainingQty}</strong></span>
        <span>{lang === 'ar' ? 'الجرعة:' : 'Dosage:'} <strong>{item.dosage || '—'}</strong></span>
        <span>{lang === 'ar' ? 'المدة:' : 'Duration:'} <strong>{item.duration || '—'}</strong></span>
      </div>

      <div className="pharmacy-review-card__decisions">
        <button
          type="button"
          className={`btn btn-secondary ${mode === 'LINK_EXISTING' ? 'is-active' : ''}`}
          onClick={() => onSetMode('LINK_EXISTING')}
        >
          {lang === 'ar' ? 'ربط بدواء موجود' : 'Link Existing'}
        </button>

        <button
          type="button"
          className={`btn btn-secondary ${mode === 'CREATE_FORMULARY' ? 'is-active' : ''}`}
          onClick={() => onSetMode('CREATE_FORMULARY')}
        >
          {lang === 'ar' ? 'إضافة كدواء جديد' : 'Create & Stock'}
        </button>

        <button
          type="button"
          className={`btn btn-secondary ${mode === 'EXTERNAL' ? 'is-active' : ''}`}
          onClick={() => onSetMode('EXTERNAL')}
        >
          {lang === 'ar' ? 'دواء خارجي' : 'External'}
        </button>
      </div>

      {mode === 'LINK_EXISTING' && (
        <LinkExistingForm
          lang={lang}
          form={form}
          drugCatalog={drugCatalog}
          selectedExistingDrug={selectedExistingDrug}
          selectedStock={selectedStock}
          saving={saving}
          onFieldChange={onFieldChange}
          onSubmit={onSubmit}
        />
      )}

      {mode === 'CREATE_FORMULARY' && (
        <CreateFormularyForm
          lang={lang}
          form={form}
          customDrugName={item.customDrugName}
          remainingQty={remainingQty}
          tomorrow={tomorrow}
          saving={saving}
          onFieldChange={onFieldChange}
          onSubmit={onSubmit}
        />
      )}

      {mode === 'EXTERNAL' && (
        <ExternalMedicationForm
          lang={lang}
          form={form}
          saving={saving}
          onFieldChange={onFieldChange}
          onSubmit={onSubmit}
        />
      )}
    </div>
  );
}
