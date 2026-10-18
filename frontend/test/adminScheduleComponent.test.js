import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { transformWithOxc } from 'vite';
const dom = new JSDOM('<div id="root"></div>');
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
const { createElement, act } = await import('react');
const { createRoot } = await import('react-dom/client');
let source = await readFile(new URL('../src/features/admin/AdminSchedulePanel.jsx', import.meta.url), 'utf8');
source = source.replace(/import \{ apiErrorMessage, fetchWithAuth \}[^;]+;/, 'const fetchWithAuth = (...args) => globalThis.scheduleFetch(...args); const apiErrorMessage = (d, fallback) => d?.error?.message || fallback;').replace(/import '\.\/adminSchedule.css';/, '').replace("'./scheduleVersion'", JSON.stringify(new URL('../src/features/admin/scheduleVersion.js', import.meta.url).href)).replace("'./latestRequest'", JSON.stringify(new URL('../src/features/admin/latestRequest.js', import.meta.url).href));
const compiled = await transformWithOxc(source, 'AdminSchedulePanel.jsx', { jsx: { runtime: 'automatic' } });
const modulePath = new URL(`.schedule-component-${process.pid}.mjs`, import.meta.url);
await writeFile(modulePath, compiled.code);
let Panel;
try { Panel = (await import(modulePath.href)).default; } finally { await unlink(modulePath); }
let root; let requests; let handler;
const reply = (data, ok = true) => ({ ok, json: async () => data });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const period = (dayOfWeek = 'MONDAY') => ({ dayOfWeek, startTime: '09:00', endTime: '17:00', slotDurationMinutes: 30, active: true, breaks: [] });
const version = (id, periods = [period()]) => ({ id, active: true, effectiveFrom: '2190-01-01', effectiveTo: '2191-01-01', periods });
async function mount(fn = () => reply([])) {
 requests = []; handler = fn;
 globalThis.scheduleFetch = async (url, options) => {
  requests.push({ url, options });
  if (url === '/api/appointments/doctors') return reply([{ id: 'A', fullNameEn: 'Doctor A' }, { id: 'B', fullNameEn: 'Doctor B' }]);
  if (url === '/api/public-config') return reply({ clinicTimeZone: 'Africa/Khartoum' });
  return handler(url, options);
 };
 root = createRoot(document.getElementById('root'));
 await act(async () => root.render(createElement(Panel)));
}
afterEach(async () => { if (root) await act(async () => root.unmount()); root = null; });
const click = async text => { const button = [...document.querySelectorAll('button')].find(b => b.textContent.includes(text)); assert.ok(button, text); await act(async () => button.click()); };
async function change(element, value) { await act(async () => { const proto = element.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(element, value); element.dispatchEvent(new window.Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }); }
const switchTo = id => change(document.querySelector('#schedule-doctor'), id);
const submit = () => act(async () => document.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));

test('creation offers all seven weekdays and persists multiple days through reload', async () => {
 let saved = [];
 await mount((url, options) => { if (options) { saved = JSON.parse(options.body).periods; return reply(version('saved', saved)); } return reply(url.endsWith('/schedules') && saved.length ? [version('saved', saved)] : []); });
 await click('Add working period'); await click('Add working period');
 const days = document.querySelectorAll('.admin-period select');
 assert.equal(days.length, 2);
 assert.equal(days[0].options.length, 7);
 await change(days[0], 'SUNDAY'); await change(days[1], 'SATURDAY'); await submit();
 assert.deepEqual(saved.map(p => p.dayOfWeek), ['SUNDAY', 'SATURDAY']);
 assert.deepEqual([...document.querySelectorAll('.admin-period select')].map(e => e.value), ['SUNDAY', 'SATURDAY']);
});
test('editing retains effective end date and uses PUT without child database fields', async () => {
 await mount((url, options) => options ? reply({}) : reply(url.endsWith('/schedules') ? [version('existing', [{ ...period('FRIDAY'), id: 'child', scheduleId: 'existing' }])] : []));
 await submit(); const mutation = requests.find(r => r.options);
 assert.equal(mutation.options.method, 'PUT'); const body = JSON.parse(mutation.options.body);
 assert.equal(body.effectiveTo, '2191-01-01'); assert.equal(body.periods[0].id, undefined);
});
test('save failure preserves unsaved periods and displays the conflict', async () => {
 await mount((url, options) => options ? reply({ error: { message: 'MONDAY 09:00–17:00 overlaps MONDAY 09:00–17:00.' } }, false) : reply([]));
 await click('Add working period'); await click('Add working period'); await submit();
 assert.equal(document.querySelectorAll('.admin-period').length, 2);
 assert.match(document.querySelector('[role=alert]').textContent, /overlaps/);
});
test('A→B→A ignores an older response for the same doctor', async () => {
 const old = deferred(); let calls = 0;
 await mount(url => { if (url === '/api/admin/doctors/A/schedules' && ++calls === 1) return old.promise; return reply(url.endsWith('/schedules') ? [version('new', [period('FRIDAY')])] : []); });
 await switchTo('B'); await switchTo('A');
 await act(async () => old.resolve(reply([version('old', [period('MONDAY')])])));
 assert.match(document.querySelector('.admin-period').textContent, /FRIDAY/);
});
test('switching during save cannot reload or overwrite the newly selected doctor', async () => {
 const pending = deferred();
 await mount((url, options) => options ? pending.promise : reply(url.endsWith('/schedules') ? [version(url.includes('/A/') ? 'a' : 'b', [period(url.includes('/A/') ? 'MONDAY' : 'FRIDAY')])] : []));
 await submit(); await switchTo('B'); const before = requests.length;
 await act(async () => pending.resolve(reply({})));
 assert.equal(document.querySelector('#schedule-doctor').value, 'B');
 assert.match(document.querySelector('.admin-period').textContent, /FRIDAY/);
 assert.equal(requests.length, before);
 assert.equal(document.querySelector('.badge-success'), null);
});
test('failed loads show errors and prevent saving blank data', async () => {
 await mount(url => reply(url.endsWith('/schedules') ? { error: { message: 'Load failed' } } : [], !url.endsWith('/schedules')));
 assert.match(document.querySelector('[role=alert]')?.textContent || '', /Load failed/);
 assert.equal([...document.querySelectorAll('button')].find(b => b.textContent.includes('Save schedule')).disabled, true);
});

