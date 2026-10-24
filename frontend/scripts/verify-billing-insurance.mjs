import fs from 'node:fs';
import assert from 'node:assert/strict';
const origin = process.env.CLINIC_UI_ORIGIN || 'http://127.0.0.1:5187';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(origin).hostname));
const output = process.env.CLINIC_UI_OUTPUT || '/tmp/clinic-billing-browser-evidence';
fs.mkdirSync(output, { recursive: true });
const target = await (await fetch('http://127.0.0.1:9337/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let sequence = 0; const pending = new Map();
const report = { checks: [], captures: [], exceptions: [], unknownApi: [], mockedWrites: [] };
const id = '10000000-0000-4000-8000-000000000001';
let scenario = 'normal';
const company = { id, labelAr: 'شركة التأمين', labelEn: 'Clinic insurer', copayPercentage: 20, active: true, billingCycleDays: 30, coveredCategories: ['CONSULTATION','LABORATORY'] };
function response(url, method) {
 if (method !== 'GET') { report.mockedWrites.push(url.pathname); return { error: { message: 'Mock write blocked' } }; }
 if (url.pathname === '/api/public-config') return { clinicTimeZone: 'Africa/Khartoum' };
 if (url.pathname === '/api/billing/payment-methods') return [{code:'CASH',labelAr:'نقداً',labelEn:'Cash',active:true}];
 if (url.pathname === '/api/billing/insurance-companies') return [company];
 if (url.pathname.endsWith('/insurance')) return [{ insuranceCompanyId: id, memberNumber: 'SYNTHETIC-123', plan: 'Standard', active: true, validFrom: '2026-01-01', validUntil: '2027-12-31' }];
 if (url.pathname === '/api/notifications') return [];
 report.unknownApi.push(url.pathname); return [];
}
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
ws.onmessage = async ({ data }) => {
 const event = JSON.parse(data);
 if (event.id) { const task = pending.get(event.id); if (task) { pending.delete(event.id); if (event.error) task.reject(Error(event.error.message)); else task.resolve(event.result); } }
 else if (event.method === 'Fetch.requestPaused') {
  const { requestId, request } = event.params;
  if (request.method === 'POST' && request.url.includes('/payments')) report.mockedWrites.push({ path: new URL(request.url).pathname, body: request.postData, key: Object.entries(request.headers).find(([key])=>key.toLowerCase()==='idempotency-key')?.[1] });
  const payload = response(new URL(request.url), request.method);
  await send('Fetch.fulfillRequest', { requestId, responseCode: request.method !== 'GET' ? 409 : scenario === 'error' && !request.url.endsWith('/public-config') ? 503 : 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify(payload)).toString('base64') }).catch(() => {});
 } else if (event.method === 'Runtime.exceptionThrown') report.exceptions.push(event.params.exceptionDetails.text);
};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const ev = async expression => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
const check = (name, passed) => report.checks.push({ name, passed: Boolean(passed) });
async function shot(name) { const png = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); fs.writeFileSync(`${output}/${name}.png`, Buffer.from(png.data, 'base64')); report.captures.push(name); }

