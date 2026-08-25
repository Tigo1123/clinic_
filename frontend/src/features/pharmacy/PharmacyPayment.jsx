import { useCallback, useEffect, useRef, useState } from 'react';
import { apiErrorMessage, fetchWithAuth } from '../../services/staffApi';
import { buildPaymentPayload, newPaymentAttempt, paymentAttemptIsReflected, samePaymentAttempt } from '../../utils/pharmacyManagement';

const methodLabels = { CASH: 'CASH', CARD: 'CARD', BANKAK: 'BANKAK', FAWRY: 'FAWRY' };

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
      if (!response.ok) throw new Error(apiErrorMessage(payload, 'Unable to load payment state.'));
      if (!mountedRef.current || requestId !== stateRequestRef.current) return null;
      setState(payload);
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

  if (loading && !state) return <section className="pharmacy-payment"><p>{lang === 'ar' ? 'جارٍ تحميل فاتورة الأدوية…' : 'Loading medicine invoice…'}</p></section>;
  if (!state?.invoice) return <section className="pharmacy-payment"><h3>{lang === 'ar' ? 'فاتورة الأدوية' : 'Medicine Invoice'}</h3><p>{lang === 'ar' ? 'لم تُصدر فاتورة صيدلية لهذه الوصفة بعد.' : 'No pharmacy invoice has been issued for this prescription.'}</p><button type="button" className="btn" disabled={loading} onClick={loadState}>{lang === 'ar' ? 'تحديث' : 'Refresh'}</button></section>;
  const invoice = state.invoice;
  return <section className="pharmacy-payment" aria-labelledby="medicine-invoice-title">
    <div className="pharmacy-management-header"><h3 id="medicine-invoice-title">{lang === 'ar' ? 'فاتورة الأدوية' : 'Medicine Invoice'}</h3><button type="button" className="btn" disabled={loading || submitting} onClick={loadState}>{lang === 'ar' ? 'تحديث الحالة' : 'Refresh state'}</button></div>
    <dl className="pharmacy-summary"><div><dt>{lang === 'ar' ? 'إجمالي الفاتورة' : 'Total'}</dt><dd>{invoice.totalAmountSdg.toLocaleString()} SDG</dd></div><div><dt>{lang === 'ar' ? 'المدفوع' : 'Paid'}</dt><dd>{invoice.paidAmountSdg.toLocaleString()} SDG</dd></div><div><dt>{lang === 'ar' ? 'المتبقي' : 'Outstanding'}</dt><dd>{invoice.outstandingAmountSdg.toLocaleString()} SDG</dd></div><div><dt>{lang === 'ar' ? 'حالة الدفع' : 'Payment status'}</dt><dd>{invoice.paymentStatus}</dd></div></dl>
    {state.dispensingAllowed ? <div className="badge badge-success pharmacy-paid">✅ {lang === 'ar' ? 'تم دفع فاتورة الأدوية بالكامل' : 'Medicine invoice is fully paid'}</div> : <form className="pharmacy-payment-form" onSubmit={submit}>
      <label className="form-group"><span className="form-label">{lang === 'ar' ? 'طريقة الدفع' : 'Payment method'}</span><select className="form-input" disabled={reconciliationRequired} value={method} onChange={(event) => { setMethod(event.target.value); attemptRef.current = null; }}>{(state.allowedPaymentMethods || Object.keys(methodLabels)).map((value) => <option key={value} value={value}>{methodLabels[value] || value}</option>)}</select></label>
      <label className="form-group"><span className="form-label">{lang === 'ar' ? 'المبلغ' : 'Amount'}</span><input className="form-input" disabled={reconciliationRequired} type="number" min="1" step="1" max={invoice.outstandingAmountSdg} value={amount} onChange={(event) => { setAmount(event.target.value); attemptRef.current = null; }} /></label>
      <button type="submit" className="btn btn-primary" disabled={submitting || reconciliationRequired}>{submitting ? (lang === 'ar' ? 'جارٍ التسجيل…' : 'Recording…') : (lang === 'ar' ? 'تسجيل الدفع' : 'Record Payment')}</button>
    </form>}
    {message.text && <div role="status" className={`badge badge-${message.type}`} style={{ display: 'block', padding: '.6rem', marginTop: '.6rem' }}>{message.text}</div>}
    {reconciliationRequired && <div className="form-help"><p>{lang === 'ar' ? 'نتيجة الطلب غير مؤكدة. يجب تحديث حالة الفاتورة قبل أي محاولة أخرى.' : 'The request outcome is uncertain. Refresh invoice state before any further attempt.'}</p><button type="button" className="btn" disabled={loading || submitting} onClick={loadState}>{lang === 'ar' ? 'التحقق من حالة الدفع' : 'Reconcile payment state'}</button></div>}
  </section>;
}
