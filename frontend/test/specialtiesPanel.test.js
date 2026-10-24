import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { createElement as h, act } from 'react';
import { transformWithOxc } from 'vite';

const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, Node: dom.window.Node, ShadowRoot: dom.window.ShadowRoot, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, DocumentFragment: dom.window.DocumentFragment, getComputedStyle: dom.window.getComputedStyle, IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import('react-dom/client');
const rowSource = await readFile(new URL('../src/features/admin/SpecialtyRow.jsx', import.meta.url), 'utf8');
const panelSource = (await readFile(new URL('../src/features/admin/SpecialtiesPanel.jsx', import.meta.url), 'utf8'))
  .replace(/import \{ useTheme \}[^;]+;/, "const useTheme = () => ({ theme: 'light' });")
  .replace("'./SpecialtyRow.jsx'", `'./.SpecialtyRow-test-${process.pid}.mjs'`);
const rowFile = new URL(`../src/features/admin/.SpecialtyRow-test-${process.pid}.mjs`, import.meta.url);
const panelFile = new URL(`../src/features/admin/.SpecialtiesPanel-test-${process.pid}.mjs`, import.meta.url);
await writeFile(rowFile, (await transformWithOxc(rowSource, 'SpecialtyRow.jsx', { jsx: { runtime: 'automatic' } })).code);
await writeFile(panelFile, (await transformWithOxc(panelSource, 'SpecialtiesPanel.jsx', { jsx: { runtime: 'automatic' } })).code);
const { default: Panel } = await import(panelFile.href);
await Promise.all([unlink(rowFile), unlink(panelFile)]);

const specialty = { id: 'specialty-1', code: 'cardio', nameAr: 'أمراض القلب', nameEn: 'Cardiology and Cardiovascular Medicine with an intentionally long clinic-facing name', active: true };
let root;
let props;
let resolveCreate;
let resolveSave;
async function mount(lang = 'en') {
  root = createRoot(document.getElementById('root'));
  await act(async () => root.render(h(Panel, { ...props, lang })));
}
async function click(text) {
  const button = [...document.querySelectorAll('button')].find(item => item.textContent.trim() === text);
  assert.ok(button, `missing button: ${text}`);
  await act(async () => button.click());
  return button;
}
async function change(label, value, scope = document) {
  const field = [...scope.querySelectorAll('input')].find(input => input.closest('.MuiFormControl-root')?.querySelector('label')?.textContent.includes(label));
  assert.ok(field, `missing field: ${label}`);
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(field, value);
    field.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
}
beforeEach(() => {
  props = { specialties: [specialty], draft: { code: '', nameAr: '', nameEn: '' }, setDraft: update => { props.draft = typeof update === 'function' ? update(props.draft) : update; }, error: '', feedback: null, pending: false, onCreate: () => Promise.resolve(), onSave: () => Promise.resolve(true), isAdmin: true, request: async () => ({ ok: true, status: 204 }), onDeleted: () => {}, onFeedback: () => {} };
});
afterEach(async () => { if (root) await act(async () => root.unmount()); root = null; });

test('renders MUI create form and specialty card with safe wrapping and RTL direction', async () => {
  await mount('ar');
  assert.equal(document.querySelector('.MuiBox-root[dir="rtl"]')?.dir, 'rtl');
  assert.ok(document.querySelector('.MuiCard-root'));
  assert.ok(document.querySelector('.MuiGrid-root'));
  assert.match(document.body.textContent, /أمراض القلب/);
  assert.match(document.body.textContent, /Cardiology and Cardiovascular Medicine/);
  assert.match(document.body.textContent, /نشط/);
  assert.ok([...document.querySelectorAll('button')].some(button => button.textContent.includes('تعديل')));
  assert.ok(document.querySelector('bdi[dir="ltr"]'));
});

