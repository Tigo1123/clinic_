import assert from 'node:assert/strict';
import fs from 'node:fs';
const origin = process.env.CLINIC_UI_ORIGIN || 'http://127.0.0.1:5187';
const apiOrigin = process.env.CLINIC_PRICING_API || 'http://127.0.0.1:55438';
const sessions = JSON.parse(fs.readFileSync(process.env.CLINIC_PRICING_SESSIONS || '/tmp/clinic-pricing-browser-sessions.json'));
for (const url of [origin, apiOrigin]) assert.ok(['127.0.0.1', 'localhost'].includes(new URL(url).hostname));
const output = '/tmp/clinic-medicine-pricing-browser'; fs.mkdirSync(output, { recursive: true });
const report = { checks: [], requests: [], dialogs: [], exceptions: [] };
const check = (name, passed) => { report.checks.push({ name, passed: !!passed }); if (!passed) console.error(`FAIL ${name}`); };
const target = await (await fetch('http://127.0.0.1:9337/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let seq = 0; const pending = new Map();
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
ws.onmessage = async ({ data }) => {
  const event = JSON.parse(data);
  if (event.id) {
    const task = pending.get(event.id); if (!task) return; pending.delete(event.id);
    if (event.error) task.reject(Error(event.error.message)); else task.resolve(event.result);
  } else if (event.method === 'Page.javascriptDialogOpening') {
    report.dialogs.push(event.params.message); await send('Page.handleJavaScriptDialog', { accept: true });
  } else if (event.method === 'Fetch.requestPaused') {
    // Forward to the real isolated backend; no pricing API response is mocked.
    const { request, requestId } = event.params; const url = new URL(request.url);
    const response = await fetch(apiOrigin + url.pathname + url.search, { method: request.method, headers: { 'Content-Type': 'application/json', ...(request.headers.Authorization ? { Authorization: request.headers.Authorization } : {}) }, ...(request.postData ? { body: request.postData } : {}) });
    const body = await response.text();
    if (request.method === 'PATCH') report.requests.push({ path: url.pathname, payload: JSON.parse(request.postData), status: response.status, response: JSON.parse(body) });
    await send('Fetch.fulfillRequest', { requestId, responseCode: response.status, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(body).toString('base64') });
  } else if (event.method === 'Runtime.exceptionThrown') report.exceptions.push(event.params.exceptionDetails.exception?.description || event.params.exceptionDetails.text);
};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function ev(expression) { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; }
async function until(expression) { for (let i = 0; i < 100; i++) { if (await ev(expression)) return; await delay(50); } throw Error(`Timed out: ${expression}`); }
async function click(selector) { const p = await ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center',behavior:'instant'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`); await send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...p }); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...p }); await delay(100); }
async function mount(kind, lang = 'en') {
  await send('Page.navigate', { url: `${origin}/?pricing=${kind}-${lang}-${Date.now()}` });
  await until('!!document.querySelector("#root")&&!!window.$RefreshReg$');
  await ev(`(async()=>{const main=await(await fetch('/src/main.jsx')).text();const r=await import(main.match(/"([^"]*react\\.js[^"]*)"/)[1]),d=await import(main.match(/"([^"]*react-dom_client\\.js[^"]*)"/)[1]);const R=r.default||r,D=d.default||d;const T=await import('/src/app/theme/ThemeContext.jsx');const C=await import(${JSON.stringify(kind === 'admin' ? '/src/features/admin/AdminDashboard.jsx' : '/src/features/pharmacy/PharmacyManagement.jsx')});await import('/src/App.css');await import('/src/styles/medical.css');const i=(await import('/src/i18n.js')).default;await i.changeLanguage(${JSON.stringify(lang)});const s=${JSON.stringify(sessions[kind === 'admin' ? 'admin' : 'pharmacy'])};sessionStorage.setItem('cms_staff_user',JSON.stringify(s.user));sessionStorage.setItem('cms_staff_token',s.token);document.documentElement.dir=${JSON.stringify(lang === 'ar' ? 'rtl' : 'ltr')};document.querySelector('#root').style.display='none';const n=document.createElement('div');document.body.appendChild(n);D.createRoot(n).render(R.createElement(T.ThemeProvider,null,R.createElement(C.default,{user:s.user,lang:${JSON.stringify(lang)},t:key=>i.t(key)})));})()`);
  await until(kind === 'admin' ? '!!document.querySelector(".admin-workspace .menu-btn:nth-child(3)")' : '!!document.querySelector(".pharmacy-inventory-table")');
  if (kind === 'admin') { await click('.admin-workspace .menu-btn:nth-child(3)'); await until(`!!document.querySelector('input[aria-label="medicines price"]')`); }
}
await send('Page.enable'); await send('Runtime.enable'); await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false }); await send('Fetch.enable', { patterns: [{ urlPattern: '*/api/*', requestStage: 'Request' }] });
try {
  for (const lang of ['en', 'ar']) {
    const unique = `Browser pricing ${lang} ${Date.now()}`;
    const arabicName = `دواء اختبار الأسعار ${Date.now()}`;
    const create = await fetch(`${apiOrigin}/api/pharmacy/formulary`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessions.pharmacy.token}` }, body: JSON.stringify({ brandName: unique, labelAr: arabicName, labelEn: unique, genericName: unique, strength: '1 mg', dosageForm: 'Tablet' }) });
    assert.equal(create.status, 201); const { medicine } = await create.json();
    await mount('admin', lang);
    const visibleName = lang === 'ar' ? arabicName : unique;
    await ev(`window.pricingRow=[...document.querySelectorAll('tr')].find(r=>r.textContent.includes(${JSON.stringify(visibleName)}));window.pricingRow.dataset.pricingTest='target'`);
    const row = '[data-pricing-test="target"]';
    await ev(`(()=>{const e=document.querySelector('${row} input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'3450');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await delay(80);
    await ev(`(()=>{const e=document.querySelector('${row} select');e.value='ACTIVE';e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await delay(80);
    const before = report.requests.length;
    await click(`${row} button`);
    await until(`!!document.querySelector('.admin-workspace .badge-success')||!!document.querySelector('.admin-workspace .badge-danger')`);
    check(`one update ${lang}`, report.requests.length === before + 1);
    const saved = report.requests.at(-1);
    check(`correct request ${lang}`, saved?.payload.priceSdg === 3450 && saved.payload.status === 'ACTIVE');
    check(`persisted response ${lang}`, saved?.status === 200 && saved.response.unitPriceSdg === 3450 && saved.response.status === 'ACTIVE');
    await mount('admin', lang);
    check(`Admin refresh ${lang}`, await ev(`(()=>{const r=[...document.querySelectorAll('tr')].find(r=>r.textContent.includes(${JSON.stringify(visibleName)}));return r.querySelector('input').value==='3450'&&r.querySelector('select').value==='ACTIVE'})()`));
    const pharmacy = await fetch(`${apiOrigin}/api/pharmacy/formulary/${medicine.id}`, { headers: { Authorization: `Bearer ${sessions.pharmacy.token}` } });
    const result = await pharmacy.json(); check(`Pharmacy API ${lang}`, result.unitPriceSdg === 3450 && result.status === 'ACTIVE');
    await mount('pharmacy', lang);
    check(`Pharmacy browser refresh ${lang}`, await ev(`(()=>{const r=[...document.querySelectorAll('.pharmacy-inventory-table tbody tr')].find(r=>r.textContent.includes(${JSON.stringify(visibleName)}));return !!r&&!r.querySelector('.pharmacy-admin-note')&&[...r.querySelectorAll('.badge')].some(e=>e.textContent===${JSON.stringify(lang === 'ar' ? 'نشط' : 'Active')})})()`));
  }
  check('no exceptions', report.exceptions.length === 0);
} catch (error) {
  report.failure = error.message;
  console.error(await ev('({body:document.body.innerText.slice(-1600),selected:document.querySelector("[data-pricing-test] select")?.value,price:document.querySelector("[data-pricing-test] input")?.value})'));
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); fs.writeFileSync(`${output}/failure.png`, Buffer.from(shot.data, 'base64'));
  throw error;
} finally {
  fs.writeFileSync(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ checks: report.checks, requests: report.requests, dialogs: report.dialogs, exceptions: report.exceptions }, null, 2));
  await send('Page.close'); ws.close();
}
process.exitCode = report.checks.every(c => c.passed) ? 0 : 1;
