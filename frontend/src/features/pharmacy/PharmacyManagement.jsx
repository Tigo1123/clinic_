import { useCallback, useEffect, useRef, useState } from 'react';
import { PackagePlus, RefreshCw, Search } from 'lucide-react';
import Dialog from '../../components/ui/Dialog';
import { fetchWithAuth } from '../../services/staffApi';
import {
  authoritativeStockSummary, batchPresentation, buildBatchPayload, buildMedicinePayload,
  buildMetadataPayload, localizedMovementType, localizedStockState, pharmacyManagementError,
  stockPresentation, updateMedicineField, validateBatchForm
} from '../../utils/pharmacyManagement';

const emptyMedicine = {
  brandName: '', labelAr: '', labelEn: '', genericName: '', strength: '', dosageForm: '',
  includeInitialBatch: false, batchNumber: '', expiryDate: '', receivedQuantity: '', minReorderLevel: '0'
};
const emptyBatch = { batchNumber: '', expiryDate: '', receivedQuantity: '', minReorderLevel: '0' };

async function jsonRequest(url, options, fallback, lang) {
  let response;
  try { response = await fetchWithAuth(url, options); }
  catch { throw new Error(pharmacyManagementError({}, 0, lang, fallback)); }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(pharmacyManagementError(payload, response.status, lang, fallback));
  return payload;
}

function Field({ id, label, error, ...props }) {
  return <div className="form-group"><label className="form-label" htmlFor={id}>{label}</label><input id={id} className={`form-input${error ? ' form-input-error' : ''}`} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} {...props} />{error && <small id={`${id}-error`} className="pharmacy-field-error">{error}</small>}</div>;
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

function BatchFields({ form, setForm, lang, errors = {}, idPrefix = 'batch' }) {
  return <div className="pharmacy-form-grid">
    <Field id={`${idPrefix}-batchNumber`} name="batchNumber" dir="ltr" required error={errors.batchNumber} label={lang === 'ar' ? 'رقم الدفعة' : 'Batch number'} value={form.batchNumber} onChange={(event) => setForm((current) => ({ ...current, batchNumber: event.target.value }))} />
    <Field id={`${idPrefix}-expiryDate`} name="expiryDate" dir="ltr" required type="date" error={errors.expiryDate} label={lang === 'ar' ? 'تاريخ الصلاحية' : 'Expiry date'} value={form.expiryDate} onChange={(event) => setForm((current) => ({ ...current, expiryDate: event.target.value }))} />
    <Field id={`${idPrefix}-receivedQuantity`} name="receivedQuantity" dir="ltr" required type="number" min="1" step="1" error={errors.receivedQuantity} label={lang === 'ar' ? 'الكمية المستلمة' : 'Received quantity'} value={form.receivedQuantity} onChange={(event) => setForm((current) => ({ ...current, receivedQuantity: event.target.value }))} />
    <Field id={`${idPrefix}-minReorderLevel`} name="minReorderLevel" dir="ltr" required type="number" min="0" step="1" error={errors.minReorderLevel} label={lang === 'ar' ? 'حد إعادة الطلب' : 'Reorder level'} value={form.minReorderLevel} onChange={(event) => setForm((current) => ({ ...current, minReorderLevel: event.target.value }))} />
  </div>;
}

function StockBadges({ medicine, lang }) {
  const stock = authoritativeStockSummary(medicine);
  const state = stockPresentation(stock);
  const tone = { OUT_OF_STOCK: 'danger', EXPIRED: 'danger', LOW_STOCK: 'warning', NEAR_EXPIRY: 'warning', HEALTHY: 'success' }[state];
  return <div className="pharmacy-badges">
    <span className={`badge ${medicine.status === 'ACTIVE' ? 'badge-success' : 'badge-warning'}`}>{medicine.status}</span>
    <span className={`badge badge-${tone} pharmacy-state-badge`}>{localizedStockState(state, lang)}</span>
    {stock.expiredBatchCount > 0 && state !== 'EXPIRED' && <span className="badge badge-danger pharmacy-state-badge">{localizedStockState('EXPIRED', lang)}</span>}
  </div>;
}

