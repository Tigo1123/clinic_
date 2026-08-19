import { useEffect, useState } from 'react';
import { AlertTriangle, FileText, HelpCircle, Sliders, Stethoscope } from 'lucide-react';
import { apiErrorMessage, fetchWithAuth } from '../../services/staffApi';
import RoleHero from '../../components/healthcare/RoleHero';
import { clinicDateString } from '../../utils/clinicTime';

export default function PharmacyDashboard({ lang, t }) {
  const [prescriptions, setPrescriptions] = useState([]);
  const [selectedRx, setSelectedRx] = useState(null);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Inventory warnings
  const [inventoryAlerts, setInventoryAlerts] = useState([]);

  // Pharmacist-only medication pricing
  const [drugCatalog, setDrugCatalog] = useState([]);
  const [priceDrafts, setPriceDrafts] = useState({});
  const [priceSavingId, setPriceSavingId] = useState(null);
  const [pricingSuccessMsg, setPricingSuccessMsg] = useState('');
  const [pricingErrorMsg, setPricingErrorMsg] = useState('');

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

  const handlePriceUpdate = async (drug) => {
    setPricingErrorMsg('');
    setPricingSuccessMsg('');

    const draftValue =
      priceDrafts[drug.id] ??
      (drug.unitPriceSdg == null
        ? ''
        : String(Number(drug.unitPriceSdg)));

    const unitPriceSdg = Number(draftValue);

    if (!Number.isSafeInteger(unitPriceSdg) || unitPriceSdg <= 0) {
      setPricingErrorMsg(
        lang === 'ar'
          ? 'يجب إدخال سعر صحيح أكبر من صفر بالعملة السودانية.'
          : 'Enter a valid positive whole-number price in SDG.'
      );
      return;
    }

    try {
      setPriceSavingId(drug.id);

      const res = await fetchWithAuth(
        `/api/records/drugs/${drug.id}/price`,
        {
          method: 'PATCH',
          body: JSON.stringify({ unitPriceSdg })
        }
      );

      const payload = await res.json().catch(() => ({}));

      if (!res.ok) {
        setPricingErrorMsg(
          apiErrorMessage(payload, 'Failed to update medicine price.')
        );
        return;
      }

      const updatedDrug = payload.drug;

      setDrugCatalog((current) =>
        current.map((item) =>
          item.id === drug.id
            ? {
                ...item,
                unitPriceSdg: updatedDrug.unitPriceSdg
              }
            : item
        )
      );

      setPriceDrafts((current) => ({
        ...current,
        [drug.id]: String(updatedDrug.unitPriceSdg)
      }));

      setPricingSuccessMsg(
        lang === 'ar'
          ? `تم تحديث سعر ${
              drug.labelAr || drug.labelEn
            } بنجاح.`
          : `${drug.labelEn || drug.labelAr} price updated successfully.`
      );
    } catch (error) {
      console.error(error);

      setPricingErrorMsg(
        lang === 'ar'
          ? 'تعذر تحديث سعر الدواء.'
          : 'Unable to update medicine price.'
      );
    } finally {
      setPriceSavingId(null);
    }
  };

  const handleDispense = async (rx) => {
    setErrorMsg('');
    setSuccessMsg('');

    if (rx.billingStatus !== 'PAID') {
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
      const res = await fetchWithAuth(`/api/records/prescriptions/${rx.id}/dispense`, {
        method: 'POST',
        body: JSON.stringify({ items })
      });
      if (res.ok) {
        setSuccessMsg(lang === 'ar' ? 'تم صرف الوصفة الطبية وإنقاص المخزون بنجاح.' : 'Prescription dispensed successfully.');
        setSelectedRx(null);
        fetchPendingRx();
      } else {
        const err = await res.json();
        setErrorMsg(apiErrorMessage(err, 'Dispense failed.'));
      }
    } catch (e) {
      console.error(e);
      setErrorMsg('Dispensing transaction failed.');
    }
  };

  return (
    <div className="dashboard-wrapper">
      <div className="workspace-panel" style={{ padding: '1rem' }}>
        <RoleHero role="pharmacy" lang={lang}/>

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
                ? 'إدارة أسعار الأدوية'
                : 'Medication Pricing'}
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
              ? 'الصيدلي مسؤول عن اعتماد وتعديل أسعار الأدوية المستخدمة في فواتير الصيدلية.'
              : 'Pharmacists can approve and update medication prices used for pharmacy billing.'}
          </p>

          {pricingErrorMsg && (
            <div
              className="badge badge-danger"
              style={{
                padding: '0.6rem',
                marginBottom: '0.75rem',
                display: 'block'
              }}
            >
              {pricingErrorMsg}
            </div>
          )}

          {pricingSuccessMsg && (
            <div
              className="badge badge-success"
              style={{
                padding: '0.6rem',
                marginBottom: '0.75rem',
                display: 'block'
              }}
            >
              {pricingSuccessMsg}
            </div>
          )}

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

                      <div
                        style={{
                          display: 'flex',
                          gap: '0.5rem',
                          marginTop: '0.65rem'
                        }}
                      >
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={
                            priceDrafts[drug.id] ??
                            (
                              hasValidPrice
                                ? String(currentPrice)
                                : ''
                            )
                          }
                          onChange={(event) =>
                            setPriceDrafts((current) => ({
                              ...current,
                              [drug.id]: event.target.value
                            }))
                          }
                          placeholder={
                            lang === 'ar'
                              ? 'السعر بالجنيه'
                              : 'Price in SDG'
                          }
                          style={{
                            width: '100%',
                            minWidth: 0
                          }}
                        />

                        <button
                          type="button"
                          className="btn btn-primary"
                          disabled={priceSavingId === drug.id}
                          onClick={() =>
                            handlePriceUpdate(drug)
                          }
                          style={{
                            whiteSpace: 'nowrap'
                          }}
                        >
                          {priceSavingId === drug.id
                            ? (lang === 'ar'
                                ? 'جارٍ الحفظ...'
                                : 'Saving...')
                            : (lang === 'ar'
                                ? 'حفظ السعر'
                                : 'Save Price')}
                        </button>
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
                  onClick={() => setSelectedRx(rx)}
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

                <div
                  className={`badge ${
                    selectedRx.billingStatus === 'PAID'
                      ? 'badge-success'
                      : 'badge-warning'
                  }`}
                  style={{
                    padding: '0.6rem',
                    marginBottom: '1rem',
                    display: 'block'
                  }}
                >
                  {selectedRx.billingStatus === 'PAID'
                    ? (lang === 'ar'
                        ? '✓ تم الدفع بالكامل — الوصفة جاهزة للصرف'
                        : '✓ Paid in Full — Ready to Dispense')
                    : selectedRx.billingStatus === 'PARTIALLY_PAID'
                      ? (lang === 'ar'
                          ? '🔒 تم الدفع جزئياً — يجب إكمال الدفع عند الاستقبال'
                          : '🔒 Partially Paid — Payment must be completed at Reception')
                      : selectedRx.billingStatus === 'UNPAID'
                        ? (lang === 'ar'
                            ? '🔒 الفاتورة غير مدفوعة — راجع الاستقبال'
                            : '🔒 Invoice Unpaid — Refer to Reception')
                        : (lang === 'ar'
                            ? '🔒 لم تصدر فاتورة الصيدلية بعد — راجع الاستقبال'
                            : '🔒 Pharmacy Invoice Not Issued — Refer to Reception')}
                </div>

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
                  disabled={selectedRx.billingStatus !== 'PAID'}
                >
                  {selectedRx.billingStatus === 'PAID'
                    ? (lang === 'ar'
                        ? 'صرف الأدوية وتحديث المستودع'
                        : 'Confirm Dispensation')
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
