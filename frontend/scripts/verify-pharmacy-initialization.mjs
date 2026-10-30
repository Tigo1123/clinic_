import fs from 'node:fs';
import assert from 'node:assert/strict';
const origin = process.env.CLINIC_UI_ORIGIN || 'http://127.0.0.1:5187';
const browser = process.env.CLINIC_BROWSER_ORIGIN || 'http://127.0.0.1:9337';
for (const url of [origin, browser]) assert.ok(['127.0.0.1', 'localhost'].includes(new URL(url).hostname));
const output = process.env.CLINIC_UI_OUTPUT || '/tmp/clinic-pharmacy-initialization'; fs.mkdirSync(output, { recursive: true });
const report = { checks: [], exceptions: [], requests: [], screenshots: [] };
const target = await (await fetch(`${browser}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let seq = 0, scenario = {}, held = [];
const pending = new Map();
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const medicine = { id: 'medicine-1', labelAr: 'باراسيتامول', labelEn: 'Paracetamol', brandName: 'Paracetamol', status: 'ACTIVE', unitPriceSdg: 500, stock: { usableStock: 25, totalOnHand: 25, batchCount: 1, nearestUnexpiredExpiry: '2030-01-01' } };
const prescription = { id: 'rx-1', patient: { fullNameAr: 'مريض الاختبار', fullNameEn: 'Test Patient' }, doctor: { fullNameAr: 'طبيب الاختبار', fullNameEn: 'Test Doctor' }, prescriptionDate: '2026-10-30T08:00:00Z', status: 'ACTIVE', billingStatus: 'UNPAID', prescribedDrugs: [{ id: 'item-1', drug: medicine, drugId: medicine.id, qtyPrescribed: 2, qtyDispensed: 0, dosage: '1', duration: '2 days' }] };
async function fulfill(requestId, body, status = 200) { await send('Fetch.fulfillRequest', { requestId, responseCode: status, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify(body)).toString('base64') }); }
ws.onmessage = async ({ data }) => {
  const event = JSON.parse(data);
  if (event.id) { const task = pending.get(event.id); if (!task) return; pending.delete(event.id); event.error ? task.reject(Error(event.error.message)) : task.resolve(event.result); return; }
  if (event.method === 'Runtime.exceptionThrown') report.exceptions.push(event.params.exceptionDetails.exception?.description || event.params.exceptionDetails.text);
  if (event.method !== 'Fetch.requestPaused') return;
  const { requestId, request } = event.params; const path = new URL(request.url).pathname;
  report.requests.push({ scenario: scenario.name, path });
  if (scenario.hold === path || (scenario.holdAsset && path.includes('/src/features/pharmacy/PharmacyDashboard'))) { held.push(requestId); return; }
  if (!path.includes('/api/')) { await send('Fetch.continueRequest', { requestId }); return; }
  let body = [], status = 200;
  if (path === '/api/public-config') body = { clinicTimeZone: 'Africa/Khartoum' };
  if (path === '/api/notifications') body = { notifications: [], unreadCount: 0, nextCursor: null };
  if (path === '/api/records/prescriptions/pending') body = [prescription];
  if (path === '/api/records/drugs') body = [medicine];
  if (path === '/api/pharmacy/formulary') body = { items: [medicine], pagination: { page: 1, total: 1, totalPages: 1 } };
  if (path === '/api/pharmacy/formulary/medicine-1') body = medicine;
  if (path.endsWith('/payment-state')) body = { prescriptionId: prescription.id, invoice: null, dispensingAllowed: false, allowedPaymentMethods: [], billingPending: { code: 'PRESCRIPTION_REVIEW_REQUIRED' } };
  if (scenario.fail === path || (scenario.fail === 'all' && path !== '/api/public-config' && path !== '/api/notifications')) { status = scenario.status; body = { error: { code: status === 401 ? 'AUTHENTICATION_REQUIRED' : 'UNEXPECTED_BACKEND_FAILURE', message: 'RAW PRIVATE ENGLISH BACKEND ERROR' } }; }
  if (scenario.malformed === path) body = { unexpected: true };
  try { await fulfill(requestId, body, status); } catch (error) { if (!error.message.includes('Invalid InterceptionId')) report.exceptions.push(`fixture: ${error.message}`); }
};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function ev(expression) { const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result.value; }
async function until(expression) { for (let i = 0; i < 120; i++) { if (await ev(expression)) return; await delay(50); } throw Error(`Timed out ${scenario.name}: ${expression}`); }
function check(name, passed) { report.checks.push({ scenario: scenario.name, name, passed: !!passed }); if (!passed) throw Error(`FAIL ${scenario.name}: ${name}`); }
const click = selector => ev(`document.querySelector(${JSON.stringify(selector)}).click()`);
async function shot(name) { await ev('document.fonts.ready'); const image = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); fs.writeFileSync(`${output}/${name}.png`, Buffer.from(image.data, 'base64')); report.screenshots.push(`${name}.png`); }
async function mount(config, lang, mode) {
  scenario = { ...config, name: `${config.name}-${lang}-${mode}` }; held = [];
  await send('Page.navigate', { url: `${origin}/staff?pharmacy-init=${encodeURIComponent(scenario.name)}&lang=${lang}&mode=${mode}` });
  await until(`location.search.includes(${JSON.stringify(encodeURIComponent(scenario.name))}) && !!document.querySelector('#root')`);
}
const queuePath = '/api/records/prescriptions/pending';
await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable'); await send('Network.setBlockedURLs', { urls: ['*socket.io*'] });
await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 960, deviceScaleFactor: 1, mobile: false });
await send('Fetch.enable', { patterns: [{ urlPattern: '*/api/*' }, { urlPattern: '*/src/features/pharmacy/PharmacyDashboard*' }] });
await send('Page.addScriptToEvaluateOnNewDocument', { source: `if(location.search.includes('pharmacy-init=')){const q=new URLSearchParams(location.search);sessionStorage.setItem('cms_staff_user',JSON.stringify({id:'fixture-pharmacist',username:'pharmacy',role:'PHARMACIST'}));sessionStorage.setItem('cms_staff_token','fixture-only');localStorage.setItem('shifa_language',q.get('lang'));localStorage.setItem('alshifa_theme',q.get('mode'));}` });
try {
  for (const lang of ['ar', 'en']) for (const mode of ['dark', 'light']) {
    if (!process.env.CLINIC_MODULE_ONLY) {
    await mount({ name: 'success' }, lang, mode);
    await until('!!document.querySelector(".queue-card-item") && !document.querySelector(".pharmacy-read-feedback")');
    check('route and page loaders finish', await ev('!document.querySelector(".route-loading,.pharmacy-page-loading,.portal-loading")'));
    check('localized direction and theme', await ev(`document.documentElement.lang===${JSON.stringify(lang)}&&document.documentElement.dir===${JSON.stringify(lang === 'ar' ? 'rtl' : 'ltr')}&&document.documentElement.dataset.theme===${JSON.stringify(mode)}`));
    const settledRequests = report.requests.filter(r => r.scenario === scenario.name).length;
    await delay(150);
    check('no repeated initial fetch loop', report.requests.filter(r => r.scenario === scenario.name).length === settledRequests);
    await shot(`success-${lang}-${mode}`);
    await click('.queue-card-item'); await until('!!document.querySelector(".pharmacy-payment button")&&!document.querySelector(".pharmacy-payment [role=status]")');
    check('payment state reaches explicit non-dispensing state', await ev('!document.querySelector(".pharmacy-payment [role=status]")'));
    await click('.pharmacy-workspace-tabs button:nth-child(2)'); await until('!!document.querySelector(".pharmacy-inventory-table tbody tr")');
    check('inventory price preserved read only', await ev('document.querySelector(".pharmacy-inventory-table").textContent.includes("500")&&!document.querySelector(".pharmacy-inventory-table input")'));
    await shot(`inventory-${lang}-${mode}`);

    for (const status of [403, 500]) {
      await mount({ name: `queue-${status}`, fail: queuePath, status }, lang, mode);
      await until('!!document.querySelector(".pharmacy-queue-column .pharmacy-read-feedback [role=alert]")&&!document.querySelector(".pharmacy-read-feedback [role=status]")');
      check(`${status} explicit error and retry`, await ev('!!document.querySelector(".pharmacy-read-feedback button")&&!document.querySelector(".pharmacy-read-feedback [role=status]")'));
      check('backend error never rendered', !(await ev('document.body.innerText')).includes('RAW PRIVATE'));
      check('no fake empty prescription queue', !(await ev('document.body.innerText')).includes(lang === 'ar' ? 'لا توجد وصفات بانتظار الصرف.' : 'No prescriptions are awaiting dispensing.'));
      await shot(`queue-${status}-${lang}-${mode}`);
      scenario.fail = null; await click('.pharmacy-read-feedback button'); await until('!!document.querySelector(".queue-card-item")');
      check('retry recovers queue', true);
    }
    await mount({ name: 'one-panel-failure', fail: '/api/records/drugs', status: 500 }, lang, mode);
    await until('!!document.querySelector(".queue-card-item")&&!!document.querySelector(".pharmacy-read-feedback [role=alert]")');
    check('catalog failure does not block prescriptions', true);
    await click('.pharmacy-workspace-tabs button:nth-child(2)'); await until('!!document.querySelector(".pharmacy-inventory-table")');
    check('catalog failure does not block inventory', true);
    await shot(`one-panel-failure-${lang}-${mode}`);

    await mount({ name: 'malformed', malformed: queuePath }, lang, mode);
    await until('!!document.querySelector(".pharmacy-read-feedback [role=alert]")');
    check('malformed payload explicit localized error', (await ev('document.querySelector(".pharmacy-read-feedback [role=alert]").textContent')).includes(lang === 'ar' ? 'بيانات غير صالحة' : 'invalid data'));

    await mount({ name: 'slow-history', hold: '/api/records/prescriptions/history' }, lang, mode);
    await until('!!document.querySelector(".queue-card-item")'); check('slow history does not block Pharmacy', true);
    await click('.pharmacy-queue-tabs button:nth-child(2)');
    await until('!!document.querySelector(".pharmacy-read-feedback [role=status]")');
    await shot(`slow-history-${lang}-${mode}`);
    scenario.hold = null;
    for (const requestId of held) { try { await fulfill(requestId, []); } catch {} }
    await until('!document.querySelector(".pharmacy-read-feedback [role=status]")');
    check('slow history eventually settles', true);

    await mount({ name: 'cancel-history', hold: '/api/records/prescriptions/history' }, lang, mode);
    await until('!!document.querySelector(".queue-card-item")'); await click('.pharmacy-queue-tabs button:nth-child(2)'); await until('!!document.querySelector(".pharmacy-read-feedback [role=status]")');
    await click('.pharmacy-read-feedback button'); await until('!!document.querySelector(".pharmacy-read-feedback [role=alert]")');
    check('cancel terminates pending read', await ev('!document.querySelector(".pharmacy-read-feedback [role=status]")'));
    scenario.hold = null; await click('.pharmacy-read-feedback button'); await until('!document.querySelector(".pharmacy-read-feedback")');
    check('cancelled read supports retry', true);

    await mount({ name: 'all-500', fail: 'all', status: 500 }, lang, mode);
    await until('document.querySelectorAll(".pharmacy-read-feedback [role=alert]").length===3&&!document.querySelector(".pharmacy-read-feedback [role=status]")');
    check('all failed reads settle without parking the route loader', await ev('!!document.querySelector(".pharmacy-workspace")&&!document.querySelector(".portal-loading,.pharmacy-page-loading")'));
    await click('.pharmacy-workspace-tabs button:nth-child(3)');
    await until('!!document.querySelector(".pharmacy-alert-column [role=alert]")');
    check('alerts have their own error', true);
    await click('.pharmacy-workspace-tabs button:nth-child(2)');
    await until('!!document.querySelector(".pharmacy-management [role=alert]")');
    check('inventory has its own error', true);
    await shot(`all-500-${lang}-${mode}`);

    }
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    await mount({ name: 'held-module', holdAsset: true }, lang, mode);
    await until('!!document.querySelector(".pharmacy-page-loading button")');
    check('staff header stays visible during held Pharmacy import', await ev('!!document.querySelector(".nav-header")'));
    check('no Pharmacy API reads start before module mounts', report.requests.filter(r => r.scenario === scenario.name && /\/api\/(records|pharmacy)\//.test(r.path)).length === 0);
    await shot(`held-module-${lang}-${mode}`);
    await click('.pharmacy-page-loading button');
    await until('!!document.querySelector(".pharmacy-page-error [role=alert]")');
    check('pending module can leave loading without a timeout', await ev('!document.querySelector(".pharmacy-page-loading")'));
    await shot(`module-error-${lang}-${mode}`);
    scenario.holdAsset = false;
    await click('.pharmacy-page-error button');
    await until('!!document.querySelector(".queue-card-item")');
    check('module Retry reloads current assets and recovers Pharmacy', true);

    if (process.env.CLINIC_MODULE_ONLY) continue;
    await mount({ name: 'auth-401', fail: queuePath, status: 401 }, lang, mode);
    await until('location.search===""&&!!document.querySelector("#staff-username")&&!sessionStorage.getItem("cms_staff_token")');
    check('401 clears session and returns to login', await ev('!sessionStorage.getItem("cms_staff_token")&&!document.querySelector(".portal-loading,.pharmacy-page-loading")'));
    await shot(`auth-401-${lang}-${mode}`);
  }
  check('no uncaught browser exceptions', report.exceptions.length === 0);
} catch (error) { report.failure = error.message; console.error(error.message); console.error(await ev('document.body.innerText')); await shot('failure'); process.exitCode = 1; }
finally {
  fs.writeFileSync(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ checks: report.checks.length, failed: report.checks.filter(c => !c.passed), failure: report.failure, exceptions: report.exceptions, screenshots: report.screenshots.length, output }, null, 2));
  await send('Page.close'); ws.close();
}
