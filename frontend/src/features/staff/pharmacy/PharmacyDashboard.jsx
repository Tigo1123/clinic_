import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, ClipboardCheck, Package, Pill, RefreshCw } from 'lucide-react';
import { apiErrorMessage, fetchWithAuth } from '../../../services/staff/staffApi';
import PharmacyManagement from './PharmacyManagement';
import PharmacyPayment from './PharmacyPayment';
import Dialog from '../../../components/ui/Dialog';
import { buildMedicationReviewPayload, customMedicineRequiresReview, pharmacyAlertModel } from './pharmacyHelpers';
import MedicationReviewCard from './components/MedicationReviewCard';
import PrescriptionQueueCard from './components/PrescriptionQueueCard';
import PrescribedStockItemCard from './components/PrescribedStockItemCard';
import CustomPrescribedItemCard from './components/CustomPrescribedItemCard';
import PharmacyAlertsBody from './components/PharmacyAlertsBody';
import { useStaffNav } from '../staffShellContext';
import './pharmacyDashboard.css';

export default function PharmacyDashboard({ lang, t: _t }) {
  const [prescriptions, setPrescriptions] = useState([]);
  const [prescriptionsLoadError, setPrescriptionsLoadError] = useState(false);
  const [prescriptionHistory, setPrescriptionHistory] = useState([]);
  const [historyLoadError, setHistoryLoadError] = useState(false);
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
  const [selectedReviewId, setSelectedReviewId] = useState(null);
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
  const [unavailableError, setUnavailableError] = useState('');
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
        const list = Array.isArray(data) ? data : [];
        setMedicationReviews(list);
        setSelectedReviewId((current) => {
          if (current && list.some((item) => item.id === current)) return current;
          return list[0]?.id || null;
        });
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
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load prescriptions');
        return res.json();
      })
      .then((data) => {
        setPrescriptionsLoadError(false);
        const queue = Array.isArray(data) ? data : [];
        setPrescriptions(queue);

        setSelectedRx((current) => {
          if (!current) return queue[0] || null;

          return (
            queue.find((rx) => rx.id === current.id) ||
            queue[0] ||
            null
          );
        });
      })
      .catch(() => {
        setPrescriptionsLoadError(true);
      });
  }, []);

  const fetchPrescriptionHistory = useCallback(() => {
    fetchWithAuth('/api/records/prescriptions/history')
      .then((res) => {
        if (!res.ok) throw new Error('History load failed');
        return res.json();
      })
      .then((data) => {
        setHistoryLoadError(false);
        setPrescriptionHistory(Array.isArray(data) ? data : []);
      })
      .catch(() => setHistoryLoadError(true));
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
    setSelectedReviewId(reviewDialogItem.id);
    setActiveSection('reviews');
    setReviewDialogItem(null);
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
      const minReorderLevel = Number(form.minReorderLevel);

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
        const err = await res.json().catch(() => ({}));
        setErrorMsg(apiErrorMessage(err, lang === 'ar' ? 'تعذر صرف الوصفة الطبية.' : 'Dispense failed.'));
      }
    } catch {
      setErrorMsg(lang === 'ar' ? 'فشلت معاملة الصرف. تحقق من الاتصال وحاول مرة أخرى.' : 'Dispensing transaction failed.');
    } finally {
      setDispensing(false);
    }
  };

  const openUnavailableResolution = (item, defaultReason = 'OUT_OF_STOCK') => {
    setUnavailableItem(item);
    setUnavailableReason(defaultReason);
    setUnavailableNote('');
    setUnavailableError('');
    setErrorMsg('');
  };

  const resolveUnavailable = async () => {
    if (!unavailableItem) return;
    try {
      setUnavailableSaving(true);
      setUnavailableError('');
      const response = await fetchWithAuth(`/api/records/prescribed-drugs/${unavailableItem.id}/unavailable`, {
        method: 'POST',
        body: JSON.stringify({ reason: unavailableReason, note: unavailableNote.trim() || null })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setUnavailableError(apiErrorMessage(payload, lang === 'ar' ? 'تعذر تسجيل تعذر الصرف.' : 'Unable to resolve the medication.'));
        return;
      }
      setUnavailableError('');
      setUnavailableItem(null);
      setSelectedRx(null);
      setPaymentState(null);
      setPaymentRefresh((value) => value + 1);
      setSuccessMsg(lang === 'ar' ? 'تم توثيق تعذر صرف الدواء دون خصم مخزون أو تحصيل قيمته.' : 'The medicine was recorded as unavailable without stock deduction or patient charge.');
      fetchPendingRx();
      fetchPrescriptionHistory();
    } catch {
      setUnavailableError(lang === 'ar' ? 'تعذر إكمال الإجراء.' : 'Unable to complete the action.');
    } finally {
      setUnavailableSaving(false);
    }
  };

  const alertModel = pharmacyAlertModel(alertMedicines || []);

  useStaffNav({
    items: [
      {
        id: 'dispensing',
        label: lang === 'ar' ? 'صرف الوصفات' : 'Dispensing',
        icon: Pill,
        count: prescriptions.length
      },
      {
        id: 'reviews',
        label: lang === 'ar' ? 'مراجعة الأدوية' : 'Medicine review',
        icon: ClipboardCheck,
        count: medicationReviews.length
      },
      {
        id: 'inventory',
        label: lang === 'ar' ? 'المخزون' : 'Inventory',
        icon: Package
      },
      {
        id: 'alerts',
        label: lang === 'ar' ? 'تنبيهات المخزون' : 'Stock alerts',
        icon: AlertTriangle,
        count: alertMedicines ? alertModel.totalAlertCount : null
      }
    ],
    activeId: activeSection,
    onSelect: setActiveSection,
    roleLabel: lang === 'ar' ? 'صيدلي' : 'Pharmacist'
  });

  const customNeedingReview = (selectedRx?.prescribedDrugs || []).find(
    (item) => !item.drug && customMedicineRequiresReview(item)
  );

  const selectedReviewItem = medicationReviews.find((item) => item.id === selectedReviewId) || medicationReviews[0] || null;

  return (
    <div className="pharmacy-workspace dashboard-wrapper">
      {/* Accessible tablist preserved for screen readers and unit tests */}
      <div className="sr-only" role="tablist" aria-label={lang === 'ar' ? 'أقسام الصيدلية' : 'Pharmacy sections'}>
        {[
          ['dispensing', lang === 'ar' ? 'صرف الوصفات' : 'Prescription Dispensing', prescriptions.length],
          ['inventory', lang === 'ar' ? 'الأدوية والمخزون' : 'Medicines & Inventory', null],
          ['alerts', lang === 'ar' ? 'التنبيهات' : 'Stock & Expiry Alerts', alertMedicines ? alertModel.totalAlertCount : null],
          ['reviews', lang === 'ar' ? 'طلبات الأدوية الجديدة' : 'Custom Medicine Review', medicationReviews.length]
        ].map(([id, label, count]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={activeSection === id}
            aria-controls={`pharmacy-section-${id}`}
            className={activeSection === id ? 'is-active' : ''}
            onClick={() => setActiveSection(id)}
          >
            <span>{label}</span>
            {count !== null && <span className="pharmacy-tab-count">{count}</span>}
          </button>
        ))}
      </div>

      {/* ── SECTION 1: DISPENSING (Pharmacy.dc.html) ─────────── */}
      {activeSection === 'dispensing' && (
        <div id="pharmacy-section-dispensing" role="tabpanel" className="pharmacy-split ui-split">
          {/* List column */}
          <section aria-labelledby="rx-list-title" className="pharmacy-split__list">
            <div className="pharmacy-list-header">
              <h2 id="rx-list-title" className="pharmacy-list-title ui-section-label">
                {lang === 'ar' ? 'الوصفات الطبية' : 'Prescriptions'}
              </h2>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={queueView === 'active' ? fetchPendingRx : fetchPrescriptionHistory}
              >
                <RefreshCw size={14} /> {lang === 'ar' ? 'تحديث' : 'Refresh'}
              </button>
            </div>

            <div role="group" aria-label={lang === 'ar' ? 'عرض الوصفات' : 'Prescription view'} className="pharmacy-segmented ui-segmented">
              <button
                type="button"
                aria-pressed={queueView === 'active'}
                className={`pharmacy-segmented__btn ${queueView === 'active' ? 'is-active' : ''}`}
                onClick={() => setQueueView('active')}
              >
                {lang === 'ar' ? `بانتظار الصرف · ${prescriptions.length}` : `To dispense · ${prescriptions.length}`}
              </button>
              <button
                type="button"
                aria-pressed={queueView === 'history'}
                className={`pharmacy-segmented__btn ${queueView === 'history' ? 'is-active' : ''}`}
                onClick={() => { setQueueView('history'); fetchPrescriptionHistory(); }}
              >
                {lang === 'ar' ? `السجل · ${prescriptionHistory.length}` : `Dispensed · ${prescriptionHistory.length}`}
                <span className="sr-only">History</span>
              </button>
            </div>

            <div className="pharmacy-list-items">
              {queueView === 'active' && prescriptionsLoadError && (
                <div role="alert" className="patient-alert error">
                  {lang === 'ar' ? 'تعذر تحميل القائمة. تحقق من الاتصال وحاول مرة أخرى.' : 'Could not load this list. Check the connection and try again.'} <button type="button" onClick={fetchPendingRx}>{lang === 'ar' ? 'إعادة المحاولة' : 'Retry'}</button>
                </div>
              )}
              {queueView === 'history' && historyLoadError && (
                <div role="alert" className="patient-alert error">
                  {lang === 'ar' ? 'تعذر تحميل القائمة. تحقق من الاتصال وحاول مرة أخرى.' : 'Could not load this list. Check the connection and try again.'} <button type="button" onClick={fetchPrescriptionHistory}>{lang === 'ar' ? 'إعادة المحاولة' : 'Retry'}</button>
                </div>
              )}
              {(queueView === 'active' ? prescriptions : prescriptionHistory).length === 0 ? (
                <div className="pharmacy-compact-empty">
                  <p className="pharmacy-empty-text">
                    {queueView === 'active'
                      ? (lang === 'ar' ? 'لا توجد وصفات بانتظار الصرف.' : 'No prescriptions are awaiting dispensing.')
                      : (lang === 'ar' ? 'لا توجد وصفات محفوظة في السجل.' : 'No prescription history is available.')}
                  </p>
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
          </section>

          {/* Detail column */}
          <section aria-labelledby="rx-title" className="pharmacy-split__detail">
            {selectedRx ? (
              <>
                <header className="pharmacy-detail-header ui-page-header">
                  <div>
                    <h1 id="rx-title" className="ui-page-title">
                      {lang === 'ar' ? selectedRx.patient.fullNameAr : selectedRx.patient.fullNameEn}
                    </h1>
                    <span className="pharmacy-detail-header__meta">
                      {lang === 'ar' ? 'وصف بواسطة د. ' : 'Prescribed by Dr. '}
                      {lang === 'ar' ? selectedRx.doctor.fullNameAr : selectedRx.doctor.fullNameEn}
                      {' · '}
                      <span className="pharmacy-detail-header__id ui-mono">
                        {selectedRx.prescriptionNumber || selectedRx.id}
                      </span>
                    </span>
                  </div>
                </header>

                {errorMsg && <div role="alert" className="pharmacy-alert-banner pharmacy-alert-banner--danger">{errorMsg}</div>}
                {successMsg && <div role="status" className="pharmacy-alert-banner pharmacy-alert-banner--success">{successMsg}</div>}

                {/* Items table */}
                <div className="pharmacy-table-panel ui-panel">
                  <div className="pharmacy-grid-table">
                    <div className="pharmacy-grid-table__header ui-section-label">
                      <span>{lang === 'ar' ? 'الدواء' : 'Medicine'}</span>
                      <span>{lang === 'ar' ? 'الكمية' : 'Qty'}</span>
                      <span>{lang === 'ar' ? 'الدفعة / المخزون' : 'Batch / Stock'}</span>
                      <span>{lang === 'ar' ? 'الحالة' : 'Status'}</span>
                    </div>
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
                  </div>
                </div>

                {/* Amber notice if item requires review */}
                {customNeedingReview && (
                  <div className="pharmacy-amber-notice">
                    <span>
                      <strong>{customNeedingReview.customDrugName} {lang === 'ar' ? 'دواء يدوي.' : 'is a custom medicine.'}</strong>{' '}
                      {lang === 'ar' ? 'قم بربطه بالمخزون أو توثيق تعذر الصرف قبل المتابعة.' : 'Link it to stock or mark it unavailable before dispensing.'}
                    </span>
                    <button type="button" onClick={() => openCustomMedicineReview(customNeedingReview)}>
                      {lang === 'ar' ? 'مراجعة الدواء' : 'Review medicine'}
                    </button>
                  </div>
                )}

                {/* Totals & Payment */}
                {queueView === 'active' && (
                  <PharmacyPayment
                    key={`${selectedRx.id}:${paymentRefresh}`}
                    prescriptionId={selectedRx.id}
                    lang={lang}
                    onStateChange={setPaymentState}
                  />
                )}

                {/* Dispense footer */}
                {queueView === 'active' && (
                  <div className="pharmacy-dispense-footer">
                    <span className="pharmacy-dispense-hint">
                      {paymentState?.dispensingAllowed
                        ? (lang === 'ar' ? 'تم استيفاء الدفع. الوصفة جاهزة للصرف.' : 'Invoice is fully paid. Prescription is ready to dispense.')
                        : (lang === 'ar' ? 'يتاح الصرف بعد سداد الفاتورة بالكامل واعتماد جميع الأدوية.' : 'Dispensing unlocks once the invoice is paid and every medicine is resolved.')}
                    </span>
                    <button
                      type="button"
                      className={`btn ${paymentState?.dispensingAllowed ? 'btn-primary' : 'btn-secondary'}`}
                      disabled={!paymentState?.dispensingAllowed || dispensing}
                      onClick={() => handleDispense(selectedRx)}
                    >
                      {dispensing
                        ? (lang === 'ar' ? 'جارٍ الصرف…' : 'Dispensing…')
                        : (lang === 'ar' ? 'صرف الوصفة الطبية' : 'Dispense prescription')}
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="pharmacy-compact-empty">
                <p className="pharmacy-empty-text">
                  {lang === 'ar'
                    ? 'اختر وصفة طبية من القائمة لعرض الأدوية والتحقق من المخزون.'
                    : 'Select a prescription to review medications and inventory availability.'}
                </p>
              </div>
            )}
          </section>
        </div>
      )}

      {/* ── SECTION 2: MEDICINE REVIEW (Split View) ─────────── */}
      {activeSection === 'reviews' && (
        <div id="pharmacy-section-reviews" role="tabpanel" className="pharmacy-split ui-split">
          {/* List column */}
          <section aria-labelledby="review-list-title" className="pharmacy-split__list">
            <div className="pharmacy-list-header">
              <h2 id="review-list-title" className="pharmacy-list-title ui-section-label">
                {lang === 'ar' ? 'طلبات الأدوية الجديدة' : 'Medicine review'}
              </h2>
              <span className="ui-mono" style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>
                {medicationReviews.length}
              </span>
            </div>

            <p className="pharmacy-cell-meta pharmacy-review-intro">
              {lang === 'ar'
                ? 'الأدوية التي كتبها الطبيب ولم يتم اعتمادها بعد من الصيدلية. يجب ربط الدواء بالمخزون أو إضافته كدواء غير نشط بانتظار تسعير المدير أو تحديده كدواء خارجي.'
                : 'Custom medicines entered by doctors must be reviewed before automatic billing. Link them to existing stock, create them for administrator pricing, or mark them for external purchase.'}
            </p>

            {reviewErrorMsg && (
              <div role="alert" className="pharmacy-alert-banner pharmacy-alert-banner--danger pharmacy-alert-banner--inset">
                {reviewErrorMsg}
              </div>
            )}
            {reviewSuccessMsg && (
              <div role="status" className="pharmacy-alert-banner pharmacy-alert-banner--success pharmacy-alert-banner--inset">
                {reviewSuccessMsg}
              </div>
            )}

            <div className="pharmacy-list-items">
              {medicationReviews.length === 0 ? (
                <div className="pharmacy-compact-empty">
                  <p className="pharmacy-empty-text">
                    {lang === 'ar'
                      ? 'لا توجد طلبات أدوية جديدة حالياً.'
                      : 'No medication requests awaiting review.'}
                  </p>
                </div>
              ) : (
                medicationReviews.map((item) => {
                  const patientName = lang === 'ar'
                    ? (item.patient?.fullNameAr || item.patient?.fullNameEn)
                    : (item.patient?.fullNameEn || item.patient?.fullNameAr);
                  const isSelected = selectedReviewItem?.id === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`pharmacy-queue-item ${isSelected ? 'is-selected' : ''}`}
                      onClick={() => setSelectedReviewId(item.id)}
                    >
                      <span className="pharmacy-queue-item__info">
                        <span className="pharmacy-queue-item__name">{item.customDrugName}</span>
                        <span className="pharmacy-cell-meta">{patientName}</span>
                        <span className="ui-status ui-status--warn">
                          {lang === 'ar' ? 'بانتظار المراجعة' : 'Awaiting review'}
                        </span>
                      </span>
                      <span className="pharmacy-queue-item__time ui-mono">
                        Qty: {item.qtyPrescribed}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </section>

          {/* Detail column */}
          <section aria-labelledby="review-detail-title" className="pharmacy-split__detail">
            {selectedReviewItem ? (
              <MedicationReviewCard
                key={selectedReviewItem.id}
                item={selectedReviewItem}
                lang={lang}
                form={reviewForms[selectedReviewItem.id] || {}}
                mode={reviewModeById[selectedReviewItem.id] || 'LINK_EXISTING'}
                drugCatalog={drugCatalog}
                saving={reviewSavingId === selectedReviewItem.id}
                onSetMode={(mode) => setReviewMode(selectedReviewItem, mode)}
                onFieldChange={(field, value) => updateReviewForm(selectedReviewItem.id, field, value)}
                onSubmit={(decision) => handleMedicationReview(selectedReviewItem, decision)}
              />
            ) : (
              <div className="pharmacy-compact-empty">
                <p className="pharmacy-empty-text">
                  {lang === 'ar'
                    ? 'اختر طلباً لمراجعته واعتماده.'
                    : 'Select a medication request to review and approve.'}
                </p>
              </div>
            )}
          </section>
        </div>
      )}

      {/* ── SECTION 3: INVENTORY (PharmacyInventory.dc.html) ── */}
      {activeSection === 'inventory' && (
        <div id="pharmacy-section-inventory" role="tabpanel">
          <PharmacyManagement
            lang={lang}
            refreshToken={managementRefresh}
            onInventoryChanged={loadAlertInventory}
          />
        </div>
      )}

      {/* ── SECTION 4: STOCK ALERTS ─────────────────────────── */}
      {activeSection === 'alerts' && (
        <div id="pharmacy-section-alerts" role="tabpanel" className="pharmacy-alerts-view">
          <header className="ui-page-header">
            <h1 className="ui-page-title">
              {lang === 'ar' ? 'تنبيهات المخازن والصلاحية' : 'Stock Alerts & Expiry'}
            </h1>
            <button type="button" className="btn btn-secondary" onClick={loadAlertInventory}>
              <RefreshCw size={15} /> {lang === 'ar' ? 'تحديث' : 'Refresh'}
            </button>
          </header>
          <PharmacyAlertsBody
            lang={lang}
            alertLoadError={alertLoadError}
            alertMedicines={alertMedicines}
            alertModel={alertModel}
            onRetry={loadAlertInventory}
          />
        </div>
      )}

      {/* ── DIALOGS ─────────────────────────────────────────── */}
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
          <button type="button" className="btn btn-secondary" onClick={() => chooseReviewDecision('CREATE_FORMULARY')}>
            {lang === 'ar' ? 'إضافة كدواء جديد' : 'Create Formulary Medicine'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => chooseReviewDecision('EXTERNAL')}>
            {lang === 'ar' ? 'دواء خارجي' : 'External Medication'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => setReviewDialogItem(null)}>
            {lang === 'ar' ? 'إلغاء' : 'Cancel'}
          </button>
        </div>
      </Dialog>

      <Dialog
        open={Boolean(unavailableItem)}
        title={lang === 'ar' ? 'تعذر الصرف' : 'Unable to Dispense'}
        description={unavailableItem ? (unavailableItem.drug ? (lang === 'ar' ? unavailableItem.drug.labelAr : unavailableItem.drug.labelEn) : unavailableItem.customDrugName) : ''}
        onClose={() => { if (!unavailableSaving) { setUnavailableItem(null); setUnavailableError(''); } }}
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
          <p className="form-help">
            {lang === 'ar'
              ? 'لن يُسجل الدواء كمصروف، ولن يُخصم من المخزون أو تُحصّل قيمته.'
              : 'The item will not be marked dispensed, deducted from stock, or charged.'}
          </p>
          {unavailableError && <div role="alert" className="patient-alert error">{unavailableError}</div>}
          <div className="dialog-actions">
            <button type="button" className="btn btn-danger" disabled={unavailableSaving} onClick={resolveUnavailable}>
              {unavailableSaving ? (lang === 'ar' ? 'جارٍ الحفظ…' : 'Saving…') : (lang === 'ar' ? 'تأكيد تعذر الصرف' : 'Confirm Unable to Dispense')}
            </button>
            <button type="button" className="btn btn-secondary" disabled={unavailableSaving} onClick={() => { setUnavailableItem(null); setUnavailableError(''); }}>
              {lang === 'ar' ? 'إلغاء' : 'Cancel'}
            </button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
