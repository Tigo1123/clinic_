export function LinkExistingForm({ lang, form, drugCatalog, selectedExistingDrug, selectedStock, saving, onFieldChange, onSubmit }) {
  return (
    <div
      style={{
        marginTop: '1rem',
        padding: '0.9rem',
        border:
          '1px solid var(--border)',
        borderRadius: '12px'
      }}
    >
      <strong>
        {lang === 'ar'
          ? 'ربط الدواء بقائمة الصيدلية'
          : 'Link to Existing Formulary'}
      </strong>

      <select
        value={
          form.drugId || ''
        }
        onChange={(event) =>
          onFieldChange('drugId', event.target.value)
        }
        style={{
          width: '100%',
          marginTop: '0.7rem'
        }}
      >
        <option value="">
          {lang === 'ar'
            ? 'اختر الدواء'
            : 'Select medication'}
        </option>

        {[...drugCatalog]
          .sort((a, b) =>
            String(
              a.labelEn || ''
            ).localeCompare(
              String(
                b.labelEn || ''
              )
            )
          )
          .map((drug) => (
            <option
              key={drug.id}
              value={drug.id}
            >
              {drug.labelEn}
              {' — '}
              {drug.strength}
              {' — '}
              {drug.unitPriceSdg
                ? `${Number(
                    drug.unitPriceSdg
                  ).toLocaleString()} SDG`
                : 'No price'}
            </option>
          ))}
      </select>

      {selectedExistingDrug && (
        <div
          style={{
            marginTop: '0.6rem',
            fontSize: '0.8rem'
          }}
        >
          <strong>
            {lang === 'ar'
              ? 'المخزون القابل للصرف:'
              : 'Usable stock:'}
          </strong>{' '}
          {selectedStock}
          {' • '}

          <strong>
            {lang === 'ar'
              ? 'السعر:'
              : 'Price:'}
          </strong>{' '}
          {selectedExistingDrug
            .unitPriceSdg
            ? `${Number(
                selectedExistingDrug
                  .unitPriceSdg
              ).toLocaleString()} SDG`
            : (
                lang === 'ar'
                  ? 'غير محدد'
                  : 'Not set'
              )}
        </div>
      )}

      <textarea
        value={form.note || ''}
        onChange={(event) =>
          onFieldChange('note', event.target.value)
        }
        placeholder={
          lang === 'ar'
            ? 'ملاحظة اختيارية'
            : 'Optional review note'
        }
        style={{
          width: '100%',
          marginTop: '0.7rem'
        }}
      />

      <button
        type="button"
        className="btn btn-primary"
        disabled={
          saving
        }
        onClick={() =>
          onSubmit('LINK_EXISTING')
        }
        style={{
          marginTop: '0.7rem'
        }}
      >
        {saving
          ? (
              lang === 'ar'
                ? 'جارٍ الاعتماد...'
                : 'Approving...'
            )
          : (
              lang === 'ar'
                ? 'اعتماد وربط'
                : 'Approve & Link'
            )}
      </button>
    </div>
  );
}

