import { useCallback, useEffect, useRef, useState } from 'react';
import { PackagePlus, RefreshCw, Search } from 'lucide-react';
import Dialog from '../../components/ui/Dialog';
import { apiErrorMessage, fetchWithAuth } from '../../services/staffApi';
import { buildBatchPayload, buildMedicinePayload, buildMetadataPayload, updateMedicineField } from '../../utils/pharmacyManagement';

const emptyMedicine = {
  brandName: '', labelAr: '', labelEn: '', genericName: '', strength: '', dosageForm: '',
  includeInitialBatch: false, batchNumber: '', expiryDate: '', receivedQuantity: '', minReorderLevel: '0'
};
const emptyBatch = { batchNumber: '', expiryDate: '', receivedQuantity: '', minReorderLevel: '0' };

function messageFor(payload, fallback, lang) {
  const code = payload?.error?.code;
  if (code === 'FORMULARY_MEDICINE_ALREADY_EXISTS') return lang === 'ar' ? 'يوجد دواء مطابق بالفعل في القائمة.' : 'A matching medicine already exists.';
  if (code === 'INVENTORY_BATCH_ALREADY_EXISTS') return lang === 'ar' ? 'هذه الدفعة مسجلة بالفعل لنفس الدواء وتاريخ الصلاحية.' : 'This batch already exists for the medicine and expiry date.';
  if (code === 'FORMULARY_IDENTITY_IMMUTABLE') return lang === 'ar' ? 'لا يمكن تغيير هوية الدواء بعد استخدامه. يمكن تصحيح الاسمين المعروضين فقط.' : 'Medicine identity cannot change after use. Display labels may still be corrected.';
  return apiErrorMessage(payload, fallback);
}

