// Run against one existing headless Chrome instance. All APIs are synthetic.
import fs from 'node:fs';
import path from 'node:path';
const origin = process.env.CLINIC_UI_ORIGIN || 'http://127.0.0.1:5187';
const cdp = process.env.CLINIC_CDP_ORIGIN || 'http://127.0.0.1:9337';
for (const value of [origin, cdp]) if (!['127.0.0.1', 'localhost'].includes(new URL(value).hostname)) throw Error('Local origins only');
const output = path.resolve(process.env.CLINIC_UI_OUTPUT || '../qa-evidence/admin-shell');
fs.mkdirSync(output, { recursive: true });
const report = { checks: [], layouts: [], screenshots: [], exceptions: [], consoleErrors: [], unexpectedWrites: [] };
const smoke = process.argv.includes('--smoke');
const doctors = Array.from({ length: 45 }, (_, i) => ({ id: `doctor-${i}`, userId: `user-${i}`, fullNameAr: `طبيب اختبار ${i}`, fullNameEn: `Fixture Doctor ${i}`, specialtyAr: 'طب عام', specialtyEn: 'General medicine', specialtyId: 'specialty', consultationFee: 1000, status: 'ACTIVE', account: { status: 'ACTIVE' } }));
const services = Array.from({ length: 45 }, (_, i) => ({ id: `service-${i}`, code: `service_${i}`, labelAr: `خدمة اختبار ${i}`, labelEn: `Fixture Service ${i}`, priceSdg: 1000, baseFeeSdg: 1000, status: 'ACTIVE', category: i % 2 ? 'LABORATORY' : 'CLINICAL_PROCEDURE' }));
const medicines = Array.from({ length: 45 }, (_, i) => ({ id: `medicine-${i}`, labelAr: `دواء اختبار ${i}`, labelEn: `Fixture Medicine ${i}`, unitPriceSdg: 1000, status: 'ACTIVE' }));
const staff = Array.from({ length: 45 }, (_, i) => ({ id: `staff-${i}`, username: `fixture-${i}@example.test`, role: 'RECEPTIONIST', status: 'ACTIVE', mfaEnabled: false }));
const specialty = { id: 'specialty', code: 'general', nameAr: 'طب عام', nameEn: 'General medicine', active: true };
const periods = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'].map(dayOfWeek => ({ dayOfWeek, startTime: '09:00', endTime: '17:00', slotDurationMinutes: 30, active: true, breaks: [] }));
function fixture(url, method) {
  const key = url.pathname;
  if (key.startsWith('/socket.io')) return [503, {}];
  if (method !== 'GET') { report.unexpectedWrites.push({ method, key }); return [503, {}]; }
  if (key === '/api/public-config') return [200, { clinicTimeZone: 'Africa/Khartoum', staffMfaRequired: false }];
  if (key === '/api/specialties') return [200, [specialty]];
  if (key === '/api/notifications') return [200, { items: [], unreadCount: 0 }];
  if (key === '/api/admin/pricing') return [200, { doctors, services, medicines }];
  if (key === '/api/admin/doctors') return [200, url.searchParams.get('pageSize') === '12' ? doctors.slice(0, 12) : doctors];
  if (key.endsWith('/schedules')) return [200, [{ id: 'schedule', effectiveFrom: '2020-01-01', effectiveTo: null, active: true, periods }]];
  if (key.endsWith('/schedule-exceptions')) return [200, []];
  if (key === '/api/admin/catalog/services' || key === '/api/admin/catalog/laboratory-tests') {
    const items = services.filter(item => key.endsWith('laboratory-tests') ? item.category === 'LABORATORY' : item.category !== 'LABORATORY').slice(0, 12);
    return [200, { items, total: 45 }];
  }
  if (key === '/api/auth/users') return [200, staff];
  if (key === '/api/auth/audit-logs') return [200, { items: Array.from({ length: 25 }, (_, i) => ({ id: `audit-${i}`, timestamp: '2026-10-27T10:00:00Z', action: 'USER_PASSWORD_CHANGED', actor: staff[i], target: { type: 'USER', id: staff[i].id }, details: JSON.stringify({ role: 'RECEPTIONIST' }) })), pagination: { page: 1, pageSize: 25, total: 25, totalPages: 1 }, filters: { actions: [] } }];
  if (key === '/api/admin/analytics') return [200, { totalPatients: 1250, monthlyVisits: 450, completionRate: 90, financials: { totalRevenueSdg: 1000000 }, appointmentTrend: Array.from({ length: 7 }, (_, i) => ({ date: `2026-10-${20 + i}`, count: 15 + i })), appointmentStatuses: [{ status: 'COMPLETED', count: 90 }, { status: 'PENDING', count: 10 }], doctorVisits: doctors.map(doctor => ({ ...doctor, doctorId: doctor.id, visitsCount: 15 })) }];
  if (key === '/api/pharmacy/formulary') return [200, { items: [], pagination: { page: 1, totalPages: 1 } }];
  return [200, []];
}
const target = await (await fetch(`${cdp}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let sequence = 0, initId; const pending = new Map();
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(Error(`Timeout ${method}`)); }, 20000);
  pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }));
});
ws.onmessage = async ({ data }) => {
  const event = JSON.parse(data);
  if (event.id) {
    const task = pending.get(event.id); if (!task) return; pending.delete(event.id); clearTimeout(task.timer);
    if (event.error) task.reject(Error(event.error.message)); else task.resolve(event.result);
  } else if (event.method === 'Fetch.requestPaused') {
    const { requestId, request } = event.params;
    const [status, body] = fixture(new URL(request.url), request.method);
    await send('Fetch.fulfillRequest', { requestId, responseCode: status, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'X-Has-More', value: 'false' }, { name: 'X-Total-Count', value: '45' }], body: Buffer.from(JSON.stringify(body)).toString('base64') }).catch(() => {});
  } else if (event.method === 'Runtime.exceptionThrown') report.exceptions.push(event.params.exceptionDetails.exception?.description || event.params.exceptionDetails.text);
  else if (event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error') report.consoleErrors.push(event.params.args.map(arg => arg.description || arg.value).join(' '));
};
const ev = async expression => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
const wait = expression => ev(`new Promise(resolve=>{const end=Date.now()+10000;const poll=()=>{if(${expression})resolve(true);else if(Date.now()>end)resolve(false);else setTimeout(poll,40)};poll()})`);
const check = (name, passed) => { report.checks.push({ name, passed: Boolean(passed) }); if (!passed) console.log(`FAIL ${name}`); };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function mount(width, height, lang, mode, role = 'ADMIN') {
  if (initId) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: initId });
  const user = { id: 'audit-user', username: 'layout@example.test', role, mfaEnabled: true, doctorId: 'doctor-0' };
  const source = `localStorage.clear();sessionStorage.clear();localStorage.setItem('shifa_language',${JSON.stringify(lang)});localStorage.setItem('alshifa_theme',${JSON.stringify(mode)});sessionStorage.setItem('cms_staff_user',${JSON.stringify(JSON.stringify(user))});sessionStorage.setItem('cms_staff_token','synthetic-only');`;
  initId = (await send('Page.addScriptToEvaluateOnNewDocument', { source })).identifier;
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
  await send('Page.navigate', { url: `${origin}/staff` });
  check(`mounted ${width}-${height}-${lang}-${mode}-${role}`, await wait('!!document.querySelector(".dashboard-wrapper")&&!document.querySelector(".portal-loading")'));
}
const measure = () => ev(`(()=>{const box=s=>{const e=document.querySelector(s),r=e.getBoundingClientRect(),c=getComputedStyle(e);return {x:r.x,y:r.y,width:r.width,height:r.height,scrollTop:e.scrollTop,scrollHeight:e.scrollHeight,clientHeight:e.clientHeight,overflowY:c.overflowY,position:c.position}};return {header:box('.nav-header'),sidebar:box('.sidebar-menu'),content:box('.admin-workspace>.workspace-panel'),bodyTop:document.scrollingElement.scrollTop,bodyHeight:document.scrollingElement.scrollHeight,bodyWidth:document.scrollingElement.scrollWidth,width:innerWidth,height:innerHeight,dir:document.documentElement.dir,theme:document.documentElement.dataset.theme}})()`);
async function shot(name) { const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); fs.writeFileSync(path.join(output, `${name}.png`), Buffer.from(r.data, 'base64')); report.screenshots.push(name); }
async function tab(index, ready) {
  await ev(`(()=>{document.querySelector('.sidebar-menu').scrollTop=0;const b=document.querySelectorAll('.sidebar-menu .menu-btn')[${index}];b.click()})()`);
  check(`loaded tab ${index}`, await wait(ready));
}
async function probe(name, desktop) {
  await ev(`(async()=>{await document.fonts.ready;let previous='',stable=0;for(let i=0;i<24;i++){await new Promise(r=>setTimeout(r,40));const signature=document.querySelector('.admin-workspace>.workspace-panel').scrollHeight+':'+document.querySelector('.nav-header').offsetHeight;if(signature===previous)stable++;else stable=0;if(stable>=3)return;previous=signature}})()`);
  await ev(`(()=>{const c=document.querySelector('.admin-workspace>.workspace-panel');c.scrollTo({top:0,behavior:'instant'});scrollTo({top:0,behavior:'instant'})})()`);
  const before = await measure();
  if (desktop) {
    await ev(`(()=>{const c=document.querySelector('.admin-workspace>.workspace-panel');c.scrollTo({top:c.scrollHeight,behavior:'instant'});scrollTo({top:999999,behavior:'instant'})})()`);
    const after = await measure();
    check(`${name} content owns vertical scroll`, after.content.overflowY === 'auto' && after.content.scrollTop > 0);
    check(`${name} stable header`, Math.abs(after.header.y - before.header.y) < .5 && Math.abs(after.header.height - before.header.height) < .5);
    check(`${name} stable sidebar`, Math.abs(after.sidebar.y - before.sidebar.y) < .5 && Math.abs(after.sidebar.x - before.sidebar.x) < .5 && Math.abs(after.sidebar.height - before.sidebar.height) < .5);
    check(`${name} no document scroll`, after.bodyTop === 0 && after.bodyHeight <= after.height + 1);
    check(`${name} no horizontal page scroll`, after.bodyWidth <= after.width);
    const contentPosition = after.content.scrollTop;
    await ev('document.querySelector(".sidebar-menu").scrollTop=999999');
    const sidebar = await measure();
    check(`${name} independent sidebar`, sidebar.content.scrollTop === contentPosition && sidebar.bodyTop === 0 && sidebar.sidebar.overflowY === 'auto');
    if (sidebar.sidebar.scrollHeight > sidebar.sidebar.clientHeight + 1) check(`${name} long menu scrolls internally`, sidebar.sidebar.scrollTop > 0);
    report.layouts.push({ name, before, after, sidebar });
  } else {
    await ev('scrollTo({top:document.scrollingElement.scrollHeight,behavior:"instant"})');
    const after = await measure();
    check(`${name} responsive navigation`, after.sidebar.position === 'static' && after.sidebar.height < 150);
    check(`${name} narrow document remains scrollable`, after.bodyTop > 0);
    check(`${name} no horizontal page scroll`, after.bodyWidth <= after.width);
    report.layouts.push({ name, before, after });
  }
}
try {
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await send('Fetch.enable', { patterns: [{ urlPattern: '*/api/*' }, { urlPattern: '*/socket.io/*' }] });
  for (const [width, height] of (smoke ? [[1366, 768]] : [[1366, 768], [768, 1024], [390, 844]])) for (const lang of (smoke ? ['ar'] : ['ar', 'en'])) for (const mode of (smoke ? ['light'] : ['light', 'dark'])) {
    const key = `${width}-${height}-${lang}-${mode}`, desktop = width > 900;
    await mount(width, height, lang, mode);
    check(`language/theme ${key}`, await ev(`document.documentElement.dir===${JSON.stringify(lang === 'ar' ? 'rtl' : 'ltr')}&&document.documentElement.dataset.theme===${JSON.stringify(mode)}`));
    await tab(2, 'document.querySelectorAll("input[aria-label^=doctors]").length===45');
    if (width === 1366 && lang === 'en' && mode === 'light') {
      await ev('document.querySelector(".app-layout").classList.remove("app-layout--admin")');
      const legacy = await measure(); report.legacy = legacy;
      check('legacy shell reproduces body scrolling', legacy.bodyHeight > legacy.height);
      await shot('legacy-unbounded-pricing');
      await ev('document.querySelector(".app-layout").classList.add("app-layout--admin");scrollTo({top:0,behavior:"instant"})');
    }
    await probe(`pricing-${key}`, desktop); await shot(`pricing-deep-${key}`);
    if (desktop) {
      const b = await measure();
      await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: Math.round(b.content.x + b.content.width / 2), y: Math.round(b.content.y + b.content.height / 2), deltaX: 0, deltaY: 1200 }); await delay(80);
      check(`wheel does not chain to document ${key}`, await ev('document.scrollingElement.scrollTop===0'));
      await ev('document.querySelector(".admin-workspace>.workspace-panel").scrollTop=0;document.querySelector(".admin-workspace>.workspace-panel").focus()');
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'PageDown', code: 'PageDown', windowsVirtualKeyCode: 34 });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'PageDown', code: 'PageDown', windowsVirtualKeyCode: 34 }); await delay(100);
      check(`keyboard scrolls workspace ${key}`, await ev('document.querySelector(".admin-workspace>.workspace-panel").scrollTop>0&&document.scrollingElement.scrollTop===0'));
    }
    await tab(4, 'document.querySelectorAll(".clinic-setup-panel article").length>=12'); await probe(`doctors-${key}`, desktop);
    await ev('document.querySelectorAll(".clinic-setup-panel [role=tab]")[2].click()');
    check(`clinical services loaded ${key}`, await wait('document.querySelectorAll(".clinic-setup-panel article").length>=12&&document.querySelector(".clinic-setup-panel").textContent.includes("service_")'));
    await probe(`clinical-services-${key}`, desktop);
    await tab(5, 'document.querySelectorAll(".clinic-setup-panel tbody tr,.clinic-setup-panel article").length>=12'); await probe(`laboratory-services-${key}`, desktop);
    await tab(6, '!!document.querySelector(".schedule-save-bar button:not(:disabled)")'); await probe(`schedules-${key}`, desktop); await shot(`schedules-deep-${key}`);
    check(`schedule save bar reachable ${key}`, await ev('(()=>{const r=document.querySelector(".schedule-save-bar").getBoundingClientRect();return r.bottom<=innerHeight+1&&r.top<innerHeight})()'));
    await tab(7, 'document.querySelectorAll(".analytics-kpi").length===4'); await probe(`reports-${key}`, desktop);
    await tab(1, 'document.body.textContent.includes("fixture-44@example.test")'); await probe(`staff-${key}`, desktop);
    await tab(8, 'document.querySelectorAll(".audit-panel tbody tr,.audit-card").length>=25'); await probe(`audit-${key}`, desktop);
    if (mode === 'dark') await shot(`audit-deep-${key}`);
    console.log(`Checked ${key}`);
  }
  for (const [width, height] of (smoke ? [] : [[1366, 480], [1366, 1366], [1024, 768], [901, 700], [900, 1024], [320, 740]])) {
    await mount(width, height, 'ar', 'dark');
    await tab(2, 'document.querySelectorAll("input[aria-label^=doctors]").length===45');
    await probe(`edge-${width}-${height}`, width > 900); await shot(`edge-${width}-${height}`);
  }
  for (const role of (smoke ? [] : ['RECEPTIONIST', 'DOCTOR', 'LAB_TECH', 'PHARMACIST'])) {
    await mount(1366, 768, 'en', 'light', role);
    check(`other role unscoped ${role}`, await ev('!document.querySelector(".app-layout--admin")&&!document.querySelector(".admin-workspace")'));
  }
  check('no unexpected writes', report.unexpectedWrites.length === 0);
  check('no uncaught browser exceptions', report.exceptions.length === 0);
} catch (error) { report.fatal = error.stack; console.error(error.message); }
finally {
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ checks: report.checks.length, failures: report.checks.filter(c => !c.passed), screenshots: report.screenshots.length, exceptions: report.exceptions, fatal: report.fatal }));
  ws.close(); await fetch(`${cdp}/json/close/${target.id}`);
  process.exitCode = report.fatal || report.checks.some(c => !c.passed) ? 1 : 0;
}
