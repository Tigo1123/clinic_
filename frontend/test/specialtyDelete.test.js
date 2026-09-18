import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createElement as h, act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import SpecialtyDeleteButton from '../src/features/admin/SpecialtyDeleteButton.js';

const dom = new JSDOM('<div id="root"></div>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root;
let calls;
let confirmCalls;
let request;
const specialty = { id: 'unused', nameEn: 'Unused specialty', nameAr: 'تخصص غير مستخدم' };
function Harness({ lang = 'en' }) {
  const [rows, setRows] = useState([specialty]);
  const [feedback, setFeedback] = useState(null);
  return h('div', {},
    h('table', {}, h('tbody', {}, rows.map((row) => h('tr', { key: row.id }, h('td', {}, row.nameEn), h('td', {}, h(SpecialtyDeleteButton, {
      specialty: row, lang, request: (...args) => { calls.push(args); return request(...args); },
      onDeleted: (id) => setRows((current) => current.filter((s) => s.id !== id)), onFeedback: setFeedback
    })))))),
    feedback && h('div', { role: feedback.type === 'error' ? 'alert' : 'status' }, feedback.message));
}
beforeEach(() => {
  calls = []; confirmCalls = [];
  request = async () => ({ ok: true, status: 204 });
  globalThis.confirm = (text) => { confirmCalls.push(text); return true; };
  root = createRoot(document.getElementById('root'));
});
afterEach(async () => { await act(async () => root.unmount()); delete globalThis.confirm; });
const render = async (lang = 'en') => act(async () => root.render(h(Harness, { lang })));
const click = async () => act(async () => document.querySelector('button').click());

test('Admin dashboard wires deletion to local row removal and renders the control only for Admin', () => {
  const row = readFileSync(new URL('../src/features/admin/SpecialtyRow.jsx', import.meta.url), 'utf8');
  const dashboard = readFileSync(new URL('../src/features/admin/AdminDashboard.jsx', import.meta.url), 'utf8');
  assert.match(row, /isAdmin && <SpecialtyDeleteButton/);
  assert.match(dashboard, /isAdmin=\{user\?\.role === 'ADMIN'\}/);
  assert.match(dashboard, /setSpecialties\(\(current\) => current.filter\(\(item\) => item.id !== id\)\)/);
  assert.match(dashboard, /onDeleted=\{specialtyDeleted\}/);
});

for (const lang of ['en', 'ar']) {
  test(`${lang}: confirmation, loading, duplicate prevention, success and row removal`, async () => {
    let finish;
    request = () => new Promise((resolve) => { finish = resolve; });
    await render(lang);
    const button = document.querySelector('button');
    assert.equal(button.textContent, lang === 'ar' ? 'حذف' : 'Delete');
    assert.ok(button.classList.contains('btn-danger'));
    await act(async () => { button.click(); button.click(); });
    assert.equal(confirmCalls.length, 1);
    assert.match(confirmCalls[0], lang === 'ar' ? /نهائياً/ : /Permanently/);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], ['/api/specialties/unused', { method: 'DELETE' }]);
    assert.equal(button.disabled, true);
    assert.equal(button.textContent, lang === 'ar' ? 'جارٍ الحذف…' : 'Deleting…');
    await act(async () => finish({ ok: true, status: 204 }));
    assert.equal(document.querySelector('tr'), null);
    assert.equal(document.querySelector('[role="status"]').textContent, lang === 'ar' ? 'تم حذف التخصص.' : 'Specialty deleted.');
  });

  test(`${lang}: cancel confirmation never sends DELETE`, async () => {
    globalThis.confirm = () => false;
    await render(lang); await click();
    assert.equal(calls.length, 0);
    assert.ok(document.querySelector('tr'));
  });

  test(`${lang}: 409 uses the safe deactivation message and preserves the row`, async () => {
    request = async () => ({ ok: false, status: 409, json: async () => ({ error: 'secret database details' }) });
    await render(lang); await click();
    assert.equal(document.querySelector('[role="alert"]').textContent, lang === 'ar'
      ? 'لا يمكن حذف هذا التخصص لأنه مرتبط ببيانات موجودة. يمكنك تعطيله بدلاً من حذفه.'
      : 'This specialty cannot be deleted because it is referenced by existing data. You can deactivate it instead.');
    assert.ok(document.querySelector('tr')); assert.equal(document.querySelector('button').disabled, false);
  });

  test(`${lang}: 401, 403, 404 and network failures display safe localized messages`, async () => {
    await render(lang);
    const expected = lang === 'ar' ? ['انتهت جلستك', 'مدير النظام فقط', 'لم يعد موجوداً', 'تعذر حذف التخصص'] : ['session has expired', 'Only an administrator', 'no longer exists', 'Unable to delete'];
    for (const [index, status] of [401, 403, 404, 500].entries()) {
      request = async () => { if (status === 500) throw new Error('secret database details'); return { ok: false, status }; };
      await click();
      assert.ok(document.querySelector('[role="alert"]').textContent.includes(expected[index]));
      assert.equal(document.querySelector('button').disabled, false);
    }
  });
}
