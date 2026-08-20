import { useEffect, useState } from 'react';
import { AlertTriangle, FileSpreadsheet, HelpCircle, Sliders, Stethoscope } from 'lucide-react';
import { apiErrorMessage, fetchWithAuth } from '../../services/staffApi';
import RoleHero from '../../components/healthcare/RoleHero';

export default function LaboratoryDashboard({ lang }) {
  const [orders, setOrders] = useState([]);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [resultForms, setResultForms] = useState({});
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [reviewRequests, setReviewRequests] = useState([]);
  const [labServices, setLabServices] = useState([]);
  const [reviewForms, setReviewForms] = useState({});
  const [reviewingId, setReviewingId] = useState(null);

  const fetchPendingLabOrders = async (preferredOrderId = null) => {
    try {
      const res = await fetchWithAuth(
        '/api/records/lab-orders/pending'
      );

      const data = await res.json().catch(() => []);

      if (!res.ok) {
        setOrders([]);
        return;
      }

      const nextOrders = Array.isArray(data) ? data : [];

      setOrders(nextOrders);

      if (preferredOrderId) {
        setSelectedOrder(
          nextOrders.find(
            (order) => order.id === preferredOrderId
          ) || null
        );
      }
    } catch (err) {
      console.error(err);
      setOrders([]);
    }
  };

  useEffect(() => {
    fetchPendingLabOrders();
    fetchReviewRequests();
    fetchWithAuth('/api/billing/services')
      .then((res) => res.ok ? res.json() : [])
      .then((services) => setLabServices((Array.isArray(services) ? services : []).filter((service) => service.category === 'LABORATORY')))
      .catch(() => setLabServices([]));
  }, []);

  const fetchReviewRequests = async () => {
    try {
      const res = await fetchWithAuth('/api/records/lab-order-items/pending-review');
      const data = await res.json().catch(() => []);
      setReviewRequests(res.ok && Array.isArray(data) ? data : []);
    } catch {
      setReviewRequests([]);
    }
  };

  const updateReviewForm = (id, changes) => {
    setReviewForms((current) => ({ ...current, [id]: { ...(current[id] || {}), ...changes } }));
  };

  const handleReview = async (request, decision) => {
    const form = reviewForms[request.id] || {};
    const body = { decision };
    if (decision === 'LINK_EXISTING') body.serviceId = form.serviceId;
    if (decision === 'CREATE_SERVICE') {
      body.service = { labelAr: form.labelAr, labelEn: form.labelEn, baseFeeSdg: Number(form.baseFeeSdg) };
    }
    setReviewingId(request.id);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const res = await fetchWithAuth(`/api/records/lab-order-items/${request.id}/review`, {
        method: 'POST',
        body: JSON.stringify(body)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMsg(apiErrorMessage(data, lang === 'ar' ? 'تعذرت مراجعة الفحص.' : 'The test review could not be completed.'));
        return;
      }
      setSuccessMsg(lang === 'ar' ? 'تمت مراجعة الفحص المختبري بنجاح.' : 'Laboratory test review completed.');
      if (data.service) {
        setLabServices((current) => current.some((service) => service.id === data.service.id) ? current : [...current, data.service]);
      }
      await Promise.all([fetchReviewRequests(), fetchPendingLabOrders(selectedOrder?.id)]);
    } catch {
      setErrorMsg(lang === 'ar' ? 'تعذرت مراجعة الفحص.' : 'The test review could not be completed.');
    } finally {
      setReviewingId(null);
    }
  };

  const handleCollectSample = async () => {
    if (!selectedOrder || selectedOrder.status !== 'PAID') {
      return;
    }

    setErrorMsg('');
    setSuccessMsg('');

    try {
      const res = await fetchWithAuth(
        `/api/records/lab-orders/${selectedOrder.id}/collect-sample`,
        {
          method: 'PUT'
        }
      );

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setErrorMsg(
          apiErrorMessage(
            data,
            lang === 'ar'
              ? 'تعذر تسجيل جمع العينة.'
              : 'Failed to record sample collection.'
          )
        );
        return;
      }

      setSuccessMsg(
        lang === 'ar'
          ? 'تم تسجيل جمع العينة. يمكن الآن إدخال نتائج الفحوصات.'
          : 'Sample collected. Test results can now be entered.'
      );

      await fetchPendingLabOrders(selectedOrder.id);
    } catch (err) {
      console.error(err);

      setErrorMsg(
        lang === 'ar'
          ? 'حدث خطأ أثناء تسجيل جمع العينة.'
          : 'An error occurred while recording sample collection.'
      );
    }
  };

  const handleSubmitResult = async (item) => {
    setErrorMsg('');
    setSuccessMsg('');

    if (!selectedOrder || selectedOrder.status !== 'SAMPLE_COLLECTED') {
      setErrorMsg(
        lang === 'ar'
          ? 'يجب إتمام الدفع وجمع العينة قبل إدخال النتائج.'
          : 'Payment and sample collection must be completed before entering results.'
      );
      return;
    }

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

        await fetchPendingLabOrders(selectedOrder?.id);
      } else {
        const errorData = await res.json().catch(() => ({}));

        setErrorMsg(
          apiErrorMessage(
            errorData,
            lang === 'ar'
              ? 'تعذر حفظ نتيجة الفحص.'
              : 'Failed to save the test result.'
          )
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
        <section className="glass-panel" style={{ padding: '1rem', marginBottom: '1rem' }}>
          <div className="panel-header">
            <span className="panel-title">
              <AlertTriangle size={18} />
              {lang === 'ar' ? 'طلبات فحوصات مختبرية جديدة' : 'New Lab Test Requests'}
            </span>
          </div>
          {reviewRequests.length === 0 ? (
            <p style={{ color: 'var(--text-secondary)' }}>
              {lang === 'ar' ? 'لا توجد فحوصات مخصصة بانتظار المراجعة.' : 'No custom tests are awaiting review.'}
            </p>
          ) : reviewRequests.map((request) => {
            const form = reviewForms[request.id] || {};
            const mode = form.mode || '';
            return (
              <div key={request.id} className="glass-panel" style={{ padding: '1rem', marginTop: '0.75rem' }}>
                <strong>{request.customTestName}</strong>
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', margin: '0.35rem 0 0.75rem' }}>
                  {lang === 'ar' ? request.labOrder.patient.fullNameAr : request.labOrder.patient.fullNameEn}
                  {' • '}
                  {lang === 'ar' ? request.labOrder.doctor.fullNameAr : request.labOrder.doctor.fullNameEn}
                  {' • '}
                  {new Date(request.labOrder.orderDate).toLocaleDateString(lang === 'ar' ? 'ar' : 'en')}
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <button className="btn btn-secondary" type="button" onClick={() => updateReviewForm(request.id, { mode: 'LINK_EXISTING' })}>{lang === 'ar' ? 'ربط بخدمة موجودة' : 'Link Existing'}</button>
                  <button className="btn btn-secondary" type="button" onClick={() => updateReviewForm(request.id, { mode: 'CREATE_SERVICE', labelEn: form.labelEn || request.customTestName, labelAr: form.labelAr || request.customTestName })}>{lang === 'ar' ? 'إنشاء وتسعير' : 'Create & Price'}</button>
                  <button className="btn btn-secondary" type="button" disabled={reviewingId === request.id} onClick={() => handleReview(request, 'EXTERNAL')}>{lang === 'ar' ? 'خارجي / غير متوفر' : 'External / Not Available'}</button>
                </div>
                {mode === 'LINK_EXISTING' && (
                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
                    <select className="form-input" value={form.serviceId || ''} onChange={(event) => updateReviewForm(request.id, { serviceId: event.target.value })} style={{ flex: 1 }}>
                      <option value="">{lang === 'ar' ? 'اختر خدمة مختبرية' : 'Select a laboratory service'}</option>
                      {labServices.map((service) => <option key={service.id} value={service.id}>{lang === 'ar' ? service.labelAr : service.labelEn} — {Number(service.baseFeeSdg).toLocaleString()} SDG</option>)}
                    </select>
                    <button className="btn btn-primary" type="button" disabled={!form.serviceId || reviewingId === request.id} onClick={() => handleReview(request, 'LINK_EXISTING')}>{lang === 'ar' ? 'تأكيد الربط' : 'Confirm Link'}</button>
                  </div>
                )}
                {mode === 'CREATE_SERVICE' && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.5rem', marginTop: '0.75rem' }}>
                    <input className="form-input" placeholder={lang === 'ar' ? 'الاسم بالعربية' : 'Arabic label'} value={form.labelAr || ''} onChange={(event) => updateReviewForm(request.id, { labelAr: event.target.value })}/>
                    <input className="form-input" placeholder={lang === 'ar' ? 'الاسم بالإنجليزية' : 'English label'} value={form.labelEn || ''} onChange={(event) => updateReviewForm(request.id, { labelEn: event.target.value })}/>
                    <input className="form-input" type="number" min="1" step="1" placeholder={lang === 'ar' ? 'السعر بالجنيه السوداني' : 'Price in SDG'} value={form.baseFeeSdg || ''} onChange={(event) => updateReviewForm(request.id, { baseFeeSdg: event.target.value })}/>
                    <button className="btn btn-primary" type="button" disabled={!form.labelAr?.trim() || !form.labelEn?.trim() || !(Number(form.baseFeeSdg) > 0) || reviewingId === request.id} onClick={() => handleReview(request, 'CREATE_SERVICE')}>{lang === 'ar' ? 'إنشاء وربط الخدمة' : 'Create and Link'}</button>
                  </div>
                )}
              </div>
            );
          })}
        </section>
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

                  <span
                    className={`badge ${
                      ord.status === 'PENDING_BILLING'
                        ? 'badge-warning'
                        : ord.status === 'PAID'
                          ? 'badge-success'
                          : 'badge-success'
                    }`}
                    style={{
                      marginTop: '0.5rem',
                      display: 'inline-flex'
                    }}
                  >
                    {ord.items.some((item) => item.labReviewStatus === 'PENDING_REVIEW')
                      ? (lang === 'ar'
                          ? '⚠ بانتظار مراجعة فحص مخصص'
                          : '⚠ Custom Test Review Required')
                      : ord.status === 'PENDING_BILLING'
                      ? (lang === 'ar'
                          ? '🔒 بانتظار الدفع'
                          : '🔒 Waiting for Payment')
                      : ord.status === 'PAID'
                        ? (lang === 'ar'
                            ? '✓ مدفوع — جاهز لجمع العينة'
                            : '✓ Paid — Ready for Sample')
                        : (lang === 'ar'
                            ? '🧪 تم جمع العينة'
                            : '🧪 Sample Collected')}
                  </span>
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
                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                  {lang === 'ar' ? 'الطبيب طالب الفحص:' : 'Ordering Doctor:'} {lang === 'ar' ? selectedOrder.doctor.fullNameAr : selectedOrder.doctor.fullNameEn}
                </p>

                {selectedOrder.items.some((item) => item.labReviewStatus === 'PENDING_REVIEW') ? (
                  <div className="badge badge-warning" style={{ display: 'block', padding: '0.85rem', marginBottom: '1rem' }}>
                    {lang === 'ar'
                      ? 'يجب مراجعة الفحص المخصص وربطه أو تسعيره قبل إصدار الفاتورة.'
                      : 'The custom test must be reviewed, linked, or priced before billing.'}
                  </div>
                ) : selectedOrder.status === 'PENDING_BILLING' && (
                  <div
                    className="badge badge-warning"
                    style={{
                      display: 'block',
                      padding: '0.85rem',
                      marginBottom: '1rem'
                    }}
                  >
                    {lang === 'ar'
                      ? '🔒 الطلب بانتظار إتمام الدفع لدى الاستقبال. لا يمكن جمع العينة أو إدخال النتائج.'
                      : '🔒 Waiting for payment at reception. Sample collection and result entry are locked.'}
                  </div>
                )}

                {selectedOrder.status === 'PAID' && (
                  <div
                    className="glass-panel"
                    style={{
                      padding: '1rem',
                      marginBottom: '1rem'
                    }}
                  >
                    <div
                      className="badge badge-success"
                      style={{
                        marginBottom: '0.75rem',
                        padding: '0.6rem'
                      }}
                    >
                      {lang === 'ar'
                        ? 'تم الدفع بالكامل'
                        : 'Payment Complete'}
                    </div>

                    <button
                      type="button"
                      className="btn btn-primary"
                      style={{ width: '100%' }}
                      onClick={handleCollectSample}
                    >
                      {lang === 'ar'
                        ? 'تأكيد جمع العينة'
                        : 'Collect Sample'}
                    </button>
                  </div>
                )}

                {selectedOrder.status === 'SAMPLE_COLLECTED' && (
                  <div
                    className="badge badge-success"
                    style={{
                      display: 'block',
                      padding: '0.75rem',
                      marginBottom: '1rem'
                    }}
                  >
                    {lang === 'ar'
                      ? '🧪 تم جمع العينة — يمكن إدخال النتائج الآن.'
                      : '🧪 Sample collected — results can now be entered.'}
                  </div>
                )}

                {selectedOrder.items.filter((item) => item.labReviewStatus !== 'EXTERNAL').map((item) => {
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
                      ) : selectedOrder.status !== 'SAMPLE_COLLECTED' ? (
                        <div
                          className="badge badge-warning"
                          style={{
                            marginTop: '0.75rem',
                            padding: '0.65rem'
                          }}
                        >
                          {selectedOrder.status === 'PAID'
                            ? (lang === 'ar'
                                ? 'يجب جمع العينة أولاً.'
                                : 'Collect the sample first.')
                            : (lang === 'ar'
                                ? 'النتائج مقفلة حتى إتمام الدفع.'
                                : 'Results are locked until payment is complete.')}
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