async function jsonRequest(url, options, fallback, lang) {
  const response = await fetchWithAuth(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(messageFor(payload, fallback, lang));
  return payload;
}

function Field({ id, label, ...props }) {
  return <div className="form-group"><label className="form-label" htmlFor={id}>{label}</label><input id={id} className="form-input" {...props} /></div>;
}

function DialogFeedback({ feedback }) {
  return feedback.text
    ? <div role="alert" className={`badge badge-${feedback.type}`} style={{ display: 'block', padding: '.65rem', marginBottom: '.75rem' }}>{feedback.text}</div>
    : null;
}

function MedicineFields({ form, setForm, lang, labelsOnly = false }) {
  const fields = labelsOnly
    ? [['labelAr', 'الاسم العربي', 'Arabic label'], ['labelEn', 'الاسم الإنجليزي', 'English label']]
    : [
        ['brandName', 'العلامة التجارية', 'Brand'], ['labelAr', 'الاسم العربي', 'Arabic label'],
        ['labelEn', 'الاسم الإنجليزي', 'English label'], ['genericName', 'الاسم العلمي', 'Generic name'],
        ['strength', 'التركيز', 'Strength'], ['dosageForm', 'الشكل الدوائي', 'Dosage form']
      ];
  return <div className="pharmacy-form-grid">{fields.map(([name, ar, en]) => <Field key={name} id={`medicine-${name}`} name={name} required label={lang === 'ar' ? ar : en} dir={name === 'labelAr' ? 'rtl' : 'ltr'} value={form[name] || ''} onChange={(event) => setForm((current) => updateMedicineField(current, name, event.target.value))} />)}</div>;
}

function BatchFields({ form, setForm, lang, idPrefix = 'batch' }) {
  return <div className="pharmacy-form-grid">
    <Field id={`${idPrefix}-batchNumber`} name="batchNumber" dir="ltr" required label={lang === 'ar' ? 'رقم الدفعة' : 'Batch number'} value={form.batchNumber} onChange={(event) => setForm((current) => ({ ...current, batchNumber: event.target.value }))} />
    <Field id={`${idPrefix}-expiryDate`} name="expiryDate" dir="ltr" required type="date" label={lang === 'ar' ? 'تاريخ الصلاحية' : 'Expiry date'} value={form.expiryDate} onChange={(event) => setForm((current) => ({ ...current, expiryDate: event.target.value }))} />
    <Field id={`${idPrefix}-receivedQuantity`} name="receivedQuantity" dir="ltr" required type="number" min="1" step="1" label={lang === 'ar' ? 'الكمية المستلمة' : 'Received quantity'} value={form.receivedQuantity} onChange={(event) => setForm((current) => ({ ...current, receivedQuantity: event.target.value }))} />
    <Field id={`${idPrefix}-minReorderLevel`} name="minReorderLevel" dir="ltr" required type="number" min="0" step="1" label={lang === 'ar' ? 'حد إعادة الطلب' : 'Reorder level'} value={form.minReorderLevel} onChange={(event) => setForm((current) => ({ ...current, minReorderLevel: event.target.value }))} />
  </div>;
}

function StockBadges({ medicine, lang }) {
  const stock = medicine.stock || {};
  return <div className="pharmacy-badges">
    <span className={`badge ${medicine.status === 'ACTIVE' ? 'badge-success' : 'badge-warning'}`}>{medicine.status}</span>
    {Number(stock.usableStock) === 0 && <span className="badge badge-danger">{lang === 'ar' ? 'نفد المخزون' : 'OUT OF STOCK'}</span>}
    {stock.lowStock && Number(stock.usableStock) > 0 && <span className="badge badge-warning">{lang === 'ar' ? 'مخزون منخفض' : 'LOW STOCK'}</span>}
    {stock.hasExpiredBatch && <span className="badge badge-danger">{lang === 'ar' ? 'مخزون منتهي' : 'EXPIRED STOCK'}</span>}
  </div>;
}

export default function PharmacyManagement({ lang, refreshToken = 0 }) {
  const [items, setItems] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [searchSubmission, setSearchSubmission] = useState(0);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState({ type: '', text: '' });
  const [dialog, setDialog] = useState(null);
  const [selected, setSelected] = useState(null);
  const [medicineForm, setMedicineForm] = useState(emptyMedicine);
  const [batchForm, setBatchForm] = useState(emptyBatch);
  const [batches, setBatches] = useState([]);
  const [movements, setMovements] = useState([]);
  const formularyRequestRef = useRef(0);
  const detailRequestRef = useRef(0);
  const savingRef = useRef(false);

  const loadFormulary = useCallback(async (page, submittedSearch, selectedStatus) => {
    const requestId = ++formularyRequestRef.current;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: '20' });
      if (submittedSearch) params.set('search', submittedSearch);
      if (selectedStatus) params.set('status', selectedStatus);
      const data = await jsonRequest(`/api/pharmacy/formulary?${params}`, {}, 'Unable to load formulary.', lang);
      if (requestId === formularyRequestRef.current) {
        setItems(data.items || []);
        setPagination(data.pagination || { page, totalPages: 1, total: 0 });
      }
    } catch (error) {
      if (requestId === formularyRequestRef.current) setFeedback({ type: 'danger', text: error.message });
    } finally {
      if (requestId === formularyRequestRef.current) setLoading(false);
    }
  }, [lang]);

  useEffect(() => {
    loadFormulary(1, search, status);
    return () => { formularyRequestRef.current += 1; };
  }, [loadFormulary, refreshToken, search, searchSubmission, status]);

  useEffect(() => { savingRef.current = saving; }, [saving]);

  const closeDialog = useCallback((force = false) => {
    if (savingRef.current && force !== true) return;
    detailRequestRef.current += 1;
    setDialog(null); setSelected(null); setMedicineForm(emptyMedicine); setBatchForm(emptyBatch); setBatches([]); setMovements([]);
  }, []);

  const showDetails = async (medicine, mode = 'details') => {
    const requestId = ++detailRequestRef.current;
    setSelected(medicine); setDialog(mode); setFeedback({ type: '', text: '' });
    try {
      const detail = await jsonRequest(`/api/pharmacy/formulary/${medicine.id}`, {}, 'Unable to load medicine.', lang);
      if (requestId !== detailRequestRef.current) return;
      setSelected(detail);
      if (mode === 'edit') setMedicineForm(Object.fromEntries(['brandName', 'labelAr', 'labelEn', 'genericName', 'strength', 'dosageForm'].map((field) => [field, detail[field]])));
      if (mode === 'batches') {
        const data = await jsonRequest(`/api/pharmacy/formulary/${medicine.id}/batches?page=1&pageSize=50`, {}, 'Unable to load batches.', lang);
        if (requestId !== detailRequestRef.current) return;
        setBatches(data.items || []);
      }
      if (mode === 'movements') {
        const data = await jsonRequest(`/api/pharmacy/formulary/${medicine.id}/movements?page=1&pageSize=50`, {}, 'Unable to load movements.', lang);
        if (requestId !== detailRequestRef.current) return;
        setMovements(data.items || []);
      }
    } catch (error) {
      if (requestId === detailRequestRef.current) setFeedback({ type: 'danger', text: error.message });
    }
  };

  const submitMedicine = async (event) => {
    event.preventDefault(); setSaving(true);
    try {
      await jsonRequest('/api/pharmacy/formulary', { method: 'POST', body: JSON.stringify(buildMedicinePayload(medicineForm)) }, 'Unable to create medicine.', lang);
      closeDialog(true); setFeedback({ type: 'success', text: lang === 'ar' ? 'تم إنشاء الدواء بنجاح.' : 'Medicine created successfully.' }); await loadFormulary(1, search, status);
    } catch (error) { setFeedback({ type: 'danger', text: error.message }); } finally { setSaving(false); }
  };

  const submitMetadata = async (event) => {
    event.preventDefault(); setSaving(true);
    try {
      await jsonRequest(`/api/pharmacy/formulary/${selected.id}/metadata`, { method: 'PATCH', body: JSON.stringify(buildMetadataPayload(medicineForm)) }, 'Unable to update medicine.', lang);
      closeDialog(true); setFeedback({ type: 'success', text: lang === 'ar' ? 'تم تحديث بيانات الدواء.' : 'Medicine metadata updated.' }); await loadFormulary(pagination.page, search, status);
    } catch (error) { setFeedback({ type: 'danger', text: error.message }); } finally { setSaving(false); }
  };

  const submitBatch = async (event) => {
    event.preventDefault(); setSaving(true);
    try {
      await jsonRequest(`/api/pharmacy/formulary/${selected.id}/batches`, { method: 'POST', body: JSON.stringify(buildBatchPayload(batchForm)) }, 'Unable to receive batch.', lang);
      closeDialog(true); setFeedback({ type: 'success', text: lang === 'ar' ? 'تم استلام دفعة المخزون.' : 'Inventory batch received.' }); await loadFormulary(pagination.page, search, status);
    } catch (error) { setFeedback({ type: 'danger', text: error.message }); } finally { setSaving(false); }
  };

  return <section className="glass-panel pharmacy-management" aria-labelledby="pharmacy-management-title">
    <div className="pharmacy-management-header">
      <div><h2 id="pharmacy-management-title">{lang === 'ar' ? 'إدارة الأدوية والمخزون' : 'Medicine & Inventory Management'}</h2><p>{lang === 'ar' ? 'إدارة قائمة الأدوية والدفعات وسجل حركة المخزون.' : 'Manage formulary metadata, inventory batches, and stock history.'}</p></div>
      <button className="btn btn-primary" type="button" onClick={() => { setFeedback({ type: '', text: '' }); setMedicineForm(emptyMedicine); setDialog('create'); }}><PackagePlus size={16} /> {lang === 'ar' ? 'إضافة دواء' : 'Add Medicine'}</button>
    </div>
    <form className="pharmacy-toolbar" onSubmit={(event) => { event.preventDefault(); setSearch(searchInput.trim()); setSearchSubmission((value) => value + 1); }}>
      <label htmlFor="pharmacy-formulary-search"><span className="sr-only">{lang === 'ar' ? 'بحث' : 'Search'}</span><div className="pharmacy-search"><Search size={16} /><input id="pharmacy-formulary-search" name="formularySearch" value={searchInput} maxLength={100} onChange={(event) => setSearchInput(event.target.value)} placeholder={lang === 'ar' ? 'بحث في الأدوية' : 'Search medicines'} /></div></label>
      <select id="pharmacy-formulary-status" name="formularyStatus" aria-label={lang === 'ar' ? 'حالة الدواء' : 'Medicine status'} value={status} onChange={(event) => { if (['', 'ACTIVE', 'INACTIVE'].includes(event.target.value)) setStatus(event.target.value); }}><option value="">{lang === 'ar' ? 'كل الحالات' : 'All statuses'}</option><option value="ACTIVE">ACTIVE</option><option value="INACTIVE">INACTIVE</option></select>
      <button className="btn" type="submit">{lang === 'ar' ? 'بحث' : 'Search'}</button>
      <button className="btn" type="button" disabled={loading} onClick={() => loadFormulary(pagination.page, search, status)}><RefreshCw size={15} /> {lang === 'ar' ? 'تحديث' : 'Refresh'}</button>
    </form>
    {feedback.text && <div role="status" className={`badge badge-${feedback.type}`} style={{ display: 'block', padding: '.65rem', margin: '.7rem 0' }}>{feedback.text}</div>}
    {loading ? <p className="pharmacy-empty">{lang === 'ar' ? 'جارٍ تحميل الأدوية…' : 'Loading medicines…'}</p> : items.length === 0 ? <p className="pharmacy-empty">{lang === 'ar' ? 'لا توجد أدوية مطابقة.' : 'No medicines found.'}</p> : <div className="pharmacy-card-grid">{items.map((medicine) => <article className="pharmacy-medicine-card" key={medicine.id}>
      <div><h3>{lang === 'ar' ? medicine.labelAr : medicine.labelEn}</h3><small>{medicine.brandName} · {medicine.genericName} · {medicine.strength} · {medicine.dosageForm}</small></div>
      <StockBadges medicine={medicine} lang={lang} />
      <dl className="pharmacy-summary"><div><dt>{lang === 'ar' ? 'السعر الرسمي' : 'Official price'}</dt><dd>{medicine.unitPriceSdg == null ? '—' : `${Number(medicine.unitPriceSdg).toLocaleString()} SDG`}</dd></div><div><dt>{lang === 'ar' ? 'الإجمالي/القابل للصرف' : 'Total / usable'}</dt><dd>{medicine.stock.totalStock} / {medicine.stock.usableStock}</dd></div><div><dt>{lang === 'ar' ? 'أقرب صلاحية' : 'Nearest expiry'}</dt><dd>{medicine.stock.nearestExpiry || '—'}</dd></div><div><dt>{lang === 'ar' ? 'الدفعات' : 'Batches'}</dt><dd>{medicine.stock.batchCount}</dd></div></dl>
      <div className="pharmacy-card-actions"><button type="button" className="btn" onClick={() => showDetails(medicine)}>{lang === 'ar' ? 'التفاصيل' : 'Details'}</button><button type="button" className="btn" onClick={() => showDetails(medicine, 'edit')}>{lang === 'ar' ? 'تعديل' : 'Edit'}</button><button type="button" className="btn" onClick={() => { setFeedback({ type: '', text: '' }); setSelected(medicine); setBatchForm(emptyBatch); setDialog('receive'); }}>{lang === 'ar' ? 'إضافة دفعة' : 'Receive batch'}</button><button type="button" className="btn" onClick={() => showDetails(medicine, 'batches')}>{lang === 'ar' ? 'الدفعات' : 'Batches'}</button><button type="button" className="btn" onClick={() => showDetails(medicine, 'movements')}>{lang === 'ar' ? 'الحركات' : 'Movements'}</button></div>
    </article>)}</div>}
    <div className="pharmacy-pagination"><button type="button" className="btn" disabled={pagination.page <= 1 || loading} onClick={() => loadFormulary(pagination.page - 1, search, status)}>{lang === 'ar' ? 'السابق' : 'Previous'}</button><span>{pagination.page} / {Math.max(1, pagination.totalPages)}</span><button type="button" className="btn" disabled={pagination.page >= pagination.totalPages || loading} onClick={() => loadFormulary(pagination.page + 1, search, status)}>{lang === 'ar' ? 'التالي' : 'Next'}</button></div>

    <Dialog open={dialog === 'create'} title={lang === 'ar' ? 'إضافة دواء' : 'Add Medicine'} description={lang === 'ar' ? 'سيتم إنشاء الدواء بحالة غير نشطة وبدون سعر. يجب على المدير تحديد السعر وتفعيل الدواء.' : 'The medicine will be created inactive and without a price. An administrator must price and activate it.'} onClose={closeDialog}><DialogFeedback feedback={feedback} /><form onSubmit={submitMedicine}><MedicineFields form={medicineForm} setForm={setMedicineForm} lang={lang} /><label className="pharmacy-checkbox" htmlFor="medicine-includeInitialBatch"><input id="medicine-includeInitialBatch" name="includeInitialBatch" type="checkbox" checked={medicineForm.includeInitialBatch} onChange={(event) => setMedicineForm((current) => ({ ...current, includeInitialBatch: event.target.checked }))} /> {lang === 'ar' ? 'إضافة دفعة أولية اختيارية' : 'Add optional initial batch'}</label>{medicineForm.includeInitialBatch && <BatchFields form={medicineForm} setForm={setMedicineForm} lang={lang} idPrefix="initial-batch" />}<div className="dialog-actions"><button type="button" className="btn" onClick={() => closeDialog()}>{lang === 'ar' ? 'إلغاء' : 'Cancel'}</button><button disabled={saving} className="btn btn-primary">{saving ? '…' : lang === 'ar' ? 'إنشاء' : 'Create'}</button></div></form></Dialog>
    <Dialog open={dialog === 'edit'} title={lang === 'ar' ? 'تعديل بيانات الدواء' : 'Edit medicine metadata'} onClose={closeDialog}><DialogFeedback feedback={feedback} /><form onSubmit={submitMetadata}><MedicineFields form={medicineForm} setForm={setMedicineForm} lang={lang} /><p className="form-help">{lang === 'ar' ? 'قد يرفض الخادم تغيير هوية دواء استُخدم سريرياً أو في المخزون؛ تظل الأسماء المعروضة قابلة للتصحيح.' : 'The server prevents identity changes after clinical or inventory use; display labels remain correctable.'}</p><div className="dialog-actions"><button type="button" className="btn" onClick={() => closeDialog()}>{lang === 'ar' ? 'إلغاء' : 'Cancel'}</button><button disabled={saving} className="btn btn-primary">{saving ? '…' : lang === 'ar' ? 'حفظ' : 'Save'}</button></div></form></Dialog>
    <Dialog open={dialog === 'receive'} title={`${lang === 'ar' ? 'إضافة دفعة' : 'Receive batch'} — ${selected?.brandName || ''}`} onClose={closeDialog}><DialogFeedback feedback={feedback} /><form onSubmit={submitBatch}><BatchFields form={batchForm} setForm={setBatchForm} lang={lang} /><div className="dialog-actions"><button type="button" className="btn" onClick={() => closeDialog()}>{lang === 'ar' ? 'إلغاء' : 'Cancel'}</button><button disabled={saving} className="btn btn-primary">{saving ? '…' : lang === 'ar' ? 'استلام' : 'Receive'}</button></div></form></Dialog>
    <Dialog open={dialog === 'details'} title={lang === 'ar' ? 'تفاصيل الدواء' : 'Medicine details'} onClose={closeDialog}><DialogFeedback feedback={feedback} />{selected && <><StockBadges medicine={selected} lang={lang} /><dl className="pharmacy-detail-list">{[['brandName','Brand'],['labelAr','Arabic label'],['labelEn','English label'],['genericName','Generic'],['strength','Strength'],['dosageForm','Dosage form'],['status','Status'],['unitPriceSdg','Official price']].map(([field,label]) => <div key={field}><dt>{label}</dt><dd>{selected[field] ?? '—'}</dd></div>)}{[['totalStock','Total stock'],['usableStock','Usable stock'],['expiredStock','Expired stock'],['nearestExpiry','Nearest expiry'],['batchCount','Batch count']].map(([field,label]) => <div key={field}><dt>{label}</dt><dd>{selected.stock?.[field] ?? '—'}</dd></div>)}</dl><button type="button" className="btn" onClick={() => closeDialog()}>{lang === 'ar' ? 'إغلاق' : 'Close'}</button></>}</Dialog>
    <Dialog open={dialog === 'batches'} title={lang === 'ar' ? 'دفعات المخزون' : 'Inventory batches'} onClose={closeDialog}><DialogFeedback feedback={feedback} /><div className="pharmacy-scroll-table"><table><thead><tr><th>{lang === 'ar' ? 'الدفعة' : 'Batch'}</th><th>{lang === 'ar' ? 'الصلاحية' : 'Expiry'}</th><th>{lang === 'ar' ? 'الكمية' : 'Quantity'}</th><th>{lang === 'ar' ? 'إعادة الطلب' : 'Reorder'}</th><th>{lang === 'ar' ? 'الحالة' : 'State'}</th></tr></thead><tbody>{batches.map((batch) => <tr key={batch.id}><td>{batch.batchNumber}</td><td>{batch.expiryDate}</td><td>{batch.qtyOnHand}</td><td>{batch.minReorderLevel}</td><td>{batch.state?.expired ? 'EXPIRED' : batch.state?.expiresToday ? 'EXPIRES TODAY' : batch.state?.nearExpiry ? 'NEAR EXPIRY' : 'USABLE'}{batch.state?.lowStock ? ' · LOW' : ''}</td></tr>)}</tbody></table></div><button type="button" className="btn" onClick={() => closeDialog()}>{lang === 'ar' ? 'إغلاق' : 'Close'}</button></Dialog>
    <Dialog open={dialog === 'movements'} title={lang === 'ar' ? 'سجل حركة المخزون' : 'Stock movement ledger'} onClose={closeDialog}><DialogFeedback feedback={feedback} /><div className="pharmacy-scroll-table"><table><thead><tr><th>{lang === 'ar' ? 'النوع' : 'Type'}</th><th>{lang === 'ar' ? 'الدفعة' : 'Batch'}</th><th>{lang === 'ar' ? 'التغيير' : 'Delta'}</th><th>{lang === 'ar' ? 'الرصيد' : 'Balance'}</th><th>{lang === 'ar' ? 'المنفذ' : 'Actor'}</th><th>{lang === 'ar' ? 'الوقت' : 'Time'}</th></tr></thead><tbody>{movements.map((movement) => <tr key={movement.id}><td>{{ OPENING_BALANCE: 'رصيد افتتاحي', RECEIPT: 'استلام مخزون', DISPENSE: 'صرف دواء' }[movement.movementType] || movement.movementType}</td><td>{movement.batch?.batchNumber || '—'}</td><td>{movement.quantityDelta}</td><td>{movement.resultingBalance}</td><td>{movement.actor?.username || '—'}</td><td>{new Date(movement.createdAt).toLocaleString()}</td></tr>)}</tbody></table></div><p className="form-help">{lang === 'ar' ? 'هذا السجل للقراءة فقط ولا يمكن تعديله أو حذفه.' : 'This immutable ledger is read-only and cannot be edited or deleted.'}</p><button type="button" className="btn" onClick={() => closeDialog()}>{lang === 'ar' ? 'إغلاق' : 'Close'}</button></Dialog>
  </section>;
}
