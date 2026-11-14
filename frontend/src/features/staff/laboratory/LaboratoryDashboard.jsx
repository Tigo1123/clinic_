import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  FlaskConical,
  HelpCircle,
  History,
  Lock,
  Save
} from 'lucide-react';
import { apiErrorMessage, fetchWithAuth } from '../../../services/staff/staffApi';
import { useStaffNav } from '../staffShellContext';
import { createLatestRequestGate, mergeLabOrdersMonotonically } from './labOrderVersions';
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
  const [selectedReviewId, setSelectedReviewId] = useState(null);

  const queueRequestGateRef = useRef(null);
  if (queueRequestGateRef.current === null) queueRequestGateRef.current = createLatestRequestGate();

  const visibleOrders = orderView === 'work' ? orders : historyOrders;
  const selectedOrder = [...orders, ...historyOrders].find((order) => order.id === selectedOrderId) || null;

  // Rail navigation integration via useStaffNav
  const navItems = useMemo(() => [
    {
      id: 'work',
      label: lang === 'ar' ? 'قائمة العمل' : 'Work queue',
      icon: FlaskConical,
      count: orders.length,
    },
    {
      id: 'custom',
      label: lang === 'ar' ? 'مراجعة الفحوصات المخصصة' : 'Custom test review',
      icon: ClipboardCheck,
      count: reviewRequests.length,
    },
    {
      id: 'history',
      label: lang === 'ar' ? 'السجل المختبري' : 'History',
      icon: History,
    },
  ], [lang, orders.length, reviewRequests.length]);

  useStaffNav({
    items: navItems,
    activeId: orderView,
    onSelect: (id) => {
      setOrderView(id);
      setErrorMsg('');
      setSuccessMsg('');
    },
    roleLabel: lang === 'ar' ? 'فني مختبر' : 'Laboratory',
  });

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

  // Auto-select first order when none is selected or current selection is not visible
  useEffect(() => {
    if (orderView !== 'custom' && visibleOrders.length > 0) {
      if (!selectedOrderId || !visibleOrders.some((order) => order.id === selectedOrderId)) {
        setSelectedOrderId(visibleOrders[0].id);
      }
    }
  }, [visibleOrders, selectedOrderId, orderView]);

  // Auto-select first custom review request if none selected
  useEffect(() => {
    if (orderView === 'custom' && reviewRequests.length > 0) {
      if (!selectedReviewId || !reviewRequests.some((r) => r.id === selectedReviewId)) {
        setSelectedReviewId(reviewRequests[0].id);
      }
    }
  }, [reviewRequests, selectedReviewId, orderView]);

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

  const updateResultForm = (itemId, field, value) => {
    setResultForms((current) => ({
      ...current,
      [itemId]: {
        ...(current[itemId] || {}),
        [field]: value
      }
    }));
  };

  const handleSubmitResult = async (item) => {
    setErrorMsg('');
    setSuccessMsg('');

    if (!selectedOrder || selectedOrder.status !== 'SAMPLE_COLLECTED') {
      setErrorMsg(
        selectedOrder?.status === 'PAID'
          ? (lang === 'ar' ? 'يجب جمع العينة أولاً.' : 'Collect the sample first.')
          : (lang === 'ar' ? 'النتائج مقفلة حتى إتمام الدفع.' : 'Results are locked until payment is complete.')
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

  const handleSaveAllResults = async () => {
    if (!selectedOrder || selectedOrder.status !== 'SAMPLE_COLLECTED') {
      if (selectedOrder?.status === 'PAID') {
        setErrorMsg(lang === 'ar' ? 'يجب جمع العينة أولاً.' : 'Collect the sample first.');
      } else if (selectedOrder?.status === 'PENDING_BILLING') {
        setErrorMsg(lang === 'ar' ? 'النتائج مقفلة حتى إتمام الدفع.' : 'Results are locked until payment is complete.');
      }
      return;
    }
    const dirtyItems = selectedOrder.items.filter(
      (item) => item.labReviewStatus !== 'EXTERNAL' && resultForms[item.id]?.value?.trim()
    );
    if (dirtyItems.length === 0) return;
    for (const item of dirtyItems) {
      await handleSubmitResult(item);
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

  // Active items for table
  const activeOrderItems = useMemo(() => {
    if (!selectedOrder) return [];
    return selectedOrder.items.filter((item) => item.labReviewStatus !== 'EXTERNAL');
  }, [selectedOrder]);

  const enteredCount = useMemo(() => {
    return activeOrderItems.filter((i) => i.resultValue != null && String(i.resultValue).trim() !== '').length;
  }, [activeOrderItems]);

  const hasUnsavedEntries = useMemo(() => {
    return activeOrderItems.some((item) => resultForms[item.id]?.value?.trim());
  }, [activeOrderItems, resultForms]);

  const activeReviewRequest = reviewRequests.find((r) => r.id === (selectedReviewId || reviewRequests[0]?.id));
  const activeReviewForm = activeReviewRequest ? (reviewForms[activeReviewRequest.id] || {}) : {};

  return (
    <div className="dashboard-wrapper laboratory-dashboard" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <div className="workspace-panel laboratory-workspace">
        {orderView === 'custom' ? (
          /* ── CUSTOM TEST REVIEW SPLIT VIEW ───────────────────── */
          <section className={`laboratory-review-section ${reviewRequests.length === 0 ? 'is-empty' : ''}`} aria-labelledby="laboratory-review-title">
            {reviewRequests.length === 0 ? (
              <div className="laboratory-empty-state" role="status">
                <div className="laboratory-review-heading">
                  <span className="laboratory-review-icon">
                    <AlertTriangle size={17} aria-hidden="true" />
                  </span>
                  <div>
                    <h2 id="laboratory-review-title">
                      {lang === 'ar' ? 'مراجعة الفحوصات المخصصة' : 'Custom Test Review'}
                    </h2>
                    <p>
                      {lang === 'ar'
                        ? 'فحوصات كتبها الطبيب يدوياً وتحتاج إلى مطابقة أو اعتماد قبل التنفيذ.'
                        : 'Tests entered manually by a doctor that require review before processing.'}
                    </p>
                  </div>
                  <span className="laboratory-review-count">0</span>
                </div>
                <p className="laboratory-review-empty">
                  {lang === 'ar' ? 'لا توجد فحوصات مخصصة بانتظار المراجعة.' : 'No custom tests are awaiting review.'}
                </p>
              </div>
            ) : (
              <div className="laboratory-split ui-split">
                {/* Column 1: Custom test requests list */}
                <aside className="laboratory-orders-panel" aria-labelledby="laboratory-review-title">
                  <div className="laboratory-orders-header">
                    <div className="laboratory-orders-heading">
                      <h2 id="laboratory-review-title" className="laboratory-orders-title">
                        {lang === 'ar' ? 'مراجعة الفحوصات المخصصة' : 'Custom Test Review'}
                      </h2>
                      <span className="laboratory-orders-count">
                        {reviewRequests.length}{' '}
                        {lang === 'ar'
                          ? (reviewRequests.length === 1 ? 'فحص' : 'فحوصات')
                          : (reviewRequests.length === 1 ? 'request' : 'requests')}
                      </span>
                    </div>
                  </div>
                  <div className="laboratory-order-list">
                    {reviewRequests.map((request) => {
                      const isSelected = (selectedReviewId || reviewRequests[0]?.id) === request.id;
                      return (
                        <button
                          type="button"
                          key={request.id}
                          className={`laboratory-order-card ${isSelected ? 'selected' : ''}`}
                          onClick={() => setSelectedReviewId(request.id)}
                          aria-pressed={isSelected}
                        >
                          <span className="laboratory-order-card__start">
                            <strong className="laboratory-order-card__name">{request.customTestName}</strong>
                            <span className="laboratory-order-card__status laboratory-order-card__status--warn">
                              {lang === 'ar' ? request.labOrder.patient.fullNameAr : request.labOrder.patient.fullNameEn}
                            </span>
                          </span>
                          <span className="laboratory-order-card__end">
                            <span className="laboratory-order-card__time ui-mono">
                              {formatOrderTime(request.labOrder.orderDate)}
                            </span>
                            <span className="ui-status ui-status--warn">
                              {lang === 'ar' ? 'بانتظار المراجعة' : 'Pending review'}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </aside>

                {/* Column 2: Selected custom test detail & resolutions */}
                <main className="laboratory-results-panel" aria-labelledby="laboratory-review-detail-title">
                  {activeReviewRequest ? (() => {
                    const request = activeReviewRequest;
                    const form = activeReviewForm;
                    const mode = form.mode || '';
                    return (
                      <article className="laboratory-review-detail">
                        <header className="laboratory-detail-header">
                          <div className="laboratory-detail-title-group">
                            <span className="ui-section-label">{lang === 'ar' ? 'الفحص المطلوب' : 'Requested test'}</span>
                            <h1 id="laboratory-review-detail-title" className="ui-page-title">
                              {request.customTestName}
                            </h1>
                            <dl className="laboratory-review-meta">
                              <div>
                                <dt>{lang === 'ar' ? 'المريض' : 'Patient'}</dt>
                                <dd>{lang === 'ar' ? request.labOrder.patient.fullNameAr : request.labOrder.patient.fullNameEn}</dd>
                              </div>
                              <div>
                                <dt>{lang === 'ar' ? 'الطبيب' : 'Doctor'}</dt>
                                <dd>{lang === 'ar' ? request.labOrder.doctor.fullNameAr : request.labOrder.doctor.fullNameEn}</dd>
                              </div>
                              <div>
                                <dt>{lang === 'ar' ? 'تاريخ الطلب' : 'Requested'}</dt>
                                <dd className="ui-mono">{new Date(request.labOrder.orderDate).toLocaleDateString(lang === 'ar' ? 'ar' : 'en')}</dd>
                              </div>
                            </dl>
                          </div>
                          <span className="ui-status ui-status--warn">
                            {lang === 'ar' ? 'بانتظار المراجعة' : 'Pending review'}
                          </span>
                        </header>

                        {errorMsg && <div className="badge badge-danger" role="alert">{errorMsg}</div>}
                        {successMsg && <div className="badge badge-success" role="status">{successMsg}</div>}

                        <div className="laboratory-review-panel ui-panel">
                          <div className="laboratory-review-panel-heading">
                            <h3>{lang === 'ar' ? 'إجراء المراجعة' : 'Review Resolution'}</h3>
                            <p className="text-muted">
                              {lang === 'ar'
                                ? 'حدد مطابقة الفحص مع قائمة الخدمات الرسمية، أو أنشئ خدمة غير مسعرة ليراجعها المسؤول، أو صنف الفحص كخدمة خارجية.'
                                : 'Match the test with existing catalogue services, create an unpriced service for admin review, or classify as external.'}
                            </p>
                          </div>

                          <div className="laboratory-review-actions">
                            <button
                              className={`btn ${mode === 'LINK_EXISTING' ? 'btn-primary' : 'btn-secondary'}`}
                              type="button"
                              onClick={() => updateReviewForm(request.id, { mode: 'LINK_EXISTING' })}
                            >
                              {lang === 'ar' ? 'ربط بخدمة موجودة' : 'Link Existing'}
                            </button>
                            <button
                              className={`btn ${mode === 'CREATE_SERVICE' ? 'btn-primary' : 'btn-secondary'}`}
                              type="button"
                              onClick={() => updateReviewForm(request.id, {
                                mode: 'CREATE_SERVICE',
                                labelEn: form.labelEn || request.customTestName,
                                labelAr: form.labelAr || request.customTestName
                              })}
                            >
                              {lang === 'ar' ? 'إنشاء للمراجعة الإدارية' : 'Create for Admin Pricing'}
                            </button>
                            <button
                              className="btn btn-secondary"
                              type="button"
                              disabled={reviewingId === request.id}
                              onClick={() => handleReview(request, 'EXTERNAL')}
                            >
                              {lang === 'ar' ? 'خارجي / غير متوفر' : 'External / Not Available'}
                            </button>
                          </div>

                          {mode === 'LINK_EXISTING' && (
                            <div className="laboratory-resolution-content">
                              <div className="form-group">
                                <label className="form-label" htmlFor="select-lab-service">
                                  {lang === 'ar' ? 'اختر خدمة مختبرية من الدليل' : 'Select a laboratory service from the catalogue'}
                                </label>
                                <div className="laboratory-review-form-row">
                                  <select
                                    id="select-lab-service"
                                    className="form-input"
                                    value={form.serviceId || ''}
                                    onChange={(event) => updateReviewForm(request.id, { serviceId: event.target.value })}
                                  >
                                    <option value="">{lang === 'ar' ? 'اختر خدمة مختبرية' : 'Select a laboratory service'}</option>
                                    {labServices.map((service) => (
                                      <option key={service.id} value={service.id}>
                                        {lang === 'ar' ? service.labelAr : service.labelEn} — {Number(service.baseFeeSdg).toLocaleString()} SDG
                                      </option>
                                    ))}
                                  </select>
                                  <button
                                    className="btn btn-primary"
                                    type="button"
                                    disabled={!form.serviceId || reviewingId === request.id}
                                    onClick={() => handleReview(request, 'LINK_EXISTING')}
                                  >
                                    {lang === 'ar' ? 'تأكيد الربط' : 'Confirm Link'}
                                  </button>
                                </div>
                              </div>
                            </div>
                          )}

                          {mode === 'CREATE_SERVICE' && (
                            <div className="laboratory-resolution-content">
                              <div className="laboratory-create-inputs">
                                <div className="form-group">
                                  <label className="form-label">{lang === 'ar' ? 'الاسم بالعربية' : 'Arabic label'}</label>
                                  <input
                                    className="form-input"
                                    placeholder={lang === 'ar' ? 'الاسم بالعربية' : 'Arabic label'}
                                    value={form.labelAr || ''}
                                    onChange={(event) => updateReviewForm(request.id, { labelAr: event.target.value })}
                                  />
                                </div>
                                <div className="form-group">
                                  <label className="form-label">{lang === 'ar' ? 'الاسم بالإنجليزية' : 'English label'}</label>
                                  <input
                                    className="form-input"
                                    placeholder={lang === 'ar' ? 'الاسم بالإنجليزية' : 'English label'}
                                    value={form.labelEn || ''}
                                    onChange={(event) => updateReviewForm(request.id, { labelEn: event.target.value })}
                                  />
                                </div>
                              </div>
                              <p className="laboratory-create-hint text-muted">
                                {lang === 'ar'
                                  ? 'ستبقى الخدمة غير نشطة وغير قابلة للفوترة حتى يحدد المسؤول سعرها الرسمي.'
                                  : 'The service remains inactive and non-billable until an administrator configures its official price.'}
                              </p>
                              <button
                                className="btn btn-primary"
                                type="button"
                                disabled={!form.labelAr?.trim() || !form.labelEn?.trim() || reviewingId === request.id}
                                onClick={() => handleReview(request, 'CREATE_SERVICE')}
                              >
                                {lang === 'ar' ? 'إنشاء وربط الخدمة المعلقة' : 'Create and Link Pending Service'}
                              </button>
                            </div>
                          )}
                        </div>
                      </article>
                    );
                  })() : (
                    <div className="laboratory-no-selection">
                      <HelpCircle size={48} aria-hidden="true" />
                      <h2>{lang === 'ar' ? 'لم يتم تحديد فحص' : 'No request selected'}</h2>
                      <p>{lang === 'ar' ? 'اختر فحصاً مخصصاً من القائمة لعرض التفاصيل وتحديد الإجراء.' : 'Select a custom test from the list to review and resolve.'}</p>
                    </div>
                  )}
                </main>
              </div>
            )}
          </section>
        ) : (
          /* ── WORK QUEUE & HISTORY SPLIT VIEW ─────────────────── */
          <div className="laboratory-split ui-split">
            {/* COLUMN 1: ORDERS LIST */}
            <aside className="laboratory-orders-panel" aria-label={lang === 'ar' ? 'طلبات المختبر' : 'Laboratory Orders'} aria-labelledby="laboratory-orders-title">
              <div className="laboratory-orders-header">
                <div className="laboratory-orders-heading">
                  <h2 id="laboratory-orders-title" className="laboratory-orders-title">
                    {orderView === 'history'
                      ? (lang === 'ar' ? 'السجل المختبري' : 'History')
                      : (lang === 'ar' ? 'قائمة العمل' : 'Work queue')}
                  </h2>
                  <span className="laboratory-orders-count">
                    {visibleOrders.length}{' '}
                    {lang === 'ar'
                      ? (visibleOrders.length === 1 ? 'طلب' : 'طلبات')
                      : (visibleOrders.length === 1 ? 'order' : 'orders')}
                  </span>
                </div>

                {/* Accessible tablist matching test specifications and assistive needs */}
                <div className="laboratory-order-tabs sr-only" role="tablist" aria-label={lang === 'ar' ? 'عرض طلبات المختبر' : 'Laboratory order view'}>
                  <button type="button" role="tab" aria-selected={orderView === 'work'} className={orderView === 'work' ? 'is-active' : ''} onClick={() => { setOrderView('work'); setSelectedOrderId(null); }}><FlaskConical size={15} />{lang === 'ar' ? 'قائمة العمل' : 'Work Queue'}<span>{orders.length}</span></button>
                  <button type="button" role="tab" aria-selected={orderView === 'history'} className={orderView === 'history' ? 'is-active' : ''} onClick={() => { setOrderView('history'); setSelectedOrderId(null); }}><History size={15} />{lang === 'ar' ? 'السجل المختبري' : 'Lab History'}<span>{historyOrders.length}</span></button>
                </div>
              </div>

              {historyLoading && orderView === 'history' ? (
                <div className="laboratory-orders-empty" role="status">
                  {lang === 'ar' ? 'جارٍ تحميل السجل المختبري...' : 'Loading laboratory history...'}
                </div>
              ) : visibleOrders.length === 0 ? (
                <div className="laboratory-orders-empty" role="status">
                  <HelpCircle size={36} aria-hidden="true" />
                  <p>
                    {orderView === 'work'
                      ? (lang === 'ar' ? 'لا توجد طلبات فحوصات مخبرية بانتظار الإجراء حالياً.' : 'There are no laboratory orders requiring action.')
                      : (lang === 'ar' ? 'لا توجد طلبات مختبرية مكتملة في السجل.' : 'There are no completed laboratory orders in history.')}
                  </p>
                </div>
              ) : (
                <div className="laboratory-order-list">
                  {visibleOrders.map((ord) => {
                    const isSelected = selectedOrder?.id === ord.id;
                    const { text: subtitle, tone } = getOrderSubtitle(ord, lang);
                    return (
                      <button
                        type="button"
                        key={ord.id}
                        className={`laboratory-order-card ${isSelected ? 'selected' : ''}`}
                        onClick={() => setSelectedOrderId(ord.id)}
                        aria-pressed={isSelected}
                      >
                        <span className="laboratory-order-card__start">
                          <strong className="laboratory-order-card__name">
                            {lang === 'ar' ? ord.patient.fullNameAr : ord.patient.fullNameEn}
                          </strong>
                          <span className={`laboratory-order-card__status laboratory-order-card__status--${tone}`}>
                            {subtitle}
                          </span>
                        </span>
                        <span className="laboratory-order-card__end">
                          <span className="laboratory-order-card__time ui-mono">
                            {formatOrderTime(ord.orderDate)}
                          </span>
                          <span className="laboratory-order-card__mrn ui-mono">
                            <bdi dir="ltr">{ord.patient.fileNumber || ''}</bdi>
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </aside>

            {/* COLUMN 2: RESULTS ENTRY / DETAIL PANEL */}
            <main className="laboratory-results-panel" aria-label={lang === 'ar' ? 'تسجيل نتائج الفحوصات' : 'Laboratory Results Entry'} aria-labelledby="lab-order-title">
              {errorMsg && <div className="badge badge-danger" role="alert">{errorMsg}</div>}
              {successMsg && <div className="badge badge-success" role="status">{successMsg}</div>}

              {selectedOrder ? (
                <>
                  <header className="laboratory-detail-header">
                    <div className="laboratory-detail-title-group">
                      <h1 id="lab-order-title" className="ui-page-title">
                        {lang === 'ar' ? selectedOrder.patient.fullNameAr : selectedOrder.patient.fullNameEn}
                      </h1>
                      <div className="laboratory-detail-subtitle text-muted">
                        <span>
                          {lang === 'ar' ? 'الطبيب طالب الفحص: ' : 'Ordering Doctor: '}
                          {lang === 'ar' ? selectedOrder.doctor.fullNameAr : selectedOrder.doctor.fullNameEn}
                          {lang === 'ar' ? ' عند ' : ' at '}
                          <span className="ui-mono">{formatOrderTime(selectedOrder.orderDate)}</span>
                        </span>
                        <span> · </span>
                        <span className="ui-mono">{selectedOrder.patient.fileNumber || ''}</span>
                      </div>
                    </div>
                    <div className="laboratory-detail-progress">
                      <span className="laboratory-progress-text">
                        {selectedOrder.releasedToPatientAt
                          ? (lang === 'ar' ? 'تم الإفراج عن النتائج' : 'Results released to patient')
                          : selectedOrder.status === 'COMPLETED'
                            ? (lang === 'ar' ? 'اكتملت جميع النتائج' : 'All results entered')
                            : (lang === 'ar'
                                ? `${enteredCount} من ${activeOrderItems.length} نتائج مسجلة`
                                : `${enteredCount} of ${activeOrderItems.length} results entered`)}
                      </span>
                    </div>
                  </header>

                  <ol className="laboratory-workflow" aria-label={lang === 'ar' ? 'مراحل سير طلب المختبر' : 'Laboratory order workflow'}>
                    {workflowSteps.map((step, index) => (
                      <li className={index < selectedWorkflowPosition ? 'is-done' : index === selectedWorkflowPosition ? 'is-current' : ''} key={step.en}>
                        <span>{index < selectedWorkflowPosition ? <CheckCircle2 size={15} aria-hidden="true" /> : index + 1}</span>
                        <small>{lang === 'ar' ? step.ar : step.en}</small>
                      </li>
                    ))}
                  </ol>

                  {/* Status guards and banners */}
                  {selectedOrder.items.some((item) => item.labReviewStatus === 'PENDING_REVIEW') ? (
                    <div className="laboratory-status-notice laboratory-status-notice--pending">
                      <div className="laboratory-status-notice__text">
                        <strong>{lang === 'ar' ? 'مراجعة مطلوبة' : 'Review Required'}</strong>
                        <span>{lang === 'ar' ? 'يجب مراجعة الفحص المخصص وربطه أو تسعيره قبل إصدار الفاتورة.' : 'The custom test must be reviewed, linked, or priced before billing.'}</span>
                      </div>
                    </div>
                  ) : selectedOrder.status === 'PENDING_BILLING' && (
                    <div className="laboratory-status-notice laboratory-status-notice--pending">
                      <span className="laboratory-status-notice__icon">
                        <Lock size={16} aria-hidden="true" />
                      </span>
                      <div className="laboratory-status-notice__text">
                        <strong>{lang === 'ar' ? 'بانتظار الدفع' : 'Waiting for Payment'}</strong>
                        <span>{lang === 'ar' ? 'النتائج مقفلة حتى إتمام الدفع. الطلب بانتظار إتمام الدفع لدى الاستقبال. لا يمكن جمع العينة أو إدخال النتائج.' : 'Results are locked until payment is complete. Waiting for payment at reception. Sample collection and result entry are locked.'}</span>
                      </div>
                    </div>
                  )}

                  {selectedOrder.status === 'PAID' && (
                    <div className="laboratory-status-notice laboratory-status-notice--paid">
                      <div className="laboratory-status-notice__text">
                        <strong>{lang === 'ar' ? 'تم الدفع بالكامل' : 'Payment Complete'}</strong>
                        <span>{lang === 'ar' ? 'يجب جمع العينة أولاً. سجّل جمع العينة قبل البدء بإدخال نتائج الفحوصات.' : 'Collect the sample first. Sample collection must be recorded before entering test results.'}</span>
                      </div>
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={handleCollectSample}
                      >
                        {lang === 'ar' ? 'تأكيد جمع العينة' : 'Collect Sample'}
                      </button>
                    </div>
                  )}

                  {selectedOrder.status === 'SAMPLE_COLLECTED' && (
                    <div className="laboratory-status-notice laboratory-status-notice--ready">
                      <span className="laboratory-status-notice__icon">
                        <FlaskConical size={16} aria-hidden="true" />
                      </span>
                      <div className="laboratory-status-notice__text">
                        <strong>{lang === 'ar' ? 'تم جمع العينة' : 'Sample Collected'}</strong>
                        <span>{lang === 'ar' ? 'تم جمع العينة — يمكن إدخال النتائج الآن.' : 'Sample collected — results can now be entered.'}</span>
                      </div>
                    </div>
                  )}

                  {selectedOrder.status === 'COMPLETED' && !selectedOrder.releasedToPatientAt && (
                    <div className="laboratory-status-notice laboratory-status-notice--ready">
                      <div className="laboratory-status-notice__text">
                        <strong>{lang === 'ar' ? 'اكتملت جميع النتائج' : 'All Results Completed'}</strong>
                        <span>{lang === 'ar' ? 'راجع النتائج ثم أفرج عنها لتظهر في بوابة المريض.' : 'Review the results, then release them for the Patient Portal.'}</span>
                      </div>
                    </div>
                  )}

                  {selectedOrder.releasedToPatientAt && (
                    <div className="laboratory-released-banner" role="status">
                      <ClipboardCheck size={18} aria-hidden="true" />
                      <div>
                        <strong>{lang === 'ar' ? 'تم الإفراج عن النتائج' : 'Results released'}</strong>
                        <span>{lang === 'ar' ? 'هذا الطلب محفوظ في السجل المختبري للقراءة والتدقيق.' : 'This order is retained in laboratory history for review and audit.'}</span>
                      </div>
                      <time dateTime={selectedOrder.releasedToPatientAt}>
                        {new Date(selectedOrder.releasedToPatientAt).toLocaleString(lang === 'ar' ? 'ar' : 'en')}
                      </time>
                    </div>
                  )}

                  {/* Table of tests */}
                  <div className="laboratory-table-container ui-panel">
                    <div className="laboratory-table-inner">
                      <div className="laboratory-table-header">
                        <span>{lang === 'ar' ? 'الفحص' : 'Test'}</span>
                        <span>{lang === 'ar' ? 'النتيجة' : 'Result'}</span>
                        <span>{lang === 'ar' ? 'ملاحظة للطبيب' : 'Note for the doctor'}</span>
                        <span>{lang === 'ar' ? 'الحالة' : 'Status'}</span>
                      </div>
                      {activeOrderItems.map((item) => {
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

                        const displayValue = hasUnsavedForm
                          ? form.value
                          : (item.resultValue != null ? String(item.resultValue) : '');
                        const displayNote = form.note || '';

                        const valParsed = Number(form.value);
                        const minParsed = Number(form.min);
                        const maxParsed = Number(form.max);
                        const isOutOfRange = Boolean(item.isOutOfRange) || (
                          form.value !== '' &&
                          Number.isFinite(valParsed) &&
                          ((form.min !== '' && valParsed < minParsed) || (form.max !== '' && valParsed > maxParsed))
                        );

                        const isReadOnly = selectedOrder.status !== 'SAMPLE_COLLECTED' || Boolean(selectedOrder.releasedToPatientAt) || orderView === 'history';

                        let statusTone = 'muted';
                        let statusText = lang === 'ar' ? 'معلق' : 'Pending';

                        if (isOutOfRange) {
                          statusTone = 'danger';
                          statusText = lang === 'ar' ? 'خارج النطاق' : 'Out of range';
                        } else if (isCompleted && !hasUnsavedForm) {
                          statusTone = 'ok';
                          statusText = lang === 'ar' ? 'تم الإدخال' : 'Entered';
                        } else if (hasUnsavedForm) {
                          statusTone = 'warn';
                          statusText = lang === 'ar' ? 'قيد التعديل' : 'Editing';
                        }

                        return (
                          <div key={item.id} className="laboratory-table-row">
                            <div className="laboratory-test-name-cell">
                              <span className="laboratory-test-name">{testName}</span>
                              {(item.referenceRangeMin != null || item.referenceRangeMax != null) && (
                                <span className="laboratory-test-ref ui-mono">
                                  {lang === 'ar' ? 'المرجع الافتراضي: ' : 'Default ref: '}
                                  {item.referenceRangeMin ?? '—'} – {item.referenceRangeMax ?? '—'}
                                </span>
                              )}
                              <div className="laboratory-ref-inputs">
                                <div className="laboratory-ref-field">
                                  <label htmlFor={`ref-min-${item.id}`} className="laboratory-ref-label">
                                    {lang === 'ar' ? 'الحد الأدنى' : 'Reference min'}
                                  </label>
                                  <input
                                    id={`ref-min-${item.id}`}
                                    type="number"
                                    step="any"
                                    placeholder={
                                      item.referenceRangeMin != null
                                        ? String(item.referenceRangeMin)
                                        : (lang === 'ar' ? 'الحد الأدنى' : 'Reference min')
                                    }
                                    aria-label={lang === 'ar' ? 'الحد الأدنى للنطاق المرجعي' : 'Reference range minimum'}
                                    className="form-input laboratory-ref-input"
                                    value={form.min ?? ''}
                                    disabled={isReadOnly}
                                    onChange={(e) => updateResultForm(item.id, 'min', e.target.value)}
                                  />
                                </div>
                                <div className="laboratory-ref-field">
                                  <label htmlFor={`ref-max-${item.id}`} className="laboratory-ref-label">
                                    {lang === 'ar' ? 'الحد الأعلى' : 'Reference max'}
                                  </label>
                                  <input
                                    id={`ref-max-${item.id}`}
                                    type="number"
                                    step="any"
                                    placeholder={
                                      item.referenceRangeMax != null
                                        ? String(item.referenceRangeMax)
                                        : (lang === 'ar' ? 'الحد الأعلى' : 'Reference max')
                                    }
                                    aria-label={lang === 'ar' ? 'الحد الأعلى للنطاق المرجعي' : 'Reference range maximum'}
                                    className="form-input laboratory-ref-input"
                                    value={form.max ?? ''}
                                    disabled={isReadOnly}
                                    onChange={(e) => updateResultForm(item.id, 'max', e.target.value)}
                                  />
                                </div>
                              </div>
                            </div>

                            <div>
                              <input
                                type="text"
                                aria-label={lang === 'ar' ? `نتيجة ${testName}` : `Result for ${testName}`}
                                placeholder={
                                  selectedOrder.status === 'PAID'
                                    ? (lang === 'ar' ? 'يجب جمع العينة أولاً.' : 'Collect the sample first.')
                                    : selectedOrder.status === 'PENDING_BILLING'
                                      ? (lang === 'ar' ? 'النتائج مقفلة حتى إتمام الدفع.' : 'Results are locked until payment is complete.')
                                      : (lang === 'ar' ? 'قيمة النتيجة، مثال: 13.5' : 'Result value, e.g. 13.5')
                                }
                                className={`form-input laboratory-result-input ${isOutOfRange ? 'is-out-of-range' : ''}`}
                                value={displayValue}
                                disabled={isReadOnly}
                                onChange={(e) => updateResultForm(item.id, 'value', e.target.value)}
                              />
                              {isOutOfRange && (
                                <span className="laboratory-row-out-warning">
                                  <AlertTriangle size={13} aria-hidden="true" />
                                  <span>{lang === 'ar' ? 'تنبيه: النتيجة خارج النطاق المرجعي' : 'Warning: Result is outside the reference range'}</span>
                                </span>
                              )}
                              {isReadOnly && !isCompleted && (
                                <span className="laboratory-row-disabled-hint">
                                  {selectedOrder.status === 'PAID' ? (
                                    <span>{lang === 'ar' ? 'يجب جمع العينة أولاً.' : 'Collect the sample first.'}</span>
                                  ) : selectedOrder.status === 'PENDING_BILLING' ? (
                                    <span className="laboratory-hint-with-icon">
                                      <Lock size={12} aria-hidden="true" />
                                      <span>{lang === 'ar' ? 'النتائج مقفلة حتى إتمام الدفع.' : 'Results are locked until payment is complete.'}</span>
                                    </span>
                                  ) : null}
                                </span>
                              )}
                            </div>

                            <div>
                              <input
                                type="text"
                                aria-label={lang === 'ar' ? `ملاحظة لـ ${testName}` : `Note for ${testName}`}
                                placeholder={lang === 'ar' ? 'اختياري' : 'Optional'}
                                className="form-input"
                                value={displayNote}
                                disabled={isReadOnly}
                                onChange={(e) => updateResultForm(item.id, 'note', e.target.value)}
                              />
                            </div>

                            <div className="laboratory-test-status-cell">
                              <span className={`ui-status ui-status--${statusTone}`}>
                                {statusText}
                              </span>
                              {selectedOrder.status === 'SAMPLE_COLLECTED' && hasUnsavedForm && (
                                <button
                                  type="button"
                                  className="laboratory-row-save-btn btn btn-secondary"
                                  onClick={() => handleSubmitResult(item)}
                                  title={lang === 'ar' ? 'حفظ نتيجة الفحص' : 'Save Test Result'}
                                  aria-label={lang === 'ar' ? `حفظ نتيجة الفحص: ${testName}` : `Save Test Result: ${testName}`}
                                >
                                  <Save size={16} aria-hidden="true" />
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Footer actions */}
                  <div className="laboratory-footer-bar">
                    <span className="laboratory-footer-hint text-muted">
                      {selectedOrder.releasedToPatientAt
                        ? (lang === 'ar' ? 'هذا الطلب محفوظ في السجل المختبري للقراءة والتدقيق.' : 'This order is retained in laboratory history for review and audit.')
                        : (lang === 'ar' ? 'تصل النتائج إلى المريض فقط بعد الإفراج عنها.' : 'Results reach the patient only after you release them.')}
                    </span>
                    <div className="laboratory-footer-actions">
                      <button
                        type="button"
                        className={`btn ${selectedOrder.status === 'COMPLETED' && !selectedOrder.releasedToPatientAt ? 'btn-primary' : 'btn-secondary'}`}
                        disabled={selectedOrder.status !== 'COMPLETED' || Boolean(selectedOrder.releasedToPatientAt)}
                        onClick={handleReleaseResults}
                      >
                        {lang === 'ar' ? 'الإفراج عن النتائج للمريض' : 'Release Results to Patient'}
                      </button>
                      <button
                        type="button"
                        className={`btn ${selectedOrder.status === 'SAMPLE_COLLECTED' ? 'btn-primary' : 'btn-secondary'}`}
                        disabled={selectedOrder.status !== 'SAMPLE_COLLECTED' || !hasUnsavedEntries}
                        onClick={handleSaveAllResults}
                      >
                        <Save size={18} strokeWidth={1.8} aria-hidden="true" />
                        <span>{lang === 'ar' ? 'حفظ النتائج' : 'Save results'}</span>
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="laboratory-no-selection">
                  <FlaskConical size={48} aria-hidden="true" />
                  <h2>{lang === 'ar' ? 'لم يتم تحديد طلب' : 'No order selected'}</h2>
                  <p>
                    {orderView === 'history'
                      ? (lang === 'ar' ? 'اختر طلباً من السجل لعرض نتائجه المفرج عنها.' : 'Select an order from history to view released results.')
                      : (lang === 'ar' ? 'اختر طلب فحص من القائمة لعرض التفاصيل وتسجيل النتائج.' : 'Select a laboratory order from the list to view details and enter results.')}
                  </p>
                </div>
              )}
            </main>
          </div>
        )}
      </div>
    </div>
  );
}

function formatOrderTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

function getOrderSubtitle(ord, lang) {
  const count = ord.items?.length || 0;
  const countStr = lang === 'ar'
    ? `${count} ${count === 1 ? 'فحص' : 'فحوصات'}`
    : `${count} ${count === 1 ? 'test' : 'tests'}`;

  let stateStr = '';
  let tone = 'muted';

  if (ord.releasedToPatientAt) {
    stateStr = lang === 'ar' ? 'تم الإفراج عن النتائج' : 'Results Released';
    tone = 'ok';
  } else if (ord.items?.some((item) => item.labReviewStatus === 'PENDING_REVIEW')) {
    stateStr = lang === 'ar' ? 'مراجعة مطلوبة' : 'review required';
    tone = 'warn';
  } else if (ord.status === 'PENDING_BILLING') {
    stateStr = lang === 'ar' ? 'بانتظار الدفع' : 'awaiting payment';
    tone = 'warn';
  } else if (ord.status === 'PAID') {
    stateStr = lang === 'ar' ? 'جاهز لجمع العينة' : 'ready for sample';
    tone = 'ok';
  } else if (ord.status === 'COMPLETED') {
    stateStr = lang === 'ar' ? 'جاهز للإفراج' : 'ready to release';
    tone = 'ok';
  } else if (ord.status === 'SAMPLE_COLLECTED') {
    const entered = ord.items.filter((i) => i.resultValue != null && String(i.resultValue).trim() !== '').length;
    if (entered === 0) {
      stateStr = lang === 'ar' ? 'لم يبدأ' : 'not started';
      tone = 'muted';
    } else {
      stateStr = lang === 'ar' ? `تم إدخال ${entered}` : `${entered} entered`;
      tone = 'ok';
    }
  } else {
    stateStr = lang === 'ar' ? 'تم جمع العينة' : 'sample collected';
    tone = 'ok';
  }

  return { text: `${countStr} · ${stateStr}`, tone };
}
