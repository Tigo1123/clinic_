export function LinkExistingForm({ lang, form, drugCatalog, selectedExistingDrug, selectedStock, saving, onFieldChange, onSubmit }) {
  return (
    <div className="ui-panel pharmacy-review-card">
      <h3 className="ui-section-label" style={{ fontSize: '13px', margin: 0 }}>
        {lang === 'ar'
          ? 'ربط الدواء بقائمة الصيدلية'
          : 'Link to Existing Formulary'}
      </h3>

      <div className="form-group">
        <label className="form-label ui-section-label" htmlFor="review-link-select">
          {lang === 'ar' ? 'اختر الدواء' : 'Select medication'}
        </label>
        <select
          id="review-link-select"
          className="form-input"
          value={selectedExistingDrug?.id || ''}
          onChange={(event) => onFieldChange('drugId', event.target.value)}
        >
          <option value="">
            {lang === 'ar' ? 'اختر الدواء' : 'Select medication'}
          </option>

          {[...drugCatalog]
            .sort((a, b) =>
              String(a.labelEn || '').localeCompare(String(b.labelEn || ''))
            )
            .map((drug) => (
              <option key={drug.id} value={drug.id}>
                {lang === 'ar' ? drug.labelAr : drug.labelEn}
                {' — '}
                {drug.strength}
                {' — '}
                {drug.unitPriceSdg
                  ? `${Number(drug.unitPriceSdg).toLocaleString()} SDG`
                  : 'No price'}
              </option>
            ))}
        </select>
      </div>

      {selectedExistingDrug && (
        <div className="pharmacy-totals-row">
          <span>
            <strong>
              {lang === 'ar' ? 'المخزون الصالح:' : 'Usable stock:'}
            </strong>{' '}
            <span className="ui-mono">{selectedStock}</span>
          </span>
          <span>
            <strong>
              {lang === 'ar' ? 'السعر:' : 'Price:'}
            </strong>{' '}
            <span className="ui-mono">
              {selectedExistingDrug.unitPriceSdg
                ? `${Number(selectedExistingDrug.unitPriceSdg).toLocaleString()} SDG`
                : (lang === 'ar' ? 'غير محدد' : 'Not set')}
            </span>
          </span>
        </div>
      )}

      <div className="form-group">
        <label className="form-label" htmlFor="review-link-note">
          {lang === 'ar' ? 'ملاحظة اختيارية' : 'Optional review note'}
        </label>
        <textarea
          id="review-link-note"
          className="form-input"
          value={form.note || ''}
          onChange={(event) => onFieldChange('note', event.target.value)}
          placeholder={lang === 'ar' ? 'ملاحظة اختيارية' : 'Optional review note'}
        />
      </div>

      <button
        type="button"
        className="btn btn-primary"
        disabled={saving || !selectedExistingDrug}
        onClick={() => onSubmit('LINK_EXISTING')}
      >
        {saving
          ? (lang === 'ar' ? 'جارٍ الاعتماد…' : 'Approving…')
          : (lang === 'ar' ? 'اعتماد وربط' : 'Approve & Link')}
      </button>
    </div>
  );
}

