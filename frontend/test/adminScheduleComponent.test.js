import { pagingReplacements } from './helpers/staffPagingHarness.js';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { transformWithOxc } from 'vite';
const dom = new JSDOM('<div id="root"></div>');
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node, DocumentFragment: dom.window.DocumentFragment, ShadowRoot: dom.window.ShadowRoot, getComputedStyle: dom.window.getComputedStyle, requestAnimationFrame: callback => setTimeout(callback, 0), IS_REACT_ACT_ENVIRONMENT: true });
const { createElement, act } = await import('react');
const { createRoot } = await import('react-dom/client');
let source = await readFile(new URL('../src/features/admin/AdminSchedulePanel.jsx', import.meta.url), 'utf8');
source = source.replace(/import \{ apiErrorMessage, fetchWithAuth \}[^;]+;/, 'const fetchWithAuth = (...args) => globalThis.scheduleFetch(...args); const apiErrorMessage = (d, fallback) => d?.error?.message || fallback;').replace(/import '\.\/adminSchedule.css';/, '').replace("'./scheduleVersion'", JSON.stringify(new URL('../src/features/admin/scheduleVersion.js', import.meta.url).href)).replace("'./latestRequest'", JSON.stringify(new URL('../src/features/admin/latestRequest.js', import.meta.url).href));
source = source.replace("'./scheduleTime.js'", JSON.stringify(new URL('../src/features/admin/scheduleTime.js', import.meta.url).href));
source = source.replace(/import \{ useTheme \}[^;]+;/, "const useTheme = () => ({ theme: 'light' });")
 .replace("'../../utils/patientMuiTheme.js'", JSON.stringify(new URL('../src/utils/patientMuiTheme.js', import.meta.url).href));
source = source.replace(/import AppDatePicker[^;]+;/, 'const AppDatePicker = props => <label>{props.label}<input type="date" value={props.value || ""} onChange={event => props.onChange(event.target.value)} /></label>;');
const weekFile = new URL(`.schedule-week-${process.pid}.mjs`, import.meta.url);
const weekSource = (await readFile(new URL('../src/features/admin/ScheduleWeekEditor.jsx', import.meta.url), 'utf8')).replace("'./scheduleTime.js'", JSON.stringify(new URL('../src/features/admin/scheduleTime.js', import.meta.url).href));
await writeFile(weekFile, (await transformWithOxc(weekSource, 'ScheduleWeekEditor.jsx', { jsx: { runtime: 'automatic' } })).code);
source = source.replace("'./ScheduleWeekEditor.jsx'", JSON.stringify(weekFile.href));
source = await pagingReplacements(source, 'scheduleFetch', 'schedulePaging');
const compiled = await transformWithOxc(source, 'AdminSchedulePanel.jsx', { jsx: { runtime: 'automatic' } });
const modulePath = new URL(`.schedule-component-${process.pid}.mjs`, import.meta.url);
await writeFile(modulePath, compiled.code);
let Panel;
try { Panel = (await import(modulePath.href)).default; } finally { await unlink(modulePath); await unlink(weekFile); }
let root; let requests; let handler;
const reply = (data, ok = true) => ({ ok, headers: { get: () => 'false' }, json: async () => data });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const period = (dayOfWeek = 'MONDAY') => ({ dayOfWeek, startTime: '09:00', endTime: '17:00', slotDurationMinutes: 30, active: true, breaks: [] });
const version = (id, periods = [period()]) => ({ id, active: true, effectiveFrom: '2190-01-01', effectiveTo: '2191-01-01', periods });
async function mount(fn = () => reply([]), t, config = () => reply({ clinicTimeZone: 'Africa/Khartoum' }), lang = 'en') {
 requests = []; handler = fn;
 globalThis.scheduleFetch = async (url, options) => {
  requests.push({ url, options });
  if (url.startsWith('/api/admin/doctors?')) return reply([{ id: 'A', fullNameEn: 'Doctor A' }, { id: 'B', fullNameEn: 'Doctor B' }]);
  if (url === '/api/public-config') return config();
  return handler(url, options);
 };
 root = createRoot(document.getElementById('root'));
 await act(async () => root.render(createElement(Panel, { t, lang })));
}
afterEach(async () => { if (root) await act(async () => root.unmount()); root = null; });
const click = async text => { const button = [...document.querySelectorAll('button')].find(b => b.textContent.toLowerCase().includes(text.toLowerCase())); assert.ok(button, text); await act(async () => button.click()); };
async function change(element, value) { await act(async () => { const proto = element.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(element, value); element.dispatchEvent(new window.Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }); }
const dayRow = day => document.querySelector(`.schedule-day[data-day="${day}"]`);
const workingDays = () => [...document.querySelectorAll('.schedule-day')].filter(row => row.querySelector('input[type=checkbox]').checked).map(row => row.dataset.day);
const expand = async (day = 'MONDAY') => { const button = dayRow(day).querySelector('button[aria-expanded]'); if (button.getAttribute('aria-expanded') !== 'true') await act(async () => button.click()); };
const editPeriod = async (day = 'MONDAY') => { await expand(day); if (!dayRow(day).querySelector('input[type=time]')) { const button = [...dayRow(day).querySelectorAll('button')].find(b => b.textContent.includes('Edit period')); assert.ok(button); await act(async () => button.click()); } };
const toggleDay = day => act(async () => dayRow(day).querySelector('input[type=checkbox]').click());
const switchTo = id => change(document.querySelector('#schedule-doctor'), id);
const submit = () => act(async () => document.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));

