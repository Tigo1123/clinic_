import { guardFormSubmit } from '../../../utils/guardFormSubmit.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PackagePlus, RefreshCw, Search } from 'lucide-react';
import Dialog from '../../../components/ui/Dialog';
import { fetchWithAuth } from '../../../services/staff/staffApi';
import {
  authoritativeStockSummary, batchPresentation, buildBatchPayload, buildMedicinePayload,
  buildMetadataPayload, localizedMovementType, localizedStockState, pharmacyManagementError,
  stockPresentation, updateMedicineField, validateBatchForm
} from './pharmacyHelpers';

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
  return <div className="form-group"><label className="form-label ui-section-label" htmlFor={id}>{label}</label><input id={id} className={`form-input${error ? ' form-input-error' : ''}`} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} {...props} />{error && <small id={`${id}-error`} className="pharmacy-field-error">{error}</small>}</div>;
}

function DialogFeedback({ feedback }) {
  return feedback.text
    ? <div role="alert" className={`pharmacy-alert-banner pharmacy-alert-banner--${feedback.type === 'danger' ? 'danger' : feedback.type === 'success' ? 'success' : 'warning'} pharmacy-alert-banner--bottom-spaced`}>{feedback.text}</div>
    : null;
}

function MedicineFields({ form, setForm, lang, medicine, disabled = false }) {
  const fields = [
    ['brandName', 'العلامة التجارية', 'Brand'], ['labelAr', 'الاسم العربي', 'Arabic label'],
    ['labelEn', 'الاسم الإنجليزي', 'English label'], ['genericName', 'الاسم العلمي', 'Generic name'],
    ['strength', 'التركيز', 'Strength'], ['dosageForm', 'الشكل الدوائي', 'Dosage form']
  ];
  return (
    <div className="pharmacy-form-grid">
      {fields.map(([name, ar, en]) => (
        <Field
          key={name}
          id={`medicine-${name}`}
          name={name}
          required={!medicine || Boolean(medicine[name])}
          readOnly={medicine?.identityLocked && name !== 'labelAr' && name !== 'labelEn'}
          disabled={disabled}
          maxLength={name === 'strength' || name === 'dosageForm' ? 80 : 150}
          label={lang === 'ar' ? ar : en}
          dir={name === 'labelAr' ? 'rtl' : 'ltr'}
          value={form[name] ?? ''}
          onChange={(event) => setForm((current) => updateMedicineField(current, name, event.target.value))}
        />
      ))}
    </div>
  );
}

function BatchFields({ form, setForm, lang, errors = {}, idPrefix = 'batch' }) {
  return (
    <div className="pharmacy-form-grid">
      <Field id={`${idPrefix}-batchNumber`} name="batchNumber" dir="ltr" required error={errors.batchNumber} label={lang === 'ar' ? 'رقم الدفعة' : 'Batch number'} value={form.batchNumber} onChange={(event) => setForm((current) => ({ ...current, batchNumber: event.target.value }))} />
      <Field id={`${idPrefix}-expiryDate`} name="expiryDate" dir="ltr" required type="date" error={errors.expiryDate} label={lang === 'ar' ? 'تاريخ الصلاحية' : 'Expiry date'} value={form.expiryDate} onChange={(event) => setForm((current) => ({ ...current, expiryDate: event.target.value }))} />
      <Field id={`${idPrefix}-receivedQuantity`} name="receivedQuantity" dir="ltr" required type="number" min="1" step="1" error={errors.receivedQuantity} label={lang === 'ar' ? 'الكمية المستلمة' : 'Received quantity'} value={form.receivedQuantity} onChange={(event) => setForm((current) => ({ ...current, receivedQuantity: event.target.value }))} />
      <Field id={`${idPrefix}-minReorderLevel`} name="minReorderLevel" dir="ltr" required type="number" min="0" step="1" error={errors.minReorderLevel} label={lang === 'ar' ? 'حد إعادة الطلب' : 'Reorder level'} value={form.minReorderLevel} onChange={(event) => setForm((current) => ({ ...current, minReorderLevel: event.target.value }))} />
    </div>
  );
}

