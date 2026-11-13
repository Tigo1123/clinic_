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

  return (
    <div
      id={`medication-review-${item.id}`}
      className="glass-panel"
      style={{
        padding: '1rem',
        borderLeft:
          '4px solid var(--warning)'
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent:
            'space-between',
          gap: '1rem',
          flexWrap: 'wrap'
        }}
      >
        <div>
          <strong
            style={{
              fontSize: '1rem'
            }}
          >
            {item.customDrugName}
          </strong>

          <div
            style={{
              marginTop: '0.35rem',
              color:
                'var(--text-secondary)',
              fontSize: '0.8rem'
            }}
          >
            {lang === 'ar'
              ? 'المريض'
              : 'Patient'}
            :{' '}
            <strong>
              {lang === 'ar'
                ? (
                    item.patient
                      ?.fullNameAr ||
                    item.patient
                      ?.fullNameEn
                  )
                : (
                    item.patient
                      ?.fullNameEn ||
                    item.patient
                      ?.fullNameAr
                  )}
            </strong>
          </div>
        </div>

        <span className="badge badge-warning">
          {lang === 'ar'
            ? 'بانتظار مراجعة الصيدلية'
            : 'AWAITING PHARMACY REVIEW'}
        </span>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns:
            'repeat(auto-fit, minmax(150px, 1fr))',
          gap: '0.6rem',
          marginTop: '0.85rem',
          fontSize: '0.8rem'
        }}
      >
        <div>
          <span
            style={{
              color:
                'var(--text-secondary)'
            }}
          >
            {lang === 'ar'
              ? 'الكمية:'
              : 'Quantity:'}
          </span>{' '}
          <strong>
            {remainingQty}
          </strong>
        </div>

        <div>
          <span
            style={{
              color:
                'var(--text-secondary)'
            }}
          >
            {lang === 'ar'
              ? 'الجرعة:'
              : 'Dosage:'}
          </span>{' '}
          <strong>
            {item.dosage || '—'}
          </strong>
        </div>

        <div>
          <span
            style={{
              color:
                'var(--text-secondary)'
            }}
          >
            {lang === 'ar'
              ? 'المدة:'
              : 'Duration:'}
          </span>{' '}
          <strong>
            {item.duration || '—'}
          </strong>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          gap: '0.5rem',
          flexWrap: 'wrap',
          marginTop: '1rem'
        }}
      >
        <button
          type="button"
          className="btn btn-primary"
          onClick={() =>
            onSetMode('LINK_EXISTING')
          }
        >
          {lang === 'ar'
            ? 'ربط بدواء موجود'
            : 'Link Existing'}
        </button>

        <button
          type="button"
          className="btn btn-primary"
          onClick={() =>
            onSetMode('CREATE_FORMULARY')
          }
        >
          {lang === 'ar'
            ? 'إضافة كدواء جديد'
            : 'Create & Stock'}
        </button>

        <button
          type="button"
          className="btn"
          onClick={() =>
            onSetMode('EXTERNAL')
          }
        >
          {lang === 'ar'
            ? 'دواء خارجي'
            : 'External'}
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