export function CreateFormularyForm({ lang, form, customDrugName, remainingQty, tomorrow, saving, onFieldChange, onSubmit }) {
  return (
    <div
      style={{
        marginTop: '1rem',
        padding: '0.9rem',
        border:
          '1px solid var(--border)',
        borderRadius: '12px'
      }}
    >
      <strong>
        {lang === 'ar'
          ? 'إنشاء دواء جديد غير نشط وإدخال المخزون'
          : 'Create Medication & Initial Stock'}
      </strong>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns:
            'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '0.65rem',
          marginTop: '0.8rem'
        }}
      >
        <input
          value={
            form.labelEn ??
            customDrugName ??
            ''
          }
          onChange={(event) =>
            onFieldChange('labelEn', event.target.value)
          }
          placeholder="English name"
        />

        <input
          value={
            form.labelAr || ''
          }
          onChange={(event) =>
            onFieldChange('labelAr', event.target.value)
          }
          placeholder={
            lang === 'ar'
              ? 'الاسم العربي'
              : 'Arabic name'
          }
        />

        <input
          value={
            form.genericName || ''
          }
          onChange={(event) =>
            onFieldChange('genericName', event.target.value)
          }
          placeholder={
            lang === 'ar'
              ? 'الاسم العلمي'
              : 'Generic name'
          }
        />

        <input
          value={
            form.strength || ''
          }
          onChange={(event) =>
            onFieldChange('strength', event.target.value)
          }
          placeholder={
            lang === 'ar'
              ? 'التركيز مثل 400mg'
              : 'Strength e.g. 400mg'
          }
        />

        <input
          value={
            form.dosageForm || ''
          }
          onChange={(event) =>
            onFieldChange('dosageForm', event.target.value)
          }
          placeholder={
            lang === 'ar'
              ? 'الشكل: Tablet / Syrup'
              : 'Dosage form'
          }
        />

        <input
          value={
            form.batchNumber || ''
          }
          onChange={(event) =>
            onFieldChange('batchNumber', event.target.value)
          }
          placeholder={
            lang === 'ar'
              ? 'رقم التشغيلة'
              : 'Batch number'
          }
        />

        <input
          type="date"
          min={tomorrow}
          value={
            form.expiryDate || ''
          }
          onChange={(event) =>
            onFieldChange('expiryDate', event.target.value)
          }
        />

        <input
          type="number"
          min={remainingQty}
          step="1"
          value={
            form.qtyOnHand ??
            String(remainingQty)
          }
          onChange={(event) =>
            onFieldChange('qtyOnHand', event.target.value)
          }
          placeholder={
            lang === 'ar'
              ? 'كمية المخزون'
              : 'Initial quantity'
          }
        />

        <input
          type="number"
          min="0"
          step="1"
          value={
            form.minReorderLevel ??
            '10'
          }
          onChange={(event) =>
            onFieldChange('minReorderLevel', event.target.value)
          }
          placeholder={
            lang === 'ar'
              ? 'حد إعادة الطلب'
              : 'Reorder level'
          }
        />
      </div>

      <textarea
        value={form.note || ''}
        onChange={(event) =>
          onFieldChange('note', event.target.value)
        }
        placeholder={
          lang === 'ar'
            ? 'ملاحظة اختيارية'
            : 'Optional review note'
        }
        style={{
          width: '100%',
          marginTop: '0.7rem'
        }}
      />

      <button
        type="button"
        className="btn btn-primary"
        disabled={
          saving
        }
        onClick={() =>
          onSubmit('CREATE_FORMULARY')
        }
        style={{
          marginTop: '0.7rem'
        }}
      >
        {saving
          ? (
              lang === 'ar'
                ? 'جارٍ الإنشاء...'
                : 'Creating...'
            )
          : (
              lang === 'ar'
                ? 'إنشاء الدواء وإضافة المخزون'
                : 'Create Medicine & Stock'
            )}
      </button>
    </div>
  );
}

export function ExternalMedicationForm({ lang, form, saving, onFieldChange, onSubmit }) {
  return (
    <div
      style={{
        marginTop: '1rem',
        padding: '0.9rem',
        border:
          '1px solid var(--border)',
        borderRadius: '12px'
      }}
    >
      <strong>
        {lang === 'ar'
          ? 'تحديد الدواء كدواء خارجي'
          : 'Mark as External Medication'}
      </strong>

      <p
        style={{
          color:
            'var(--text-secondary)',
          fontSize: '0.8rem',
          marginTop: '0.45rem'
        }}
      >
        {lang === 'ar'
          ? 'سيتم اعتبار هذا الدواء من خارج صيدلية العيادة ولن يدخل في فاتورة الصيدلية أو مخزونها.'
          : 'This medication will not be included in the clinic pharmacy invoice. The patient will purchase it externally.'}
      </p>

      <textarea
        value={form.note || ''}
        onChange={(event) =>
          onFieldChange('note', event.target.value)
        }
        placeholder={
          lang === 'ar'
            ? 'سبب أو ملاحظة للصيدلية'
            : 'Reason or pharmacy note'
        }
        style={{
          width: '100%',
          marginTop: '0.6rem'
        }}
      />

      <button
        type="button"
        className="btn"
        disabled={
          saving
        }
        onClick={() =>
          onSubmit('EXTERNAL')
        }
        style={{
          marginTop: '0.7rem'
        }}
      >
        {saving
          ? (
              lang === 'ar'
                ? 'جارٍ الحفظ...'
                : 'Saving...'
            )
          : (
              lang === 'ar'
                ? 'تأكيد كدواء خارجي'
                : 'Confirm External'
            )}
      </button>
    </div>
  );
}