function StockBadges({ medicine, lang }) {
  const stock = authoritativeStockSummary(medicine);
  const state = stockPresentation(stock);
  const tone = { OUT_OF_STOCK: 'danger', EXPIRED: 'danger', LOW_STOCK: 'warn', NEAR_EXPIRY: 'warn', HEALTHY: 'ok' }[state];
  return (
    <div className="pharmacy-badges">
      <span className={`ui-status ${medicine.status === 'ACTIVE' ? 'ui-status--ok' : 'ui-status--warn'}`}>{medicine.status === 'ACTIVE' ? (lang === 'ar' ? 'نشط' : 'Active') : (lang === 'ar' ? 'غير نشط' : 'Inactive')}</span>
      <span className={`ui-status ui-status--${tone} pharmacy-state-badge`}>{localizedStockState(state, lang)}</span>
      {stock.expiredBatchCount > 0 && state !== 'EXPIRED' && (
        <span className="ui-status ui-status--danger pharmacy-state-badge">{localizedStockState('EXPIRED', lang)}</span>
      )}
    </div>
  );
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
  const [editLoading, setEditLoading] = useState(false);
  const [editReady, setEditReady] = useState(false);
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
  const deactivateCancelRef = useRef(null);

  const loadFormulary = useCallback(async (page, submittedSearch, selectedStatus) => {
    const requestId = ++formularyRequestRef.current;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: '20' });
      if (submittedSearch) params.set('search', submittedSearch);
      if (selectedStatus) params.set('status', selectedStatus);
      const data = await jsonRequest(`/api/pharmacy/formulary?${params}`, {}, lang === 'ar' ? 'تعذر تحميل قائمة الأدوية.' : 'Unable to load formulary.', lang);
      if (requestId === formularyRequestRef.current) {
        if (page > 1 && data.pagination && page > data.pagination.totalPages) {
          return loadFormulary(Math.max(1, data.pagination.totalPages), submittedSearch, selectedStatus);
        }
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
    setFeedback((current) => (current.type === 'danger' ? { type: '', text: '' } : current));
    setDialog(null); setSelected(null); setMedicineForm(emptyMedicine); setBatchForm(emptyBatch); setBatchErrors({}); setBatches([]); setMovements([]); setBatchError(''); setMovementError('');
    setEditLoading(false); setEditReady(false);
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
    if (mode === 'deactivate') return;
    if (mode === 'edit') {
      setEditLoading(true);
      setEditReady(false);
    }
    try {
      const detail = await jsonRequest(`/api/pharmacy/formulary/${medicine.id}`, {}, lang === 'ar' ? 'تعذر تحميل بيانات الدواء.' : 'Unable to load medicine.', lang);
      if (requestId !== detailRequestRef.current) return;
      setSelected(detail);
      if (mode === 'edit') {
        setMedicineForm(detail);
        setEditReady(true);
      }
    } catch (error) {
      if (requestId === detailRequestRef.current) setFeedback({ type: 'danger', text: error.message });
    } finally {
      if (mode === 'edit' && requestId === detailRequestRef.current) setEditLoading(false);
    }
  };

  const submitMedicine = async (event) => {
    event.preventDefault();
    if (medicineForm.includeInitialBatch) { const errors = validateBatchForm(medicineForm, lang); setBatchErrors(errors); if (Object.keys(errors).length) return; }
    setSaving(true);
    try {
      await jsonRequest('/api/pharmacy/formulary', { method: 'POST', body: JSON.stringify(buildMedicinePayload(medicineForm)) }, lang === 'ar' ? 'تعذر إنشاء الدواء.' : 'Unable to create medicine.', lang);
      closeDialog(true); setFeedback({ type: 'success', text: lang === 'ar' ? 'تم إنشاء الدواء بنجاح. سيظل غير نشط وبدون سعر حتى تقوم الإدارة بالتسعير والتفعيل.' : 'Medicine created successfully. It will remain inactive and unpriced until an Admin sets the official price and activates it.' }); await loadFormulary(1, search, status); onInventoryChanged();
    } catch (error) { setFeedback({ type: 'danger', text: error.message }); } finally { setSaving(false); }
  };

  const submitMetadata = async (event) => {
    event.preventDefault();
    if (savingRef.current || !editReady) return;
    const changes = buildMetadataPayload(medicineForm, selected);
    if (Object.keys(changes).length === 0) return;
    if (Object.values(changes).some((value) => !value)) {
      setFeedback({ type: 'danger', text: lang === 'ar' ? 'أدخل قيمة لكل حقل تم تعديله.' : 'Enter a value for each edited field.' });
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      await jsonRequest(`/api/pharmacy/formulary/${selected.id}/metadata`, { method: 'PATCH', body: JSON.stringify(changes) }, lang === 'ar' ? 'تعذر تحديث بيانات الدواء.' : 'Unable to update medicine.', lang);
      closeDialog(true); setFeedback({ type: 'success', text: lang === 'ar' ? 'تم تحديث بيانات الدواء.' : 'Medicine metadata updated.' }); await loadFormulary(pagination.page, search, status); onInventoryChanged();
    } catch (error) {
      setFeedback({ type: 'danger', text: error.message });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const deactivateMedicine = async () => {
    if (savingRef.current || selected?.status !== 'ACTIVE') return;
    savingRef.current = true;
    setSaving(true);
    setFeedback({ type: '', text: '' });
    try {
      await jsonRequest(`/api/pharmacy/formulary/${selected.id}/deactivate`, { method: 'POST', body: '{}' }, lang === 'ar' ? 'تعذر إيقاف الدواء.' : 'Unable to deactivate medicine.', lang);
      closeDialog(true);
      setFeedback({ type: 'success', text: lang === 'ar' ? 'تم إيقاف الدواء.' : 'Medicine deactivated.' });
      onInventoryChanged();
      await loadFormulary(pagination.page, search, status);
    } catch (error) {
      setFeedback({ type: 'danger', text: error.message });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const submitBatch = async (event) => {
    event.preventDefault(); const errors = validateBatchForm(batchForm, lang); setBatchErrors(errors); if (Object.keys(errors).length) return; setSaving(true);
    try {
      await jsonRequest(`/api/pharmacy/formulary/${selected.id}/batches`, { method: 'POST', body: JSON.stringify(buildBatchPayload(batchForm)) }, lang === 'ar' ? 'تعذر استلام دفعة المخزون.' : 'Unable to receive batch.', lang);
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

  return (
    <section className="pharmacy-inventory-view" aria-labelledby="pharmacy-management-title">
      <header className="ui-page-header">
        <div>
          <h1 id="pharmacy-management-title" className="ui-page-title">
            {lang === 'ar' ? 'المخزون' : 'Inventory'}
          </h1>
          <span className="sr-only">Medicine & Inventory Management</span>
        </div>
        <button
          className="btn btn-primary"
          type="button"
          onClick={() => { setFeedback({ type: '', text: '' }); setMedicineForm(emptyMedicine); setDialog('create'); }}
        >
          <PackagePlus size={18} /> {lang === 'ar' ? 'إضافة دواء' : 'Add medicine'}
        </button>
      </header>

      <form className="pharmacy-toolbar" onSubmit={(event) => { event.preventDefault(); setSearch(searchInput.trim()); setSearchSubmission((value) => value + 1); }}>
        <label className="pharmacy-filter-field pharmacy-filter-field--search" htmlFor="pharmacy-formulary-search">
          <span className="ui-section-label">{lang === 'ar' ? 'بحث في الأدوية' : 'Search medicines'}</span>
          <div className="pharmacy-search">
            <Search size={16} />
            <input
              id="pharmacy-formulary-search"
              name="formularySearch"
              value={searchInput}
              maxLength={100}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder={lang === 'ar' ? 'الاسم أو الاسم العلمي' : 'Name or generic name'}
            />
          </div>
        </label>

        <label className="pharmacy-filter-field pharmacy-filter-field--status" htmlFor="pharmacy-formulary-status">
          <span className="ui-section-label">{lang === 'ar' ? 'حالة الدواء' : 'Status'}</span>
          <select
            id="pharmacy-formulary-status"
            name="formularyStatus"
            aria-label={lang === 'ar' ? 'حالة الدواء' : 'Medicine status'}
            value={status}
            onChange={(event) => {
              if (['', 'ACTIVE', 'INACTIVE'].includes(event.target.value)) setStatus(event.target.value);
            }}
          >
            <option value="">{lang === 'ar' ? 'كل الحالات' : 'All statuses'}</option>
            <option value="ACTIVE">{lang === 'ar' ? 'نشط فقط' : 'Active only'}</option>
            <option value="INACTIVE">{lang === 'ar' ? 'غير نشط فقط' : 'Inactive only'}</option>
          </select>
        </label>

        <button className="btn btn-secondary" type="submit">
          {lang === 'ar' ? 'بحث' : 'Search'}
        </button>
        <button
          className="btn btn-secondary"
          type="button"
          disabled={loading}
          onClick={async () => { await loadFormulary(pagination.page, search, status); onInventoryChanged(); }}
        >
          <RefreshCw size={15} /> {lang === 'ar' ? 'تحديث' : 'Refresh'}
        </button>
      </form>

      {feedback.text && (
        <div role="status" className={`pharmacy-alert-banner pharmacy-alert-banner--${feedback.type === 'danger' ? 'danger' : feedback.type === 'success' ? 'success' : 'warning'}`}>
          {feedback.text}
        </div>
      )}

      {loading && items.length === 0 ? (
        <div className="pharmacy-table-panel ui-panel">
          <div className="pharmacy-compact-empty">
            <p className="pharmacy-empty pharmacy-empty-text">{lang === 'ar' ? 'جارٍ تحميل الأدوية…' : 'Loading medicines…'}</p>
          </div>
        </div>
      ) : items.length === 0 ? (
        <div className="pharmacy-table-panel ui-panel">
          <div className="pharmacy-compact-empty">
            <p className="pharmacy-empty pharmacy-empty-text">{lang === 'ar' ? 'لا توجد أدوية مطابقة.' : 'No medicines found.'}</p>
          </div>
        </div>
      ) : (
        <div className={`pharmacy-table-panel ui-panel${loading ? ' is-refreshing' : ''}`}>
          <table className="pharmacy-inventory-table">
            <thead>
              <tr>
                <th className="ui-section-label">{lang === 'ar' ? 'الدواء' : 'Medicine'}</th>
                <th className="ui-section-label">{lang === 'ar' ? 'السعر الرسمي' : 'Official price'}</th>
                <th className="ui-section-label">{lang === 'ar' ? 'المخزون الصالح' : 'Usable stock'}</th>
                <th className="ui-section-label">{lang === 'ar' ? 'أقرب صلاحية' : 'Nearest expiry'}</th>
                <th className="ui-section-label">{lang === 'ar' ? 'حالة المخزون' : 'Stock status'}</th>
                <th className="ui-section-label">{lang === 'ar' ? 'حالة القائمة' : 'Formulary status'}</th>
                <th><span className="sr-only">{lang === 'ar' ? 'الإجراءات' : 'Actions'}</span></th>
              </tr>
            </thead>
            <tbody>
              {items.map((medicine) => {
                const stock = authoritativeStockSummary(medicine);
                const state = stockPresentation(stock);
                const tone = { OUT_OF_STOCK: 'danger', EXPIRED: 'danger', LOW_STOCK: 'warn', NEAR_EXPIRY: 'warn', HEALTHY: 'ok' }[state] || 'muted';
                const metaDetails = [medicine.genericName, medicine.strength, medicine.dosageForm].filter(Boolean).join(' · ');

                return (
                  <tr key={medicine.id}>
                    <td data-label={lang === 'ar' ? 'الدواء' : 'Medicine'}>
                      <strong>{lang === 'ar' ? medicine.labelAr : medicine.labelEn}</strong>
                      {medicine.brandName && (
                        <span className="pharmacy-cell-meta">{medicine.brandName}</span>
                      )}
                      {metaDetails && <span className="pharmacy-cell-meta">{metaDetails}</span>}
                      {medicine.unitPriceSdg == null && (
                        <span className="pharmacy-admin-note">
                          {lang === 'ar' ? 'بانتظار التسعير والتفعيل من الإدارة' : 'Waiting for Admin pricing and activation'}
                        </span>
                      )}
                      {medicine.status === 'INACTIVE' && medicine.unitPriceSdg != null && (
                        <span className="pharmacy-admin-note">
                          {lang === 'ar' ? 'يمكن للإدارة إعادة تفعيله' : 'An administrator can reactivate it'}
                        </span>
                      )}
                    </td>
                    <td data-label={lang === 'ar' ? 'السعر الرسمي' : 'Official price'} className="ui-mono">
                      {medicine.unitPriceSdg == null ? '—' : `SDG ${Number(medicine.unitPriceSdg).toLocaleString()}`}
                    </td>
                    <td data-label={lang === 'ar' ? 'المخزون الصالح' : 'Usable stock'} className="ui-mono">
                      <strong>{stock.usableStock}</strong>
                      <span className="pharmacy-cell-meta">{lang === 'ar' ? `الإجمالي ${stock.totalOnHand}` : `Total ${stock.totalOnHand}`}</span>
                    </td>
                    <td data-label={lang === 'ar' ? 'أقرب صلاحية' : 'Nearest expiry'} className="ui-mono" dir="ltr">
                      {stock.nearestUnexpiredExpiry || '—'}
                    </td>
                    <td data-label={lang === 'ar' ? 'حالة المخزون' : 'Stock status'}>
                      <span className={`ui-status ui-status--${tone}`}>
                        {localizedStockState(state, lang)}
                      </span>
                      {stock.expiredBatchCount > 0 && (
                        <small className="pharmacy-expired-note">
                          {lang === 'ar' ? `${stock.expiredBatchCount} دفعة منتهية` : `${stock.expiredBatchCount} expired batch(es)`}
                        </small>
                      )}
                    </td>
                    <td data-label={lang === 'ar' ? 'حالة القائمة' : 'Formulary status'}>
                      <span className={`ui-status ${medicine.status === 'ACTIVE' ? 'ui-status--ok' : 'ui-status--warn'}`}>
                        {medicine.status === 'ACTIVE' ? (lang === 'ar' ? 'نشط' : 'Active') : (lang === 'ar' ? 'غير نشط' : 'Inactive')}
                      </span>
                    </td>
                    <td className="pharmacy-action-cell">
                      <div className="pharmacy-action-group">
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => showDetails(medicine, 'details')}
                        >
                          {lang === 'ar' ? 'عرض التفاصيل' : 'Details'}
                        </button>
                        <div
                          className="pharmacy-action-menu"
                          onBlur={(event) => {
                            if (!event.currentTarget.contains(event.relatedTarget)) setActionMenuId(null);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Escape') setActionMenuId(null);
                          }}
                        >
                          <button
                            type="button"
                            className="pharmacy-action-trigger"
                            aria-label={lang === 'ar' ? `إجراءات ${medicine.labelAr}` : `${medicine.labelEn} actions`}
                            aria-haspopup="menu"
                            aria-expanded={actionMenuId === medicine.id}
                            onClick={() => setActionMenuId((current) => current === medicine.id ? null : medicine.id)}
                          >
                            ⋮
                          </button>
                          {actionMenuId === medicine.id && (
                            <div className="pharmacy-action-popover" role="menu">
                              {[
                                ['details', 'عرض التفاصيل', 'View details'],
                                ['edit', 'تعديل البيانات', 'Edit metadata'],
                                ['receive', 'إضافة دفعة', 'Add batch'],
                                ['batches', 'عرض الدفعات', 'View batches'],
                                ['movements', 'سجل الحركات', 'Movement history'],
                                ...(medicine.status === 'ACTIVE' ? [['deactivate', 'إيقاف الدواء', 'Deactivate medicine']] : [])
                              ].map(([action, ar, en]) => (
                                <button
                                  key={action}
                                  type="button"
                                  role="menuitem"
                                  onClick={() => runMedicineAction(medicine, action)}
                                >
                                  {lang === 'ar' ? ar : en}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="pharmacy-pagination">
        <button
          type="button"
          className="btn btn-secondary"
          disabled={pagination.page <= 1 || loading}
          onClick={() => loadFormulary(pagination.page - 1, search, status)}
        >
          {lang === 'ar' ? 'السابق' : 'Previous'}
        </button>
        <span className="ui-mono">{pagination.page} / {Math.max(1, pagination.totalPages)}</span>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={pagination.page >= pagination.totalPages || loading}
          onClick={() => loadFormulary(pagination.page + 1, search, status)}
        >
          {lang === 'ar' ? 'التالي' : 'Next'}
        </button>
      </div>

      <Dialog open={dialog === 'create'} title={lang === 'ar' ? 'إضافة دواء' : 'Add Medicine'} description={lang === 'ar' ? 'سيتم إنشاء الدواء بحالة غير نشطة وبدون سعر. يجب على المدير تحديد السعر وتفعيل الدواء.' : 'The medicine will be created inactive and without a price. An administrator must price and activate it.'} onClose={closeDialog}>
        <DialogFeedback feedback={feedback} />
        <form onSubmit={event => guardFormSubmit(event, submitMedicine)}>
          <MedicineFields form={medicineForm} setForm={setMedicineForm} lang={lang} />
          <label className="pharmacy-checkbox" htmlFor="medicine-includeInitialBatch">
            <input
              id="medicine-includeInitialBatch"
              name="includeInitialBatch"
              type="checkbox"
              checked={medicineForm.includeInitialBatch}
              onChange={(event) => setMedicineForm((current) => ({ ...current, includeInitialBatch: event.target.checked }))}
            />
            {lang === 'ar' ? 'إضافة دفعة أولية اختيارية' : 'Add optional initial batch'}
          </label>
          {medicineForm.includeInitialBatch && (
            <BatchFields form={medicineForm} setForm={setMedicineForm} lang={lang} errors={batchErrors} idPrefix="initial-batch" />
          )}
          <div className="dialog-actions">
            <button type="button" className="btn btn-secondary" onClick={() => closeDialog()}>
              {lang === 'ar' ? 'إلغاء' : 'Cancel'}
            </button>
            <button disabled={saving} className="btn btn-primary">
              {saving ? '…' : lang === 'ar' ? 'إنشاء' : 'Create'}
            </button>
          </div>
        </form>
      </Dialog>

      <Dialog open={dialog === 'edit'} title={lang === 'ar' ? 'تعديل بيانات الدواء' : 'Edit medicine metadata'} onClose={closeDialog}>
        <DialogFeedback feedback={feedback} />
        {editLoading && <p role="status">{lang === 'ar' ? 'جارٍ تحميل بيانات الدواء…' : 'Loading medicine details…'}</p>}
        {!editLoading && !editReady && selected && (
          <button type="button" className="btn btn-secondary" onClick={() => showDetails(selected, 'edit')}>
            {lang === 'ar' ? 'إعادة المحاولة' : 'Retry'}
          </button>
        )}
        {editReady && <form onSubmit={event => guardFormSubmit(event, submitMetadata)}>
          <MedicineFields form={medicineForm} setForm={setMedicineForm} lang={lang} medicine={selected} disabled={saving} />
          <p className="form-help">
            {selected.identityLocked
              ? (lang === 'ar' ? 'يمكن تصحيح اسمي العرض. الحقول التي تحدد هوية الدواء مقفلة بسبب استخدامه في وصفة أو في المخزون.' : 'You can correct both display labels. The identity fields are locked because this medicine has prescription or inventory history.')
              : (lang === 'ar' ? 'يمكن تعديل هوية الدواء حتى يُستخدم في وصفة أو في المخزون.' : 'You can edit the medicine’s identity until it has prescription or inventory history.')}
          </p>
          <div className="dialog-actions">
            <button type="button" className="btn btn-secondary" onClick={() => closeDialog()}>
              {lang === 'ar' ? 'إلغاء' : 'Cancel'}
            </button>
            <button disabled={saving || Object.keys(buildMetadataPayload(medicineForm, selected)).length === 0} className="btn btn-primary">
              {saving ? '…' : lang === 'ar' ? 'حفظ' : 'Save'}
            </button>
          </div>
        </form>}
        {!editReady && (
          <div className="dialog-actions">
            <button type="button" className="btn btn-secondary" onClick={() => closeDialog()}>
              {lang === 'ar' ? 'إغلاق' : 'Close'}
            </button>
          </div>
        )}
      </Dialog>

      <Dialog
        open={dialog === 'deactivate'}
        title={lang === 'ar' ? 'إيقاف الدواء' : 'Deactivate medicine'}
        description={lang === 'ar'
          ? 'سيختفي الدواء من خيارات الوصفات الجديدة وربط الأدوية. سيبقى المخزون وسجل الوصفات والفواتير محفوظاً. قد تحتاج الوصفات غير المفوترة إلى مراجعة. يمكن للإدارة إعادة تفعيله.'
          : 'This removes the medicine from new prescription and medication-linking choices. Stock, prescription and invoice history are kept. Unbilled prescriptions may need review. An administrator can reactivate it.'}
        onClose={closeDialog}
        initialFocusRef={deactivateCancelRef}
      >
        <DialogFeedback feedback={feedback} />
        <p><strong>{lang === 'ar' ? selected?.labelAr : selected?.labelEn}</strong></p>
        <div className="dialog-actions">
          <button ref={deactivateCancelRef} type="button" className="btn btn-secondary" disabled={saving} onClick={() => closeDialog()}>
            {lang === 'ar' ? 'إلغاء' : 'Cancel'}
          </button>
          <button type="button" className="btn btn-danger" disabled={saving} onClick={deactivateMedicine}>
            {saving ? '…' : lang === 'ar' ? 'تأكيد الإيقاف' : 'Confirm deactivation'}
          </button>
        </div>
      </Dialog>

      <Dialog open={dialog === 'receive'} title={`${lang === 'ar' ? 'إضافة دفعة' : 'Receive batch'} — ${selected?.brandName || ''}`} onClose={closeDialog}>
        <DialogFeedback feedback={feedback} />
        <form onSubmit={event => guardFormSubmit(event, submitBatch)}>
          <BatchFields form={batchForm} setForm={setBatchForm} lang={lang} errors={batchErrors} />
          <div className="dialog-actions">
            <button type="button" className="btn btn-secondary" onClick={() => closeDialog()}>
              {lang === 'ar' ? 'إغلاق' : 'Close'}
            </button>
            <button disabled={saving} className="btn btn-primary">
              {saving ? '…' : lang === 'ar' ? 'استلام' : 'Receive'}
            </button>
          </div>
        </form>
      </Dialog>

      <Dialog open={dialog === 'details'} title={lang === 'ar' ? 'تفاصيل الدواء' : 'Medicine details'} onClose={closeDialog}>
        <DialogFeedback feedback={feedback} />
        {selected && (() => {
          const stock = authoritativeStockSummary(selected);
          return (
            <>
              <StockBadges medicine={selected} lang={lang} />
              <dl className="pharmacy-detail-list">
                <div>
                  <dt>{lang === 'ar' ? 'الاسم التجاري' : 'Brand name'}</dt>
                  <dd>{selected.brandName || '—'}</dd>
                </div>
                <div>
                  <dt>{lang === 'ar' ? 'الاسم بالعربية' : 'Arabic label'}</dt>
                  <dd dir="rtl">{selected.labelAr || '—'}</dd>
                </div>
                <div>
                  <dt>{lang === 'ar' ? 'الاسم بالإنجليزية' : 'English label'}</dt>
                  <dd dir="ltr">{selected.labelEn || '—'}</dd>
                </div>
                <div>
                  <dt>{lang === 'ar' ? 'الاسم العلمي' : 'Generic name'}</dt>
                  <dd>{selected.genericName || '—'}</dd>
                </div>
                <div>
                  <dt>{lang === 'ar' ? 'القوة' : 'Strength'}</dt>
                  <dd>{selected.strength || '—'}</dd>
                </div>
                <div>
                  <dt>{lang === 'ar' ? 'الشكل الدوائي' : 'Dosage form'}</dt>
                  <dd>{selected.dosageForm || '—'}</dd>
                </div>
                <div>
                  <dt>{lang === 'ar' ? 'حالة القائمة' : 'Formulary status'}</dt>
                  <dd>
                    <span className={`ui-status ${selected.status === 'ACTIVE' ? 'ui-status--ok' : 'ui-status--warn'}`}>
                      {selected.status === 'ACTIVE' ? (lang === 'ar' ? 'نشط' : 'Active') : (lang === 'ar' ? 'غير نشط' : 'Inactive')}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt>{lang === 'ar' ? 'السعر الرسمي' : 'Official price'}</dt>
                  <dd className="ui-mono">{selected.unitPriceSdg == null ? '—' : `SDG ${Number(selected.unitPriceSdg).toLocaleString()}`}</dd>
                </div>
                <div>
                  <dt>{lang === 'ar' ? 'المخزون الصالح' : 'Usable stock'}</dt>
                  <dd className="ui-mono">{stock.usableStock}</dd>
                </div>
                <div>
                  <dt>{lang === 'ar' ? 'إجمالي المخزون' : 'Total stock'}</dt>
                  <dd className="ui-mono">{stock.totalOnHand}</dd>
                </div>
                <div>
                  <dt>{lang === 'ar' ? 'أقرب صلاحية' : 'Nearest expiry'}</dt>
                  <dd className="ui-mono" dir="ltr">{stock.nearestUnexpiredExpiry || '—'}</dd>
                </div>
                <div>
                  <dt>{lang === 'ar' ? 'دفعات منتهية' : 'Expired batches'}</dt>
                  <dd className="ui-mono">{stock.expiredBatchCount}</dd>
                </div>
                <div>
                  <dt>{lang === 'ar' ? 'دفعات منخفضة' : 'Low-stock batches'}</dt>
                  <dd className="ui-mono">{stock.lowStockBatchCount}</dd>
                </div>
                <div>
                  <dt>{lang === 'ar' ? 'إجمالي الدفعات' : 'Total batches'}</dt>
                  <dd className="ui-mono">{stock.batchCount}</dd>
                </div>
              </dl>
              <div className="dialog-actions">
                <button type="button" className="btn btn-secondary" onClick={() => closeDialog()}>
                  {lang === 'ar' ? 'إغلاق' : 'Close'}
                </button>
              </div>
            </>
          );
        })()}
      </Dialog>

      <Dialog open={dialog === 'batches'} title={lang === 'ar' ? 'دفعات المخزون' : 'Inventory batches'} onClose={closeDialog}>
        {batchLoading ? (
          <p className="pharmacy-empty pharmacy-empty-text">{lang === 'ar' ? 'جارٍ تحميل الدفعات…' : 'Loading batches…'}</p>
        ) : batchError ? (
          <div className="pharmacy-compact-empty">
            <div role="alert" className="pharmacy-alert-banner pharmacy-alert-banner--danger">{batchError}</div>
            <button type="button" className="btn btn-secondary" onClick={() => loadBatches(selected.id, batchPagination.page)}>
              {lang === 'ar' ? 'إعادة المحاولة' : 'Retry'}
            </button>
          </div>
        ) : batches.length === 0 ? (
          <p className="pharmacy-empty pharmacy-empty-text">{lang === 'ar' ? 'لا توجد دفعات مسجلة.' : 'No inventory batches found.'}</p>
        ) : (
          <div className="pharmacy-scroll-table">
            <table>
              <thead>
                <tr>
                  <th className="ui-section-label">{lang === 'ar' ? 'الدفعة' : 'Batch'}</th>
                  <th className="ui-section-label">{lang === 'ar' ? 'الصلاحية' : 'Expiry'}</th>
                  <th className="ui-section-label">{lang === 'ar' ? 'الكمية' : 'Quantity'}</th>
                  <th className="ui-section-label">{lang === 'ar' ? 'إعادة الطلب' : 'Reorder'}</th>
                  <th className="ui-section-label">{lang === 'ar' ? 'الحالة' : 'State'}</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((batch) => {
                  const state = batchPresentation(batch);
                  const tone = ['EXPIRED', 'OUT_OF_STOCK'].includes(state) ? 'danger' : ['LOW_STOCK', 'NEAR_EXPIRY'].includes(state) ? 'warn' : 'ok';
                  return (
                    <tr key={batch.id}>
                      <td dir="ltr" className="ui-mono">{batch.batchNumber}</td>
                      <td dir="ltr" className="ui-mono">{batch.expiryDate}</td>
                      <td className="ui-mono">{batch.qtyOnHand}</td>
                      <td className="ui-mono">{batch.minReorderLevel}</td>
                      <td>
                        <span className={`ui-status ui-status--${tone}`}>{localizedStockState(state, lang)}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="pharmacy-pagination">
          <button type="button" className="btn btn-secondary" disabled={batchLoading || batchPagination.page <= 1} onClick={() => loadBatches(selected.id, batchPagination.page - 1)}>
            {lang === 'ar' ? 'السابق' : 'Previous'}
          </button>
          <span className="ui-mono">{batchPagination.page} / {Math.max(1, batchPagination.totalPages)}</span>
          <button type="button" className="btn btn-secondary" disabled={batchLoading || batchPagination.page >= batchPagination.totalPages} onClick={() => loadBatches(selected.id, batchPagination.page + 1)}>
            {lang === 'ar' ? 'التالي' : 'Next'}
          </button>
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary" disabled={batchLoading} onClick={() => loadBatches(selected.id, batchPagination.page)}>
            <RefreshCw size={15} /> {lang === 'ar' ? 'تحديث' : 'Refresh'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => closeDialog()}>
            {lang === 'ar' ? 'إغلاق' : 'Close'}
          </button>
        </div>
      </Dialog>

      <Dialog open={dialog === 'movements'} title={lang === 'ar' ? 'سجل حركة المخزون' : 'Stock movement ledger'} onClose={closeDialog}>
        {movementLoading ? (
          <p className="pharmacy-empty pharmacy-empty-text">{lang === 'ar' ? 'جارٍ تحميل الحركات…' : 'Loading movements…'}</p>
        ) : movementError ? (
          <div className="pharmacy-compact-empty">
            <div role="alert" className="pharmacy-alert-banner pharmacy-alert-banner--danger">{movementError}</div>
            <button type="button" className="btn btn-secondary" onClick={() => loadMovements(selected.id, movementPagination.page)}>
              {lang === 'ar' ? 'إعادة المحاولة' : 'Retry'}
            </button>
          </div>
        ) : movements.length === 0 ? (
          <p className="pharmacy-empty pharmacy-empty-text">{lang === 'ar' ? 'لا توجد حركات مخزون مسجلة.' : 'No stock movements found.'}</p>
        ) : (
          <div className="pharmacy-scroll-table">
            <table>
              <thead>
                <tr>
                  <th className="ui-section-label">{lang === 'ar' ? 'النوع' : 'Type'}</th>
                  <th className="ui-section-label">{lang === 'ar' ? 'الدفعة' : 'Batch'}</th>
                  <th className="ui-section-label">{lang === 'ar' ? 'التغيير' : 'Delta'}</th>
                  <th className="ui-section-label">{lang === 'ar' ? 'الرصيد' : 'Balance'}</th>
                  <th className="ui-section-label">{lang === 'ar' ? 'المنفذ' : 'Actor'}</th>
                  <th className="ui-section-label">{lang === 'ar' ? 'الوقت' : 'Time'}</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((movement) => (
                  <tr key={movement.id}>
                    <td>{localizedMovementType(movement.movementType, lang)}</td>
                    <td dir="ltr" className="ui-mono">{movement.batch?.batchNumber || '—'}</td>
                    <td dir="ltr" className="ui-mono">{movement.quantityDelta}</td>
                    <td className="ui-mono">{movement.resultingBalance}</td>
                    <td>{movement.actor?.username || '—'}</td>
                    <td className="ui-mono">{new Date(movement.createdAt).toLocaleString(lang === 'ar' ? 'ar' : 'en')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="pharmacy-pagination">
          <button type="button" className="btn btn-secondary" disabled={movementLoading || movementPagination.page <= 1} onClick={() => loadMovements(selected.id, movementPagination.page - 1)}>
            {lang === 'ar' ? 'السابق' : 'Previous'}
          </button>
          <span className="ui-mono">{movementPagination.page} / {Math.max(1, movementPagination.totalPages)}</span>
          <button type="button" className="btn btn-secondary" disabled={movementLoading || movementPagination.page >= movementPagination.totalPages} onClick={() => loadMovements(selected.id, movementPagination.page + 1)}>
            {lang === 'ar' ? 'التالي' : 'Next'}
          </button>
        </div>
        <p className="form-help">
          {lang === 'ar' ? 'هذا السجل للقراءة فقط ولا يمكن تعديله أو حذفه.' : 'This immutable ledger is read-only and cannot be edited or deleted.'}
        </p>
        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary" disabled={movementLoading} onClick={() => loadMovements(selected.id, movementPagination.page)}>
            <RefreshCw size={15} /> {lang === 'ar' ? 'تحديث' : 'Refresh'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => closeDialog()}>
            {lang === 'ar' ? 'إغلاق' : 'Close'}
          </button>
        </div>
      </Dialog>
    </section>
  );
}
