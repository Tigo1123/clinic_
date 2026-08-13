import { useEffect, useState } from 'react';
import { AlertTriangle, FileSpreadsheet, HelpCircle, Sliders, Stethoscope } from 'lucide-react';
import { fetchWithAuth } from '../../services/staffApi';

export default function LaboratoryDashboard({ lang }) {
  const [orders, setOrders] = useState([]);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [resultForms, setResultForms] = useState({});
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const fetchPendingLabOrders = () => {
    fetchWithAuth('/api/records/lab-orders/pending')
      .then((res) => res.ok ? res.json() : [])
      .then((data) => setOrders(Array.isArray(data) ? data : []))
      .catch((err) => {
        console.error(err);
        setOrders([]);
      });
  };

  useEffect(() => {
    fetchPendingLabOrders();
  }, []);

  const handleSubmitResult = async (item) => {
    setErrorMsg('');
    setSuccessMsg('');
    const form = resultForms[item.id] || {};
    if (!form.value?.trim()) return;
    const numericValue = Number(form.value);
    const min = form.min === '' || form.min == null ? undefined : Number(form.min);
    const max = form.max === '' || form.max == null ? undefined : Number(form.max);
    const isOut = Number.isFinite(numericValue) && ((Number.isFinite(min) && numericValue < min) || (Number.isFinite(max) && numericValue > max));

    try {
      const res = await fetchWithAuth(`/api/records/lab-orders/items/${item.id}/results`, {
        method: 'PUT',
        body: JSON.stringify({
          resultValue: form.value,
          ...(Number.isFinite(min) ? { referenceRangeMin: min } : {}),
          ...(Number.isFinite(max) ? { referenceRangeMax: max } : {}),
          isOutOfRange: isOut
        })
      });
      if (res.ok) {
        setSuccessMsg(lang === 'ar' ? 'تم تسجيل النتيجة وتنبيه الطبيب بنجاح.' : 'Lab results logged and doctor notified.');
        setResultForms((current) => { const next = { ...current }; delete next[item.id]; return next; });
        setSelectedOrder(null);
        fetchPendingLabOrders();
      } else {
        setErrorMsg('Failed to save lab results.');
      }
    } catch (e) {
      console.error(e);
      setErrorMsg('Transaction failed.');
    }
  };

  return (
    <div className="dashboard-wrapper">
      <div className="workspace-panel" style={{ padding: '1rem' }}>
        <div className="panel-grid-2">
          {/* COLUMN 1: PENDING ORDERS QUEUE */}
          <div className="panel-column glass-panel" style={{ padding: '1rem' }}>
            <div className="panel-header">
              <span className="panel-title">
                <FileSpreadsheet size={18} />
                {lang === 'ar' ? 'الفحوصات الطبية المطلوبة' : 'Pending Lab/Rad Orders'}
              </span>
            </div>
            {orders.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
                <HelpCircle size={36} />
                <p style={{ marginTop: '0.5rem' }}>{lang === 'ar' ? 'لا توجد فحوصات مطلوبة بانتظار الإجراء حالياً.' : 'No pending test orders to perform.'}</p>
              </div>
            ) : (
              orders.map((ord) => (
                <div
                  key={ord.id}
                  className={`queue-card-item glass-panel ${selectedOrder?.id === ord.id ? 'selected' : ''}`}
                  onClick={() => setSelectedOrder(ord)}
                >
                  <strong>{lang === 'ar' ? ord.patient.fullNameAr : ord.patient.fullNameEn}</strong>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                    <span>{new Date(ord.orderDate).toLocaleDateString()}</span>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* COLUMN 2: RESULTS ENTRY FORM */}
          <div className="panel-column glass-panel" style={{ padding: '1rem' }}>
            <div className="panel-header">
              <span className="panel-title">
                <Sliders size={18} />
                {lang === 'ar' ? 'تسجيل نتائج الفحوصات' : 'Test Findings Entry Desk'}
              </span>
            </div>
            {errorMsg && <div className="badge badge-danger" style={{ padding: '0.5rem' }}>{errorMsg}</div>}
            {successMsg && <div className="badge badge-success" style={{ padding: '0.5rem' }}>{successMsg}</div>}

            {selectedOrder ? (
              <div>
                <h4>
                  {lang === 'ar' ? 'المريض:' : 'Patient:'}{' '}
                  {lang === 'ar' ? selectedOrder.patient.fullNameAr : selectedOrder.patient.fullNameEn}
                </h4>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
                  {lang === 'ar' ? 'الطبيب الطالب:' : 'Ordering Physician:'} {lang === 'ar' ? selectedOrder.doctor.fullNameAr : selectedOrder.doctor.fullNameEn}
                </p>

                {selectedOrder.items.map((item) => {
                  const form = resultForms[item.id] || { value: '', min: '', max: '' };
                  const valParsed = Number(form.value);
                  const minParsed = Number(form.min);
                  const maxParsed = Number(form.max);
                  const isOutOfRange = form.value !== '' && Number.isFinite(valParsed) && ((form.min !== '' && valParsed < minParsed) || (form.max !== '' && valParsed > maxParsed));
                  const updateForm = (field, value) => setResultForms((current) => ({ ...current, [item.id]: { ...form, [field]: value } }));

                  return (
                    <div key={item.id} className="glass-panel" style={{ padding: '1rem', marginBottom: '1rem', borderLeft: isOutOfRange ? '4px solid var(--danger)' : '1px solid var(--border-color)' }}>
                      <strong>{lang === 'ar' ? item.service.labelAr : item.service.labelEn}</strong>
                      <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginTop: '0.75rem', flexWrap: 'wrap' }}>
                        <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                          <input
                            type="text"
                            placeholder="Result value (e.g. 13.5)"
                            className="form-input"
                            style={isOutOfRange ? { border: '1px solid var(--danger)', boxShadow: '0 0 8px rgba(239, 68, 68, 0.3)', color: 'var(--danger)', fontWeight: 'bold' } : {}}
                            value={form.value}
                            onChange={(e) => updateForm('value', e.target.value)}
                          />
                        </div>
                        <input aria-label="Reference minimum" type="number" step="any" placeholder="Reference min" className="form-input" style={{width:'130px'}} value={form.min} onChange={(e) => updateForm('min', e.target.value)} />
                        <input aria-label="Reference maximum" type="number" step="any" placeholder="Reference max" className="form-input" style={{width:'130px'}} value={form.max} onChange={(e) => updateForm('max', e.target.value)} />
                      </div>

                      {isOutOfRange && (
                        <div style={{ color: 'var(--danger)', fontSize: '0.8rem', marginTop: '0.5rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <AlertTriangle size={14} />
                          {lang === 'ar' ? 'تنبيه: نتيجة غير طبيعية (خارج المعدل المرجعي)' : 'Abnormal Test Finding (Out of normal range!)'}
                        </div>
                      )}

                      <button className="btn btn-primary" style={{ width: '100%', marginTop: '1rem' }} onClick={() => handleSubmitResult(item)}>
                        {lang === 'ar' ? 'إرسال التقرير وتحديث السجل' : 'Save Findings'}
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '5rem', color: 'var(--text-secondary)' }}>
                <Stethoscope size={64} />
                <p style={{ marginTop: '1rem' }}>{lang === 'ar' ? 'يرجى اختيار فحص مخبري من القائمة للمتابعة.' : 'Please select an active test order from the list.'}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

