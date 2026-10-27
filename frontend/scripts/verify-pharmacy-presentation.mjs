import assert from 'node:assert/strict';
import fs from 'node:fs';

// Real dashboard, HTTP fixtures only. Start Vite on 5187 and Chrome with
// --headless --remote-debugging-port=9337 before running this script.
const origin = process.env.CLINIC_UI_ORIGIN || 'http://127.0.0.1:5187';
const browser = process.env.CLINIC_BROWSER_ORIGIN || 'http://127.0.0.1:9337';
for (const url of [origin, browser]) assert.ok(['127.0.0.1', 'localhost'].includes(new URL(url).hostname));
const output = process.env.CLINIC_UI_OUTPUT || '/tmp/clinic-pharmacy-presentation';
fs.mkdirSync(output, { recursive: true });
const target = await (await fetch(`${browser}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
const report = { checks: [], exceptions: [], captures: [], writes: [] };
let sequence = 0;
const pending = new Map();
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params }));
});
const medicines = [
  { id: 'medicine-1', brandName: 'Panadol', labelEn: 'Panadol Extra', labelAr: 'بانادول إكسترا', genericName: 'Paracetamol', strength: '500 mg', dosageForm: 'Tablet', status: 'INACTIVE', unitPriceSdg: null, stock: { totalOnHand: 24, usableStock: 24, nearestUnexpiredExpiry: '2029-08-01', batchCount: 1 } },
  { id: 'medicine-2', brandName: 'Amoxil', labelEn: 'Amoxicillin', labelAr: 'أموكسيسيلين', genericName: 'Amoxicillin', strength: '250 mg', dosageForm: 'Capsule', status: 'ACTIVE', unitPriceSdg: 2500, stock: { totalOnHand: 5, usableStock: 5, nearestUnexpiredExpiry: '2030-01-01', lowStockBatchCount: 1, batchCount: 1 } },
  { id: 'medicine-3', brandName: 'Vitamin C', labelEn: 'Vitamin C extended release', labelAr: 'فيتامين سي ممتد المفعول', genericName: 'Ascorbic acid', strength: '1000 mg', dosageForm: 'Effervescent tablet', status: 'ACTIVE', unitPriceSdg: 1800, stock: { totalOnHand: 0, usableStock: 0, batchCount: 0 } }
];
ws.onmessage = async ({ data }) => {
  const event = JSON.parse(data);
  if (event.id) {
    const task = pending.get(event.id); if (!task) return;
    pending.delete(event.id); if (event.error) task.reject(Error(event.error.message)); else task.resolve(event.result);
  } else if (event.method === 'Fetch.requestPaused') {
    const { requestId, request } = event.params;
    const url = new URL(request.url);
    let body = [];
    if (url.pathname === '/api/public-config') body = { clinicTimeZone: 'Africa/Khartoum' };
    if (url.pathname === '/api/pharmacy/formulary') body = { items: medicines, pagination: { page: 1, total: 3, totalPages: 1 } };
    if (url.pathname === '/api/pharmacy/formulary/medicine-1') body = medicines[0];
    if (request.method !== 'GET') { report.writes.push({ path: url.pathname, body: JSON.parse(request.postData) }); body = medicines[0]; }
    await send('Fetch.fulfillRequest', { requestId, responseCode: request.method === 'POST' ? 201 : 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify(body)).toString('base64') });
  } else if (event.method === 'Runtime.exceptionThrown') report.exceptions.push(event.params.exceptionDetails.exception?.description || event.params.exceptionDetails.text);
};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function ev(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
async function until(expression) {
  for (let i = 0; i < 80; i++) { if (await ev(expression)) return; await delay(50); }
  throw Error(`Timed out: ${expression}`);
}
function check(name, passed) { report.checks.push({ name, passed: Boolean(passed) }); if (!passed) console.error(`FAIL: ${name}`); }
async function click(selector) {
  const point = await ev(`(() => {const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point }); await delay(100);
}
async function shot(name) {
  const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(`${output}/${name}.png`, Buffer.from(result.data, 'base64')); report.captures.push(name);
}
async function mount(width, lang, mode) {
  const scenario = `${width}-${lang}-${mode}`;
  await send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 600 });
  await send('Page.navigate', { url: `${origin}/?pharmacy-presentation=${scenario}` });
  await until(`location.search===${JSON.stringify(`?pharmacy-presentation=${scenario}`)}&&!!document.querySelector('#root')&&!!window.$RefreshReg$`);
  await ev(`(async () => {
    localStorage.setItem('alshifa_theme',${JSON.stringify(mode)});sessionStorage.setItem('cms_staff_token','synthetic-presentation-only');
    const main=await(await fetch('/src/main.jsx')).text();
    const reactPath=main.match(/"([^"]*react\\.js[^"]*)"/)[1];
    const clientPath=main.match(/"([^"]*react-dom_client\\.js[^"]*)"/)[1];
    const react=await import(reactPath),client=await import(clientPath);const R=react.default||react,D=client.default||client;
    const T=await import('/src/app/theme/ThemeContext.jsx');const P=await import('/src/features/pharmacy/PharmacyDashboard.jsx');
    await import('/src/App.css');await import('/src/styles/medical.css');
    await(await import('/src/i18n.js')).default.changeLanguage(${JSON.stringify(lang)});
    document.documentElement.dir=${JSON.stringify(lang === 'ar' ? 'rtl' : 'ltr')};document.documentElement.lang=${JSON.stringify(lang)};
    document.querySelector('#root').style.display='none';const host=document.createElement('div');document.body.appendChild(host);
    D.createRoot(host).render(R.createElement(T.ThemeProvider,null,R.createElement(P.default,{lang:${JSON.stringify(lang)}})));
    // CSS color contrast, including translucent token backgrounds composited on the card.
    window.contrast=(foreground,background)=>{const rgb=s=>s.match(/[\\d.]+/g).map(Number);const surface=rgb(getComputedStyle(document.querySelector('.pharmacy-management')).backgroundColor);const f=rgb(foreground),b=rgb(background);const alpha=b[3]??1;const composite=b.slice(0,3).map((v,i)=>v*alpha+surface[i]*(1-alpha));const luminance=v=>v.slice(0,3).map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4}).reduce((n,x,i)=>n+x*[.2126,.7152,.0722][i],0);const a=luminance(f),c=luminance(composite);return(Math.max(a,c)+.05)/(Math.min(a,c)+.05);};
  })()`);
  await until('!!document.querySelector(".pharmacy-workspace-tabs button:nth-child(2)")');
  await click('.pharmacy-workspace-tabs button:nth-child(2)');
  await until('document.querySelectorAll(".pharmacy-inventory-table tbody tr").length===3');
  await ev('document.fonts.ready');
}
await send('Page.enable'); await send('Runtime.enable');
await send('Fetch.enable', { patterns: [{ urlPattern: '*/api/*', requestStage: 'Request' }] });
try {
  for (const width of [1440, 768, 390]) for (const lang of ['en', 'ar']) for (const mode of ['dark', 'light']) {
    const key = `${width}-${lang}-${mode}`;
    report.scenario = key;
    await mount(width, lang, mode);
    check(`fits viewport ${key}`, await ev('document.documentElement.scrollWidth<=innerWidth'));
    check(`compact hero ${key}`, await ev('document.querySelector(".role-hero").getBoundingClientRect().height<=140'));
    check(`localized statuses and unchanged filter values ${key}`, await ev(`document.querySelector('.pharmacy-inventory-table tbody tr .badge-warning:last-child')!==null&&[...document.querySelectorAll('.pharmacy-inventory-table .badge')].some(e=>e.textContent===${JSON.stringify(lang === 'ar' ? 'غير نشط' : 'Inactive')})&&document.querySelector('option[value="INACTIVE"]').textContent===${JSON.stringify(lang === 'ar' ? 'غير نشط' : 'Inactive')}`));
    check(`table has accessible headers ${key}`, await ev('document.querySelectorAll(".pharmacy-inventory-table th[scope=col]").length===8&&!!document.querySelector(".pharmacy-inventory-table[aria-labelledby]")'));
    check(`readable secondary text and badges ${key}`, await ev(`[...document.querySelectorAll('.pharmacy-management .badge,.pharmacy-admin-note,.pharmacy-medicine-details')].every(e=>{const s=getComputedStyle(e);return window.contrast(s.color,s.backgroundColor)>=4.5})`));
    check(`accessible primary button contrast ${key}`, await ev(`(()=>{const s=getComputedStyle(document.querySelector('.pharmacy-management-header .btn-primary'));return window.contrast(s.color,s.backgroundColor)>=4.5})()`));
    check(`note has no colored panel ${key}`, await ev(`getComputedStyle(document.querySelector('.pharmacy-admin-note')).backgroundColor==='rgba(0, 0, 0, 0)'`));
    check(`name and secondary text grouped ${key}`, await ev(`(()=>{const e=document.querySelector('.pharmacy-medicine-identity'),name=getComputedStyle(e.querySelector('strong')),detail=getComputedStyle(e.querySelector('small'));return name.fontWeight>detail.fontWeight&&parseFloat(name.fontSize)>parseFloat(detail.fontSize)&&e.parentElement.getBoundingClientRect().width<=innerWidth})()`));
    check(`touch targets ${key}`, await ev(`[...document.querySelectorAll('.pharmacy-action-trigger,.pharmacy-toolbar .btn')].every(e=>e.getBoundingClientRect().height>=44)`));
    check(`direction and isolated dates ${key}`, await ev(`document.documentElement.dir===${JSON.stringify(lang === 'ar' ? 'rtl' : 'ltr')}&&!!document.querySelector('.pharmacy-numeric bdi')`));
    check(`responsive row layout ${key}`, await ev(`getComputedStyle(document.querySelector('.pharmacy-inventory-table tbody tr')).display===${JSON.stringify(width <= 900 ? 'block' : 'table-row')}`));
    if (mode === 'dark') {
      check(`dark palette stays pharmacy scoped ${key}`, await ev(`(()=>{const e=document.querySelector('.pharmacy-management');return getComputedStyle(e).backgroundColor==='rgb(22, 32, 51)'&&getComputedStyle(document.querySelector('.pharmacy-workspace')).backgroundColor==='rgb(15, 23, 42)'&&getComputedStyle(document.documentElement).getPropertyValue('--color-surface').trim()==='#172438'})()`));
      check(`no white active tabs ${key}`, await ev(`(()=>{const e=document.querySelector('.pharmacy-workspace-tabs .is-active'),s=getComputedStyle(e);return s.backgroundColor!=='rgb(255, 255, 255)'&&window.contrast(s.color,s.backgroundColor)>=4.5})()`));
      check(`soft row borders ${key}`, await ev(`getComputedStyle(document.querySelector('.pharmacy-inventory-table tbody tr td')).borderBottomWidth==='0px'||getComputedStyle(document.querySelector('.pharmacy-inventory-table tbody tr td')).borderBottomColor==='rgba(148, 163, 184, 0.18)'`));
    }
    await ev('window.scrollTo(0,0)');await shot(`inventory-${key}`);
    await click('.pharmacy-action-trigger');
    check(`menu fits and has usable targets ${key}`, await ev(`(()=>{const e=document.querySelector('[role=menu]'),r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&[...e.querySelectorAll('button')].every(b=>b.getBoundingClientRect().height>=44)})()`));
    await ev("document.querySelector('[role=menuitem]').focus()");
    check(`visible keyboard focus ${key}`, await ev(`parseFloat(getComputedStyle(document.activeElement).outlineWidth)>=2`));
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await until('!document.querySelector("[role=menu]")');
    // Trigger the real success feedback through an isolated, mocked create request.
    await click('.pharmacy-management-header .btn-primary');
    for (const field of ['brandName','labelAr','labelEn','genericName','strength','dosageForm']) await ev(`(()=>{const e=document.querySelector('#medicine-${field}');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'QA medicine');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await click('.ui-dialog .dialog-actions .btn-primary');
    await until('!!document.querySelector(".pharmacy-feedback[role=status]")');
    check(`compact readable success feedback ${key}`, await ev(`(()=>{const e=document.querySelector('.pharmacy-feedback[role=status]'),s=getComputedStyle(e);return parseFloat(s.paddingTop)<=8&&Number(s.fontWeight)<=500&&parseFloat(s.borderRadius)<20&&window.contrast(s.color,s.backgroundColor)>=4.5})()`));
    check(`create contract unchanged ${key}`, Object.keys(report.writes.at(-1).body).sort().join(',') === 'brandName,dosageForm,genericName,labelAr,labelEn,strength');
    await ev('document.querySelector(".pharmacy-management").scrollIntoView({block:"start"})');await shot(`feedback-${key}`);
  }
  check('no browser exceptions', report.exceptions.length === 0);
} catch (error) {
  report.failure = error.message;
  await shot('failure');
  console.error(await ev(`({location:location.href,tab:document.querySelector('.pharmacy-workspace-tabs .is-active')?.textContent,body:document.body.innerText.slice(-1200)})`));
  throw error;
} finally {
  fs.writeFileSync(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ checks: report.checks.length, failed: report.checks.filter(c => !c.passed), exceptions: report.exceptions, output }, null, 2));
  await send('Page.close'); ws.close();
}
process.exitCode = report.checks.every(c => c.passed) ? 0 : 1;