await send('Page.enable'); await send('Runtime.enable');
await send('Fetch.enable', { patterns: [{ urlPattern: '*/api/*', requestStage: 'Request' }] });
for (const width of [360, 1366]) for (const lang of ['ar', 'en']) for (const mode of ['light', 'dark']) for (const screen of ['billing', 'insurance']) {
 const key = `${screen}-${width}-${lang}-${mode}`;
 await send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 600 });
 await send('Page.navigate', { url: origin }); await delay(350);
 const invoice = { id, invoiceDate: '2026-10-24', invoiceType: 'CONSULTATION', paymentStatus: 'PARTIALLY_PAID', totalAmountSdg: 20000, insuranceCoverageSdg: 16000, patientShareSdg: 4000, totalPaidSdg: 2000, refundedSdg: 0, remainingBalanceSdg: 2000, items: [{descriptionAr:'كشف طبي',descriptionEn:'Consultation',qty:1,unitPriceSdg:20000}], payments:[{id,createdAt:'2026-10-24',amountSdg:2000,paymentMethod:'CASH'}], refunds: [], insuranceClaim: { id, claimStatus: 'DRAFT' } };
 await ev(`(async()=>{
  localStorage.setItem('alshifa_theme',${JSON.stringify(mode)}); sessionStorage.setItem('cms_staff_token','synthetic-browser-token');
  document.documentElement.lang=${JSON.stringify(lang)}; document.documentElement.dir=${JSON.stringify(lang === 'ar' ? 'rtl' : 'ltr')};
  document.querySelector('#root').style.display='none';const node=document.createElement('div');node.style.padding='12px';node.className='patient-file-section';document.body.appendChild(node);
  const R=await import('/node_modules/.vite/deps/react.js'); const D=await import('/node_modules/.vite/deps/react-dom_client.js');const T=await import('/src/app/theme/ThemeContext.jsx');const i18n=(await import('/src/i18n.js')).default;await i18n.changeLanguage(${JSON.stringify(lang)});
  await import('/src/features/clinical/patientFile.css');
  const Panel=await import(${JSON.stringify(screen === 'billing' ? '/src/features/clinical/PatientBillingDetails.jsx' : '/src/features/admin/ClinicSetupPanel.jsx')});
  const props=${JSON.stringify(screen === 'billing' ? {patientId:id,invoices:[invoice],lang,admin:true} : {initialTab:'insurance',lang})};
  window.fixtureRoot=(D.default||D).createRoot(node);window.fixtureRoot.render((R.default||R).createElement(T.ThemeProvider,null,(R.default||R).createElement(Panel.default,props)));
 })()`); await delay(500);
 check(`no horizontal overflow ${key}`, await ev('document.documentElement.scrollWidth<=innerWidth'));
 check(`theme ${key}`, await ev(`document.documentElement.dataset.theme===${JSON.stringify(mode)}`));
 if (screen === 'billing') {
  check(`financial distinctions ${key}`, await ev(`document.body.textContent.includes(${JSON.stringify(lang === 'ar' ? 'الرصيد المتبقي' : 'Remaining balance')})&&document.body.textContent.includes(${JSON.stringify(lang === 'ar' ? 'حالة المطالبة' : 'Claim status')})`));
  await ev(`document.querySelector('details').open=true`);await delay(200);
  check(`membership fields ${key}`,await ev('document.querySelectorAll("select").length>0&&document.querySelectorAll("input").length>=3'));
  await ev(`document.querySelectorAll('details')[2].open=true;(()=>{const input=document.querySelector('input[type=number]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'100');input.dispatchEvent(new Event('input',{bubbles:true}))})()`);await delay(100);
  const before = report.mockedWrites.filter(row=>typeof row==='object').length;
  await ev(`document.querySelector('input[type=number]').closest('form').requestSubmit()`);await delay(200);
  await ev(`document.querySelector('input[type=number]').closest('form').requestSubmit()`);await delay(200);
  const attempts = report.mockedWrites.filter(row=>typeof row==='object').slice(before);
  check(`payment retry reuses idempotency key ${key}`, attempts.length===2&&!!attempts[0].key&&attempts[0].key===attempts[1].key);

 } else {
  await ev(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(lang === 'ar' ? 'تعديل' : 'Edit')}).click()`);await delay(250);
  check(`insurance editor ${key}`,await ev('!!document.querySelector("[role=dialog]")&&document.querySelectorAll("[role=dialog] input").length>=4'));
 }
 check(`expanded view fits ${key}`,await ev('document.documentElement.scrollWidth<=innerWidth'));
 await shot(key);
}
check('no unhandled exceptions',report.exceptions.length===0);
check('no unmocked API requests',report.unknownApi.length===0);
fs.writeFileSync(`${output}/report.json`,JSON.stringify(report,null,2));
console.log(JSON.stringify({checks:report.checks.length,failed:report.checks.filter(c=>!c.passed),captures:report.captures.length,exceptions:report.exceptions}));
ws.close();
process.exitCode=report.checks.every(c=>c.passed)?0:1;
