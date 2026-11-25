import { useRef, useState } from 'react';
import Dialog from '../../../../components/ui/Dialog';
import { apiErrorMessage, fetchWithAuth } from '../../../../services/staff/staffApi';

export default function ExcludeServiceChargeDialog({ lang, orderId, line, onClose, onExcluded }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const ar = lang === 'ar';
  const close = () => { if (!inFlight.current) onClose(); };

  async function submit(event) {
    event.preventDefault();
    const value = reason.trim();
    if (!value || inFlight.current) return;

    inFlight.current = true;
    setSaving(true);
    setError('');
    const fallback = ar ? 'تعذر استبعاد الرسوم.' : 'Unable to remove the charge.';
    try {
      const response = await fetchWithAuth(`/api/billing/service-orders/${orderId}/items/${line.id}/exclude`, {
        method: 'POST',
        body: JSON.stringify({ reason: value })
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok) onExcluded(line.id, value);
      else setError(apiErrorMessage(data, fallback, lang));
    } catch {
      setError(fallback);
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  return (
    <Dialog open title={ar ? 'استبعاد رسوم الخدمة' : 'Remove service charge'} onClose={close}>
      <form onSubmit={submit}>
        <p><strong>{ar ? line.labelAr : line.labelEn}</strong></p>
        <p>{ar ? 'سيبقى طلب الطبيب في الملف الطبي وتُستبعد هذه الرسوم من الفاتورة.' : 'The doctor’s order stays in the medical record. This charge will be left off the invoice.'}</p>
        <label className="reception-form-label">
          {ar ? 'سبب الاستبعاد' : 'Reason for removal'}
          <textarea className="form-input" value={reason} maxLength={500} required disabled={saving} onChange={(event) => setReason(event.target.value)} />
        </label>
        {error && <p role="alert" className="patient-alert error">{error}</p>}
        <div className="ui-dialog__actions" aria-busy={saving}>
          <button type="button" className="btn btn-secondary" disabled={saving} onClick={close}>{ar ? 'إلغاء' : 'Cancel'}</button>
          <button type="submit" className="btn btn-danger" disabled={saving || !reason.trim()}>
            {saving ? (ar ? 'جارٍ الاستبعاد…' : 'Removing…') : (ar ? 'استبعاد الرسوم' : 'Remove charge')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
