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
  const [lowStockAlerts, setLowStockAlerts] = useState([]);

  const fetchPendingRx = () => {
    fetchWithAuth('/api/records/prescriptions/pending')
      .then((res) => res.ok ? res.json() : [])
      .then((data) => setPrescriptions(Array.isArray(data) ? data : []))
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
          // filter low stock items (qty <= min level)
          const lowStock = data.filter((d) =>
            d.inventoryBatches && d.inventoryBatches.some((b) => b.qtyOnHand <= b.minReorderLevel)
          );
          setLowStockAlerts(lowStock);
        } else {
          setLowStockAlerts([]);
        }
      })
      .catch((err) => {
        console.error(err);
        setLowStockAlerts([]);
      });
  }, []);

  const handleDispense = async (rx) => {
    setErrorMsg('');
    setSuccessMsg('');

    const items = rx.prescribedDrugs
      .filter((item) => item.drug)
      .map((item) => {
        // Select the eligible batch with the earliest expiry (FEFO).
        const today = clinicDateString();
        const batch = [...(item.drug.inventoryBatches || [])]
          .filter((candidate) => candidate.qtyOnHand > 0 && candidate.expiryDate >= today)
          .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate) || a.batchNumber.localeCompare(b.batchNumber))[0];

        return {
          prescribedDrugId: item.id,
          qtyToDispense: item.qtyPrescribed - item.qtyDispensed,
          batchId: batch ? batch.id : null
        };
      });

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
        <div className="panel-grid">
          {/* COLUMN 1: ACTIVE RX QUEUE */}
          <div className="panel-column glass-panel" style={{ padding: '1rem' }}>
            <div className="panel-header">
              <span className="panel-title">
                <FileText size={18} />
                {lang === 'ar' ? 'الوصفات الطبية المعلقة' : 'Pending Rx Queue'}
              </span>
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
                  <strong>{lang === 'ar' ? rx.patient.fullNameAr : rx.patient.fullNameEn}</strong>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                    <span>{new Date(rx.prescriptionDate).toLocaleDateString()}</span>
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
                            {lang === 'ar' ? 'غير متوفر' : 'Out of Stock'}
                          </span>
                        ) : isInsufficient ? (
                          <span className="badge badge-danger" style={{ fontSize: '0.7rem' }}>
                            {lang === 'ar' ? 'غير كافٍ' : `Insufficient (${qtyOnHand})`}
                          </span>
                        ) : isLowStock ? (
                          <span className="badge badge-warning" style={{ fontSize: '0.7rem' }}>
                            {lang === 'ar' ? 'مخزون منخفض' : `Low Stock (${qtyOnHand})`}
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

                <button className="btn btn-primary" style={{ width: '100%', marginTop: '1.5rem' }} onClick={() => handleDispense(selectedRx)}>
                  {lang === 'ar' ? 'صرف الأدوية وتحديث المستودع' : 'Confirm Dispensation'}
                </button>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '5rem', color: 'var(--text-secondary)' }}>
                <Stethoscope size={64} />
                <p style={{ marginTop: '1rem' }}>{lang === 'ar' ? 'يرجى اختيار وصفة طبية من القائمة للمتابعة.' : 'Please select an active prescription from the list.'}</p>
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
            {lowStockAlerts.map((d) => {
              const qty = d.inventoryBatches[0]?.qtyOnHand || 0;
              const isZero = qty === 0;
              return (
                <div key={d.id} className="glass-panel" style={{ padding: '0.75rem', borderLeft: isZero ? '4px solid var(--danger)' : '4px solid var(--warning)', fontSize: '0.85rem', marginBottom: '0.5rem', background: isZero ? 'rgba(239, 68, 68, 0.05)' : 'rgba(245, 158, 11, 0.05)' }}>
                  <strong>{lang === 'ar' ? d.labelAr : d.labelEn}</strong>
                  <p style={{ color: isZero ? 'var(--danger)' : 'var(--warning)', marginTop: '0.25rem', fontWeight: 'bold' }}>
                    {isZero
                      ? (lang === 'ar' ? 'نفذ تماماً من المخزن!' : 'OUT OF STOCK!')
                      : `${lang === 'ar' ? 'مستوى حرج للمخزون:' : 'Critical low stock:'} ${qty} left`}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ==========================================
   5. LAB TECHNICIAN DASHBOARD
   ========================================== */
