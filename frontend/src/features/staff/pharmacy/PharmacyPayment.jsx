import { useCallback, useEffect, useRef, useState } from 'react';
import { ReceiptText, RefreshCw } from 'lucide-react';
import { apiErrorMessage, fetchWithAuth } from '../../../services/staff/staffApi';
import { buildPaymentPayload, newPaymentAttempt, paymentAttemptIsReflected, pharmacyBillingPendingCopy, pharmacyBillingRequiresReview, samePaymentAttempt } from './pharmacyHelpers';

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

export default function PharmacyPayment({ prescriptionId, lang, onStateChange }) {
  const [state, setState] = useState(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('CASH');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [reconciliationRequired, setReconciliationRequired] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });
  const attemptRef = useRef(null);
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
      if (reconciliationRequiredRef.current) {
        if (attemptRef.current) {
          if (paymentAttemptIsReflected(attemptRef.current, payload)) {
            attemptRef.current = null;
            setMessage({ type: 'success', text: payload.dispensingAllowed ? (lang === 'ar' ? 'تم تأكيد الدفع الكامل من الخادم.' : 'The server confirmed full payment.') : (lang === 'ar' ? 'تم تأكيد الدفعة من الخادم.' : 'The server confirmed the payment.') });
          } else {
            setMessage({ type: 'warning', text: lang === 'ar' ? 'لم يظهر الدفع في الحالة الحالية. يمكنك إعادة نفس المحاولة بالمفتاح نفسه أو تعديلها كمحاولة جديدة.' : 'The payment is not reflected in current state. Retry the exact attempt with the same key, or change it as a new attempt.' });
          }
        }
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
  }, [lang, onStateChange, prescriptionId, requireReconciliation]);

  useEffect(() => {
    mountedRef.current = true;
    setState(null); setMessage({ type: '', text: '' }); attemptRef.current = null; requireReconciliation(false); loadState();
    return () => { mountedRef.current = false; stateRequestRef.current += 1; };
  }, [loadState, requireReconciliation]);

  const submit = async (event) => {
    event.preventDefault();
    const invoice = state?.invoice;
    const numericAmount = Number(amount);
    if (!invoice || !Number.isSafeInteger(numericAmount) || numericAmount <= 0) {
      setMessage({ type: 'danger', text: lang === 'ar' ? 'أدخل مبلغاً صحيحاً أكبر من صفر.' : 'Enter a positive whole payment amount.' });
      return;
    }
    if (!samePaymentAttempt(attemptRef.current, invoice.id, numericAmount, method)) {
      attemptRef.current = newPaymentAttempt(invoice.id, numericAmount, method, invoice.paidAmountSdg);
    }
    const attempt = attemptRef.current;
    setSubmitting(true); setMessage({ type: '', text: '' });
    let responseReceived = false;
    try {
      const response = await fetchWithAuth(`/api/billing/invoice/${invoice.id}/payments`, {
        method: 'POST',
        headers: { 'Idempotency-Key': attempt.idempotencyKey },
        body: JSON.stringify(buildPaymentPayload(numericAmount, method))
      });
      responseReceived = true;
      const payload = await response.json().catch(() => ({}));
      if (!mountedRef.current) return;
      if (!response.ok) {
        const code = payload?.error?.code;
        if (['PAYMENT_LEDGER_CONFLICT', 'PAYMENT_EXCEEDS_BALANCE', 'INVOICE_ALREADY_PAID'].includes(code)) await loadState();
        throw new Error(apiErrorMessage(payload, lang === 'ar' ? 'تعذر تسجيل الدفع. حدّث حالة الفاتورة قبل المحاولة مجدداً.' : 'Payment could not be recorded. Refresh invoice state before retrying.'));
      }
      attemptRef.current = null;
      requireReconciliation(false);
      const refreshed = await loadState();
      if (refreshed) {
        setMessage({ type: 'success', text: refreshed.dispensingAllowed ? (lang === 'ar' ? 'تم دفع فاتورة الأدوية بالكامل.' : 'Medicine invoice paid in full.') : (lang === 'ar' ? 'تم تسجيل الدفعة الجزئية.' : 'Partial payment recorded.') });
      } else {
        requireReconciliation(true);
        setMessage({ type: 'warning', text: lang === 'ar' ? 'قبل الخادم الدفع، لكن تعذر تحديث حالة الفاتورة. تحقق من الحالة قبل أي دفعة أخرى.' : 'The server accepted the payment, but invoice refresh failed. Reconcile state before another payment.' });
      }
    } catch (error) {
      if (mountedRef.current) {
        if (!responseReceived) requireReconciliation(true);
        setMessage({ type: 'danger', text: error.message });
      }
    } finally {
      if (mountedRef.current) setSubmitting(false);
    }
  };

  if (loading && !state) {
    return (
      <section className="pharmacy-payment-wrapper" aria-labelledby="medicine-invoice-title">
        <div className="pharmacy-compact-empty">
          <p>{lang === 'ar' ? 'جارٍ تحميل فاتورة الأدوية…' : 'Loading medicine invoice…'}</p>
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
        <h3 id="medicine-invoice-title" className="pharmacy-list-title">
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
        <dl className="pharmacy-totals-card">
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
          <div className="pharmacy-totals-card pharmacy-paid-card">
            <span className="ui-status ui-status--ok pharmacy-paid-status">
              {lang === 'ar' ? 'تم دفع فاتورة الأدوية بالكامل' : 'Medicine invoice is fully paid'}
            </span>
          </div>
        ) : (
          <form className="pharmacy-payment-form-card" onSubmit={submit}>
            <label className="pharmacy-payment-field">
              <span className="form-label">{lang === 'ar' ? 'طريقة الدفع' : 'Payment method'}</span>
              <select
                className="form-input"
                disabled={reconciliationRequired}
                value={method}
                onChange={(event) => { setMethod(event.target.value); attemptRef.current = null; }}
              >
                {(state.allowedPaymentMethods || []).map((value) => (
                  <option key={value} value={value}>
                    {state.paymentMethodOptions?.find(option => option.code === value)?.[lang === 'ar' ? 'labelAr' : 'labelEn'] || methodLabels[value] || value}
                  </option>
                ))}
              </select>
            </label>

            <label className="pharmacy-payment-field">
              <span className="form-label">{lang === 'ar' ? 'المبلغ (SDG)' : 'Amount (SDG)'}</span>
              <input
                className="form-input"
                disabled={reconciliationRequired}
                type="number"
                min="1"
                step="1"
                max={invoice.outstandingAmountSdg}
                value={amount}
                onChange={(event) => { setAmount(event.target.value); attemptRef.current = null; }}
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
        <div role="status" className={`badge badge-${message.type} pharmacy-alert-banner pharmacy-alert-banner--spaced`}>
          {message.text}
        </div>
      )}

      {reconciliationRequired && (
        <div className="pharmacy-amber-notice pharmacy-amber-notice--spaced">
          <span>{lang === 'ar' ? 'نتيجة الطلب غير مؤكدة. يجب تحديث حالة الفاتورة قبل أي محاولة أخرى.' : 'The request outcome is uncertain. Refresh invoice state before any further attempt.'}</span>
          <button type="button" disabled={loading || submitting} onClick={loadState}>
            {lang === 'ar' ? 'التحقق من حالة الدفع' : 'Reconcile payment state'}
          </button>
        </div>
      )}
    </section>
  );
}
