import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { transformWithOxc } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
let source = await readFile(new URL('../src/features/clinical/PatientBillingDetails.jsx', import.meta.url), 'utf8');
source = source.replace(/import AppDatePicker[^;]+;/, 'const AppDatePicker = props => <label>{props.label}</label>;')
 .replace(/import \{ fetchWithAuth \}[^;]+;/, 'const fetchWithAuth = () => { throw Error("Unexpected network during render"); };');
const file = new URL(`.billing-details-${process.pid}.mjs`, import.meta.url);
await writeFile(file, (await transformWithOxc(source, 'PatientBillingDetails.jsx', { jsx: { runtime: 'automatic' } })).code);
let Panel;
try { Panel = (await import(file.href)).default; } finally { await unlink(file); }
const invoice = { id: 'i', invoiceDate: '2026-10-24', invoiceType: 'CONSULTATION', paymentStatus: 'PARTIALLY_PAID', totalAmountSdg: 1000, insuranceCoverageSdg: 800, patientShareSdg: 200, totalPaidSdg: 100, refundedSdg: 0, remainingBalanceSdg: 100, items: [], payments: [], refunds: [], insuranceClaim: { id: 'c', claimStatus: 'DRAFT' } };
for (const lang of ['ar', 'en']) test(`financial view distinguishes balances and claim status in ${lang}`, () => {
 const html = renderToStaticMarkup(createElement(Panel, { patientId: 'p', invoices: [invoice], lang, admin: false }));
 for (const label of lang === 'ar' ? ['إجمالي الرسوم','تغطية التأمين','حصة المريض','المدفوع','المسترد','الرصيد المتبقي','حالة المطالبة'] : ['Total charge','Insurance coverage','Patient payable','Amount paid','Refunds','Remaining balance','Claim status']) assert.ok(html.includes(label), label);
 assert.ok(html.includes(lang === 'ar' ? 'مدفوع جزئياً' : 'Partially paid'));
 assert.equal(html.includes(lang === 'ar' ? '>مقدمة</button>' : '>Submitted</button>'), false);
 const admin = renderToStaticMarkup(createElement(Panel, { patientId: 'p', invoices: [invoice], lang, admin: true }));
 assert.ok(admin.includes(lang === 'ar' ? '>مقدمة</button>' : '>Submitted</button>'));
});