export default function PharmacyManagement({ lang, refreshToken = 0, onInventoryChanged = () => {} }) {
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
  const [actionMenuId, setActionMenuId] = useState(null);
  const [selected, setSelected] = useState(null);
  const [medicineForm, setMedicineForm] = useState(emptyMedicine);
  const [batchForm, setBatchForm] = useState(emptyBatch);
  const [batchErrors, setBatchErrors] = useState({});
  const [batches, setBatches] = useState([]);
  const [batchPagination, setBatchPagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchError, setBatchError] = useState('');
  const [movements, setMovements] = useState([]);
  const [movementPagination, setMovementPagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const [movementLoading, setMovementLoading] = useState(false);
  const [movementError, setMovementError] = useState('');
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
    setDialog(null); setSelected(null); setMedicineForm(emptyMedicine); setBatchForm(emptyBatch); setBatchErrors({}); setBatches([]); setMovements([]); setBatchError(''); setMovementError('');
  }, []);

  const loadBatches = useCallback(async (medicineId, page = 1) => {
    const requestId = ++detailRequestRef.current;
    setBatchLoading(true); setBatchError('');
    try {
      const data = await jsonRequest(`/api/pharmacy/formulary/${medicineId}/batches?page=${page}&pageSize=50`, {}, lang === 'ar' ? 'تعذر تحميل الدفعات.' : 'Unable to load batches.', lang);
      if (requestId === detailRequestRef.current) { setBatches(data.items || []); setBatchPagination(data.pagination || { page, totalPages: 1, total: 0 }); }
    } catch (error) { if (requestId === detailRequestRef.current) setBatchError(error.message); }
    finally { if (requestId === detailRequestRef.current) setBatchLoading(false); }
  }, [lang]);

  const loadMovements = useCallback(async (medicineId, page = 1) => {
    const requestId = ++detailRequestRef.current;
    setMovementLoading(true); setMovementError('');
    try {
      const data = await jsonRequest(`/api/pharmacy/formulary/${medicineId}/movements?page=${page}&pageSize=50`, {}, lang === 'ar' ? 'تعذر تحميل الحركات.' : 'Unable to load movements.', lang);
      if (requestId === detailRequestRef.current) { setMovements(data.items || []); setMovementPagination(data.pagination || { page, totalPages: 1, total: 0 }); }
    } catch (error) { if (requestId === detailRequestRef.current) setMovementError(error.message); }
    finally { if (requestId === detailRequestRef.current) setMovementLoading(false); }
  }, [lang]);

  const showDetails = async (medicine, mode = 'details') => {
    const requestId = ++detailRequestRef.current;
    setSelected(medicine); setDialog(mode); setFeedback({ type: '', text: '' });
    if (mode === 'batches') { loadBatches(medicine.id, 1); return; }
    if (mode === 'movements') { loadMovements(medicine.id, 1); return; }
    try {
      const detail = await jsonRequest(`/api/pharmacy/formulary/${medicine.id}`, {}, 'Unable to load medicine.', lang);
      if (requestId !== detailRequestRef.current) return;
      setSelected(detail);
      if (mode === 'edit') setMedicineForm(Object.fromEntries(['brandName', 'labelAr', 'labelEn', 'genericName', 'strength', 'dosageForm'].map((field) => [field, detail[field]])));
    } catch (error) {
      if (requestId === detailRequestRef.current) setFeedback({ type: 'danger', text: error.message });
    }
  };

  const submitMedicine = async (event) => {
    event.preventDefault();
    if (medicineForm.includeInitialBatch) { const errors = validateBatchForm(medicineForm, lang); setBatchErrors(errors); if (Object.keys(errors).length) return; }
    setSaving(true);
    try {
      await jsonRequest('/api/pharmacy/formulary', { method: 'POST', body: JSON.stringify(buildMedicinePayload(medicineForm)) }, 'Unable to create medicine.', lang);
      closeDialog(true); setFeedback({ type: 'success', text: lang === 'ar' ? 'تم إنشاء الدواء بنجاح. سيظل غير نشط وبدون سعر حتى تقوم الإدارة بالتسعير والتفعيل.' : 'Medicine created successfully. It will remain inactive and unpriced until an Admin sets the official price and activates it.' }); await loadFormulary(1, search, status); onInventoryChanged();
    } catch (error) { setFeedback({ type: 'danger', text: error.message }); } finally { setSaving(false); }
  };

  const submitMetadata = async (event) => {
    event.preventDefault(); setSaving(true);
    try {
      await jsonRequest(`/api/pharmacy/formulary/${selected.id}/metadata`, { method: 'PATCH', body: JSON.stringify(buildMetadataPayload(medicineForm)) }, 'Unable to update medicine.', lang);
      closeDialog(true); setFeedback({ type: 'success', text: lang === 'ar' ? 'تم تحديث بيانات الدواء.' : 'Medicine metadata updated.' }); await loadFormulary(pagination.page, search, status); onInventoryChanged();
    } catch (error) { setFeedback({ type: 'danger', text: error.message }); } finally { setSaving(false); }
  };

  const submitBatch = async (event) => {
    event.preventDefault(); const errors = validateBatchForm(batchForm, lang); setBatchErrors(errors); if (Object.keys(errors).length) return; setSaving(true);
    try {
      await jsonRequest(`/api/pharmacy/formulary/${selected.id}/batches`, { method: 'POST', body: JSON.stringify(buildBatchPayload(batchForm)) }, 'Unable to receive batch.', lang);
      setBatchForm(emptyBatch); setBatchErrors({}); setFeedback({ type: 'success', text: lang === 'ar' ? 'تم استلام دفعة المخزون.' : 'Inventory batch received.' }); await loadFormulary(pagination.page, search, status); onInventoryChanged();
    } catch (error) { setFeedback({ type: 'danger', text: error.message }); } finally { setSaving(false); }
  };

  const openBatchDialog = (medicine) => {
    setFeedback({ type: '', text: '' });
    setSelected(medicine);
    setBatchForm(emptyBatch);
    setDialog('receive');
  };

  const runMedicineAction = (medicine, action) => {
    setActionMenuId(null);
    if (action === 'receive') openBatchDialog(medicine);
    else showDetails(medicine, action === 'details' ? 'details' : action);
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
      <button className="btn" type="button" disabled={loading} onClick={async () => { await loadFormulary(pagination.page, search, status); onInventoryChanged(); }}><RefreshCw size={15} /> {lang === 'ar' ? 'تحديث' : 'Refresh'}</button>
    </form>
    {feedback.text && <div role="status" className={`badge badge-${feedback.type}`} style={{ display: 'block', padding: '.65rem', margin: '.7rem 0' }}>{feedback.text}</div>}
    {loading && items.length === 0 ? <p className="pharmacy-empty">{lang === 'ar' ? 'جارٍ تحميل الأدوية…' : 'Loading medicines…'}</p> : items.length === 0 ? <p className="pharmacy-empty">{lang === 'ar' ? 'لا توجد أدوية مطابقة.' : 'No medicines found.'}</p> : <div className={`pharmacy-inventory-list${loading ? ' is-refreshing' : ''}`}>
      <table className="pharmacy-inventory-table">
        <thead><tr><th>{lang === 'ar' ? 'الدواء' : 'Medicine'}</th><th>{lang === 'ar' ? 'البيانات الدوائية' : 'Generic / strength / form'}</th><th>{lang === 'ar' ? 'السعر الرسمي' : 'Official price'}</th><th>{lang === 'ar' ? 'المخزون الصالح' : 'Usable stock'}</th><th>{lang === 'ar' ? 'أقرب صلاحية' : 'Nearest expiry'}</th><th>{lang === 'ar' ? 'حالة المخزون' : 'Stock status'}</th><th>{lang === 'ar' ? 'حالة القائمة' : 'Formulary status'}</th><th><span className="sr-only">{lang === 'ar' ? 'الإجراءات' : 'Actions'}</span></th></tr></thead>
        <tbody>{items.map((medicine) => { const stock = authoritativeStockSummary(medicine); const state = stockPresentation(stock); const tone = { OUT_OF_STOCK: 'danger', EXPIRED: 'danger', LOW_STOCK: 'warning', NEAR_EXPIRY: 'warning', HEALTHY: 'success' }[state]; return <tr key={medicine.id}>
          <td data-label={lang === 'ar' ? 'الدواء' : 'Medicine'}><strong>{lang === 'ar' ? medicine.labelAr : medicine.labelEn}</strong><small>{medicine.brandName}</small>{(medicine.status !== 'ACTIVE' || medicine.unitPriceSdg == null) && <span className="pharmacy-admin-note">{lang === 'ar' ? 'بانتظار التسعير والتفعيل من الإدارة' : 'Waiting for Admin pricing and activation'}</span>}</td>
          <td data-label={lang === 'ar' ? 'البيانات' : 'Details'}>{[medicine.genericName, medicine.strength, medicine.dosageForm].filter(Boolean).join(' · ') || '—'}</td>
          <td data-label={lang === 'ar' ? 'السعر الرسمي' : 'Official price'}>{medicine.unitPriceSdg == null ? '—' : `${Number(medicine.unitPriceSdg).toLocaleString()} SDG`}</td>
          <td data-label={lang === 'ar' ? 'المخزون الصالح' : 'Usable stock'}><strong>{stock.usableStock}</strong><small>{lang === 'ar' ? `الإجمالي ${stock.totalOnHand}` : `Total ${stock.totalOnHand}`}</small></td>
          <td data-label={lang === 'ar' ? 'أقرب صلاحية' : 'Nearest expiry'} dir="ltr">{stock.nearestUnexpiredExpiry || '—'}</td>
          <td data-label={lang === 'ar' ? 'حالة المخزون' : 'Stock status'}><span className={`badge badge-${tone}`}>{localizedStockState(state, lang)}</span>{stock.expiredBatchCount > 0 && <small className="pharmacy-expired-note">{lang === 'ar' ? `${stock.expiredBatchCount} دفعة منتهية` : `${stock.expiredBatchCount} expired batch(es)`}</small>}</td>
          <td data-label={lang === 'ar' ? 'حالة القائمة' : 'Formulary status'}><span className={`badge ${medicine.status === 'ACTIVE' ? 'badge-success' : 'badge-warning'}`}>{medicine.status}</span></td>
          <td className="pharmacy-action-cell"><div className="pharmacy-action-menu" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setActionMenuId(null); }} onKeyDown={(event) => { if (event.key === 'Escape') setActionMenuId(null); }}><button type="button" className="pharmacy-action-trigger" aria-label={lang === 'ar' ? `إجراءات ${medicine.labelAr}` : `${medicine.labelEn} actions`} aria-haspopup="menu" aria-expanded={actionMenuId === medicine.id} onClick={() => setActionMenuId((current) => current === medicine.id ? null : medicine.id)}>⋮</button>{actionMenuId === medicine.id && <div className="pharmacy-action-popover" role="menu">{[['details', 'عرض التفاصيل', 'View details'], ['edit', 'تعديل البيانات', 'Edit metadata'], ['receive', 'إضافة دفعة', 'Add batch'], ['batches', 'عرض الدفعات', 'View batches'], ['movements', 'سجل الحركات', 'Movement history']].map(([action, ar, en]) => <button key={action} type="button" role="menuitem" onClick={() => runMedicineAction(medicine, action)}>{lang === 'ar' ? ar : en}</button>)}</div>}</div></td>
        </tr>; })}</tbody>
      </table>
    </div>}
    <div className="pharmacy-pagination"><button type="button" className="btn" disabled={pagination.page <= 1 || loading} onClick={() => loadFormulary(pagination.page - 1, search, status)}>{lang === 'ar' ? 'السابق' : 'Previous'}</button><span>{pagination.page} / {Math.max(1, pagination.totalPages)}</span><button type="button" className="btn" disabled={pagination.page >= pagination.totalPages || loading} onClick={() => loadFormulary(pagination.page + 1, search, status)}>{lang === 'ar' ? 'التالي' : 'Next'}</button></div>

    <Dialog open={dialog === 'create'} title={lang === 'ar' ? 'إضافة دواء' : 'Add Medicine'} description={lang === 'ar' ? 'سيتم إنشاء الدواء بحالة غير نشطة وبدون سعر. يجب على المدير تحديد السعر وتفعيل الدواء.' : 'The medicine will be created inactive and without a price. An administrator must price and activate it.'} onClose={closeDialog}><DialogFeedback feedback={feedback} /><form onSubmit={submitMedicine}><MedicineFields form={medicineForm} setForm={setMedicineForm} lang={lang} /><label className="pharmacy-checkbox" htmlFor="medicine-includeInitialBatch"><input id="medicine-includeInitialBatch" name="includeInitialBatch" type="checkbox" checked={medicineForm.includeInitialBatch} onChange={(event) => setMedicineForm((current) => ({ ...current, includeInitialBatch: event.target.checked }))} /> {lang === 'ar' ? 'إضافة دفعة أولية اختيارية' : 'Add optional initial batch'}</label>{medicineForm.includeInitialBatch && <BatchFields form={medicineForm} setForm={setMedicineForm} lang={lang} errors={batchErrors} idPrefix="initial-batch" />}<div className="dialog-actions"><button type="button" className="btn" onClick={() => closeDialog()}>{lang === 'ar' ? 'إلغاء' : 'Cancel'}</button><button disabled={saving} className="btn btn-primary">{saving ? '…' : lang === 'ar' ? 'إنشاء' : 'Create'}</button></div></form></Dialog>
    <Dialog open={dialog === 'edit'} title={lang === 'ar' ? 'تعديل بيانات الدواء' : 'Edit medicine metadata'} onClose={closeDialog}><DialogFeedback feedback={feedback} /><form onSubmit={submitMetadata}><MedicineFields form={medicineForm} setForm={setMedicineForm} lang={lang} /><p className="form-help">{lang === 'ar' ? 'قد يرفض الخادم تغيير هوية دواء استُخدم سريرياً أو في المخزون؛ تظل الأسماء المعروضة قابلة للتصحيح.' : 'The server prevents identity changes after clinical or inventory use; display labels remain correctable.'}</p><div className="dialog-actions"><button type="button" className="btn" onClick={() => closeDialog()}>{lang === 'ar' ? 'إلغاء' : 'Cancel'}</button><button disabled={saving} className="btn btn-primary">{saving ? '…' : lang === 'ar' ? 'حفظ' : 'Save'}</button></div></form></Dialog>
    <Dialog open={dialog === 'receive'} title={`${lang === 'ar' ? 'إضافة دفعة' : 'Receive batch'} — ${selected?.brandName || ''}`} onClose={closeDialog}><DialogFeedback feedback={feedback} /><form onSubmit={submitBatch}><BatchFields form={batchForm} setForm={setBatchForm} lang={lang} errors={batchErrors} /><div className="dialog-actions"><button type="button" className="btn" onClick={() => closeDialog()}>{lang === 'ar' ? 'إغلاق' : 'Close'}</button><button disabled={saving} className="btn btn-primary">{saving ? '…' : lang === 'ar' ? 'استلام' : 'Receive'}</button></div></form></Dialog>
    <Dialog open={dialog === 'details'} title={lang === 'ar' ? 'تفاصيل الدواء' : 'Medicine details'} onClose={closeDialog}><DialogFeedback feedback={feedback} />{selected && (() => { const stock = authoritativeStockSummary(selected); return <><StockBadges medicine={selected} lang={lang} /><dl className="pharmacy-detail-list">{[['brandName','Brand'],['labelAr','Arabic label'],['labelEn','English label'],['genericName','Generic'],['strength','Strength'],['dosageForm','Dosage form'],['status','Status'],['unitPriceSdg','Official price']].map(([field,label]) => <div key={field}><dt>{label}</dt><dd>{selected[field] ?? '—'}</dd></div>)}{[['totalOnHand','Total on hand'],['usableStock','Usable stock'],['nearestUnexpiredExpiry','Nearest unexpired expiry'],['expiredBatchCount','Expired batches'],['lowStockBatchCount','Low-stock batches'],['batchCount','Batch count']].map(([field,label]) => <div key={field}><dt>{label}</dt><dd>{stock[field] ?? '—'}</dd></div>)}</dl><button type="button" className="btn" onClick={() => closeDialog()}>{lang === 'ar' ? 'إغلاق' : 'Close'}</button></>; })()}</Dialog>
    <Dialog open={dialog === 'batches'} title={lang === 'ar' ? 'دفعات المخزون' : 'Inventory batches'} onClose={closeDialog}>
      {batchLoading ? <p className="pharmacy-empty">{lang === 'ar' ? 'جارٍ تحميل الدفعات…' : 'Loading batches…'}</p> : batchError ? <div className="pharmacy-dialog-state"><div role="alert" className="badge badge-danger">{batchError}</div><button type="button" className="btn" onClick={() => loadBatches(selected.id, batchPagination.page)}>{lang === 'ar' ? 'إعادة المحاولة' : 'Retry'}</button></div> : batches.length === 0 ? <p className="pharmacy-empty">{lang === 'ar' ? 'لا توجد دفعات مسجلة.' : 'No inventory batches found.'}</p> : <div className="pharmacy-scroll-table"><table><thead><tr><th>{lang === 'ar' ? 'الدفعة' : 'Batch'}</th><th>{lang === 'ar' ? 'الصلاحية' : 'Expiry'}</th><th>{lang === 'ar' ? 'الكمية' : 'Quantity'}</th><th>{lang === 'ar' ? 'إعادة الطلب' : 'Reorder'}</th><th>{lang === 'ar' ? 'الحالة' : 'State'}</th></tr></thead><tbody>{batches.map((batch) => { const state = batchPresentation(batch); const tone = ['EXPIRED', 'OUT_OF_STOCK'].includes(state) ? 'danger' : ['LOW_STOCK', 'NEAR_EXPIRY'].includes(state) ? 'warning' : 'success'; return <tr key={batch.id}><td dir="ltr">{batch.batchNumber}</td><td dir="ltr">{batch.expiryDate}</td><td>{batch.qtyOnHand}</td><td>{batch.minReorderLevel}</td><td><span className={`badge badge-${tone}`}>{localizedStockState(state, lang)}</span></td></tr>; })}</tbody></table></div>}
      <div className="pharmacy-pagination"><button type="button" className="btn" disabled={batchLoading || batchPagination.page <= 1} onClick={() => loadBatches(selected.id, batchPagination.page - 1)}>{lang === 'ar' ? 'السابق' : 'Previous'}</button><span>{batchPagination.page} / {Math.max(1, batchPagination.totalPages)}</span><button type="button" className="btn" disabled={batchLoading || batchPagination.page >= batchPagination.totalPages} onClick={() => loadBatches(selected.id, batchPagination.page + 1)}>{lang === 'ar' ? 'التالي' : 'Next'}</button></div><div className="dialog-actions"><button type="button" className="btn" disabled={batchLoading} onClick={() => loadBatches(selected.id, batchPagination.page)}><RefreshCw size={15} /> {lang === 'ar' ? 'تحديث' : 'Refresh'}</button><button type="button" className="btn" onClick={() => closeDialog()}>{lang === 'ar' ? 'إغلاق' : 'Close'}</button></div>
    </Dialog>
    <Dialog open={dialog === 'movements'} title={lang === 'ar' ? 'سجل حركة المخزون' : 'Stock movement ledger'} onClose={closeDialog}>
      {movementLoading ? <p className="pharmacy-empty">{lang === 'ar' ? 'جارٍ تحميل الحركات…' : 'Loading movements…'}</p> : movementError ? <div className="pharmacy-dialog-state"><div role="alert" className="badge badge-danger">{movementError}</div><button type="button" className="btn" onClick={() => loadMovements(selected.id, movementPagination.page)}>{lang === 'ar' ? 'إعادة المحاولة' : 'Retry'}</button></div> : movements.length === 0 ? <p className="pharmacy-empty">{lang === 'ar' ? 'لا توجد حركات مخزون مسجلة.' : 'No stock movements found.'}</p> : <div className="pharmacy-scroll-table"><table><thead><tr><th>{lang === 'ar' ? 'النوع' : 'Type'}</th><th>{lang === 'ar' ? 'الدفعة' : 'Batch'}</th><th>{lang === 'ar' ? 'التغيير' : 'Delta'}</th><th>{lang === 'ar' ? 'الرصيد' : 'Balance'}</th><th>{lang === 'ar' ? 'المنفذ' : 'Actor'}</th><th>{lang === 'ar' ? 'الوقت' : 'Time'}</th></tr></thead><tbody>{movements.map((movement) => <tr key={movement.id}><td>{localizedMovementType(movement.movementType, lang)}</td><td dir="ltr">{movement.batch?.batchNumber || '—'}</td><td dir="ltr">{movement.quantityDelta}</td><td>{movement.resultingBalance}</td><td>{movement.actor?.username || '—'}</td><td>{new Date(movement.createdAt).toLocaleString(lang === 'ar' ? 'ar' : 'en')}</td></tr>)}</tbody></table></div>}
      <div className="pharmacy-pagination"><button type="button" className="btn" disabled={movementLoading || movementPagination.page <= 1} onClick={() => loadMovements(selected.id, movementPagination.page - 1)}>{lang === 'ar' ? 'السابق' : 'Previous'}</button><span>{movementPagination.page} / {Math.max(1, movementPagination.totalPages)}</span><button type="button" className="btn" disabled={movementLoading || movementPagination.page >= movementPagination.totalPages} onClick={() => loadMovements(selected.id, movementPagination.page + 1)}>{lang === 'ar' ? 'التالي' : 'Next'}</button></div><p className="form-help">{lang === 'ar' ? 'هذا السجل للقراءة فقط ولا يمكن تعديله أو حذفه.' : 'This immutable ledger is read-only and cannot be edited or deleted.'}</p><div className="dialog-actions"><button type="button" className="btn" disabled={movementLoading} onClick={() => loadMovements(selected.id, movementPagination.page)}><RefreshCw size={15} /> {lang === 'ar' ? 'تحديث' : 'Refresh'}</button><button type="button" className="btn" onClick={() => closeDialog()}>{lang === 'ar' ? 'إغلاق' : 'Close'}</button></div>
    </Dialog>
  </section>;
}
