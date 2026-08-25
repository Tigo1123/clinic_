import { useEffect, useState } from 'react';
import { AlertTriangle, FileText, HelpCircle, Sliders, Stethoscope } from 'lucide-react';
import { apiErrorMessage, fetchWithAuth } from '../../services/staffApi';
import RoleHero from '../../components/healthcare/RoleHero';
import { clinicDateString } from '../../utils/clinicTime';
import PharmacyManagement from './PharmacyManagement';
import PharmacyPayment from './PharmacyPayment';

export default function PharmacyDashboard({ lang, t }) {
  const [prescriptions, setPrescriptions] = useState([]);
  const [selectedRx, setSelectedRx] = useState(null);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [paymentState, setPaymentState] = useState(null);
  const [managementRefresh, setManagementRefresh] = useState(0);
  const [dispensing, setDispensing] = useState(false);

  // Inventory warnings
  const [inventoryAlerts, setInventoryAlerts] = useState([]);

  // Read-only formulary pricing; official prices are configured by ADMIN.
  const [drugCatalog, setDrugCatalog] = useState([]);

  // Custom medications awaiting pharmacist review
  const [medicationReviews, setMedicationReviews] = useState([]);
  const [reviewModeById, setReviewModeById] = useState({});
  const [reviewForms, setReviewForms] = useState({});
  const [reviewSavingId, setReviewSavingId] = useState(null);
  const [reviewSuccessMsg, setReviewSuccessMsg] = useState('');
  const [reviewErrorMsg, setReviewErrorMsg] = useState('');

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
      .catch((error) => {
        console.error(error);
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
      .catch((err) => {
        console.error(err);
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

          const today = clinicDateString();

          const expiryCutoff = new Date(`${today}T00:00:00Z`);
          expiryCutoff.setUTCDate(expiryCutoff.getUTCDate() + 30);
          const expiryCutoffDate = expiryCutoff.toISOString().slice(0, 10);

          const alerts = data
            .map((drug) => {
              const batches = Array.isArray(drug.inventoryBatches)
                ? drug.inventoryBatches
                : [];

              // A batch is usable only when it has stock and has not expired.
              // This intentionally matches the current pharmacy dispensing rule.
              const usableBatches = batches.filter(
                (batch) =>
                  Number(batch.qtyOnHand) > 0 &&
                  batch.expiryDate >= today
              );

              const totalUsableStock = usableBatches.reduce(
                (sum, batch) => sum + Number(batch.qtyOnHand || 0),
                0
              );

              const reorderLevel = batches.length
                ? Math.max(
                    ...batches.map((batch) =>
                      Number(batch.minReorderLevel || 0)
                    )
                  )
                : 0;

              const expiredBatches = batches.filter(
                (batch) =>
                  Number(batch.qtyOnHand) > 0 &&
                  batch.expiryDate < today
              );

              const expiringSoonBatches = batches
                .filter(
                  (batch) =>
                    Number(batch.qtyOnHand) > 0 &&
                    batch.expiryDate >= today &&
                    batch.expiryDate <= expiryCutoffDate
                )
                .sort((a, b) =>
                  a.expiryDate.localeCompare(b.expiryDate)
                );

              const isOutOfStock = totalUsableStock === 0;

              const isLowStock =
                totalUsableStock > 0 &&
                totalUsableStock <= reorderLevel;

              const hasExpiryAlert =
                expiredBatches.length > 0 ||
                expiringSoonBatches.length > 0;

              if (!isOutOfStock && !isLowStock && !hasExpiryAlert) {
                return null;
              }

              return {
                ...drug,
                totalUsableStock,
                reorderLevel,
                isOutOfStock,
                isLowStock,
                expiredBatches,
                expiringSoonBatches
              };
            })
            .filter(Boolean);

          setInventoryAlerts(alerts);
        } else {
          setDrugCatalog([]);
          setInventoryAlerts([]);
        }
      })
      .catch((err) => {
        console.error(err);
        setDrugCatalog([]);
        setInventoryAlerts([]);
      });
  }, []);

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

    const body = {
      decision,
      note:
        typeof form.note === 'string'
          ? form.note.trim()
          : ''
    };

    if (decision === 'LINK_EXISTING') {
      if (!form.drugId) {
        setReviewErrorMsg(
          lang === 'ar'
            ? 'اختر دواءً من قائمة الصيدلية أولاً.'
            : 'Select an existing formulary medication first.'
        );
        return;
      }

      body.drugId = form.drugId;
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

      body.formulary = {
        labelEn:
          form.labelEn?.trim() ||
          item.customDrugName,
        labelAr:
          form.labelAr?.trim() ||
          form.labelEn?.trim() ||
          item.customDrugName,
        genericName: form.genericName.trim(),
        strength: form.strength.trim(),
        dosageForm: form.dosageForm.trim()
      };

      body.inventory = {
        batchNumber: form.batchNumber.trim(),
        expiryDate: form.expiryDate,
        qtyOnHand,
        minReorderLevel
      };
    }

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

      fetchPendingRx();

      setReviewSuccessMsg(
        decision === 'EXTERNAL'
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
    } catch (error) {
      console.error(error);

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
    } catch (e) {
      console.error(e);
      setErrorMsg('Dispensing transaction failed.');
    } finally {
      setDispensing(false);
    }
  };

  return (
    <div className="dashboard-wrapper">
      <div className="workspace-panel" style={{ padding: '1rem' }}>
        <RoleHero role="pharmacy" lang={lang}/>

        <PharmacyManagement lang={lang} refreshToken={managementRefresh} />

        <div
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
              ? 'الأدوية التي كتبها الطبيب ولم يتم اعتمادها بعد من الصيدلية. يجب ربط الدواء بالمخزون أو إضافته وتسعيره أو تحديده كدواء خارجي.'
              : 'Custom medicines entered by doctors must be reviewed before reception billing. Link them to existing stock, create and stock them, or mark them for external purchase.'}
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
                          ? 'إضافة وتسعير ومخزون'
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
                            ? 'إنشاء دواء جديد وإدخال المخزون'
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
                                  ? 'إنشاء وإضافة المخزون واعتماد'
                                  : 'Create, Stock & Approve'
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
                            ? 'لن يتم إدخال هذا الدواء في فاتورة صيدلية العيادة، وسيشتريه المريض من الخارج.'
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
        </div>

        <div
          className="glass-panel"
          style={{
            padding: '1rem',
            marginBottom: '1rem'
          }}
        >
          <div className="panel-header">
            <span className="panel-title">
              {lang === 'ar'
                ? 'أسعار الأدوية الرسمية'
                : 'Official Medication Prices'}
            </span>
          </div>

          <p
            style={{
              fontSize: '0.82rem',
              color: 'var(--text-secondary)',
              marginBottom: '1rem'
            }}
          >
            {lang === 'ar'
              ? 'يمكن للصيدلي عرض الأسعار الرسمية. يحدد المسؤول الأسعار ويعتمد الأدوية الجديدة للفوترة.'
              : 'Pharmacists can view official prices. Administrators price and activate new medicines for billing.'}
          </p>

          {drugCatalog.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '1.5rem',
                color: 'var(--text-secondary)'
              }}
            >
              {lang === 'ar'
                ? 'لا توجد أدوية متاحة.'
                : 'No medications available.'}
            </div>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns:
                  'repeat(auto-fit, minmax(260px, 1fr))',
                gap: '0.75rem'
              }}
            >
              {[...drugCatalog]
                .sort((a, b) => {
                  const aMissing =
                    a.unitPriceSdg == null ||
                    Number(a.unitPriceSdg) <= 0;

                  const bMissing =
                    b.unitPriceSdg == null ||
                    Number(b.unitPriceSdg) <= 0;

                  if (aMissing !== bMissing) {
                    return aMissing ? -1 : 1;
                  }

                  return String(a.labelEn || '').localeCompare(
                    String(b.labelEn || '')
                  );
                })
                .map((drug) => {
                  const currentPrice =
                    drug.unitPriceSdg == null
                      ? null
                      : Number(drug.unitPriceSdg);

                  const hasValidPrice =
                    Number.isFinite(currentPrice) &&
                    currentPrice > 0;

                  return (
                    <div
                      key={drug.id}
                      className="glass-panel"
                      style={{
                        padding: '0.85rem',
                        borderLeft: hasValidPrice
                          ? '4px solid var(--success)'
                          : '4px solid var(--warning)'
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          gap: '0.5rem',
                          alignItems: 'flex-start'
                        }}
                      >
                        <div>
                          <strong>
                            {lang === 'ar'
                              ? drug.labelAr
                              : drug.labelEn}
                          </strong>

                          <div
                            style={{
                              fontSize: '0.75rem',
                              color: 'var(--text-secondary)',
                              marginTop: '0.2rem'
                            }}
                          >
                            {[drug.strength, drug.dosageForm]
                              .filter(Boolean)
                              .join(' • ')}
                          </div>
                        </div>

                        <span
                          className={`badge ${
                            hasValidPrice
                              ? 'badge-success'
                              : 'badge-warning'
                          }`}
                          style={{
                            fontSize: '0.68rem',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          {hasValidPrice
                            ? (lang === 'ar'
                                ? 'سعر معتمد'
                                : 'PRICED')
                            : (lang === 'ar'
                                ? 'السعر مطلوب'
                                : 'PRICE REQUIRED')}
                        </span>
                      </div>

                      <div
                        style={{
                          marginTop: '0.75rem',
                          fontSize: '0.8rem',
                          color: 'var(--text-secondary)'
                        }}
                      >
                        {lang === 'ar'
                          ? 'السعر الحالي:'
                          : 'Current price:'}{' '}

                        <strong
                          style={{
                            color: 'var(--text-primary)'
                          }}
                        >
                          {hasValidPrice
                            ? `${currentPrice.toLocaleString(
                                lang === 'ar'
                                  ? 'ar-SD'
                                  : 'en-US'
                              )} SDG`
                            : (lang === 'ar'
                                ? 'غير محدد'
                                : 'Not set')}
                        </strong>
                      </div>

                    </div>
                  );
                })}
            </div>
          )}
        </div>

        <div className="panel-grid">
          {/* COLUMN 1: ACTIVE RX QUEUE */}
          <div className="panel-column glass-panel" style={{ padding: '1rem' }}>
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
              <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
                <HelpCircle size={36} />
                <p style={{ marginTop: '0.5rem' }}>{t('pharmacyQueueEmpty')}</p>
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
          <div className="panel-column glass-panel" style={{ padding: '1rem' }}>
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

                <PharmacyPayment key={selectedRx.id} prescriptionId={selectedRx.id} lang={lang} onStateChange={setPaymentState} />

                {selectedRx.prescribedDrugs.map((item) => {
                  const isCustom = !item.drug;

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
                      </div>
                    );
                  }

                  const qtyOnHand =
                    item.drug.inventoryBatches?.reduce(
                      (sum, b) => sum + (b.qtyOnHand || 0),
                      0
                    ) || 0;

                  const isOutOfStock = qtyOnHand === 0;
                  const isInsufficient = qtyOnHand < item.qtyPrescribed;
                  const isLowStock = qtyOnHand < 25;

                  return (
                    <div
                      key={item.id}
                      className="glass-panel"
                      style={{
                        padding: '0.75rem',
                        marginBottom: '0.5rem',
                        fontSize: '0.9rem',
                        borderLeft:
                          isOutOfStock || isInsufficient
                            ? '3px solid var(--danger)'
                            : isLowStock
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

                        {isOutOfStock ? (
                          <span className="badge badge-danger" style={{ fontSize: '0.7rem' }}>
                            {lang === 'ar' ? 'غير متوفر' : 'Out of stock'}
                          </span>
                        ) : isInsufficient ? (
                          <span className="badge badge-danger" style={{ fontSize: '0.7rem' }}>
                            {lang === 'ar' ? 'غير كافٍ' : `Insufficient (${qtyOnHand})`}
                          </span>
                        ) : isLowStock ? (
                          <span className="badge badge-warning" style={{ fontSize: '0.7rem' }}>
                            {lang === 'ar'
      ? `مخزون منخفض (${qtyOnHand} متوفر)`
      : `Low stock (${qtyOnHand} available)`}
                          </span>
                        ) : (
                          <span className="badge badge-success" style={{ fontSize: '0.7rem' }}>
                            {lang === 'ar' ? 'متوفر' : `In Stock (${qtyOnHand})`}
                          </span>
                        )}
                      </div>

                      <div
                        style={{
                          fontSize: '0.75rem',
                          color: 'var(--warning)',
                          marginTop: '0.5rem'
                        }}
                      >
                        FEFO: Batch{' '}
                        {[...(item.drug.inventoryBatches || [])]
                          .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate))[0]
                          ?.batchNumber || 'N/A'}{' '}
                        (Exp:{' '}
                        {[...(item.drug.inventoryBatches || [])]
                          .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate))[0]
                          ?.expiryDate || 'N/A'}
                        )
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
              <div style={{ textAlign: 'center', padding: '5rem', color: 'var(--text-secondary)' }}>
                <Stethoscope size={64} />
                <p style={{ marginTop: '1rem' }}>{lang === 'ar'
      ? 'اختر وصفة طبية من القائمة لعرض الأدوية والتحقق من المخزون.'
      : 'Select a prescription to review medications and inventory availability.'}</p>
              </div>
            )}
          </div>

          {/* COLUMN 3: ALERTS & INVENTORY */}
          <div className="panel-column glass-panel" style={{ padding: '1rem' }}>
            <div className="panel-header">
              <span className="panel-title">
                <AlertTriangle size={18} color="var(--warning)" />
                {lang === 'ar' ? 'تنبيهات المخازن والصلاحية' : 'Stock Alerts & Expiry'}
              </span>
            </div>
            {inventoryAlerts.length === 0 ? (
              <div
                style={{
                  textAlign: 'center',
                  padding: '2rem',
                  color: 'var(--text-secondary)'
                }}
              >
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
                          ? `مخزون منخفض: ${drug.totalUsableStock} متوفر — حد إعادة الطلب ${drug.reorderLevel}`
                          : `Low stock: ${drug.totalUsableStock} available — reorder level ${drug.reorderLevel}`}
                      </div>
                    )}

                    {!drug.isOutOfStock && !drug.isLowStock && (
                      <div style={{ color: 'var(--text-secondary)' }}>
                        {lang === 'ar'
                          ? `المخزون الصالح للصرف: ${drug.totalUsableStock}`
                          : `Usable stock: ${drug.totalUsableStock}`}
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

                    {drug.expiredBatches.map((batch) => (
                      <div
                        key={`expired-${batch.id}`}
                        className="badge badge-danger"
                        style={{
                          display: 'block',
                          whiteSpace: 'normal'
                        }}
                      >
                        {lang === 'ar'
                          ? `منتهي الصلاحية — التشغيلة ${batch.batchNumber} — انتهت ${batch.expiryDate} — الكمية ${batch.qtyOnHand}`
                          : `Expired — Batch ${batch.batchNumber} — Expired ${batch.expiryDate} — Qty ${batch.qtyOnHand}`}
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ==========================================
   5. LAB TECHNICIAN DASHBOARD
   ========================================== */