test('edit changes English name and active status, saves once, and retains the card on completion', async () => {
  let calls = 0;
  let savedValue;
  props.onSave = value => { calls += 1; savedValue = value; return new Promise(resolve => { resolveSave = () => resolve(true); }); };
  await mount();
  await click('Edit');
  const editForm = [...document.querySelectorAll('form')].find(form => form.querySelector('button[type="submit"]')?.textContent.includes('Save changes'));
  await change('English name', 'Updated Cardiology', editForm);
  const status = document.querySelector('select');
  assert.ok(status);
  await act(async () => { status.value = 'false'; status.dispatchEvent(new window.Event('change', { bubbles: true })); });
  const save = [...document.querySelectorAll('button')].find(button => button.textContent.includes('Save changes'));
  await act(async () => { save.click(); save.click(); });
  assert.equal(calls, 1);
  assert.equal(save.disabled, true);
  await act(async () => resolveSave());
  assert.equal(savedValue.nameEn, 'Updated Cardiology');
  assert.equal(savedValue.active, false);
  assert.equal(document.querySelectorAll('form').length, 1);
});

test('create action cannot submit twice before the pending request resolves', async () => {
  let calls = 0;
  props.onCreate = () => { calls += 1; return new Promise(resolve => { resolveCreate = resolve; }); };
  await mount();
  const form = document.querySelector('form');
  await act(async () => {
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  });
  assert.equal(calls, 1);
  await act(async () => resolveCreate());
});


test('cancel restores the saved values and failed save preserves edits', async () => {
  props.onSave = async () => false;
  await mount();
  await click('Edit');
  const form = document.querySelector('article form');
  await change('English name', 'Unsaved name', form);
  await click('Save changes');
  assert.equal(document.querySelector('article input[dir="ltr"][maxlength="100"]').value, 'Unsaved name');
  await click('Cancel');
  await click('Edit');
  assert.equal(document.querySelector('article input[dir="ltr"][maxlength="100"]').value, specialty.nameEn);
});

test('blank edits and rejected saves show errors without closing the editor', async () => {
  let calls = 0;
  props.onSave = async () => { calls++; throw new Error('offline'); };
  await mount();
  await click('Edit');
  await change('English name', '   ', document.querySelector('article form'));
  await click('Save changes');
  assert.equal(calls, 0);
  assert.match(document.querySelector('[role="alert"]').textContent, /Enter a code/);
  await change('English name', 'Retry name', document.querySelector('article form'));
  await click('Save changes');
  assert.equal(calls, 1);
  assert.match(document.querySelector('[role="alert"]').textContent, /Unable to save/);
  assert.equal([...document.querySelectorAll('button')].find(b => b.textContent.includes('Save changes')).disabled, false);
});

test('empty state, feedback and non-admin deletion visibility', async () => {
  props.specialties = [];
  props.feedback = { type: 'success', message: 'Saved successfully' };
  await mount();
  assert.match(document.body.textContent, /No specialties/);
  assert.match(document.querySelector('[role="status"]').textContent, /Saved successfully/);
  props.specialties = [specialty];
  props.isAdmin = false;
  await act(async () => root.render(h(Panel, { ...props, lang: 'en' })));
  assert.equal([...document.querySelectorAll('button')].some(b => b.textContent === 'Delete'), false);
});

test('refreshing the list preserves unsaved edits in another card', async () => {
  await mount();
  await click('Edit');
  await change('English name', 'Work in progress', document.querySelector('article form'));
  props.specialties = [{ ...specialty, active: false }];
  await act(async () => root.render(h(Panel, { ...props, lang: 'en' })));
  assert.equal(document.querySelector('article input[dir="ltr"][maxlength="100"]').value, 'Work in progress');
  await click('Cancel');
  assert.match(document.querySelector('article').textContent, /Inactive/);
  await click('Edit');
  assert.equal(document.querySelector('select').value, 'false');
});

test('pending creation disables the fields and submit button', async () => {
  props.pending = true;
  let calls = 0;
  props.onCreate = () => { calls++; };
  await mount();
  const form = document.querySelector('form');
  assert.ok([...form.querySelectorAll('input, button')].every(control => control.disabled));
  await act(async () => form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
  assert.equal(calls, 0);
});
