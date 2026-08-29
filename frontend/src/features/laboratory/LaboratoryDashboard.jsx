import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ClipboardCheck, FileSpreadsheet, FlaskConical, HelpCircle, History, Sliders, Stethoscope } from 'lucide-react';
import { apiErrorMessage, fetchWithAuth } from '../../services/staffApi';
import RoleHero from '../../components/healthcare/RoleHero';
import { createLatestRequestGate, mergeLabOrdersMonotonically } from '../../utils/labOrderVersions';
import './laboratoryDashboard.css';

export default function LaboratoryDashboard({ lang }) {
  const [orders, setOrders] = useState([]);
  const [historyOrders, setHistoryOrders] = useState([]);
  const [orderView, setOrderView] = useState('work');
  const [historyLoading, setHistoryLoading] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const [resultForms, setResultForms] = useState({});
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [reviewRequests, setReviewRequests] = useState([]);
  const [labServices, setLabServices] = useState([]);
  const [reviewForms, setReviewForms] = useState({});
  const [reviewingId, setReviewingId] = useState(null);
  const queueRequestGateRef = useRef(null);
  if (queueRequestGateRef.current === null) queueRequestGateRef.current = createLatestRequestGate();
  const visibleOrders = orderView === 'work' ? orders : historyOrders;
  const selectedOrder = [...orders, ...historyOrders].find((order) => order.id === selectedOrderId) || null;

  const fetchPendingLabOrders = async (preferredOrderId = null) => {
    const gate = queueRequestGateRef.current;
    const generation = gate.begin();
    try {
      const res = await fetchWithAuth(
        '/api/records/lab-orders/pending'
      );

      const data = await res.json().catch(() => []);

      if (!gate.isCurrent(generation)) return;

      if (!res.ok) {
        setOrders([]);
        return;
      }

      const nextOrders = Array.isArray(data) ? data : [];

      setOrders((current) => mergeLabOrdersMonotonically(current, nextOrders));
      if (preferredOrderId) setSelectedOrderId(nextOrders.some((order) => order.id === preferredOrderId) ? preferredOrderId : null);
    } catch (err) {
      if (!gate.isCurrent(generation)) return;
      console.error(err);
      setOrders([]);
    }
  };

  useEffect(() => {
    const gate = createLatestRequestGate();
    queueRequestGateRef.current = gate;
    fetchPendingLabOrders();
    fetchLabHistory();
    fetchReviewRequests();
    fetchWithAuth('/api/billing/services')
      .then((res) => res.ok ? res.json() : [])
      .then((services) => setLabServices((Array.isArray(services) ? services : []).filter((service) => service.category === 'LABORATORY')))
      .catch(() => setLabServices([]));
    return () => gate.invalidate();
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

  const fetchLabHistory = async (preferredOrderId = null) => {
    setHistoryLoading(true);
    try {
      const res = await fetchWithAuth('/api/records/lab-orders/history');
      const data = await res.json().catch(() => []);
      const nextHistory = res.ok && Array.isArray(data) ? data : [];
      setHistoryOrders(nextHistory);
      if (preferredOrderId && nextHistory.some((order) => order.id === preferredOrderId)) {
        setSelectedOrderId(preferredOrderId);
      }
    } catch {
      setHistoryOrders([]);
    } finally {
      setHistoryLoading(false);
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
      body.service = { labelAr: form.labelAr, labelEn: form.labelEn };
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
      if (data.service?.status === 'ACTIVE') {
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
          expectedVersion: item.resultVersion,
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

        setOrders((current) => current.map((order) => order.id !== selectedOrder?.id
          ? order
          : {
              ...order,
              items: order.items.map((currentItem) => currentItem.id === item.id ? { ...currentItem, ...savedItem } : currentItem)
            }));

        await fetchPendingLabOrders(selectedOrder?.id);
      } else {
        const errorData = await res.json().catch(() => ({}));
        const errorCode = errorData?.error?.code || errorData?.code;

        if (res.status === 409 && errorCode === 'LAB_RESULT_CONFLICT') {
          setErrorMsg(
            lang === 'ar'
              ? 'غيّر مستخدم آخر هذه النتيجة. تم تحميل أحدث نسخة؛ راجع إدخالك غير المحفوظ قبل محاولة الحفظ مرة أخرى.'
              : 'Another user changed this result. The latest version was loaded; review your unsaved entry before saving again.'
          );
          await fetchPendingLabOrders(selectedOrder?.id);
          return;
        }

        if (res.status === 409 && errorCode === 'LAB_RESULT_FINALIZED') {
          setErrorMsg(
            lang === 'ar'
              ? 'لم تعد هذه النتيجة قابلة للتعديل لأنها اكتملت أو أُفرج عنها. تم الاحتفاظ بإدخالك غير المحفوظ للمراجعة.'
              : 'This result is no longer editable because it was completed or released. Your unsaved entry has been retained for review.'
          );
          await fetchPendingLabOrders(selectedOrder?.id);
          return;
        }

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

  const handleReleaseResults = async () => {
    if (!selectedOrder || selectedOrder.status !== 'COMPLETED') return;
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const res = await fetchWithAuth(`/api/records/lab-orders/${selectedOrder.id}/release`, { method: 'PUT' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMsg(apiErrorMessage(data, lang === 'ar' ? 'تعذر الإفراج عن النتائج للمريض.' : 'Failed to release results to the patient.'));
        return;
      }
      setSuccessMsg(lang === 'ar' ? 'تم الإفراج عن النتائج للمريض.' : 'Results released to the patient.');
      await Promise.all([fetchPendingLabOrders(), fetchLabHistory(selectedOrder.id)]);
      setOrderView('history');
    } catch {
      setErrorMsg(lang === 'ar' ? 'تعذر الإفراج عن النتائج للمريض.' : 'Failed to release results to the patient.');
    }
  };

  const workflowSteps = [
    { ar: 'الدفع', en: 'Payment' },
    { ar: 'جمع العينة', en: 'Sample collection' },
    { ar: 'إدخال النتائج', en: 'Result entry' },
    { ar: 'الاكتمال', en: 'Completion' },
    { ar: 'الإفراج', en: 'Release' }
  ];
  const selectedWorkflowPosition = selectedOrder?.releasedToPatientAt
    ? workflowSteps.length
    : ({ PENDING_BILLING: 0, PAID: 1, SAMPLE_COLLECTED: 2, COMPLETED: 4 }[selectedOrder?.status] ?? 0);

  return (
    <div className="dashboard-wrapper laboratory-dashboard" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <div className="workspace-panel laboratory-workspace">
        <RoleHero role="laboratory" lang={lang}/>
        <section className={`laboratory-review-section ${reviewRequests.length === 0 ? 'is-empty' : ''}`} aria-labelledby="laboratory-review-title">
          <div className="laboratory-review-heading">
            <span className="laboratory-review-icon"><AlertTriangle size={17} aria-hidden="true" /></span>
            <div>
              <h2 id="laboratory-review-title">
              {lang === 'ar' ? 'مراجعة الفحوصات المخصصة' : 'Custom Test Review'}
              </h2>
              <p>{lang === 'ar' ? 'فحوصات كتبها الطبيب يدوياً وتحتاج إلى مطابقة أو اعتماد قبل التنفيذ.' : 'Tests entered manually by a doctor that require review before processing.'}</p>
            </div>
            <span className="laboratory-review-count">{reviewRequests.length}</span>
          </div>
          {reviewRequests.length === 0 ? (
            <p className="laboratory-review-empty" role="status">
              {lang === 'ar' ? 'لا توجد فحوصات مخصصة بانتظار المراجعة.' : 'No custom tests are awaiting review.'}
            </p>
          ) : reviewRequests.map((request) => {
            const form = reviewForms[request.id] || {};
            const mode = form.mode || '';
            return (
              <article key={request.id} className="laboratory-review-card">
                <div className="laboratory-review-card__header">
                  <div><span>{lang === 'ar' ? 'الفحص المطلوب' : 'Requested test'}</span><strong>{request.customTestName}</strong></div>
                  <span className="badge badge-warning">{lang === 'ar' ? 'بانتظار المراجعة' : 'Pending review'}</span>
                </div>
                <dl className="laboratory-review-meta">
                  <div><dt>{lang === 'ar' ? 'المريض' : 'Patient'}</dt><dd>{lang === 'ar' ? request.labOrder.patient.fullNameAr : request.labOrder.patient.fullNameEn}</dd></div>
                  <div><dt>{lang === 'ar' ? 'الطبيب' : 'Doctor'}</dt><dd>{lang === 'ar' ? request.labOrder.doctor.fullNameAr : request.labOrder.doctor.fullNameEn}</dd></div>
                  <div><dt>{lang === 'ar' ? 'تاريخ الطلب' : 'Requested'}</dt><dd>{new Date(request.labOrder.orderDate).toLocaleDateString(lang === 'ar' ? 'ar' : 'en')}</dd></div>
                </dl>
                <div className="laboratory-review-actions">
                  <button className="btn btn-secondary" type="button" onClick={() => updateReviewForm(request.id, { mode: 'LINK_EXISTING' })}>{lang === 'ar' ? 'ربط بخدمة موجودة' : 'Link Existing'}</button>
                  <button className="btn btn-secondary" type="button" onClick={() => updateReviewForm(request.id, { mode: 'CREATE_SERVICE', labelEn: form.labelEn || request.customTestName, labelAr: form.labelAr || request.customTestName })}>{lang === 'ar' ? 'إنشاء للمراجعة الإدارية' : 'Create for Admin Pricing'}</button>
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
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>
                      {lang === 'ar'
                        ? 'ستبقى الخدمة غير نشطة وغير قابلة للفوترة حتى يحدد المسؤول سعرها الرسمي.'
                        : 'The service remains inactive and non-billable until an administrator configures its official price.'}
                    </p>
                    <button className="btn btn-primary" type="button" disabled={!form.labelAr?.trim() || !form.labelEn?.trim() || reviewingId === request.id} onClick={() => handleReview(request, 'CREATE_SERVICE')}>{lang === 'ar' ? 'إنشاء وربط الخدمة المعلقة' : 'Create and Link Pending Service'}</button>
                  </div>
                )}
              </article>
            );
          })}
        </section>
        <div className="laboratory-operational-grid">
          {/* COLUMN 1: PENDING ORDERS QUEUE */}
          <aside className="laboratory-orders-panel" aria-labelledby="laboratory-orders-title">
            <div className="laboratory-orders-header">
              <span className="panel-title" id="laboratory-orders-title">
                <FileSpreadsheet size={18} />
                {lang === 'ar'
                  ? 'طلبات المختبر'
                  : 'Laboratory Orders'}
              </span>
              <div className="laboratory-order-tabs" role="tablist" aria-label={lang === 'ar' ? 'عرض طلبات المختبر' : 'Laboratory order view'}>
                <button type="button" role="tab" aria-selected={orderView === 'work'} className={orderView === 'work' ? 'is-active' : ''} onClick={() => { setOrderView('work'); setSelectedOrderId(null); }}><FlaskConical size={15} />{lang === 'ar' ? 'قائمة العمل' : 'Work Queue'}<span>{orders.length}</span></button>
                <button type="button" role="tab" aria-selected={orderView === 'history'} className={orderView === 'history' ? 'is-active' : ''} onClick={() => { setOrderView('history'); setSelectedOrderId(null); }}><History size={15} />{lang === 'ar' ? 'السجل المختبري' : 'Lab History'}<span>{historyOrders.length}</span></button>
              </div>
            </div>
            {historyLoading && orderView === 'history' ? <div className="laboratory-orders-empty" role="status">{lang === 'ar' ? 'جارٍ تحميل السجل المختبري...' : 'Loading laboratory history...'}</div> : visibleOrders.length === 0 ? (
              <div className="laboratory-orders-empty" role="status">
                <HelpCircle size={36} />
                <p>{orderView === 'work'
                  ? (lang === 'ar' ? 'لا توجد طلبات فحوصات مخبرية بانتظار الإجراء حالياً.' : 'There are no laboratory orders requiring action.')
                  : (lang === 'ar' ? 'لا توجد طلبات مختبرية مكتملة في السجل.' : 'There are no completed laboratory orders in history.')}</p>
              </div>
            ) : (
              <div className="laboratory-order-list">{visibleOrders.map((ord) => (
                <button
                  type="button"
                  key={ord.id}
                  className={`laboratory-order-card ${selectedOrder?.id === ord.id ? 'selected' : ''}`}
                  onClick={() => setSelectedOrderId(ord.id)}
                  aria-pressed={selectedOrder?.id === ord.id}
                >
                  <span className="laboratory-order-card__header"><strong>{lang === 'ar' ? ord.patient.fullNameAr : ord.patient.fullNameEn}</strong><bdi dir="ltr">{ord.patient.fileNumber || ''}</bdi></span>
                  <span className="laboratory-order-card__date">
                      {new Date(ord.orderDate).toLocaleDateString(
                        lang === 'ar' ? 'ar' : 'en'
                      )}
                  </span>

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
                    {ord.releasedToPatientAt
                      ? (lang === 'ar' ? 'تم الإفراج عن النتائج' : 'Results Released')
                      : ord.items.some((item) => item.labReviewStatus === 'PENDING_REVIEW')
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
                        : ord.status === 'COMPLETED'
                          ? (lang === 'ar'
                              ? '✓ مكتمل — بانتظار الإفراج'
                              : '✓ Completed — Release Pending')
                          : (lang === 'ar'
                            ? '🧪 تم جمع العينة'
                            : '🧪 Sample Collected')}
                  </span>
                </button>
              ))}</div>
            )}
          </aside>

          {/* COLUMN 2: RESULTS ENTRY FORM */}
          <main className="laboratory-results-panel">
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

                <ol className="laboratory-workflow" aria-label={lang === 'ar' ? 'مراحل سير طلب المختبر' : 'Laboratory order workflow'}>
                  {workflowSteps.map((step, index) => <li className={index < selectedWorkflowPosition ? 'is-done' : index === selectedWorkflowPosition ? 'is-current' : ''} key={step.en}>
                    <span>{index < selectedWorkflowPosition ? <CheckCircle2 size={15} aria-hidden="true" /> : index + 1}</span>
                    <small>{lang === 'ar' ? step.ar : step.en}</small>
                  </li>)}
                </ol>

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

                {selectedOrder.status === 'COMPLETED' && !selectedOrder.releasedToPatientAt && (
                  <div className="glass-panel" style={{ padding: '1rem', marginBottom: '1rem' }}>
                    <div className="badge badge-success" style={{ marginBottom: '0.75rem', padding: '0.6rem' }}>
                      {lang === 'ar' ? 'اكتملت جميع النتائج' : 'All Results Completed'}
                    </div>
                    <p style={{ color: 'var(--text-secondary)' }}>
                      {lang === 'ar'
                        ? 'راجع النتائج ثم أفرج عنها لتظهر في بوابة المريض.'
                        : 'Review the results, then release them for the Patient Portal.'}
                    </p>
                    <button type="button" className="btn btn-primary" style={{ width: '100%' }} onClick={handleReleaseResults}>
                      {lang === 'ar' ? 'الإفراج عن النتائج للمريض' : 'Release Results to Patient'}
                    </button>
                  </div>
                )}

                {selectedOrder.releasedToPatientAt && <div className="laboratory-released-banner" role="status">
                  <ClipboardCheck size={18} aria-hidden="true" />
                  <div><strong>{lang === 'ar' ? 'تم الإفراج عن النتائج' : 'Results released'}</strong><span>{lang === 'ar' ? 'هذا الطلب محفوظ في السجل المختبري للقراءة والتدقيق.' : 'This order is retained in laboratory history for review and audit.'}</span></div>
                  <time dateTime={selectedOrder.releasedToPatientAt}>{new Date(selectedOrder.releasedToPatientAt).toLocaleString(lang === 'ar' ? 'ar' : 'en')}</time>
                </div>}

                {selectedOrder.items.filter((item) => item.labReviewStatus !== 'EXTERNAL').map((item) => {
                  const isCompleted =
                    item.resultValue !== null &&
                    item.resultValue !== undefined &&
                    String(item.resultValue).trim() !== '';
                  const hasUnsavedForm = Object.hasOwn(resultForms, item.id);

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

                      {isCompleted && !hasUnsavedForm ? (
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
          </main>
        </div>
      </div>
    </div>
  );
}