test('creation offers seven compact days and persists multiple working days through reload', async () => {
 let saved = [];
 await mount((url, options) => { if (options) { saved = JSON.parse(options.body).periods; return reply(version('saved', saved)); } return reply(url.endsWith('/schedules') && saved.length ? [version('saved', saved)] : []); });
 assert.equal(document.querySelectorAll('.schedule-day').length, 7);
 assert.equal(document.querySelectorAll('.admin-period').length, 0);
 await toggleDay('SUNDAY'); await toggleDay('SATURDAY'); await submit();
 assert.deepEqual(saved.map(p => p.dayOfWeek), ['SUNDAY', 'SATURDAY']);
 assert.deepEqual(workingDays(), ['SUNDAY', 'SATURDAY']);
});
test('editing retains effective end date and uses PUT without child database fields', async () => {
 await mount((url, options) => options ? reply({}) : reply(url.endsWith('/schedules') ? [version('existing', [{ ...period('FRIDAY'), id: 'child', scheduleId: 'existing' }])] : []));
 await submit(); const mutation = requests.find(r => r.options);
 assert.equal(mutation.options.method, 'PUT'); const body = JSON.parse(mutation.options.body);
 assert.equal(body.effectiveTo, '2191-01-01'); assert.equal(body.periods[0].id, undefined);
});
test('save failure preserves unsaved periods and displays the conflict', async () => {
 await mount((url, options) => options ? reply({ error: { message: 'MONDAY 09:00–17:00 overlaps MONDAY 09:00–17:00.' } }, false) : reply([]));
 await expand(); await click('Add working period'); await click('Done'); await click('Add working period'); await submit();
 assert.equal(document.querySelectorAll('.admin-period').length, 2);
 assert.match(document.querySelector('[role=alert]').textContent, /overlaps/);
});
test('future appointment conflicts show the translated explanation and keep edits intact', async () => {
 const arabic = 'هذا التغيير يتعارض مع موعد مستقبلي؛ عدّل ساعات العمل أو الاستراحة أو تاريخ السريان.';
 await mount((url, options) => options
  ? reply({ error: { code: 'SCHEDULE_FUTURE_APPOINTMENT_CONFLICT', message: 'Schedule conflict.' } }, false)
  : reply([]), key => key === 'scheduleAppointmentConflict' ? arabic : key);
 await expand(); await click('Add working period');
 await editPeriod();
 await change(document.querySelector('.admin-period input[type=time]'), '10:30');
 await submit();
 assert.equal(document.querySelector('[role=alert]').textContent, arabic);
 assert.equal(document.querySelector('.admin-period input[type=time]').value, '10:30');
});
test('A→B→A ignores an older response for the same doctor', async () => {
 const old = deferred(); let calls = 0;
 await mount(url => { if (url === '/api/admin/doctors/A/schedules' && ++calls === 1) return old.promise; return reply(url.endsWith('/schedules') ? [version('new', [period('FRIDAY')])] : []); });
 await switchTo('B'); await switchTo('A');
 await act(async () => old.resolve(reply([version('old', [period('MONDAY')])])));
 assert.deepEqual(workingDays(), ['FRIDAY']);
});
test('switching during save cannot reload or overwrite the newly selected doctor', async () => {
 const pending = deferred();
 await mount((url, options) => options ? pending.promise : reply(url.endsWith('/schedules') ? [version(url.includes('/A/') ? 'a' : 'b', [period(url.includes('/A/') ? 'MONDAY' : 'FRIDAY')])] : []));
 await submit(); await switchTo('B'); const before = requests.length;
 await act(async () => pending.resolve(reply({})));
 assert.equal(document.querySelector('#schedule-doctor').value, 'B');
 assert.deepEqual(workingDays(), ['FRIDAY']);
 assert.equal(requests.length, before);
 assert.equal(document.querySelector('.badge-success'), null);
});
test('failed loads show errors and prevent saving blank data', async () => {
 await mount(url => reply(url.endsWith('/schedules') ? { error: { message: 'Load failed' } } : [], !url.endsWith('/schedules')));
 assert.match(document.querySelector('[role=alert]')?.textContent || '', /Load failed/);
 assert.equal([...document.querySelectorAll('button')].find(b => b.textContent.toLowerCase().includes('save schedule')).disabled, true);
});

