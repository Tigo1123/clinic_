import AppDatePicker from '../../components/ui/AppDatePicker.jsx';
import { useEffect, useRef, useState } from 'react';
import { fetchWithAuth } from '../../services/staffApi';
import { localizedApiErrorMessage } from '../../services/apiClient.js';

async function request(url, options) {
  const response = await fetchWithAuth(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(localizedApiErrorMessage({
    code: data?.code || data?.error?.code,
    status: response.status
  }, 'تعذر إكمال الطلب.'));
  return data;
}
const transitions = { DRAFT: ['SUBMITTED'], SUBMITTED: ['UNDER_REVIEW'], UNDER_REVIEW: ['APPROVED', 'REJECTED'], APPROVED: ['PAID'] };
const statuses = { DRAFT: ['مسودة', 'Draft'], SUBMITTED: ['مقدمة', 'Submitted'], UNDER_REVIEW: ['قيد المراجعة', 'Under review'], APPROVED: ['مقبولة', 'Approved'], REJECTED: ['مرفوضة', 'Rejected'], PAID: ['مدفوعة', 'Paid'] };
export default function PatientBillingDetails({ patientId, invoices, lang, admin }) {
  const ar = lang === 'ar';
  const [companies, setCompanies] = useState([]);
  const [memberships, setMemberships] = useState([]);
  const [draft, setDraft] = useState({ insuranceCompanyId: '', memberNumber: '', plan: '', validFrom: '', validUntil: '', active: true });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [claimStates, setClaimStates] = useState({});
  const [methods, setMethods] = useState([]);
  const [paymentDrafts, setPaymentDrafts] = useState({});
  const [ledger, setLedger] = useState({});
  const paymentAttempts = useRef({});
  useEffect(() => {
    let current = true;
    Promise.all([request('/api/billing/insurance-companies'), request(`/api/billing/patients/${patientId}/insurance`), request('/api/billing/payment-methods')])
      .then(([choices, records, paymentMethods]) => { if (current) { setCompanies(choices); setMemberships(records); setMethods(paymentMethods); } })
      .catch(() => { if (current) setError(ar ? 'تعذر تحميل بيانات التأمين.' : 'Unable to load insurance information.'); });
    return () => { current = false; };
  }, [patientId, ar]);
  const save = async event => {
    event.preventDefault();
    if (busy) return;
    if (!draft.active && !window.confirm(ar ? 'تأكيد تعطيل التأمين؟' : 'Deactivate this membership?')) return;
    setBusy(true); setError('');
    try {
      await request(`/api/billing/patients/${patientId}/insurance`, { method: 'PUT', body: JSON.stringify({ ...draft, plan: draft.plan || null }) });
      setMemberships(await request(`/api/billing/patients/${patientId}/insurance`));
    } catch (failure) { setError(failure.message); } finally { setBusy(false); }
  };
  const label = key => statuses[key]?.[ar ? 0 : 1] || key;
  const amount = value => `${Number(value).toLocaleString(ar ? 'ar' : 'en')} ${ar ? 'ج.س' : 'SDG'}`;
  return <div className="patient-file-list">
    <p>{ar ? 'أحدث ٥٠ فاتورة. المبالغ المستردة معروضة بشكل منفصل.' : 'Most recent 50 invoices. Refunds are shown separately.'}</p>
    {error && <p role="alert">{error}</p>}
    <details className="patient-file-detail-card"><summary>{ar ? 'التأمين والعضوية' : 'Insurance membership'}</summary>
      <form onSubmit={save} className="patient-file-overview-grid">
        <label className="form-group">{ar ? 'شركة التأمين' : 'Insurance company'}<select className="form-input" required value={draft.insuranceCompanyId} onChange={event => { const id = event.target.value; const existing = memberships.find(row => row.insuranceCompanyId === id); setDraft(existing ? { ...existing, plan: existing.plan || '' } : { insuranceCompanyId: id, memberNumber: '', plan: '', validFrom: '', validUntil: '', active: true }); }}><option value="">{ar ? 'اختر' : 'Choose'}</option>{companies.map(company => <option key={company.id} value={company.id}>{ar ? company.labelAr : company.labelEn}{!company.active ? (ar ? ' (غير نشطة)' : ' (inactive)') : ''}</option>)}</select></label>
        {['memberNumber', 'plan'].map((key, index) => <label className="form-group" key={key}>{(ar ? ['رقم العضوية', 'الخطة (اختياري)'] : ['Member number', 'Plan (optional)'])[index]}<input className="form-input" type="text" required={key !== 'plan'} maxLength={100} value={draft[key]} onChange={event => setDraft(current => ({ ...current, [key]: event.target.value }))}/></label>)}
        {['validFrom', 'validUntil'].map((key, index) => <AppDatePicker key={key} label={(ar ? ['صالح من', 'صالح حتى'] : ['Valid from', 'Valid until'])[index]} value={draft[key]} onChange={value => setDraft(current => ({ ...current, [key]: value }))} required />)}
        <label><input type="checkbox" checked={draft.active} onChange={event => setDraft(current => ({ ...current, active: event.target.checked }))}/>{ar ? 'نشط' : 'Active'}</label>
        <button className="btn btn-primary" type="submit" disabled={busy}>{ar ? 'حفظ العضوية' : 'Save membership'}</button>
      </form>
    </details>
    {invoices.map(original => {
      const invoice = ledger[original.id] || original;
      const claim = invoice.insuranceClaim;
      const state = claim ? claimStates[claim.id] || claim.claimStatus : null;
      return <article key={invoice.id} className="patient-file-detail-card">
        <header><strong>{new Date(invoice.invoiceDate).toLocaleDateString(ar ? 'ar' : 'en')}</strong><span>{({ CONSULTATION: ar ? 'استشارة' : 'Consultation', LABORATORY: ar ? 'مختبر' : 'Laboratory', PHARMACY: ar ? 'صيدلية' : 'Pharmacy', GENERAL: ar ? 'خدمات' : 'Services' })[invoice.invoiceType] || invoice.invoiceType}</span><span>{({ PAID: ar ? 'مدفوع' : 'Paid', PARTIALLY_PAID: ar ? 'مدفوع جزئياً' : 'Partially paid', UNPAID: ar ? 'غير مدفوع' : 'Unpaid', REFUNDED: ar ? 'مسترد' : 'Refunded', PARTIALLY_REFUNDED: ar ? 'مسترد جزئياً' : 'Partially refunded' })[invoice.paymentStatus] || invoice.paymentStatus}</span></header>
        <div className="patient-file-overview-grid">{[
          [ar ? 'إجمالي الرسوم' : 'Total charge', invoice.totalAmountSdg],
          [ar ? 'تغطية التأمين' : 'Insurance coverage', invoice.insuranceCoverageSdg],
          [ar ? 'حصة المريض' : 'Patient payable', invoice.patientShareSdg],
          [ar ? 'المدفوع' : 'Amount paid', invoice.totalPaidSdg],
          [ar ? 'المسترد' : 'Refunds', invoice.refundedSdg],
          [ar ? 'الرصيد المتبقي' : 'Remaining balance', invoice.remainingBalanceSdg]
        ].map(([title, value]) => <div key={title}><span>{title}</span><strong><bdi>{amount(value)}</bdi></strong></div>)}</div>
        <details><summary>{ar ? 'الرسوم والمدفوعات والمبالغ المستردة' : 'Charges, payments and refunds'}</summary>
          {(invoice.items || []).map((item, index) => <p key={index}>{ar ? item.descriptionAr : item.descriptionEn} · <bdi>{item.qty} × {amount(item.unitPriceSdg)}</bdi></p>)}
          {['payments', 'refunds'].map(kind => (invoice[kind] || []).map(row => <p key={row.id}>{kind === 'payments' ? (ar ? 'دفعة' : 'Payment') : (ar ? 'استرداد' : 'Refund')} · {new Date(row.createdAt).toLocaleDateString(ar ? 'ar' : 'en')} · <bdi>{amount(row.amountSdg)} · {row.paymentMethod || row.refundMethod}</bdi></p>))}
        </details>
        {invoice.invoiceType !== 'PHARMACY' && ['UNPAID', 'PARTIALLY_PAID'].includes(invoice.paymentStatus) && invoice.remainingBalanceSdg > 0 && <details>
          <summary>{ar ? 'تسجيل دفعة' : 'Record payment'}</summary>
          <form className="patient-file-overview-grid" onSubmit={async event => {
            event.preventDefault(); if (busy) return;
            const draft = paymentDrafts[invoice.id] || {};
            const payment = { amountSdg: Number(draft.amountSdg), paymentMethod: draft.paymentMethod || methods[0]?.code, ...(draft.transactionReference ? { transactionReference: draft.transactionReference.trim() } : {}) };
            const fingerprint = JSON.stringify(payment);
            if (paymentAttempts.current[invoice.id]?.fingerprint !== fingerprint) paymentAttempts.current[invoice.id] = { fingerprint, key: crypto.randomUUID() };
            setBusy(true); setError('');
            try {
              await request(`/api/billing/invoice/${invoice.id}/payments`, { method: 'POST', headers: { 'Idempotency-Key': paymentAttempts.current[invoice.id].key }, body: JSON.stringify({ payments: [payment] }) });
              const profile = await request(`/api/patients/${patientId}/profile`);
              setLedger(Object.fromEntries(profile.invoices.map(row => [row.id, row])));
              delete paymentAttempts.current[invoice.id];
              setPaymentDrafts(current => ({ ...current, [invoice.id]: {} }));
            } catch (failure) { setError(failure.message); } finally { setBusy(false); }
          }}>
            <label className="form-group">{ar ? 'المبلغ' : 'Amount'}<input className="form-input" type="number" required min="1" step="1" max={invoice.remainingBalanceSdg} value={paymentDrafts[invoice.id]?.amountSdg || ''} onChange={event => setPaymentDrafts(current => ({ ...current, [invoice.id]: { ...current[invoice.id], amountSdg: event.target.value } }))}/></label>
            <label className="form-group">{ar ? 'طريقة الدفع' : 'Payment method'}<select className="form-input" required value={paymentDrafts[invoice.id]?.paymentMethod || methods[0]?.code || ''} onChange={event => setPaymentDrafts(current => ({ ...current, [invoice.id]: { ...current[invoice.id], paymentMethod: event.target.value } }))}>{methods.map(method => <option key={method.code} value={method.code}>{ar ? method.labelAr : method.labelEn}</option>)}</select></label>
            <label className="form-group">{ar ? 'مرجع المعاملة (اختياري)' : 'Transaction reference (optional)'}<input className="form-input" maxLength={200} value={paymentDrafts[invoice.id]?.transactionReference || ''} onChange={event => setPaymentDrafts(current => ({ ...current, [invoice.id]: { ...current[invoice.id], transactionReference: event.target.value } }))}/></label>
            <button className="btn btn-primary" type="submit" disabled={busy || !methods.length}>{ar ? 'تسجيل الدفعة' : 'Record payment'}</button>
          </form>
        </details>}
        {claim && <div><p>{ar ? 'حالة المطالبة' : 'Claim status'}: {label(state)}</p>{admin && (transitions[state] || []).map(next => <button key={next} className="btn btn-secondary" disabled={busy} onClick={async () => {
          if (!window.confirm(`${ar ? 'تأكيد حالة المطالبة' : 'Confirm claim status'}: ${label(next)}?`)) return;
          setBusy(true); setError('');
          try { await request(`/api/billing/claims/${claim.id}`, { method: 'PATCH', body: JSON.stringify({ fromStatus: state, claimStatus: next }) }); setClaimStates(current => ({ ...current, [claim.id]: next })); }
          catch (failure) { setError(failure.message); } finally { setBusy(false); }
        }}>{label(next)}</button>)}</div>}
      </article>;
    })}
  </div>;
}
