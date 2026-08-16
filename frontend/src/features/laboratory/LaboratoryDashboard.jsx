import { useEffect, useState } from 'react';
import { AlertTriangle, FileSpreadsheet, HelpCircle, Sliders, Stethoscope } from 'lucide-react';
import { fetchWithAuth } from '../../services/staffApi';
import RoleHero from '../../components/healthcare/RoleHero';

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
        const savedItem = await res.json();

        setSuccessMsg(
          lang === 'ar'
            ? 'تم حفظ نتيجة الفحص بنجاح.'
            : 'Test result saved successfully.'
        );

        setResultForms((current) => {
          const next = { ...current };
          delete next[item.id];
          return next;
        });

        setSelectedOrder((current) => {
          if (!current) return current;

          return {
            ...current,
            items: current.items.map((currentItem) =>
              currentItem.id === item.id
                ? {
                    ...currentItem,
                    resultValue: savedItem.resultValue,
                    referenceRangeMin: savedItem.referenceRangeMin,
                    referenceRangeMax: savedItem.referenceRangeMax,
                    isOutOfRange: savedItem.isOutOfRange
                  }
                : currentItem
            )
          };
        });

        fetchPendingLabOrders();
      } else {
        setErrorMsg(
          lang === 'ar'
            ? 'تعذر حفظ نتيجة الفحص.'
            : 'Failed to save the test result.'
        );
      }
    } catch (e) {
      console.error(e);
      setErrorMsg(
        lang === 'ar'
          ? 'حدث خطأ أثناء معالجة الطلب. يرجى المحاولة مرة أخرى.'
          : 'The request could not be completed. Please try again.'
      );
    }
  };

  return (
    <div className="dashboard-wrapper">
      <div className="workspace-panel" style={{ padding: '1rem' }}>
        <RoleHero role="laboratory" lang={lang}/>
        <div className="panel-grid-2">
          {/* COLUMN 1: PENDING ORDERS QUEUE */}
          <div className="panel-column glass-panel" style={{ padding: '1rem' }}>
            <div className="panel-header">
              <span className="panel-title">
                <FileSpreadsheet size={18} />
                {lang === 'ar'
                  ? 'طلبات الفحوصات المخبرية'
                  : 'Pending Laboratory Orders'}
              </span>
            </div>
            {orders.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
                <HelpCircle size={36} />
                <p style={{ marginTop: '0.5rem' }}>{lang === 'ar'
                    ? 'لا توجد طلبات فحوصات مخبرية بانتظار الإجراء حالياً.'
                    : 'There are no pending laboratory orders at this time.'}</p>
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
                    <span>
                      {new Date(ord.orderDate).toLocaleDateString(
                        lang === 'ar' ? 'ar' : 'en'
                      )}
                    </span>
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
                {lang === 'ar'
                  ? 'تسجيل نتائج الفحوصات'
                  : 'Laboratory Results Entry'}
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
                  {lang === 'ar' ? 'الطبيب طالب الفحص:' : 'Ordering Doctor:'} {lang === 'ar' ? selectedOrder.doctor.fullNameAr : selectedOrder.doctor.fullNameEn}
                </p>

                {selectedOrder.items.map((item) => {
                  const isCompleted =
                    item.resultValue !== null &&
                    item.resultValue !== undefined &&
                    String(item.resultValue).trim() !== '';

                  const form = resultForms[item.id] || {
                    value: '',
                    min: '',
                    max: ''
                  };

                  const testName = item.service
                    ? (lang === 'ar' ? item.service.labelAr : item.service.labelEn)
                    : item.customTestName || (lang === 'ar' ? 'فحص مخصص' : 'Custom Test');
                  const valParsed = Number(form.value);
                  const minParsed = Number(form.min);
                  const maxParsed = Number(form.max);
                  const isOutOfRange = form.value !== '' && Number.isFinite(valParsed) && ((form.min !== '' && valParsed < minParsed) || (form.max !== '' && valParsed > maxParsed));
                  const updateForm = (field, value) => setResultForms((current) => ({ ...current, [item.id]: { ...form, [field]: value } }));

                  return (
                    <div key={item.id} className="glass-panel" style={{ padding: '1rem', marginBottom: '1rem', borderLeft: isOutOfRange ? '4px solid var(--danger)' : '1px solid var(--border-color)' }}>
                      <strong>{testName}</strong>

                      {isCompleted ? (
                        <div
                          className="badge badge-success"
                          style={{ marginTop: '0.75rem', padding: '0.65rem' }}
                        >
                          {lang === 'ar'
                            ? `النتيجة المسجلة: ${item.resultValue}`
                            : `Recorded result: ${item.resultValue}`}
                        </div>
                      ) : (
                      <>
                      <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginTop: '0.75rem', flexWrap: 'wrap' }}>
                        <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                          <input
                            type="text"
                            placeholder={
                              lang === 'ar'
                                ? 'قيمة النتيجة، مثال: 13.5'
                                : 'Result value, e.g. 13.5'
                            }
                            className="form-input"
                            style={isOutOfRange ? { border: '1px solid var(--danger)', boxShadow: '0 0 8px rgba(239, 68, 68, 0.3)', color: 'var(--danger)', fontWeight: 'bold' } : {}}
                            value={form.value}
                            onChange={(e) => updateForm('value', e.target.value)}
                          />
                        </div>
                        <input
                          aria-label={
                            lang === 'ar'
                              ? 'الحد الأدنى للنطاق المرجعي'
                              : 'Reference range minimum'
                          }
                          type="number"
                          step="any"
                          placeholder={
                            lang === 'ar'
                              ? 'الحد الأدنى'
                              : 'Reference min'
                          }
                          className="form-input"
                          style={{ width: '130px' }}
                          value={form.min}
                          onChange={(e) => updateForm('min', e.target.value)}
                        />
                        <input
                          aria-label={
                            lang === 'ar'
                              ? 'الحد الأعلى للنطاق المرجعي'
                              : 'Reference range maximum'
                          }
                          type="number"
                          step="any"
                          placeholder={
                            lang === 'ar'
                              ? 'الحد الأعلى'
                              : 'Reference max'
                          }
                          className="form-input"
                          style={{ width: '130px' }}
                          value={form.max}
                          onChange={(e) => updateForm('max', e.target.value)}
                        />
                      </div>

                      {isOutOfRange && (
                        <div style={{ color: 'var(--danger)', fontSize: '0.8rem', marginTop: '0.5rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <AlertTriangle size={14} />
                          {lang === 'ar'
                            ? 'تنبيه: النتيجة خارج النطاق المرجعي'
                            : 'Warning: Result is outside the reference range'}
                        </div>
                      )}

                      <button
                        className="btn btn-primary"
                        style={{ width: '100%', marginTop: '1rem' }}
                        disabled={!form.value?.trim()}
                        onClick={() => handleSubmitResult(item)}
                      >
                        {lang === 'ar'
                          ? 'حفظ نتيجة الفحص'
                          : 'Save Test Result'}
                      </button>
                      </>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '5rem', color: 'var(--text-secondary)' }}>
                <Stethoscope size={64} />
                <p style={{ marginTop: '1rem' }}>{lang === 'ar'
                  ? 'اختر طلب فحص من القائمة لعرض التفاصيل وتسجيل النتائج.'
                  : 'Select a laboratory order from the list to view details and enter results.'}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
