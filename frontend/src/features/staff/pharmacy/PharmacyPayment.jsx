import { guardFormSubmit } from '../../../utils/guardFormSubmit.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ReceiptText, RefreshCw } from 'lucide-react';
import { apiErrorMessage, fetchWithAuth } from '../../../services/staff/staffApi';
import { buildPaymentPayload, newPaymentAttempt, pharmacyBillingPendingCopy, pharmacyBillingRequiresReview } from './pharmacyHelpers';

const methodLabels = { CASH: 'Cash', CARD: 'Card', BANKAK: 'Bankak', FAWRY: 'Fawry' };

function localizedPaymentStatus(status, lang) {
  switch (status) {
    case 'PAID':
      return { text: lang === 'ar' ? 'مدفوع' : 'Paid', tone: 'ok' };
    case 'PARTIAL':
    case 'PARTIALLY_PAID':
      return { text: lang === 'ar' ? 'مدفوع جزئياً' : 'Part paid', tone: 'warn' };
    case 'UNPAID':
      return { text: lang === 'ar' ? 'غير مدفوع' : 'Unpaid', tone: 'warn' };
    case 'UNBILLED':
      return { text: lang === 'ar' ? 'غير مفوتر' : 'Unbilled', tone: 'muted' };
    default:
      return { text: status || (lang === 'ar' ? 'غير مفوتر' : 'Unbilled'), tone: 'muted' };
  }
}