export function CreateFormularyForm({ lang, form, customDrugName, remainingQty, tomorrow, saving, onFieldChange, onSubmit }) {
  return (
    <div className="ui-panel pharmacy-review-card">
      <h3 className="ui-section-label" style={{ fontSize: '13px', margin: 0 }}>
        {lang === 'ar'
          ? 'إنشاء دواء جديد غير نشط وإدخال المخزون'
          : 'Create Medication & Initial Stock'}
      </h3>

      <div className="pharmacy-form-grid">
        <div className="form-group">
          <label className="form-label ui-section-label" htmlFor="create-labelEn">English name</label>
          <input
            id="create-labelEn"
            className="form-input"
            value={form.labelEn ?? customDrugName ?? ''}
            onChange={(event) => onFieldChange('labelEn', event.target.value)}
            placeholder="English name"
          />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="create-labelAr">{lang === 'ar' ? 'الاسم العربي' : 'Arabic name'}</label>
          <input
            id="create-labelAr"
            className="form-input"
            dir="rtl"
            value={form.labelAr || ''}
            onChange={(event) => onFieldChange('labelAr', event.target.value)}
            placeholder={lang === 'ar' ? 'الاسم العربي' : 'Arabic name'}
          />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="create-genericName">{lang === 'ar' ? 'الاسم العلمي' : 'Generic name'}</label>
          <input
            id="create-genericName"
            className="form-input"
            value={form.genericName || ''}
            onChange={(event) => onFieldChange('genericName', event.target.value)}
            placeholder={lang === 'ar' ? 'الاسم العلمي' : 'Generic name'}
          />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="create-strength">{lang === 'ar' ? 'التركيز' : 'Strength'}</label>
          <input
            id="create-strength"
            className="form-input"
            value={form.strength || ''}
            onChange={(event) => onFieldChange('strength', event.target.value)}
            placeholder={lang === 'ar' ? 'التركيز مثل 400mg' : 'Strength e.g. 400mg'}
          />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="create-dosageForm">{lang === 'ar' ? 'الشكل الدوائي' : 'Dosage form'}</label>
          <input
            id="create-dosageForm"
            className="form-input"
            value={form.dosageForm || ''}
            onChange={(event) => onFieldChange('dosageForm', event.target.value)}
            placeholder={lang === 'ar' ? 'الشكل: Tablet / Syrup' : 'Dosage form'}
          />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="create-batchNumber">{lang === 'ar' ? 'رقم التشغيلة' : 'Batch number'}</label>
          <input
            id="create-batchNumber"
            className="form-input"
            dir="ltr"
            value={form.batchNumber || ''}
            onChange={(event) => onFieldChange('batchNumber', event.target.value)}
            placeholder={lang === 'ar' ? 'رقم التشغيلة' : 'Batch number'}
          />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="create-expiryDate">{lang === 'ar' ? 'تاريخ الصلاحية' : 'Expiry date'}</label>
          <input
            id="create-expiryDate"
            className="form-input"
            type="date"
            min={tomorrow}
            value={form.expiryDate || ''}
            onChange={(event) => onFieldChange('expiryDate', event.target.value)}
          />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="create-qtyOnHand">{lang === 'ar' ? 'كمية المخزون' : 'Initial quantity'}</label>
          <input
            id="create-qtyOnHand"
            className="form-input"
            type="number"
            min={remainingQty}
            step="1"
            value={form.qtyOnHand ?? String(remainingQty)}
            onChange={(event) => onFieldChange('qtyOnHand', event.target.value)}
            placeholder={lang === 'ar' ? 'كمية المخزون' : 'Initial quantity'}
          />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="create-minReorderLevel">{lang === 'ar' ? 'حد إعادة الطلب' : 'Reorder level'}</label>
          <input
            id="create-minReorderLevel"
            className="form-input"
            type="number"
            min="0"
            step="1"
            value={form.minReorderLevel ?? '10'}
            onChange={(event) => onFieldChange('minReorderLevel', event.target.value)}
            placeholder={lang === 'ar' ? 'حد إعادة الطلب' : 'Reorder level'}
          />
        </div>
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="create-note">{lang === 'ar' ? 'ملاحظة اختيارية' : 'Optional review note'}</label>
        <textarea
          id="create-note"
          className="form-input"
          value={form.note || ''}
          onChange={(event) => onFieldChange('note', event.target.value)}
          placeholder={lang === 'ar' ? 'ملاحظة اختيارية' : 'Optional review note'}
        />
      </div>

      <button
        type="button"
        className="btn btn-primary"
        disabled={saving}
        onClick={() => onSubmit('CREATE_FORMULARY')}
      >
        {saving
          ? (lang === 'ar' ? 'جارٍ الإنشاء…' : 'Creating…')
          : (lang === 'ar' ? 'إنشاء الدواء وإضافة المخزون' : 'Create Medicine & Stock')}
      </button>
    </div>
  );
}

export function ExternalMedicationForm({ lang, form, saving, onFieldChange, onSubmit }) {
  return (
    <div className="ui-panel pharmacy-review-card">
      <h3 className="ui-section-label" style={{ fontSize: '13px', margin: 0 }}>
        {lang === 'ar'
          ? 'تحديد الدواء كدواء خارجي'
          : 'Mark as External Medication'}
      </h3>

      <p className="pharmacy-dispense-hint">
        {lang === 'ar'
          ? 'سيتم اعتبار هذا الدواء من خارج صيدلية العيادة ولن يدخل في فاتورة الصيدلية أو مخزونها.'
          : 'This medication will not be included in the clinic pharmacy invoice. The patient will purchase it externally.'}
      </p>

      <div className="form-group">
        <label className="form-label ui-section-label" htmlFor="external-note">
          {lang === 'ar' ? 'سبب أو ملاحظة للصيدلية' : 'Reason or pharmacy note'}
        </label>
        <textarea
          id="external-note"
          className="form-input"
          value={form.note || ''}
          onChange={(event) => onFieldChange('note', event.target.value)}
          placeholder={lang === 'ar' ? 'سبب أو ملاحظة للصيدلية' : 'Reason or pharmacy note'}
        />
      </div>

      <button
        type="button"
        className="btn btn-primary"
        disabled={saving}
        onClick={() => onSubmit('EXTERNAL')}
      >
        {saving
          ? (lang === 'ar' ? 'جارٍ الحفظ…' : 'Saving…')
          : (lang === 'ar' ? 'تأكيد كدواء خارجي' : 'Confirm External')}
      </button>
    </div>
  );
}