test('pending replacement is edited with PUT even while a current schedule exists', async () => {
 const current = { ...version('current'), effectiveFrom: '2020-01-01', effectiveTo: '2189-12-31' };
 await mount((url, options) => options ? reply({}) : reply(url.endsWith('/schedules') ? [current, version('pending', [period('SUNDAY')])] : []));
 assert.equal(document.querySelector('.admin-period select').value, 'SUNDAY');
 await submit(); const mutation = requests.find(r => r.options);
 assert.equal(mutation.url, '/api/admin/doctors/A/schedules/pending');
 assert.equal(mutation.options.method, 'PUT');
});
test('all weekdays can be edited and loading blocks both forms', async () => {
 const pending = deferred();
 await mount(url => url === '/api/admin/doctors/A/schedules' ? pending.promise : reply([]));
 assert.ok([...document.querySelectorAll('form > fieldset')].every(f => f.disabled));
 await act(async () => pending.resolve(reply([version('all', ['MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY','SUNDAY'].map(period))])));
 assert.equal(document.querySelectorAll('.admin-period select').length, 7);
 for (const select of document.querySelectorAll('.admin-period select')) await change(select, 'WEDNESDAY');
 assert.ok([...document.querySelectorAll('.admin-period select')].every(s => s.value === 'WEDNESDAY'));
});
test('late save failure cannot leak into another doctor', async () => {
 const pending = deferred();
 await mount((url, options) => options ? pending.promise : reply(url.endsWith('/schedules') ? [version(url.includes('/A/') ? 'a' : 'b')] : []));
 await submit(); await switchTo('B');
 await act(async () => pending.resolve(reply({ error: { message: 'Old doctor failure' } }, false)));
 assert.equal(document.querySelector('[role=alert]'), null);
 assert.equal(document.querySelector('#schedule-doctor').value, 'B');
});

test('editing hours persists the actual input value and preserves it on rejection', async () => {
 await mount((url, options) => options ? reply({ error: { message: 'Rejected by server' } }, false) : reply(url.endsWith('/schedules') ? [version('edit')] : []));
 await change(document.querySelector('.admin-period input[type=time]'), '10:30');
 await submit();
 assert.equal(JSON.parse(requests.find(r => r.options).options.body).periods[0].startTime, '10:30');
 assert.equal(document.querySelector('.admin-period input[type=time]').value, '10:30');
});
test('late unavailable-date save cannot clear or replace another doctor view', async () => {
 const pending = deferred();
 await mount((url, options) => options ? pending.promise : reply([]));
 await change(document.querySelector('.admin-exception-form input[type=date]'), '2190-01-02');
 await change(document.querySelector('.admin-exception-form input:not([type])'), 'Leave');
 await act(async () => document.querySelector('.admin-exception-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
 assert.ok(requests.some(r => r.options && r.url.endsWith('/schedule-exceptions/2190-01-02')));
 await switchTo('B');
 await act(async () => pending.resolve(reply({})));
 assert.equal(document.querySelector('.badge-success'), null);
 assert.equal(document.querySelector('#schedule-doctor').value, 'B');
});
