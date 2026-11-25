import { useRef, useState } from 'react';
import Dialog from '../../../../components/ui/Dialog';
import { apiErrorMessage, fetchWithAuth } from '../../../../services/staff/staffApi';

const refundMethods = [
  ['CASH', 'نقداً', 'Cash'],
  ['CARD', 'بطاقة', 'Card'],
  ['BANKAK', 'بنكك', 'Bankak'],
  ['FAWRY', 'فوري', 'Fawry']
];

export default function InvoiceCorrectionDialog({ lang, invoice, onClose, onRefunded }) {
  const maximum = invoice.refundableSdg;
  const isLab = invoice.invoice.invoiceType === 'LABORATORY';
  const [amount, setAmount] = useState(String(maximum));
  const [method, setMethod] = useState('CASH');
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const ar = lang === 'ar';
  const close = () => { if (!inFlight.current) onClose(); };
  const valid = Number(amount) > 0 && Number(amount) <= maximum && reason.trim();

  async function submit(event) {
    event.preventDefault();
    if (!valid || inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setError('');
    const fallback = ar ? 'تعذر تسجيل الاسترداد.' : 'Unable to record the refund.';
    try {
      const response = await fetchWithAuth(`/api/billing/invoice/${invoice.invoice.id}/refund`, {
        method: 'POST',
        body: JSON.stringify({
          amountSdg: Number(amount),
          refundMethod: method,
          transactionReference: reference.trim() || undefined,
          reason: reason.trim()
        })
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok) onRefunded(data);
      else setError(apiErrorMessage(data, fallback, lang));
    } catch {
      setError(fallback);
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  return (
    <Dialog open title={ar ? 'مراجعة استرداد الفاتورة' : 'Review invoice refund'} onClose={close}>
      <form onSubmit={submit}>
        <dl className="ui-dialog__details reception-confirm-details">
          <dt>{ar ? 'رقم الفاتورة' : 'Invoice'}</dt><dd><bdi>{invoice.invoice.id}</bdi></dd>
          <dt>{ar ? 'المبلغ المتاح للاسترداد' : 'Available to refund'}</dt><dd><bdi>{maximum} SDG</bdi></dd>
        </dl>
        <p>{isLab
          ? (ar ? 'سيعود طلب المختبر إلى انتظار الدفع. تُحفظ الفاتورة الأصلية ويُسجل الاسترداد.' : 'The lab order returns to awaiting payment. The original invoice and the refund stay on record.')
          : (ar ? 'يُسجل الاسترداد على الفاتورة الأصلية وتتوقف الدفعات الإضافية عليها.' : 'The refund will be recorded against the original invoice, and further payments on it will be locked.')}</p>
        <label className="reception-form-label">
          {ar ? 'مبلغ الاسترداد (ج.س)' : 'Refund amount (SDG)'}
          <input className="form-input" type="number" min="0.01" max={maximum} step="0.01" value={amount} readOnly={isLab} disabled={saving} onChange={(event) => setAmount(event.target.value)} required />
        </label>
        <label className="reception-form-label">
          {ar ? 'طريقة الاسترداد' : 'Refund method'}
          <select className="form-input" value={method} disabled={saving} onChange={(event) => setMethod(event.target.value)}>
            {refundMethods.map(([code, labelAr, labelEn]) => <option key={code} value={code}>{ar ? labelAr : labelEn}</option>)}
          </select>
        </label>
        <label className="reception-form-label">
          {ar ? 'رقم المرجع (اختياري)' : 'Transaction reference (optional)'}
          <input className="form-input" value={reference} maxLength={200} disabled={saving} onChange={(event) => setReference(event.target.value)} />
        </label>
        <label className="reception-form-label">
          {ar ? 'السبب' : 'Reason'}
          <textarea className="form-input" value={reason} maxLength={500} required disabled={saving} onChange={(event) => setReason(event.target.value)} />
        </label>
        {error && <p role="alert" className="patient-alert error">{error}</p>}
        <div className="ui-dialog__actions" aria-busy={saving}>
          <button type="button" className="btn btn-secondary" disabled={saving} onClick={close}>{ar ? 'إلغاء' : 'Cancel'}</button>
          <button type="submit" className="btn btn-danger" disabled={saving || !valid}>
            {saving ? (ar ? 'جارٍ تسجيل الاسترداد…' : 'Recording refund…') : (ar ? 'تأكيد الاسترداد' : 'Confirm refund')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
