import fs from 'node:fs';
import assert from 'node:assert/strict';
const origin = process.env.CLINIC_UI_ORIGIN || 'http://127.0.0.1:5187';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(origin).hostname));
const output = process.env.CLINIC_UI_OUTPUT || '/tmp/shifa-clinic-setup-browser';
fs.mkdirSync(output, { recursive: true });
const target = await (await fetch('http://127.0.0.1:9337/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let sequence = 0; const pending = new Map();
const report = { checks: [], captures: [], exceptions: [], unknownApi: [], mockedWrites: [] };
const id = '10000000-0000-4000-8000-000000000001';
const specialty = { id, code: 'internal-medicine', nameAr: 'الباطنية', nameEn: 'Internal Medicine', active: true };
let scenario = 'normal';
function response(url, method) {
 if (method !== 'GET') { report.mockedWrites.push(url.pathname); return { error: { code: 'CATALOG_DUPLICATE', message: 'Duplicate fixture' } }; }
 if (url.pathname === '/api/public-config') return { clinicTimeZone: 'Africa/Khartoum' };
 if (scenario === 'error') return { error: { code: 'FIXTURE_UNAVAILABLE' } };
 if (url.pathname === '/api/specialties') return scenario === 'empty' ? [] : [specialty];
 if (url.pathname === '/api/admin/doctors') return scenario === 'empty' ? [] : [{ id, userId: id, fullNameAr: 'د. تاج محمد أحمد', fullNameEn: 'Dr. Tag Mohamed Ahmed', specialtyId: id, consultationFee: '17001', status: 'ACTIVE', hasSchedule: false, account: { status: 'ACTIVE' } }];
 if (url.pathname === '/api/admin/catalog/services') return { items: scenario === 'empty' ? [] : [{ id, code: 'clinic-service', labelAr: 'فحص أو خدمة طبية', labelEn: 'Clinic medical service', category: url.searchParams.get('category') || 'CONSULTATION', priceSdg: '17001', status: 'ACTIVE' }], total: scenario === 'empty' ? 0 : 1 };
 if (url.pathname === '/api/admin/catalog/payment-methods') return ['CASH', 'CARD', 'BANKAK', 'FAWRY'].map(code => ({ code, labelAr: { CASH: 'نقداً', CARD: 'بطاقة / نقاط البيع', BANKAK: 'بنكك', FAWRY: 'فوري' }[code], labelEn: code, active: code !== 'CARD' }));
 if (/\/schedules$|\/schedule-exceptions$/.test(url.pathname)) return [];
 if (url.pathname === '/api/notifications') return [];
 report.unknownApi.push(url.pathname); return [];
}
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
ws.onmessage = async ({ data }) => {
 const event = JSON.parse(data);
 if (event.id) { const task = pending.get(event.id); if (task) { pending.delete(event.id); if (event.error) task.reject(Error(event.error.message)); else task.resolve(event.result); } }
 else if (event.method === 'Fetch.requestPaused') {
  const { requestId, request } = event.params;
  const payload = response(new URL(request.url), request.method);
  await send('Fetch.fulfillRequest', { requestId, responseCode: request.method !== 'GET' ? 409 : scenario === 'error' && !request.url.endsWith('/public-config') ? 503 : 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify(payload)).toString('base64') }).catch(() => {});
 } else if (event.method === 'Runtime.exceptionThrown') report.exceptions.push(event.params.exceptionDetails.text);
};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const ev = async expression => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
const check = (name, passed) => report.checks.push({ name, passed: Boolean(passed) });
async function shot(name) { const png = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); fs.writeFileSync(`${output}/${name}.png`, Buffer.from(png.data, 'base64')); report.captures.push(name); }
async function mount(width, lang, mode) {
 await send('Emulation.setDeviceMetricsOverride', { width, height: width < 600 ? 900 : 1000, deviceScaleFactor: 1, mobile: width < 600 });
 await send('Page.navigate', { url: origin }); await delay(400);
 await ev(`(async()=>{localStorage.setItem('alshifa_theme',${JSON.stringify(mode)});sessionStorage.setItem('cms_staff_user',JSON.stringify({id:${JSON.stringify(id)},role:'ADMIN',username:'fixture@example.test'}));sessionStorage.setItem('cms_staff_token','browser-fixture-only');document.documentElement.lang=${JSON.stringify(lang)};document.documentElement.dir=${JSON.stringify(lang === 'ar' ? 'rtl' : 'ltr')};document.querySelector('#root').style.display='none';const node=document.createElement('div');node.id='clinic-fixture';node.style.padding='12px';document.body.appendChild(node);const React=await import('/node_modules/.vite/deps/react.js');const DOM=await import('/node_modules/.vite/deps/react-dom_client.js');const Theme=await import('/src/app/theme/ThemeContext.jsx');const Panel=await import('/src/features/admin/ClinicSetupPanel.jsx');const i18n=(await import('/src/i18n.js')).default;await i18n.changeLanguage(${JSON.stringify(lang)});window.clinicRoot=(DOM.default||DOM).createRoot(node);window.clinicRoot.render((React.default||React).createElement(Theme.ThemeProvider,null,(React.default||React).createElement(Panel.default,{lang:${JSON.stringify(lang)},t:key=>i18n.t(key)})));await document.fonts.ready;})()`);
 await delay(200);
}
await send('Page.enable'); await send('Runtime.enable');
await send('Network.enable');
await send('Network.setBlockedURLs', { urls: ['*socket.io*'] });
await send('Page.addScriptToEvaluateOnNewDocument', { source: `if(location.origin===${JSON.stringify(origin)}){sessionStorage.removeItem('cms_staff_user');sessionStorage.removeItem('cms_staff_token')}` });
await send('Fetch.enable', { patterns: [{ urlPattern: '*/api/*', requestStage: 'Request' }] });
try {
 for (const width of (process.argv.includes('--navigation') ? [] : [360, 390, 768, 1024, 1366, 1600])) for (const lang of ['ar', 'en']) for (const mode of ['light', 'dark']) {
  scenario = 'normal'; await mount(width, lang, mode);
  for (let tab = 0; tab < 5; tab++) {
   await ev(`document.querySelectorAll('.clinic-setup-panel [role=tab]')[${tab}].click()`); await delay(100);
   const key = `${width}-${lang}-${mode}-${tab}`;
   check(`no horizontal overflow ${key}`, await ev('document.documentElement.scrollWidth<=innerWidth'));
   check(`MUI theme/direction ${key}`, await ev(`document.documentElement.dataset.theme===${JSON.stringify(mode)}&&document.querySelector('.clinic-setup-panel').dir===${JSON.stringify(lang === 'ar' ? 'rtl' : 'ltr')}`));
   check(`native select labels do not overlap ${key}`, await ev(`!!document.querySelector('.clinic-setup-panel select').closest('.MuiTextField-root').querySelector('.MuiInputLabel-shrink')`));
   check(`real controls and content ${key}`, await ev(`document.querySelectorAll('.clinic-setup-panel .MuiCard-root').length>0&&document.querySelectorAll('.clinic-setup-panel input').length>0`));
   await shot(`catalog-${key}`);
   if (width === 360 || width === 1366) {
    await ev(`(()=>{const buttons=[...document.querySelectorAll('.clinic-setup-panel button')];const label=${JSON.stringify(lang === 'ar' ? 'تعديل' : 'Edit')};buttons.find(button=>button.textContent.trim()===label).click()})()`); await delay(300);
    check(`accessible editor ${key}`, await ev(`!!document.querySelector('[role=dialog][aria-labelledby]')&&document.querySelectorAll('[role=dialog] input').length>=2`));
    check(`dialog fits viewport ${key}`, await ev(`document.querySelector('[role=dialog]').getBoundingClientRect().width<=innerWidth`));
    await shot(`editor-${key}`);
    await ev(`(()=>{const label=${JSON.stringify(lang === 'ar' ? 'إلغاء' : 'Cancel')};[...document.querySelectorAll('[role=dialog] button')].find(button=>button.textContent.trim()===label).click()})()`); await delay(70);
   }
  }
 }
 for (const state of ['empty', 'error']) { scenario = state; await mount(390, 'ar', 'dark'); await shot(state); check(`${state} state explains configuration`, await ev(`document.querySelector('.clinic-setup-panel').innerText.includes(${JSON.stringify(state === 'empty' ? 'لا توجد بيانات' : 'تعذر تحميل')})`)); }
 scenario = 'normal';
 await send('Page.addScriptToEvaluateOnNewDocument', { source: `if(location.origin===${JSON.stringify(origin)}){sessionStorage.setItem('cms_staff_user',JSON.stringify({id:${JSON.stringify(id)},role:'ADMIN',username:'fixture@example.test'}));sessionStorage.setItem('cms_staff_token','browser-fixture-only')}` });
 await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 1000, deviceScaleFactor: 1, mobile: false });
 await send('Page.navigate', { url: origin + '/staff' });
 await ev(`new Promise(resolve=>{const deadline=Date.now()+15000;const ready=()=>{if(document.querySelector('.menu-btn')||Date.now()>deadline)resolve();else setTimeout(ready,100)};ready()})`);
 await ev(`(async()=>{await(await import('/src/i18n.js')).default.changeLanguage('en')})()`); await delay(150);
 const mounted = await ev(`(()=>{const button=[...document.querySelectorAll('.menu-btn')].find(button=>button.textContent.trim()==='Doctors & catalogs');if(!button)return false;button.click();return true})()`);
 check('actual admin navigation exposes clinic setup', mounted); await delay(250);
 check('actual staff application mounts the MUI catalog screen', await ev(`!!document.querySelector('.clinic-setup-panel .MuiTabs-root')`));
 await shot('actual-admin-clinic-setup-1366-en');
 await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 900, deviceScaleFactor: 1, mobile: true });
 await delay(150); check('actual admin mobile layout has no overflow', await ev('document.documentElement.scrollWidth<=innerWidth')); await shot('actual-admin-clinic-setup-360-en');
 await ev(`(async()=>{await(await import('/src/i18n.js')).default.changeLanguage('ar');if(document.documentElement.dataset.theme!=='light')document.querySelector('.theme-toggle-btn')?.click()})()`); await delay(200);
 check('actual admin supports Arabic/light on mobile', await ev(`document.querySelector('.clinic-setup-panel')?.dir==='rtl'&&document.documentElement.dataset.theme==='light'&&document.documentElement.scrollWidth<=innerWidth`)); await shot('actual-admin-clinic-setup-360-ar-light');

 check('no unhandled browser exceptions', report.exceptions.length === 0);
 check('all API requests intercepted', report.unknownApi.length === 0);
 if (report.checks.some(item => !item.passed)) process.exitCode = 1;
} finally {
 fs.writeFileSync(`${output}/report.json`, JSON.stringify(report, null, 2));
 console.log(JSON.stringify({ captures: report.captures.length, checks: report.checks.length, failed: report.checks.filter(item => !item.passed), exceptions: report.exceptions, unknownApi: report.unknownApi, output })); ws.close();
}
