import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, FileText, HelpCircle, Sliders, Stethoscope } from 'lucide-react';
import { apiErrorMessage, fetchWithAuth } from '../../../services/staff/staffApi';
import RoleHero from '../components/RoleHero';
import PharmacyManagement from './PharmacyManagement';
import PharmacyPayment from './PharmacyPayment';
import Dialog from '../../../components/ui/Dialog';
import { buildMedicationReviewPayload, pharmacyAlertModel } from './pharmacyHelpers';
import MedicationReviewCard from './components/MedicationReviewCard';
import PrescriptionQueueCard from './components/PrescriptionQueueCard';
import PrescribedStockItemCard from './components/PrescribedStockItemCard';
import CustomPrescribedItemCard from './components/CustomPrescribedItemCard';
import PharmacyAlertsBody from './components/PharmacyAlertsBody';

export default function PharmacyDashboard({ lang, t: _t }) {
  const [prescriptions, setPrescriptions] = useState([]);
  const [prescriptionHistory, setPrescriptionHistory] = useState([]);
  const [queueView, setQueueView] = useState('active');
  const [selectedRx, setSelectedRx] = useState(null);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [paymentState, setPaymentState] = useState(null);
  const [managementRefresh, setManagementRefresh] = useState(0);
  const [paymentRefresh, setPaymentRefresh] = useState(0);
  const [dispensing, setDispensing] = useState(false);
  const [activeSection, setActiveSection] = useState('dispensing');
  const [alertMedicines, setAlertMedicines] = useState(null);
  const [alertLoadError, setAlertLoadError] = useState('');

  const [selectedStock, setSelectedStock] = useState({});

  // Read-only formulary pricing; official prices are configured by ADMIN.
  const [drugCatalog, setDrugCatalog] = useState([]);

  // Custom medications awaiting pharmacist review
  const [medicationReviews, setMedicationReviews] = useState([]);
  const [reviewModeById, setReviewModeById] = useState({});
  const [reviewForms, setReviewForms] = useState({});
  const [reviewSavingId, setReviewSavingId] = useState(null);
  const [reviewSuccessMsg, setReviewSuccessMsg] = useState('');
  const [reviewErrorMsg, setReviewErrorMsg] = useState('');
  const [reviewDialogItem, setReviewDialogItem] = useState(null);
  const [unavailableItem, setUnavailableItem] = useState(null);
  const [unavailableReason, setUnavailableReason] = useState('OUT_OF_STOCK');
  const [unavailableNote, setUnavailableNote] = useState('');
  const [unavailableSaving, setUnavailableSaving] = useState(false);
  const reviewSectionRef = useRef(null);
  const alertRequestRef = useRef(0);

  const loadAlertInventory = useCallback(async () => {
    const requestId = ++alertRequestRef.current;
    setAlertLoadError('');
    try {
      const firstResponse = await fetchWithAuth('/api/pharmacy/formulary?page=1&pageSize=100');
      if (!firstResponse.ok) throw new Error('FORMULARY_ALERT_LOAD_FAILED');
      const firstPage = await firstResponse.json();
      const totalPages = Math.max(1, Number(firstPage.pagination?.totalPages) || 1);
      const allItems = [...(firstPage.items || [])];
      for (let page = 2; page <= totalPages; page += 1) {
        const response = await fetchWithAuth(`/api/pharmacy/formulary?page=${page}&pageSize=100`);
        if (!response.ok) throw new Error('FORMULARY_ALERT_LOAD_FAILED');
        const payload = await response.json();
        allItems.push(...(payload.items || []));
      }
      if (requestId === alertRequestRef.current) {
        setAlertMedicines(allItems);
      }
    } catch {
      if (requestId === alertRequestRef.current) {
        setAlertMedicines(null);
        setAlertLoadError(lang === 'ar' ? 'تعذر تحميل تنبيهات المخزون.' : 'Unable to load inventory alerts.');
      }
    }
  }, [lang]);

  const fetchMedicationReviews = useCallback(() => {
    fetchWithAuth('/api/records/medication-reviews/pending')
      .then(async (res) => {
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(
            apiErrorMessage(
              payload,
              'Failed to load medication review requests.'
            )
          );
        }

        return res.json();
      })
      .then((data) => {
        setMedicationReviews(
          Array.isArray(data) ? data : []
        );
      })
      .catch(() => {
        setMedicationReviews([]);
        setReviewErrorMsg(
          lang === 'ar'
            ? 'تعذر تحميل طلبات مراجعة الأدوية.'
            : 'Unable to load medication review requests.'
        );
      });
  }, [lang]);

  const fetchPendingRx = useCallback(() => {
    fetchWithAuth('/api/records/prescriptions/pending')
      .then((res) => res.ok ? res.json() : [])
      .then((data) => {
        const queue = Array.isArray(data) ? data : [];
        setPrescriptions(queue);

        setSelectedRx((current) => {
          if (!current) return null;

          return (
            queue.find((rx) => rx.id === current.id) ||
            null
          );
        });
      })
      .catch(() => {
        setPrescriptions([]);
      });
  }, []);

  const fetchPrescriptionHistory = useCallback(() => {
    fetchWithAuth('/api/records/prescriptions/history')
      .then((res) => res.ok ? res.json() : [])
      .then((data) => setPrescriptionHistory(Array.isArray(data) ? data : []))
      .catch(() => setPrescriptionHistory([]));
  }, []);

  useEffect(() => {
    fetchPendingRx();
    fetchPrescriptionHistory();
    fetchMedicationReviews();

    fetchWithAuth('/api/records/drugs')
      .then((res) => res.ok ? res.json() : [])
      .then((data) => {
        if (Array.isArray(data)) {
          setDrugCatalog(data);
        } else {
          setDrugCatalog([]);
        }
      })
      .catch(() => {
        setDrugCatalog([]);
      });
  }, [fetchMedicationReviews, fetchPendingRx, fetchPrescriptionHistory]);

  useEffect(() => {
    loadAlertInventory();
    return () => { alertRequestRef.current += 1; };
  }, [loadAlertInventory, managementRefresh]);

  useEffect(() => {
    let active = true;
    const ids = [...new Set((selectedRx?.prescribedDrugs || []).map((item) => item.drugId || item.drug?.id).filter(Boolean))];
    if (!ids.length) { setSelectedStock({}); return () => { active = false; }; }
    Promise.all(ids.map(async (id) => {
      const response = await fetchWithAuth(`/api/pharmacy/formulary/${id}`);
      if (!response.ok) return [id, null];
      return [id, await response.json()];
    })).then((entries) => { if (active) setSelectedStock(Object.fromEntries(entries)); }).catch(() => { if (active) setSelectedStock({}); });
    return () => { active = false; };
  }, [selectedRx, managementRefresh]);

  const setReviewMode = (item, mode) => {
    setReviewErrorMsg('');
    setReviewSuccessMsg('');

    setReviewModeById((current) => ({
      ...current,
      [item.id]: mode
    }));

    setReviewForms((current) => {
      if (current[item.id]) {
        return current;
      }

      return {
        ...current,
        [item.id]: {
          drugId: '',
          note: '',

          labelEn: item.customDrugName || '',
          labelAr: '',
          genericName: '',
          strength: '',
          dosageForm: '',
          batchNumber: '',
          expiryDate: '',
          qtyOnHand: String(
            Math.max(
              1,
              Number(item.qtyPrescribed || 1) -
                Number(item.qtyDispensed || 0)
            )
          ),
          minReorderLevel: '10'
        }
      };
    });
  };

  const openCustomMedicineReview = (item) => {
    const reviewItem = medicationReviews.find((request) => request.id === item.id) || {
      ...item,
      patient: selectedRx?.patient
    };
    if (!medicationReviews.some((request) => request.id === item.id)) {
      setMedicationReviews((current) => [...current, reviewItem]);
    }
    setReviewDialogItem(reviewItem);
  };

  const chooseReviewDecision = (decision) => {
    if (!reviewDialogItem) return;
    setReviewMode(reviewDialogItem, decision);
    setReviewDialogItem(null);
    requestAnimationFrame(() => reviewSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const updateReviewForm = (id, field, value) => {
    setReviewForms((current) => ({
      ...current,
      [id]: {
        ...(current[id] || {}),
        [field]: value
      }
    }));
  };

  const handleMedicationReview = async (item, decision) => {
    setReviewErrorMsg('');
    setReviewSuccessMsg('');

    const form = reviewForms[item.id] || {};

    if (decision === 'LINK_EXISTING') {
      if (!form.drugId) {
        setReviewErrorMsg(
          lang === 'ar'
            ? 'اختر دواءً من قائمة الصيدلية أولاً.'
            : 'Select an existing formulary medication first.'
        );
        return;
      }
    }

    if (decision === 'CREATE_FORMULARY') {
      const qtyOnHand = Number(form.qtyOnHand);
      const minReorderLevel = Number(
        form.minReorderLevel
      );

      if (
        !form.genericName?.trim() ||
        !form.strength?.trim() ||
        !form.dosageForm?.trim()
      ) {
        setReviewErrorMsg(
          lang === 'ar'
            ? 'الاسم العلمي والتركيز والشكل الدوائي مطلوبة.'
            : 'Generic name, strength, and dosage form are required.'
        );
        return;
      }

      if (!form.batchNumber?.trim()) {
        setReviewErrorMsg(
          lang === 'ar'
            ? 'رقم التشغيلة مطلوب.'
            : 'Batch number is required.'
        );
        return;
      }

      if (!form.expiryDate) {
        setReviewErrorMsg(
          lang === 'ar'
            ? 'تاريخ الصلاحية مطلوب.'
            : 'Expiry date is required.'
        );
        return;
      }

      if (
        !Number.isSafeInteger(qtyOnHand) ||
        qtyOnHand <= 0
      ) {
        setReviewErrorMsg(
          lang === 'ar'
            ? 'كمية المخزون يجب أن تكون أكبر من صفر.'
            : 'Initial stock must be a positive whole number.'
        );
        return;
      }

      if (
        !Number.isSafeInteger(minReorderLevel) ||
        minReorderLevel < 0
      ) {
        setReviewErrorMsg(
          lang === 'ar'
            ? 'حد إعادة الطلب غير صحيح.'
            : 'Reorder level must be a non-negative whole number.'
        );
        return;
      }

    }

    const body = buildMedicationReviewPayload(item, decision, form);

    try {
      setReviewSavingId(item.id);

      const response = await fetchWithAuth(
        `/api/records/prescribed-drugs/${item.id}/pharmacy-review`,
        {
          method: 'POST',
          body: JSON.stringify(body)
        }
      );

      const payload =
        await response.json().catch(() => ({}));

      if (!response.ok) {
        setReviewErrorMsg(
          apiErrorMessage(
            payload,
            'Failed to review medication.'
          )
        );
        return;
      }

      setMedicationReviews((current) =>
        current.filter(
          (request) => request.id !== item.id
        )
      );

      setReviewModeById((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });

      setReviewForms((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });

      // CREATE_FORMULARY returns the newly created drug and batch.
      // Add it immediately to the pharmacist catalog without refresh.
      if (
        decision === 'CREATE_FORMULARY' &&
        payload.drug
      ) {
        const createdDrug = {
          ...payload.drug,
          inventoryBatches:
            payload.inventoryBatch
              ? [payload.inventoryBatch]
              : []
        };

        setDrugCatalog((current) => {
          if (
            current.some(
              (drug) => drug.id === createdDrug.id
            )
          ) {
            return current;
          }

          return [...current, createdDrug];
        });
      }

      fetchMedicationReviews();
      fetchPendingRx();
      setPaymentRefresh((value) => value + 1);
      if (decision === 'CREATE_FORMULARY') setManagementRefresh((value) => value + 1);

      setReviewSuccessMsg(
        decision === 'CREATE_FORMULARY'
          ? (lang === 'ar'
              ? 'تم إنشاء الدواء في قائمة الصيدلية. يجب على المدير تحديد السعر وتفعيل الدواء قبل إنشاء فاتورة الصيدلية تلقائيًا.'
              : 'The medicine was created in the formulary. An administrator must price and activate it before the pharmacy invoice is created automatically.')
          : decision === 'EXTERNAL'
          ? (
              lang === 'ar'
                ? `تم تحديد ${item.customDrugName} كدواء خارجي.`
                : `${item.customDrugName} was marked as an external medication.`
            )
          : (
              lang === 'ar'
                ? `تم اعتماد ${item.customDrugName} بنجاح.`
                : `${item.customDrugName} was approved successfully.`
            )
      );
    } catch {
      setReviewErrorMsg(
        lang === 'ar'
          ? 'تعذر إكمال مراجعة الدواء.'
          : 'Unable to complete medication review.'
      );
    } finally {
      setReviewSavingId(null);
    }
  };

  const handleDispense = async (rx) => {
    setErrorMsg('');
    setSuccessMsg('');

    if (!paymentState?.dispensingAllowed) {
      setErrorMsg(
        lang === 'ar'
          ? 'لا يمكن صرف هذه الوصفة قبل دفع فاتورة الصيدلية بالكامل.'
          : 'This prescription cannot be dispensed until the pharmacy invoice is fully paid.'
      );
      return;
    }

    const items = rx.prescribedDrugs
      .filter(
        (item) =>
          item.drug &&
          Number(item.qtyPrescribed) - Number(item.qtyDispensed) > 0
      )
      .map((item) => ({
        prescribedDrugId: item.id,
        qtyToDispense:
          Number(item.qtyPrescribed) - Number(item.qtyDispensed)
      }));

    if (items.length === 0) {
      setErrorMsg(
        lang === 'ar'
          ? 'هذه الوصفة تحتوي فقط على أدوية مكتوبة يدويًا وغير مرتبطة بمخزون العيادة.'
          : 'This prescription only contains custom medications that are not linked to clinic inventory.'
      );
      return;
    }

    try {
      setDispensing(true);
      const res = await fetchWithAuth(`/api/records/prescriptions/${rx.id}/dispense`, {
        method: 'POST',
        body: JSON.stringify({ items })
      });
      if (res.ok) {
        setSuccessMsg(lang === 'ar' ? 'تم صرف الوصفة الطبية وإنقاص المخزون بنجاح.' : 'Prescription dispensed successfully.');
        setSelectedRx(null);
        setPaymentState(null);
        setManagementRefresh((value) => value + 1);
        fetchPendingRx();
        fetchPrescriptionHistory();
      } else {
        const err = await res.json();
        setErrorMsg(apiErrorMessage(err, 'Dispense failed.'));
      }
    } catch {
      setErrorMsg('Dispensing transaction failed.');
    } finally {
      setDispensing(false);
    }
  };

  const openUnavailableResolution = (item, defaultReason = 'OUT_OF_STOCK') => {
    setUnavailableItem(item);
    setUnavailableReason(defaultReason);
    setUnavailableNote('');
    setErrorMsg('');
  };

  const resolveUnavailable = async () => {
    if (!unavailableItem) return;
    try {
      setUnavailableSaving(true);
      const response = await fetchWithAuth(`/api/records/prescribed-drugs/${unavailableItem.id}/unavailable`, {
        method: 'POST',
        body: JSON.stringify({ reason: unavailableReason, note: unavailableNote.trim() || null })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setErrorMsg(apiErrorMessage(payload, lang === 'ar' ? 'تعذر تسجيل تعذر الصرف.' : 'Unable to resolve the medication.'));
        return;
      }
      setUnavailableItem(null);
      setSelectedRx(null);
      setPaymentState(null);
      setPaymentRefresh((value) => value + 1);
      setSuccessMsg(lang === 'ar' ? 'تم توثيق تعذر صرف الدواء دون خصم مخزون أو تحصيل قيمته.' : 'The medicine was recorded as unavailable without stock deduction or patient charge.');
      fetchPendingRx();
      fetchPrescriptionHistory();
    } catch {
      setErrorMsg(lang === 'ar' ? 'تعذر إكمال الإجراء.' : 'Unable to complete the action.');
    } finally {
      setUnavailableSaving(false);
    }
  };

  const alertModel = pharmacyAlertModel(alertMedicines || []);

  return (
    <div className="dashboard-wrapper">
      <div className="workspace-panel" style={{ padding: '1rem' }}>
        <RoleHero role="pharmacy" lang={lang}/>
        <div className="pharmacy-pilot-summary" aria-label={lang === 'ar' ? 'ملخص العمل' : 'Operational summary'}>
          <div><strong>{prescriptions.length}</strong><span>{lang === 'ar' ? 'وصفات بانتظار الصرف' : 'Pending prescriptions'}</span></div>
          <div><strong>{medicationReviews.length}</strong><span>{lang === 'ar' ? 'طلبات أدوية جديدة' : 'Custom medicine requests'}</span></div>
        </div>
        <div className="pharmacy-workspace-tabs" role="tablist" aria-label={lang === 'ar' ? 'أقسام الصيدلية' : 'Pharmacy sections'}>
          {[
            ['dispensing', lang === 'ar' ? 'صرف الوصفات' : 'Prescription Dispensing', prescriptions.length],
            ['inventory', lang === 'ar' ? 'الأدوية والمخزون' : 'Medicines & Inventory', null],
            ['alerts', lang === 'ar' ? 'التنبيهات' : 'Stock & Expiry Alerts', alertMedicines ? alertModel.totalAlertCount : null],
            ['reviews', lang === 'ar' ? 'طلبات الأدوية الجديدة' : 'Custom Medicine Review', medicationReviews.length]
          ].map(([id, label, count]) => <button key={id} type="button" role="tab" aria-selected={activeSection === id} aria-controls={`pharmacy-section-${id}`} className={activeSection === id ? 'is-active' : ''} onClick={() => setActiveSection(id)}><span>{label}</span>{count !== null && <span className="pharmacy-tab-count">{count}</span>}</button>)}
        </div>

        {activeSection === 'inventory' && <div id="pharmacy-section-inventory" role="tabpanel"><PharmacyManagement lang={lang} refreshToken={managementRefresh} onInventoryChanged={loadAlertInventory} /></div>}

        <Dialog
          open={Boolean(reviewDialogItem)}
          title={lang === 'ar' ? 'مراجعة الدواء' : 'Review Medication'}
          description={reviewDialogItem?.customDrugName || ''}
          onClose={() => setReviewDialogItem(null)}
        >
          <div className="dialog-actions">
            <button type="button" className="btn btn-primary" onClick={() => chooseReviewDecision('LINK_EXISTING')}>
              {lang === 'ar' ? 'ربط بدواء موجود' : 'Link Existing'}
            </button>
            <button type="button" className="btn btn-primary" onClick={() => chooseReviewDecision('CREATE_FORMULARY')}>
              {lang === 'ar' ? 'إضافة كدواء جديد' : 'Create Formulary Medicine'}
            </button>
            <button type="button" className="btn" onClick={() => chooseReviewDecision('EXTERNAL')}>
              {lang === 'ar' ? 'دواء خارجي' : 'External Medication'}
            </button>
            <button type="button" className="btn" onClick={() => setReviewDialogItem(null)}>
              {lang === 'ar' ? 'إلغاء' : 'Cancel'}
            </button>
          </div>
        </Dialog>

        <Dialog
          open={Boolean(unavailableItem)}
          title={lang === 'ar' ? 'تعذر الصرف' : 'Unable to Dispense'}
          description={unavailableItem ? (unavailableItem.drug ? (lang === 'ar' ? unavailableItem.drug.labelAr : unavailableItem.drug.labelEn) : unavailableItem.customDrugName) : ''}
          onClose={() => !unavailableSaving && setUnavailableItem(null)}
        >
          <div className="pharmacy-unavailable-form">
            <label className="form-group">
              <span className="form-label">{lang === 'ar' ? 'السبب' : 'Reason'}</span>
              <select className="form-input" value={unavailableReason} onChange={(event) => setUnavailableReason(event.target.value)}>
                <option value="OUT_OF_STOCK">{lang === 'ar' ? 'غير متوفر بالمخزون' : 'Out of stock'}</option>
                <option value="NOT_IN_FORMULARY">{lang === 'ar' ? 'الدواء غير معتمد في قائمة العيادة' : 'Not in the clinic formulary'}</option>
                <option value="DOCTOR_REVIEW_REQUIRED">{lang === 'ar' ? 'دواء يدوي يحتاج مراجعة الطبيب' : 'Manual medicine requires doctor review'}</option>
                <option value="OTHER">{lang === 'ar' ? 'سبب آخر' : 'Other'}</option>
              </select>
            </label>
            <label className="form-group">
              <span className="form-label">{lang === 'ar' ? 'ملاحظة اختيارية' : 'Optional note'}</span>
              <textarea className="form-input" maxLength="500" value={unavailableNote} onChange={(event) => setUnavailableNote(event.target.value)} />
            </label>
            <p className="form-help">{lang === 'ar' ? 'لن يُسجل الدواء كمصروف، ولن يُخصم من المخزون أو تُحصّل قيمته.' : 'The item will not be marked dispensed, deducted from stock, or charged.'}</p>
            <div className="dialog-actions">
              <button type="button" className="btn btn-danger" disabled={unavailableSaving} onClick={resolveUnavailable}>{unavailableSaving ? (lang === 'ar' ? 'جارٍ الحفظ…' : 'Saving…') : (lang === 'ar' ? 'تأكيد تعذر الصرف' : 'Confirm Unable to Dispense')}</button>
              <button type="button" className="btn" disabled={unavailableSaving} onClick={() => setUnavailableItem(null)}>{lang === 'ar' ? 'إلغاء' : 'Cancel'}</button>
            </div>
          </div>
        </Dialog>

        {activeSection === 'reviews' && <div id="pharmacy-section-reviews" role="tabpanel"><div
          ref={reviewSectionRef}
          className="glass-panel"
          style={{
            padding: '1rem',
            marginBottom: '1rem'
          }}
        >
          <div
            className="panel-header"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: '1rem',
              alignItems: 'center'
            }}
          >
            <span className="panel-title">
              <AlertTriangle
                size={18}
                color="var(--warning)"
              />
              {lang === 'ar'
                ? 'طلبات الأدوية الجديدة'
                : 'New Medication Requests'}
            </span>

            <span
              className={
                medicationReviews.length
                  ? 'badge badge-warning'
                  : 'badge badge-success'
              }
            >
              {medicationReviews.length}
            </span>
          </div>

          <p
            style={{
              color: 'var(--text-secondary)',
              fontSize: '0.82rem',
              marginBottom: '1rem'
            }}
          >
            {lang === 'ar'
              ? 'الأدوية التي كتبها الطبيب ولم يتم اعتمادها بعد من الصيدلية. يجب ربط الدواء بالمخزون أو إضافته كدواء غير نشط بانتظار تسعير المدير أو تحديده كدواء خارجي.'
              : 'Custom medicines entered by doctors must be reviewed before automatic billing. Link them to existing stock, create them for administrator pricing, or mark them for external purchase.'}
          </p>

          {reviewErrorMsg && (
            <div
              className="badge badge-danger"
              style={{
                display: 'block',
                padding: '0.65rem',
                marginBottom: '0.75rem'
              }}
            >
              {reviewErrorMsg}
            </div>
          )}

          {reviewSuccessMsg && (
            <div
              className="badge badge-success"
              style={{
                display: 'block',
                padding: '0.65rem',
                marginBottom: '0.75rem'
              }}
            >
              {reviewSuccessMsg}
            </div>
          )}

          {medicationReviews.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '1.5rem',
                color: 'var(--text-secondary)'
              }}
            >
              <strong>
                {lang === 'ar'
                  ? 'لا توجد طلبات أدوية جديدة حالياً.'
                  : 'No medication requests awaiting review.'}
              </strong>
            </div>
          ) : (
            <div
              style={{
                display: 'grid',
                gap: '0.85rem'
              }}
            >
              {medicationReviews.map((item) => (
                <MedicationReviewCard
                  key={item.id}
                  item={item}
                  lang={lang}
                  form={reviewForms[item.id] || {}}
                  mode={reviewModeById[item.id] || ''}
                  drugCatalog={drugCatalog}
                  saving={reviewSavingId === item.id}
                  onSetMode={(mode) => setReviewMode(item, mode)}
                  onFieldChange={(field, value) => updateReviewForm(item.id, field, value)}
                  onSubmit={(decision) => handleMedicationReview(item, decision)}
                />
              ))}
            </div>
          )}
        </div></div>}

        {(activeSection === 'dispensing' || activeSection === 'alerts') && <div
          id={`pharmacy-section-${activeSection}`}
          role="tabpanel"
          className={`panel-grid pharmacy-operational-grid pharmacy-view-${activeSection}`}
        >
          {/* COLUMN 1: ACTIVE RX QUEUE */}
          <div className="panel-column glass-panel pharmacy-queue-column" style={{ padding: '1rem' }}>
            <div className="panel-header">
              <span className="panel-title">
                <FileText size={18} />
                {lang === 'ar'
      ? 'الوصفات الطبية بانتظار الصرف'
      : 'Prescriptions Awaiting Dispensing'}
              </span>

              <button
                type="button"
                className="btn btn-secondary"
                style={{
                  padding: '4px 10px',
                  fontSize: '0.75rem'
                }}
                onClick={queueView === 'active' ? fetchPendingRx : fetchPrescriptionHistory}
              >
                {lang === 'ar' ? 'تحديث' : 'Refresh'}
              </button>
            </div>
            <div className="pharmacy-queue-tabs" role="tablist" aria-label={lang === 'ar' ? 'عرض الوصفات' : 'Prescription view'}>
              <button type="button" role="tab" aria-selected={queueView === 'active'} className={queueView === 'active' ? 'is-active' : ''} onClick={() => setQueueView('active')}>{lang === 'ar' ? 'بانتظار الصرف' : 'Awaiting Dispensing'} <span>{prescriptions.length}</span></button>
              <button type="button" role="tab" aria-selected={queueView === 'history'} className={queueView === 'history' ? 'is-active' : ''} onClick={() => { setQueueView('history'); fetchPrescriptionHistory(); }}>{lang === 'ar' ? 'السجل' : 'History'} <span>{prescriptionHistory.length}</span></button>
            </div>
            {(queueView === 'active' ? prescriptions : prescriptionHistory).length === 0 ? (
              <div className="pharmacy-compact-empty">
                <HelpCircle size={24} />
                <p>{queueView === 'active' ? (lang === 'ar' ? 'لا توجد وصفات بانتظار الصرف.' : 'No prescriptions are awaiting dispensing.') : (lang === 'ar' ? 'لا توجد وصفات محفوظة في السجل.' : 'No prescription history is available.')}</p>
              </div>
            ) : (
              (queueView === 'active' ? prescriptions : prescriptionHistory).map((rx) => (
                <PrescriptionQueueCard
                  key={rx.id}
                  rx={rx}
                  lang={lang}
                  queueView={queueView}
                  selected={selectedRx?.id === rx.id}
                  onSelect={() => { setSelectedRx(rx); setPaymentState(null); }}
                />
              ))
            )}
          </div>

          {/* COLUMN 2: PRESCRIPTION DISPENSER */}
          <div className="panel-column glass-panel pharmacy-dispense-column" style={{ padding: '1rem' }}>
            <div className="panel-header">
              <span className="panel-title">
                <Sliders size={18} />
                {lang === 'ar' ? 'شاشة صرف الأدوية' : 'Rx Dispensation Desk'}
              </span>
            </div>
            {errorMsg && <div className="badge badge-danger" style={{ padding: '0.5rem' }}>{errorMsg}</div>}
            {successMsg && <div className="badge badge-success" style={{ padding: '0.5rem' }}>{successMsg}</div>}

            {selectedRx ? (
              <div>
                <h4>
                  {lang === 'ar' ? 'المريض:' : 'Patient:'}{' '}
                  {lang === 'ar' ? selectedRx.patient.fullNameAr : selectedRx.patient.fullNameEn}
                </h4>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                  {lang === 'ar' ? 'الطبيب المعالج:' : 'Doctor:'} {lang === 'ar' ? selectedRx.doctor.fullNameAr : selectedRx.doctor.fullNameEn}
                </p>

                {queueView === 'active' && <PharmacyPayment key={`${selectedRx.id}:${paymentRefresh}`} prescriptionId={selectedRx.id} lang={lang} onStateChange={setPaymentState} />}

                {selectedRx.prescribedDrugs.map((item) => {
                  if (!item.drug) {
                    return (
                      <CustomPrescribedItemCard
                        key={item.id}
                        item={item}
                        lang={lang}
                        queueView={queueView}
                        onReview={() => openCustomMedicineReview(item)}
                        onUnavailable={(reason) => openUnavailableResolution(item, reason)}
                      />
                    );
                  }

                  return (
                    <PrescribedStockItemCard
                      key={item.id}
                      item={item}
                      lang={lang}
                      authoritativeMedicine={selectedStock[item.drugId || item.drug.id]}
                      onUnavailable={(reason) => openUnavailableResolution(item, reason)}
                    />
                  );
                })}

                {queueView === 'active' && <button
                  className="btn btn-primary"
                  style={{
                    width: '100%',
                    marginTop: '1.5rem'
                  }}
                  onClick={() => handleDispense(selectedRx)}
                  disabled={!paymentState?.dispensingAllowed || dispensing}
                >
                  {paymentState?.dispensingAllowed
                    ? (lang === 'ar'
                        ? (dispensing ? 'جارٍ الصرف…' : 'صرف الأدوية وتحديث المستودع')
                        : (dispensing ? 'Dispensing…' : 'Confirm Dispensation'))
                    : (lang === 'ar'
                        ? '🔒 الدفع الكامل مطلوب قبل الصرف'
                        : '🔒 Full Payment Required Before Dispensing')}
                </button>}
              </div>
            ) : (
              <div className="pharmacy-compact-empty pharmacy-select-prescription">
                <Stethoscope size={28} />
                <p>{lang === 'ar'
      ? 'اختر وصفة طبية من القائمة لعرض الأدوية والتحقق من المخزون.'
      : 'Select a prescription to review medications and inventory availability.'}</p>
              </div>
            )}
          </div>

          {/* COLUMN 3: ALERTS & INVENTORY */}
          <div className="panel-column glass-panel pharmacy-alert-column" style={{ padding: '1rem' }}>
            <div className="panel-header">
              <span className="panel-title">
                <AlertTriangle size={18} color="var(--warning)" />
                {lang === 'ar' ? 'تنبيهات المخازن والصلاحية' : 'Stock Alerts & Expiry'}
              </span>
              <button type="button" className="btn btn-secondary" onClick={loadAlertInventory}>
                {lang === 'ar' ? 'تحديث' : 'Refresh'}
              </button>
            </div>
            <PharmacyAlertsBody
              lang={lang}
              alertLoadError={alertLoadError}
              alertMedicines={alertMedicines}
              alertModel={alertModel}
              onRetry={loadAlertInventory}
            />
          </div>
        </div>}
      </div>
    </div>
  );
}

/* ==========================================
   5. LAB TECHNICIAN DASHBOARD
   ========================================== */
