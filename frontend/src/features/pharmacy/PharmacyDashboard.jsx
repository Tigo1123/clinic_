import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, FileText, HelpCircle, Sliders, Stethoscope } from 'lucide-react';
import { apiErrorMessage, fetchWithAuth } from '../../services/staffApi';
import RoleHero from '../../components/healthcare/RoleHero';
import { clinicDateString } from '../../utils/clinicTime';
import PharmacyManagement from './PharmacyManagement';
import PharmacyPayment from './PharmacyPayment';
import Dialog from '../../components/ui/Dialog';
import { authoritativeStockSummary, buildMedicationReviewPayload, customMedicineRequiresReview, localizedStockState, pharmacyInventoryAlert, stockPresentation } from '../../utils/pharmacyManagement';

export default function PharmacyDashboard({ lang, t: _t }) {
  const [prescriptions, setPrescriptions] = useState([]);
  const [selectedRx, setSelectedRx] = useState(null);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [paymentState, setPaymentState] = useState(null);
  const [managementRefresh, setManagementRefresh] = useState(0);
  const [paymentRefresh, setPaymentRefresh] = useState(0);
  const [dispensing, setDispensing] = useState(false);
  const [activeSection, setActiveSection] = useState('dispensing');

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
  const reviewSectionRef = useRef(null);

  const fetchMedicationReviews = () => {
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
  };

  const fetchPendingRx = () => {
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
  };

  useEffect(() => {
    fetchPendingRx();
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
  }, []);

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

  const getUsableStock = (drug) => {
    const today = clinicDateString();

    return (Array.isArray(drug.inventoryBatches)
      ? drug.inventoryBatches
      : []
    )
      .filter(
        (batch) =>
          Number(batch.qtyOnHand) > 0 &&
          batch.expiryDate >= today
      )
      .reduce(
        (total, batch) =>
          total + Number(batch.qtyOnHand || 0),
        0
      );
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

  const inventoryAlerts = Object.values(selectedStock).filter(Boolean).map((medicine) => {
    const alert = pharmacyInventoryAlert(medicine);
    return {
      ...medicine,
      totalUsableStock: alert.usableStock,
      reorderLevel: alert.lowStockBatchCount,
      expiredBatchCount: alert.expiredBatchCount,
      isOutOfStock: ['OUT_OF_STOCK', 'EXPIRED'].includes(alert.state),
      isLowStock: alert.state === 'LOW_STOCK',
      expiringSoonBatches: []
    };
  }).filter((medicine) => medicine.isOutOfStock || medicine.isLowStock || medicine.expiredBatchCount > 0);

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
            ['alerts', lang === 'ar' ? 'التنبيهات' : 'Stock & Expiry Alerts', inventoryAlerts.length],
            ['reviews', lang === 'ar' ? 'طلبات الأدوية الجديدة' : 'Custom Medicine Review', medicationReviews.length]
          ].map(([id, label, count]) => <button key={id} type="button" role="tab" aria-selected={activeSection === id} aria-controls={`pharmacy-section-${id}`} className={activeSection === id ? 'is-active' : ''} onClick={() => setActiveSection(id)}><span>{label}</span>{count !== null && <span className="pharmacy-tab-count">{count}</span>}</button>)}
        </div>

        {activeSection === 'inventory' && <div id="pharmacy-section-inventory" role="tabpanel"><PharmacyManagement lang={lang} refreshToken={managementRefresh} /></div>}

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
              {medicationReviews.map((item) => {
                const form =
                  reviewForms[item.id] || {};

                const mode =
                  reviewModeById[item.id] || '';

                const remainingQty =
                  Number(item.qtyPrescribed || 0) -
                  Number(item.qtyDispensed || 0);

                const selectedExistingDrug =
                  drugCatalog.find(
                    (drug) =>
                      drug.id === form.drugId
                  );

                const selectedStock =
                  selectedExistingDrug
                    ? getUsableStock(
                        selectedExistingDrug
                      )
                    : 0;

                const tomorrow = (() => {
                  const today =
                    clinicDateString();

                  const date =
                    new Date(
                      `${today}T00:00:00Z`
                    );

                  date.setUTCDate(
                    date.getUTCDate() + 1
                  );

                  return date
                    .toISOString()
                    .slice(0, 10);
                })();

                return (
                  <div
                    key={item.id}
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
                          setReviewMode(
                            item,
                            'LINK_EXISTING'
                          )
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
                          setReviewMode(
                            item,
                            'CREATE_FORMULARY'
                          )
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
                          setReviewMode(
                            item,
                            'EXTERNAL'
                          )
                        }
                      >
                        {lang === 'ar'
                          ? 'دواء خارجي'
                          : 'External'}
                      </button>
                    </div>

                    {mode === 'LINK_EXISTING' && (
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
                            updateReviewForm(
                              item.id,
                              'drugId',
                              event.target.value
                            )
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
                            updateReviewForm(
                              item.id,
                              'note',
                              event.target.value
                            )
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
                            reviewSavingId ===
                            item.id
                          }
                          onClick={() =>
                            handleMedicationReview(
                              item,
                              'LINK_EXISTING'
                            )
                          }
                          style={{
                            marginTop: '0.7rem'
                          }}
                        >
                          {reviewSavingId ===
                          item.id
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
                    )}

                    {mode === 'CREATE_FORMULARY' && (
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
                              item.customDrugName ??
                              ''
                            }
                            onChange={(event) =>
                              updateReviewForm(
                                item.id,
                                'labelEn',
                                event.target.value
                              )
                            }
                            placeholder="English name"
                          />

                          <input
                            value={
                              form.labelAr || ''
                            }
                            onChange={(event) =>
                              updateReviewForm(
                                item.id,
                                'labelAr',
                                event.target.value
                              )
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
                              updateReviewForm(
                                item.id,
                                'genericName',
                                event.target.value
                              )
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
                              updateReviewForm(
                                item.id,
                                'strength',
                                event.target.value
                              )
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
                              updateReviewForm(
                                item.id,
                                'dosageForm',
                                event.target.value
                              )
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
                              updateReviewForm(
                                item.id,
                                'batchNumber',
                                event.target.value
                              )
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
                              updateReviewForm(
                                item.id,
                                'expiryDate',
                                event.target.value
                              )
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
                              updateReviewForm(
                                item.id,
                                'qtyOnHand',
                                event.target.value
                              )
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
                              updateReviewForm(
                                item.id,
                                'minReorderLevel',
                                event.target.value
                              )
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
                            updateReviewForm(
                              item.id,
                              'note',
                              event.target.value
                            )
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
                            reviewSavingId ===
                            item.id
                          }
                          onClick={() =>
                            handleMedicationReview(
                              item,
                              'CREATE_FORMULARY'
                            )
                          }
                          style={{
                            marginTop: '0.7rem'
                          }}
                        >
                          {reviewSavingId ===
                          item.id
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
                    )}

                    {mode === 'EXTERNAL' && (
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
                            updateReviewForm(
                              item.id,
                              'note',
                              event.target.value
                            )
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
                            reviewSavingId ===
                            item.id
                          }
                          onClick={() =>
                            handleMedicationReview(
                              item,
                              'EXTERNAL'
                            )
                          }
                          style={{
                            marginTop: '0.7rem'
                          }}
                        >
                          {reviewSavingId ===
                          item.id
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
                    )}
                  </div>
                );
              })}
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
                onClick={fetchPendingRx}
              >
                {lang === 'ar' ? 'تحديث' : 'Refresh'}
              </button>
            </div>
            {prescriptions.length === 0 ? (
              <div className="pharmacy-compact-empty">
                <HelpCircle size={24} />
                <p>{lang === 'ar' ? 'لا توجد وصفات بانتظار الصرف.' : 'No prescriptions are awaiting dispensing.'}</p>
              </div>
            ) : (
              prescriptions.map((rx) => (
                <div
                  key={rx.id}
                  className={`queue-card-item glass-panel ${selectedRx?.id === rx.id ? 'selected' : ''}`}
                  onClick={() => { setSelectedRx(rx); setPaymentState(null); }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      gap: '0.75rem'
                    }}
                  >
                    <strong>
                      {lang === 'ar'
                        ? rx.patient.fullNameAr
                        : rx.patient.fullNameEn}
                    </strong>

                    <span
                      className={`badge ${
                        rx.billingStatus === 'PAID'
                          ? 'badge-success'
                          : 'badge-warning'
                      }`}
                      style={{
                        fontSize: '0.68rem',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {rx.billingStatus === 'PAID'
                        ? (lang === 'ar' ? 'مدفوع' : 'PAID')
                        : rx.billingStatus === 'PARTIALLY_PAID'
                          ? (lang === 'ar' ? 'مدفوع جزئياً' : 'PARTIAL')
                          : rx.billingStatus === 'UNPAID'
                            ? (lang === 'ar' ? 'غير مدفوع' : 'UNPAID')
                            : (lang === 'ar' ? 'غير مفوتر' : 'UNBILLED')}
                    </span>
                  </div>

                  <div
                    style={{
                      marginTop: '0.55rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.3rem'
                    }}
                  >
                    {(rx.prescribedDrugs || []).map((item) => {
                      const remainingQty = Math.max(
                        0,
                        Number(item.qtyPrescribed || 0) -
                          Number(item.qtyDispensed || 0)
                      );

                      const drugName = item.drug
                        ? (
                            lang === 'ar'
                              ? item.drug.labelAr
                              : item.drug.labelEn
                          )
                        : item.customDrugName;

                      return (
                        <div
                          key={item.id}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: '0.5rem',
                            fontSize: '0.8rem'
                          }}
                        >
                          <span>
                            {drugName ||
                              (lang === 'ar'
                                ? 'دواء غير مسمى'
                                : 'Unnamed medication')}
                          </span>

                          <span
                            style={{
                              fontWeight: 600,
                              color: 'var(--primary)'
                            }}
                          >
                            {lang === 'ar' ? 'المتبقي:' : 'Remaining:'}{' '}
                            {remainingQty}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  <div
                    style={{
                      fontSize: '0.74rem',
                      color: 'var(--text-secondary)',
                      marginTop: '0.55rem'
                    }}
                  >
                    {new Date(rx.prescriptionDate).toLocaleString(
                      lang === 'ar' ? 'ar-SD' : 'en-GB',
                      {
                        dateStyle: 'medium',
                        timeStyle: 'short'
                      }
                    )}
                  </div>
                </div>
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

                <PharmacyPayment key={`${selectedRx.id}:${paymentRefresh}`} prescriptionId={selectedRx.id} lang={lang} onStateChange={setPaymentState} />

                {selectedRx.prescribedDrugs.map((item) => {
                  const isCustom = !item.drug;
                  const requiresReview = customMedicineRequiresReview(item);

                  if (isCustom) {
                    return (
                      <div
                        key={item.id}
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

                          <span className="badge badge-warning" style={{ fontSize: '0.7rem' }}>
                            {lang === 'ar' ? 'غير مرتبط بالمخزون' : 'Not linked to inventory'}
                          </span>
                        </div>

                        <div style={{ fontSize: '0.75rem', color: 'var(--warning)', marginTop: '0.5rem' }}>
                          {lang === 'ar'
                            ? 'هذا الدواء تمت كتابته يدويًا بواسطة الطبيب ولن يتم خصمه تلقائيًا من مخزون العيادة.'
                            : 'This medication was entered manually by the doctor and will not be deducted automatically from clinic inventory.'}
                        </div>
                        {requiresReview && (
                          <button
                            type="button"
                            className="btn btn-primary"
                            style={{ marginTop: '0.75rem', width: '100%' }}
                            onClick={() => openCustomMedicineReview(item)}
                          >
                            {lang === 'ar' ? 'مراجعة الدواء' : 'Review Medication'}
                          </button>
                        )}
                      </div>
                    );
                  }

                  const authoritativeMedicine = selectedStock[item.drugId || item.drug.id];
                  const stock = authoritativeStockSummary(authoritativeMedicine || {});
                  const stockState = authoritativeMedicine ? stockPresentation(stock) : null;
                  const isInsufficient = authoritativeMedicine && stock.usableStock < item.qtyPrescribed;
                  const badgeTone = !authoritativeMedicine || isInsufficient || ['OUT_OF_STOCK', 'EXPIRED'].includes(stockState) ? 'danger' : ['LOW_STOCK', 'NEAR_EXPIRY'].includes(stockState) ? 'warning' : 'success';

                  return (
                    <div
                      key={item.id}
                      className="glass-panel"
                      style={{
                        padding: '0.75rem',
                        marginBottom: '0.5rem',
                        fontSize: '0.9rem',
                        borderLeft:
                          !authoritativeMedicine || isInsufficient || ['OUT_OF_STOCK', 'EXPIRED'].includes(stockState)
                            ? '3px solid var(--danger)'
                            : ['LOW_STOCK', 'NEAR_EXPIRY'].includes(stockState)
                              ? '3px solid var(--warning)'
                              : '3px solid var(--success)'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <strong>{lang === 'ar' ? item.drug.labelAr : item.drug.labelEn}</strong>
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
                          alignItems: 'center'
                        }}
                      >
                        <span>
                          Dosage: {item.dosage} | Duration: {item.duration}
                        </span>

                        <span className={`badge badge-${badgeTone}`} style={{ fontSize: '0.7rem' }}>
                          {!authoritativeMedicine ? (lang === 'ar' ? 'جارٍ التحقق من المخزون' : 'Checking stock') : isInsufficient ? (lang === 'ar' ? `غير كافٍ (${stock.usableStock})` : `Insufficient (${stock.usableStock})`) : `${localizedStockState(stockState, lang)} (${stock.usableStock})`}
                        </span>
                      </div>

                      <div
                        style={{
                          fontSize: '0.75rem',
                          color: 'var(--warning)',
                          marginTop: '0.5rem'
                        }}
                      >
                        {lang === 'ar' ? 'أقرب صلاحية سارية: ' : 'Nearest unexpired expiry: '}{stock.nearestUnexpiredExpiry || '—'}
                      </div>
                    </div>
                  );
                })}

                <button
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
                </button>
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
            </div>
            {inventoryAlerts.length === 0 ? (
              <div className="pharmacy-compact-empty">
                <p>
                  {lang === 'ar'
                    ? 'لا توجد تنبيهات مخزون أو صلاحية حالياً.'
                    : 'There are no inventory or expiry alerts at this time.'}
                </p>
              </div>
            ) : (
              inventoryAlerts.map((drug) => (
                <div
                  key={drug.id}
                  className="glass-panel"
                  style={{
                    padding: '0.85rem',
                    marginBottom: '0.65rem',
                    fontSize: '0.85rem',
                    borderLeft: drug.isOutOfStock
                      ? '4px solid var(--danger)'
                      : '4px solid var(--warning)',
                    background: drug.isOutOfStock
                      ? 'rgba(239, 68, 68, 0.05)'
                      : 'rgba(245, 158, 11, 0.05)'
                  }}
                >
                  <strong>
                    {lang === 'ar'
                      ? drug.labelAr
                      : drug.labelEn}
                  </strong>

                  <div
                    style={{
                      display: 'grid',
                      gap: '0.4rem',
                      marginTop: '0.6rem'
                    }}
                  >
                    {drug.isOutOfStock && (
                      <div className="badge badge-danger">
                        {lang === 'ar'
                          ? 'نفد المخزون القابل للصرف'
                          : 'No usable stock available'}
                      </div>
                    )}

                    {drug.isLowStock && (
                      <div className="badge badge-warning">
                        {lang === 'ar'
                          ? `مخزون منخفض: ${drug.totalUsableStock} متوفر — دفعات منخفضة ${drug.reorderLevel}`
                          : `Low stock: ${drug.totalUsableStock} available — low-stock batches ${drug.reorderLevel}`}
                      </div>
                    )}

                    {!drug.isOutOfStock && !drug.isLowStock && (
                      <div style={{ color: 'var(--text-secondary)' }}>
                        {lang === 'ar'
                          ? `المخزون الصالح للصرف: ${drug.totalUsableStock}`
                          : `Usable stock: ${drug.totalUsableStock}`}
                      </div>
                    )}

                    {drug.expiredBatchCount > 0 && (
                      <div className="badge badge-danger" style={{ display: 'block', whiteSpace: 'normal' }}>
                        {lang === 'ar'
                          ? `يوجد ${drug.expiredBatchCount} دفعة منتهية الصلاحية لهذا الدواء`
                          : `This medicine has ${drug.expiredBatchCount} expired batches`}
                      </div>
                    )}

                    {drug.expiringSoonBatches.map((batch) => (
                      <div
                        key={`soon-${batch.id}`}
                        className="badge badge-warning"
                        style={{
                          display: 'block',
                          whiteSpace: 'normal'
                        }}
                      >
                        {lang === 'ar'
                          ? `قريب الانتهاء — التشغيلة ${batch.batchNumber} — تنتهي ${batch.expiryDate} — الكمية ${batch.qtyOnHand}`
                          : `Expiring soon — Batch ${batch.batchNumber} — Expires ${batch.expiryDate} — Qty ${batch.qtyOnHand}`}
                      </div>
                    ))}

                  </div>
                </div>
              ))
            )}
          </div>
        </div>}
      </div>
    </div>
  );
}

/* ==========================================
   5. LAB TECHNICIAN DASHBOARD
   ========================================== */