export default function PharmacyPayment({ prescriptionId, lang, onStateChange, paymentAttempts }) {
  const [state, setState] = useState(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('CASH');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [reconciliationRequired, setReconciliationRequired] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });
  const submittingRef = useRef(false);
  const reconciliationRequiredRef = useRef(false);
  const stateRequestRef = useRef(0);
  const mountedRef = useRef(true);

  const requireReconciliation = useCallback((required) => {
    reconciliationRequiredRef.current = required;
    setReconciliationRequired(required);
  }, []);

  const loadState = useCallback(async () => {
    if (!prescriptionId) return null;
    const requestId = ++stateRequestRef.current;
    setLoading(true);
    try {
      const response = await fetchWithAuth(`/api/pharmacy/prescriptions/${prescriptionId}/payment-state`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok && pharmacyBillingRequiresReview(payload?.error?.code)) {
        const pendingState = {
          prescriptionId,
          invoice: null,
          billingPending: { code: payload.error.code },
          dispensingAllowed: false,
          allowedPaymentMethods: []
        };
        if (!mountedRef.current || requestId !== stateRequestRef.current) return null;
        setState(pendingState);
        setAmount('');
        onStateChange?.(pendingState);
        return pendingState;
      }
      if (!response.ok) throw new Error(apiErrorMessage(payload, 'Unable to load payment state.'));
      if (!mountedRef.current || requestId !== stateRequestRef.current) return null;
      setState(payload);
      setMethod(current => (payload.allowedPaymentMethods || []).includes(current) ? current : payload.allowedPaymentMethods?.[0] || '');
      setAmount(payload.invoice?.outstandingAmountSdg > 0 ? String(payload.invoice.outstandingAmountSdg) : '');
      if (reconciliationRequiredRef.current && !paymentAttempts.has(prescriptionId)) {
        requireReconciliation(false);
      }
      onStateChange?.(payload);
      return payload;
    } catch (error) {
      if (mountedRef.current && requestId === stateRequestRef.current) setMessage({ type: 'danger', text: error.message });
      return null;
    } finally {
      if (mountedRef.current && requestId === stateRequestRef.current) setLoading(false);
    }
  }, [onStateChange, paymentAttempts, prescriptionId, requireReconciliation]);

  useEffect(() => {
    mountedRef.current = true;
    setState(null);
    setMessage({ type: '', text: '' });
    requireReconciliation(paymentAttempts.has(prescriptionId));
    loadState();
    return () => { mountedRef.current = false; stateRequestRef.current += 1; };
  }, [loadState, paymentAttempts, prescriptionId, requireReconciliation]);

  const sendAttempt = async (attempt) => {
    if (submittingRef.current || !attempt) return;
    submittingRef.current = true;
    paymentAttempts.set(prescriptionId, attempt);
    setSubmitting(true);
    setMessage({ type: '', text: '' });
    const clearAttempt = () => {
      if (paymentAttempts.get(prescriptionId) === attempt) paymentAttempts.delete(prescriptionId);
    };
    try {
      const response = await fetchWithAuth(`/api/billing/invoice/${attempt.invoiceId}/payments`, {
        method: 'POST',
        headers: { 'Idempotency-Key': attempt.idempotencyKey },
        body: JSON.stringify(buildPaymentPayload(attempt.amount, attempt.paymentMethod))
      });
      const payload = await response.json().catch(() => ({}));
      const uncertain = response.status >= 500 || response.status === 408;
      if (!uncertain) clearAttempt();
      if (!mountedRef.current) return;
      if (!response.ok) {
        requireReconciliation(true);
        if (!uncertain) await loadState();
        setMessage({ type: 'danger', text: apiErrorMessage(payload, lang === 'ar' ? 'تعذر تأكيد تسجيل الدفع.' : 'Could not confirm the payment.') });
        return;
      }
      requireReconciliation(true);
      const refreshed = await loadState();
      if (refreshed) {
        setMessage({ type: 'success', text: refreshed.dispensingAllowed ? (lang === 'ar' ? 'تم دفع فاتورة الأدوية بالكامل.' : 'Medicine invoice paid in full.') : (lang === 'ar' ? 'تم تسجيل الدفعة الجزئية.' : 'Partial payment recorded.') });
      } else if (mountedRef.current) {
        setMessage({ type: 'warning', text: lang === 'ar' ? 'قبل الخادم الدفع، لكن تعذر تحديث حالة الفاتورة. تحقق من الحالة قبل أي دفعة أخرى.' : 'The server accepted the payment, but invoice refresh failed. Reconcile state before another payment.' });
      }
    } catch {
      if (mountedRef.current) {
        requireReconciliation(true);
        setMessage({ type: 'danger', text: lang === 'ar' ? 'تعذر تأكيد تسجيل الدفع.' : 'Could not confirm the payment.' });
      }
    } finally {
      submittingRef.current = false;
      if (mountedRef.current) setSubmitting(false);
    }
  };

  const submit = (event) => {
    event.preventDefault();
    if (reconciliationRequiredRef.current || paymentAttempts.has(prescriptionId)) return;
    const invoice = state?.invoice;
    const numericAmount = Number(amount);
    if (!invoice || !Number.isSafeInteger(numericAmount) || numericAmount <= 0) {
      setMessage({ type: 'danger', text: lang === 'ar' ? 'أدخل مبلغاً صحيحاً أكبر من صفر.' : 'Enter a positive whole payment amount.' });
      return;
    }
    sendAttempt(newPaymentAttempt(invoice.id, numericAmount, method));
  };

  const pendingAttempt = paymentAttempts.get(prescriptionId);
  const reconciliationNotice = reconciliationRequired && (
    <div className="pharmacy-amber-notice pharmacy-amber-notice--spaced">
      <span>{pendingAttempt
        ? (lang === 'ar' ? 'نتيجة الطلب غير مؤكدة. أعد إرسال الدفعة نفسها للتحقق من تسجيلها.' : 'The payment outcome is uncertain. Retry the same payment to confirm it.')
        : (lang === 'ar' ? 'حدّث حالة الفاتورة قبل تسجيل دفعة أخرى.' : 'Refresh the invoice before recording another payment.')}</span>
      {pendingAttempt && (
        <button type="button" disabled={loading || submitting} onClick={() => sendAttempt(pendingAttempt)}>
          {lang === 'ar' ? 'إعادة محاولة الدفع' : 'Retry payment'}
        </button>
      )}
      <button type="button" disabled={loading || submitting} onClick={loadState}>
        {lang === 'ar' ? 'التحقق من حالة الدفع' : 'Reconcile payment state'}
      </button>
    </div>
  );

  if (loading && !state) {
    return (
      <section className="pharmacy-payment-wrapper ui-panel" aria-labelledby="medicine-invoice-title">
        <div className="pharmacy-compact-empty">
          <p className="pharmacy-empty-text">{lang === 'ar' ? 'جارٍ تحميل فاتورة الأدوية…' : 'Loading medicine invoice…'}</p>
        </div>
      </section>
    );
  }

  if (!state?.invoice) {
    return (
      <section className="pharmacy-payment-wrapper ui-panel pharmacy-review-card" aria-labelledby="medicine-invoice-title">
        <h3 id="medicine-invoice-title" className="pharmacy-list-title">
          {lang === 'ar' ? 'فاتورة الأدوية' : 'Medicine Invoice'}
        </h3>
        <p className="pharmacy-dispense-hint">{pharmacyBillingPendingCopy(state?.billingPending?.code, lang)}</p>
        {message.text && <p role="status">{message.text}</p>}
        {reconciliationNotice}
        <div>
          <button type="button" className="btn btn-secondary" disabled={loading} onClick={loadState}>
            <RefreshCw size={15} /> {lang === 'ar' ? 'تحديث' : 'Refresh'}
          </button>
        </div>
      </section>
    );
  }

  const invoice = state.invoice;
  const paymentStatusInfo = localizedPaymentStatus(invoice.paymentStatus, lang);

  return (
    <section className="pharmacy-payment-wrapper" aria-labelledby="medicine-invoice-title">
      <div className="pharmacy-payment-header">
        <h3 id="medicine-invoice-title" className="pharmacy-list-title ui-section-label">
          {lang === 'ar' ? 'فاتورة الأدوية' : 'Medicine Invoice'}
        </h3>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={loading || submitting}
          onClick={loadState}
        >
          <RefreshCw size={14} /> {lang === 'ar' ? 'تحديث الحالة' : 'Refresh state'}
        </button>
      </div>

      <div className="pharmacy-payment-section">
        <dl className="pharmacy-totals-card ui-panel">
          <div className="pharmacy-totals-row">
            <dt>{lang === 'ar' ? 'إجمالي الفاتورة' : 'Invoice total'}</dt>
            <dd className="ui-mono">SDG {invoice.totalAmountSdg.toLocaleString()}</dd>
          </div>
          <div className="pharmacy-totals-row">
            <dt>{lang === 'ar' ? 'المدفوع' : 'Paid'}</dt>
            <dd className="ui-mono">SDG {invoice.paidAmountSdg.toLocaleString()}</dd>
          </div>
          <div className="pharmacy-totals-row pharmacy-totals-row--total">
            <dt>{lang === 'ar' ? 'المتبقي' : 'Outstanding'}</dt>
            <dd className="ui-mono">SDG {invoice.outstandingAmountSdg.toLocaleString()}</dd>
          </div>
          <div className="pharmacy-totals-row">
            <dt>{lang === 'ar' ? 'حالة الدفع' : 'Payment status'}</dt>
            <dd>
              <span className={`ui-status ui-status--${paymentStatusInfo.tone}`}>
                {paymentStatusInfo.text}
              </span>
            </dd>
          </div>
        </dl>

        {state.dispensingAllowed ? (
          <div className="pharmacy-totals-card pharmacy-paid-card ui-panel">
            <span className="ui-status ui-status--ok pharmacy-paid-status">
              {lang === 'ar' ? 'تم دفع فاتورة الأدوية بالكامل' : 'Medicine invoice is fully paid'}
            </span>
          </div>
        ) : (
          <form className="pharmacy-payment-form-card ui-panel" onSubmit={event => guardFormSubmit(event, submit)}>
            <label className="pharmacy-payment-field">
              <span className="form-label ui-section-label">{lang === 'ar' ? 'طريقة الدفع' : 'Payment method'}</span>
              <select
                className="form-input"
                disabled={submitting || reconciliationRequired}
                value={method}
                onChange={(event) => setMethod(event.target.value)}
              >
                {(state.allowedPaymentMethods || []).map((value) => (
                  <option key={value} value={value}>
                    {state.paymentMethodOptions?.find(option => option.code === value)?.[lang === 'ar' ? 'labelAr' : 'labelEn'] || methodLabels[value] || value}
                  </option>
                ))}
              </select>
            </label>

            <label className="pharmacy-payment-field">
              <span className="form-label ui-section-label">{lang === 'ar' ? 'المبلغ (SDG)' : 'Amount (SDG)'}</span>
              <input
                className="form-input ui-mono"
                disabled={submitting || reconciliationRequired}
                type="number"
                min="1"
                step="1"
                max={invoice.outstandingAmountSdg}
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </label>

            <button
              type="submit"
              className="btn btn-primary"
              disabled={submitting || reconciliationRequired || !state.allowedPaymentMethods?.includes(method)}
            >
              <ReceiptText size={18} />
              {submitting
                ? (lang === 'ar' ? 'جارٍ التسجيل…' : 'Recording…')
                : (lang === 'ar' ? 'تسجيل الدفع' : 'Record payment')}
            </button>
          </form>
        )}
      </div>

      {!loading && state?.invoice && !state.allowedPaymentMethods?.length && !state.dispensingAllowed && (
        <p role="status" className="pharmacy-dispense-hint pharmacy-payment-notice">
          {lang === 'ar' ? 'لا توجد طرق دفع نشطة. راجع مدير العيادة.' : 'No active payment methods. Contact the clinic administrator.'}
        </p>
      )}

      {message.text && (
        <div role="status" className={`pharmacy-alert-banner pharmacy-alert-banner--${message.type === 'danger' ? 'danger' : message.type === 'success' ? 'success' : 'warning'} pharmacy-alert-banner--spaced`}>
          {message.text}
        </div>
      )}

      {reconciliationNotice}
    </section>
  );
}