test('pending replacement is edited with PUT even while a current schedule exists', async () => {
 const current = { ...version('current'), effectiveFrom: '2020-01-01', effectiveTo: '2189-12-31' };
 await mount((url, options) => options ? reply({}) : reply(url.endsWith('/schedules') ? [current, version('pending', [period('SUNDAY')])] : []));
 assert.deepEqual(workingDays(), ['SUNDAY']);
 await submit(); const mutation = requests.find(r => r.options);
 assert.equal(mutation.url, '/api/admin/doctors/A/schedules/pending');
 assert.equal(mutation.options.method, 'PUT');
});
test('all weekdays can be edited and loading blocks both forms', async () => {
 const pending = deferred();
 await mount(url => url === '/api/admin/doctors/A/schedules' ? pending.promise : reply([]));
 assert.ok([...document.querySelectorAll('form > fieldset')].every(f => f.disabled));
 await act(async () => pending.resolve(reply([version('all', ['MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY','SUNDAY'].map(period))])));
 assert.equal(workingDays().length, 7);
 for (const day of [...workingDays()]) await toggleDay(day);
 assert.equal(workingDays().length, 0);
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
 await editPeriod();
 await change(document.querySelector('.admin-period input[type=time]'), '10:30');
 await submit();
 assert.equal(JSON.parse(requests.find(r => r.options).options.body).periods[0].startTime, '10:30');
 assert.equal(document.querySelector('.admin-period input[type=time]').value, '10:30');
});
test('late unavailable-date save cannot clear or replace another doctor view', async () => {
 const pending = deferred();
 await mount((url, options) => options ? pending.promise : reply([]));
 await change(document.querySelector('.admin-exception-form input[type=date]'), '2190-01-02');
 await change(document.querySelector('.admin-exception-form input[type=text]'), 'Leave');
 await act(async () => document.querySelector('.admin-exception-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
 assert.ok(requests.some(r => r.options && r.url.endsWith('/schedule-exceptions/2190-01-02')));
 await switchTo('B');
 await act(async () => pending.resolve(reply({})));
 assert.equal(document.querySelector('.badge-success'), null);
 assert.equal(document.querySelector('#schedule-doctor').value, 'B');
});

test('schedule selector reaches doctor 51 through an explicit additional page', async () => {
  const doctors = Array.from({ length: 55 }, (_, i) => ({ id: `doctor-${i + 1}`, fullNameEn: `Doctor ${i + 1}` }));
  requests = [];
  globalThis.scheduleFetch = async (url) => {
    requests.push({ url });
    if (url.startsWith('/api/admin/doctors?')) {
      const page = Number(new URL(url, 'https://example.invalid').searchParams.get('page'));
      const response = reply(doctors.slice((page - 1) * 50, page * 50));
      response.headers.get = () => page === 1 ? 'true' : 'false';
      return response;
    }
    return reply(url === '/api/public-config' ? { clinicTimeZone: 'Africa/Khartoum' } : []);
  };
  root = createRoot(document.getElementById('root'));
  await act(async () => root.render(createElement(Panel, {})));
  assert.equal([...document.querySelector('#schedule-doctor').options].some((option) => option.value === 'doctor-51'), false);
  await click('Load more');
  await switchTo('doctor-51');
  assert.equal(document.querySelector('#schedule-doctor').value, 'doctor-51');
  assert.ok(requests.some((r) => r.url === '/api/admin/doctors/doctor-51/schedules'));
});

test('two submits in the same event turn send exactly one mutation', async () => {
  const pending = deferred();
  await mount((url, options) => options ? pending.promise : reply(url.endsWith('/schedules') ? [version('single')] : []));
  await act(async () => {
    for (let i = 0; i < 2; i++) document.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  });
  assert.equal(requests.filter(r => r.options).length, 1);
  await act(async () => pending.resolve(reply({})));
  assert.equal([...document.querySelectorAll('button')].find(b => b.textContent.toLowerCase().includes('save schedule')).disabled, false);
});

test('effective dates and inactive state are editable and persist in PUT', async () => {
  await mount((url, options) => options ? reply({}) : reply(url.endsWith('/schedules') ? [{ ...version('inactive'), active: false }] : []));
  assert.equal(document.querySelector('#schedule-version').value, 'inactive');
  assert.equal(document.querySelector('.admin-schedule-version input[type=checkbox]').checked, false);
  const dates = document.querySelectorAll('.admin-schedule-version input[type=date]');
  await change(dates[0], '2190-02-01'); await change(dates[1], '2191-02-01');
  await submit();
  const mutation = requests.find(r => r.options);
  assert.equal(mutation.options.method, 'PUT');
  assert.equal(JSON.parse(mutation.options.body).active, false);
  assert.equal(JSON.parse(mutation.options.body).effectiveFrom, '2190-02-01');
  assert.equal(JSON.parse(mutation.options.body).effectiveTo, '2191-02-01');
});

test('explicit version selection exposes current and inactive schedules without mixing their forms', async () => {
  const current = { ...version('current', [period('TUESDAY')]), effectiveFrom: '2020-01-01', effectiveTo: null };
  const inactive = { ...version('inactive', [period('FRIDAY')]), active: false };
  await mount(url => reply(url.endsWith('/schedules') ? [current, version('future'), inactive] : []));
  await change(document.querySelector('#schedule-version'), 'inactive');
  assert.deepEqual(workingDays(), ['FRIDAY']);
  await change(document.querySelector('#schedule-version'), 'current');
  assert.deepEqual(workingDays(), ['TUESDAY']);
  assert.equal(document.querySelector('.admin-schedule-version input[type=checkbox]').checked, true);
});

test('switching the initialDoctorId prop clears the old schedule and loads the new doctor', async () => {
  await mount(url => reply(url.endsWith('/schedules') ? [version(url.includes('/A/') ? 'a' : 'b', [period(url.includes('/A/') ? 'MONDAY' : 'FRIDAY')])] : url === '/api/admin/doctors/B' ? { id: 'B', fullNameEn: 'Doctor B' } : []));
  await act(async () => root.render(createElement(Panel, { initialDoctorId: 'B' })));
  assert.equal(document.querySelector('#schedule-doctor').value, 'B');
  assert.deepEqual(workingDays(), ['FRIDAY']);
});

test('an empty active schedule is refused before sending a request', async () => {
  await mount(); await submit();
  assert.equal(requests.filter(r => r.options).length, 0);
  assert.match(document.querySelector('[role=alert]').textContent, /working period/);
});

test('configuration failure blocks editing until a retry obtains the clinic timezone', async () => {
  let attempts = 0;
  await mount(() => reply([]), undefined, () => ++attempts === 1 ? reply({ error: { message: 'Config unavailable' } }, false) : reply({ clinicTimeZone: 'Pacific/Kiritimati' }));
  assert.ok([...document.querySelectorAll('form > fieldset')].every(field => field.disabled));
  await click('Retry loading schedule');
  assert.equal(attempts, 2);
  assert.ok([...document.querySelectorAll('form > fieldset')].every(field => !field.disabled));
});

for (const lang of ['en','ar']) {
 test(`${lang}: invalid time ordering and duration show localized errors before a request`,async()=>{
  await mount(url=>reply(url.endsWith('/schedules')?[version('future')]:[]),undefined,undefined,lang);
  await editPeriod();
  const inputs=document.querySelectorAll('.admin-period-grid input[type=time]');
  await change(inputs[0],'22:00');await change(inputs[1],'08:00');await submit();
  assert.match(document.querySelector('[role=alert]').textContent,lang==='ar'?/بعد منتصف الليل غير مدعومة حالياً/:/Overnight schedules are not supported/);
  assert.equal(requests.some(r=>r.options),false);
  await change(inputs[0],'09:00');await change(inputs[1],'09:00');await submit();
  assert.match(document.querySelector('[role=alert]').textContent,lang==='ar'?/وقت النهاية بعد وقت البداية في نفس اليوم/:/end time must be after the start time/);
  await change(inputs[1],'09:15');await submit();
  assert.match(document.querySelector('[role=alert]').textContent,lang==='ar'?/ألا تتجاوز مدة فترة العمل/:/no longer than the working period/);
  await change(inputs[1],'17:00');
  assert.match(document.querySelector('.admin-period-time-summary').textContent,lang==='ar'?/09:00 ص – 05:00 م/:/09:00 AM – 05:00 PM/);
 });
 test(`${lang}: backend time errors are localized and preserve the form`,async()=>{
  await mount((url,options)=>options?reply({error:{code:'SCHEDULE_OVERNIGHT_UNSUPPORTED',message:'English server message'}},false):reply(url.endsWith('/schedules')?[version('future')]:[]),undefined,undefined,lang);
  await submit();
  assert.match(document.querySelector('[role=alert]').textContent,lang==='ar'?/بعد منتصف الليل غير مدعومة حالياً/:/Overnight schedules are not supported/);
  await editPeriod();
  assert.equal(document.querySelector('.admin-period input[type=time]').value,'09:00');
 });
}

for(const [startTime,endTime] of [['09:00','17:00'],['08:00','14:00'],['14:00','20:00']]) {
 test(`${startTime}–${endTime} submits canonical wall times without changing the effective date`,async()=>{
  await mount((url,options)=>options?reply({}):reply(url.endsWith('/schedules')?[version('future')]:[]));
  await editPeriod();
  const inputs=document.querySelectorAll('.admin-period-grid input[type=time]');
  await change(inputs[0],startTime);await change(inputs[1],endTime);await submit();
  const body=JSON.parse(requests.find(r=>r.options).options.body);
  assert.equal(body.periods[0].startTime,startTime);assert.equal(body.periods[0].endTime,endTime);
  assert.equal(body.effectiveFrom,'2190-01-01');
 });
}
test('partial native time input gets a localized error instead of submitting a blank value',async()=>{
 await mount(url=>reply(url.endsWith('/schedules')?[version('future')]:[]),undefined,undefined,'ar');
 await editPeriod();
 await change(document.querySelector('.admin-period input[type=time]'),'');await submit();
 assert.match(document.querySelector('[role=alert]').textContent,/أدخل وقتَي بداية ونهاية صالحين/);
 assert.equal(requests.some(r=>r.options),false);
});

test('closed days are compact and opening a day does not open its input editor', async () => {
 await mount(url => reply(url.endsWith('/schedules') ? [version('compact', [period(), period('TUESDAY')])] : []));
 assert.equal(document.querySelectorAll('.schedule-day').length, 7);
 assert.equal(document.querySelectorAll('.schedule-day input[type=time]').length, 0);
 assert.equal(document.querySelectorAll('.schedule-week-summary [role=listitem]').length, 7);
 assert.match(document.querySelector('.schedule-week-summary').textContent,/09:00–17:00/);
 await expand();
 assert.equal(document.querySelectorAll('.admin-period').length, 1);
 assert.equal(document.querySelectorAll('.schedule-day input[type=time]').length, 0);
 await expand('TUESDAY');
 assert.equal(dayRow('MONDAY').querySelector('[aria-expanded]').getAttribute('aria-expanded'),'false');
 assert.equal(dayRow('TUESDAY').querySelector('[aria-expanded]').getAttribute('aria-expanded'),'true');
});

test('editing one day, adding a second period and a break leave other days intact', async () => {
 await mount((url,options)=>options?reply({}):reply(url.endsWith('/schedules')?[version('multi',[period(),period('TUESDAY')])]:[]));
 await editPeriod();
 await change(document.querySelector('.admin-period input[type=time]'),'10:00');
 await click('Add break');
 const breaks=document.querySelectorAll('.admin-break input');
 await change(breaks[0],'12:00');await change(breaks[1],'13:00');await click('Done');
 assert.match(dayRow('MONDAY').textContent,/Break: 12:00 PM – 01:00 PM/);
 assert.equal(dayRow('MONDAY').querySelectorAll('input[type=time]').length,0);
 await click('Add working period');await click('Done');await submit();
 const saved=JSON.parse(requests.find(r=>r.options).options.body).periods;
 assert.equal(saved.length,3);
 assert.equal(saved[0].startTime,'10:00');assert.equal(saved[0].breaks[0].endTime,'13:00');
 assert.equal(saved[1].dayOfWeek,'TUESDAY');assert.equal(saved[1].startTime,'09:00');
 assert.equal(saved[2].startTime,'17:00');
});

test('cancel restores a period and removing a break and period updates the payload', async()=>{
 await mount((url,options)=>options?reply({}):reply(url.endsWith('/schedules')?[version('breaks',[{...period(),breaks:[{startTime:'12:00',endTime:'13:00'}]}, {...period(),startTime:'18:00',endTime:'20:00'}])]:[]));
 await editPeriod();await change(document.querySelector('.admin-period input[type=time]'),'10:00');await click('Cancel');
 await editPeriod();assert.equal(document.querySelector('.admin-period input[type=time]').value,'09:00');
 await act(async()=>document.querySelector('button[aria-label="Remove break"]').click());await click('Done');
 const deleteButtons=dayRow('MONDAY').querySelectorAll('button[aria-label="Remove period"]');
 await act(async()=>deleteButtons[1].click());await submit();
 const saved=JSON.parse(requests.find(r=>r.options).options.body).periods;
 assert.equal(saved.length,1);assert.deepEqual(saved[0].breaks,[]);
});

test('invalid collapsed periods are revealed beside the affected day and corrected in place',async()=>{
 await mount(url=>reply(url.endsWith('/schedules')?[version('invalid',[period(),{...period('TUESDAY'),startTime:'22:00',endTime:'08:00'}])]:[]));
 await submit();
 assert.equal(dayRow('TUESDAY').querySelector('[aria-expanded]').getAttribute('aria-expanded'),'true');
 assert.match(dayRow('TUESDAY').querySelector('[role=alert]').textContent,/Overnight schedules are not supported/);
 assert.equal(requests.some(r=>r.options),false);
 const times=dayRow('TUESDAY').querySelectorAll('input[type=time]');await change(times[0],'09:00');await change(times[1],'17:00');
 assert.equal(dayRow('TUESDAY').querySelector('[role=alert]'),null);
});

test('overlapping periods are rejected locally, including when their editors are closed',async()=>{
 await mount(url=>reply(url.endsWith('/schedules')?[version('overlap',[period(),{...period(),startTime:'16:00',endTime:'18:00'}])]:[]));
 await submit();assert.match(dayRow('MONDAY').textContent,/must not overlap/);assert.equal(requests.some(r=>r.options),false);
});

test('unavailable-date add and restore preserve unsaved weekly changes',async()=>{
 let exceptions=[];
 await mount((url,options)=>{
  if(options){if(options.method==='PUT')exceptions=[{id:'leave',date:'2190-01-02',reason:'Leave',type:'FULL_DAY_LEAVE',active:true}];else exceptions=[];return reply({});}
  return reply(url.endsWith('/schedules')?[version('unsaved')]:exceptions);
 });
 await editPeriod();await change(document.querySelector('.admin-period input[type=time]'),'10:30');
 await change(document.querySelector('.admin-exception-form input[type=date]'),'2190-01-02');
 await change(document.querySelector('.admin-exception-form input[type=text]'),'Leave');
 await act(async()=>document.querySelector('.admin-exception-form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})));
 assert.equal(document.querySelector('.admin-period input[type=time]').value,'10:30');
 assert.match(document.querySelector('.admin-exception').textContent,/2190-01-02.*Leave/);
 globalThis.confirm=()=>true;
 try{await click('Restore');}finally{delete globalThis.confirm;}
 assert.equal(document.querySelector('.admin-period input[type=time]').value,'10:30');assert.equal(document.querySelector('.admin-exception'),null);
 assert.deepEqual(requests.filter(r=>r.options).map(r=>r.options.method),['PUT','PATCH']);
});

test('selected version status uses the existing endpoint and clears old editor state on version changes',async()=>{
 const future=version('status');
 await mount((url,options)=>{if(options){future.active=false;return reply({...future});}return reply(url.endsWith('/schedules')?[future]:[]);});
 await editPeriod();await click('Deactivate selected version');
 assert.equal(requests.find(r=>r.options).url,'/api/admin/doctors/A/schedules/status/status');
 assert.equal(JSON.parse(requests.find(r=>r.options).options.body).active,false);
 assert.equal(document.querySelectorAll('.admin-period').length,0);
});

test('Arabic uses RTL day controls, localized summaries and isolated English doctor names',async()=>{
 const {default:i18n}=await import('../src/i18n.js');
 await mount(url=>reply(url.endsWith('/schedules')?[version('rtl')]:[]),i18n.getFixedT('ar'),undefined,'ar');
 assert.equal(document.querySelector('.admin-schedule-panel').dir,'rtl');
 assert.match(document.querySelector('.schedule-week-summary').textContent,/الإثنين/);
 assert.ok(dayRow('MONDAY').querySelector('button[aria-label="تعديل: الإثنين"]'));
 assert.equal(document.querySelector('.admin-schedule-panel bdi').textContent,'Doctor A');
 await expand();
 const edit=[...dayRow('MONDAY').querySelectorAll('button')].find(b=>b.textContent.includes('تعديل الفترة'));
 await act(async()=>edit.click());
 assert.equal(dayRow('MONDAY').querySelector('input[type=time]').dir,'ltr');
});

test('editing a current schedule creates a new version from tomorrow instead of overwriting history',async()=>{
 const current={...version('current'),effectiveFrom:'2020-01-01',effectiveTo:null};
 await mount((url,options)=>options?reply({}):reply(url.endsWith('/schedules')?[current]:[]));
 await submit();const mutation=requests.find(r=>r.options);
 assert.equal(mutation.options.method,'POST');assert.equal(mutation.url,'/api/admin/doctors/A/schedules');
 const body=JSON.parse(mutation.options.body);
 assert.ok(body.effectiveFrom>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Khartoum',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()));
 assert.notEqual(body.effectiveFrom,current.effectiveFrom);
});

test('a break outside its period appears beside the edited period and prevents saving',async()=>{
 await mount(url=>reply(url.endsWith('/schedules')?[version('bad-break')]:[]));
 await editPeriod();await click('Add break');
 const times=document.querySelectorAll('.admin-break input');await change(times[0],'08:00');await change(times[1],'09:30');
 await submit();assert.match(dayRow('MONDAY').querySelector('[role=alert]').textContent,/lie inside its working period/);
 assert.equal(requests.some(r=>r.options),false);
});

test('cancel after a failed save restores the values from before period editing',async()=>{
 await mount(url=>reply(url.endsWith('/schedules')?[version('cancel-validation')]:[]));
 await editPeriod();
 const times=dayRow('MONDAY').querySelectorAll('input[type=time]');
 await change(times[0],'22:00');await change(times[1],'08:00');await submit();
 assert.match(dayRow('MONDAY').textContent,/Overnight schedules are not supported/);
 await click('Cancel');
 assert.match(dayRow('MONDAY').textContent,/09:00 AM – 05:00 PM/);
 assert.equal(dayRow('MONDAY').querySelector('[role=alert]'),null);
});
