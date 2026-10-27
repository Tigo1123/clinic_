import assert from 'node:assert/strict';
import fs from 'node:fs';

// Uses the real React/MUI components and browser hit testing. Only HTTP is mocked.
// Start Vite on 5187 and headless Chrome with --remote-debugging-port=9337.
const origin = process.env.CLINIC_UI_ORIGIN || 'http://127.0.0.1:5187';
const debuggerOrigin = process.env.CLINIC_BROWSER_ORIGIN || 'http://127.0.0.1:9337';
for (const url of [origin, debuggerOrigin]) assert.ok(['localhost', '127.0.0.1'].includes(new URL(url).hostname));
const output = process.env.CLINIC_UI_OUTPUT || '/tmp/clinic-expiry-picker';
fs.mkdirSync(output, { recursive: true });
const target = await (await fetch(`${debuggerOrigin}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let sequence = 0;
const pending = new Map();
const report = { checks: [], exceptions: [], writes: [] };
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const medicine = { id: '10000000-0000-4000-8000-000000000001', brandName: 'Test', labelAr: 'تجربة', labelEn: 'Test', genericName: 'Test', strength: '1 mg', dosageForm: 'Tablet', status: 'INACTIVE', stock: {} };
ws.onmessage = async ({ data }) => {
  const event = JSON.parse(data);
  if (event.id) {
    const task = pending.get(event.id);
    if (!task) return;
    pending.delete(event.id);
    if (event.error) task.reject(Error(event.error.message)); else task.resolve(event.result);
  } else if (event.method === 'Fetch.requestPaused') {
    const { requestId, request } = event.params;
    const url = new URL(request.url);
    let body = {};
    if (url.pathname === '/api/public-config') body = { clinicTimeZone: 'Africa/Khartoum' };
    if (url.pathname === '/api/pharmacy/formulary') body = { items: [medicine], pagination: { page: 1, total: 1, totalPages: 1 } };
    if (request.method === 'POST') {
      report.writes.push({ path: url.pathname, body: JSON.parse(request.postData) });
      body = medicine;
    }
    await send('Fetch.fulfillRequest', { requestId, responseCode: request.method === 'POST' ? 201 : 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify(body)).toString('base64') });
  } else if (event.method === 'Runtime.exceptionThrown') report.exceptions.push(event.params.exceptionDetails.exception?.description || event.params.exceptionDetails.text);
};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const ev = async expression => {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
};
const check = (name, passed) => {
  report.checks.push({ name, passed: Boolean(passed) });
  if (!passed) console.error(`FAIL: ${name}`);
};
async function until(expression) {
  for (let attempt = 0; attempt < 60; attempt++) { if (await ev(expression)) return; await delay(50); }
  throw Error(`Timed out: ${expression}`);
}
async function click(selector) {
  const point = await ev(`(() => { const e=document.querySelector(${JSON.stringify(selector)}); if(!e) throw Error('Missing '+${JSON.stringify(selector)}); e.scrollIntoView({block:'center'}); const r=e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
  await delay(100);
}
async function key(key, code = key, windowsVirtualKeyCode = 0) {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode });
  await delay(60);
}
async function fill(selector, value) {
  await ev(`(() => {const e=document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)}); e.dispatchEvent(new Event('input',{bubbles:true})); })()`);
}
async function pasteDate(selector, value) {
  await ev(`document.querySelector(${JSON.stringify(selector)}+' [role="spinbutton"]').focus()`);
  await delay(60);
  await ev(`(() => {const e=document.querySelector(${JSON.stringify(selector)}+' [role="spinbutton"]'); const data=new DataTransfer(); data.setData('text',${JSON.stringify(value)}); e.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,clipboardData:data})); })()`);
  await delay(100);
}
const field = '.ui-dialog .MuiPickersInputBase-root';
const calendar = '.MuiDateCalendar-root';
const day = '.MuiDateCalendar-root button[role="gridcell"]:not([disabled]):not([aria-disabled="true"]):not([aria-hidden="true"])';
async function openCalendar(byIcon = false) {
  await click(byIcon ? `${field} button` : `${field} [role="spinbutton"]`);
  await until(`!!document.querySelector('${calendar}')`);
}
async function mount(width, lang, mode, shared = false) {
  await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
  await send('Page.navigate', { url: origin });
  await until('!!document.querySelector("#root") && !!window.$RefreshReg$');
  await ev(`(async () => {
    localStorage.setItem('alshifa_theme',${JSON.stringify(mode)});
    sessionStorage.setItem('cms_staff_token','synthetic-expiry-picker-test');
    const react=await import('/node_modules/.vite/deps/react.js'); const R=react.default||react;
    const client=await import('/node_modules/.vite/deps/react-dom_client.js'); const D=client.default||client;
    const T=await import('/src/app/theme/ThemeContext.jsx');
    const P=await import('/src/features/pharmacy/PharmacyManagement.jsx');
    const A=await import('/src/components/ui/AppDatePicker.jsx');
    await import('/src/App.css'); await import('/src/components/ui/ui.css');
    await (await import('/src/utils/clinicTime.js')).loadClinicTimeZone();
    await (await import('/src/i18n.js')).default.changeLanguage(${JSON.stringify(lang)});
    document.documentElement.dir=${JSON.stringify(lang === 'ar' ? 'rtl' : 'ltr')};
    document.documentElement.lang=${JSON.stringify(lang)};
    document.querySelector('#root').style.display='none';
    const host=document.createElement('div');document.body.appendChild(host);
    function Shared(){const [value,setValue]=R.useState('2013-05-07');return R.createElement(A.default,{label:'DOB regression',value,onChange:setValue,maxDate:'2020-12-31',minDate:'1900-01-01',disabled:window.pickerDisabled});}
    window.qaRoot=D.createRoot(host); window.qaShared=Shared; window.qaReact=R; window.qaTheme=T.ThemeProvider;
    window.qaRoot.render(R.createElement(T.ThemeProvider,null,R.createElement(${shared ? 'Shared' : 'P.default'},${shared ? '{}' : `{lang:${JSON.stringify(lang)}}`})));
  })()`);
  await until(shared ? '!!document.querySelector(".MuiPickersInputBase-root")' : '!!document.querySelector(".pharmacy-management-header button")');
  if (!shared) {
    await click('.pharmacy-management-header button');
    await click('#medicine-includeInitialBatch');
    await until(`!!document.querySelector('${field}')`);
  }
}
async function screenshot(name) {
  const png = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(`${output}/${name}.png`, Buffer.from(png.data, 'base64'));
}
await send('Page.enable'); await send('Runtime.enable');
await send('Fetch.enable', { patterns: [{ urlPattern: '*/api/*', requestStage: 'Request' }] });
try {
  for (const width of [1366, 390]) for (const lang of ['en', 'ar']) for (const mode of ['light', 'dark']) {
    const name = `${width}-${lang}-${mode}`;
    await mount(width, lang, mode);
    await openCalendar();
    check(`field opens calendar ${name}`, await ev(`!!document.querySelector('${calendar}')`));
    await delay(250);
    const layering = await ev(`(() => { const d=document.querySelector('${day}'); const r=d.getBoundingClientRect(); return {clickable:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('[role="gridcell"]')===d,zIndex:getComputedStyle(d.closest('.MuiPopper-root,.MuiDialog-root')).zIndex, day:d.outerHTML,hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML}; })()`);
    if (!layering.clickable) console.error(layering);
    check(`calendar above pharmacy modal ${name} (z=${layering.zIndex})`, layering.clickable);
    check(`localized portal direction ${name}`, await ev(`document.querySelector('${calendar}').closest('.MuiPopper-root,.MuiDialog-root').dir===${JSON.stringify(lang === 'ar' ? 'rtl' : 'ltr')}`));
    check(`past and today cannot be selected ${name}`, await ev(`(() => {const today=Number(document.querySelector('${calendar} .MuiPickerDay-today')?.dataset.timestamp);return [...document.querySelectorAll('${calendar} button[role="gridcell"][data-timestamp]')].filter(d=>Number(d.dataset.timestamp)<=today).every(d=>d.disabled);})()`));
    await screenshot(`open-${name}`);
    // Baseline reproduction can stop here: hit testing, not element.click(), detects hidden calendars.
    if (process.env.CLINIC_EXPIRY_BASELINE === '1') continue;
    const chosen = await ev(`document.querySelector('${day}').getAttribute('data-timestamp')`);
    await click(day);
    await until(`!document.querySelector('${calendar}')`);
    const selected = await ev(`(async () => (await import('/node_modules/.vite/deps/dayjs.js')).default(Number(${JSON.stringify(chosen)})).format('YYYY-MM-DD'))()`);
    const display = await ev(`(async () => (await import('/node_modules/.vite/deps/dayjs.js')).default(Number(${JSON.stringify(chosen)})).format(${JSON.stringify(lang === 'ar' ? 'DD/MM/YYYY' : 'MM/DD/YYYY')}))()`);
    check(`selection displays localized date ${name}`, await ev(`document.querySelector('input[name="expiryDate"]').value===${JSON.stringify(display)}`));
    await fill('#initial-batch-batchNumber', 'QA-LOT');
    await fill('#initial-batch-receivedQuantity', '2');
    await openCalendar(true);
    check(`icon reopens with selected date ${name}`, await ev(`document.querySelector('${calendar} [aria-selected="true"]')?.getAttribute('data-timestamp')===${JSON.stringify(chosen)}`));
    await key('Escape', 'Escape', 27);
    await until(`!document.querySelector('${calendar}')`);
    check(`Escape preserves parent and selected value ${name}`, await ev(`!!document.querySelector('.ui-dialog')&&document.querySelector('input[name="expiryDate"]').value===${JSON.stringify(display)}`));
    check(`fits viewport ${name}`, await ev('document.documentElement.scrollWidth<=innerWidth'));
    for (const id of ['brandName', 'labelAr', 'labelEn', 'genericName', 'strength', 'dosageForm']) await fill(`#medicine-${id}`, 'QA medicine');
    // Bypass native required checks here to exercise the existing form validation as well.
    for (const invalid of ['01/01/2020', lang === 'ar' ? '30/02/2030' : '02/30/2030']) {
      const beforeInvalid = report.writes.length;
      await pasteDate(field, invalid);
      await ev("document.querySelector('.ui-dialog form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))");
      await delay(100);
      check(`reject manual invalid expiry ${invalid} ${name}`, report.writes.length === beforeInvalid && await ev("!!document.querySelector('.ui-dialog .Mui-error')"));
    }
    await pasteDate(field, display);
    check(`manual valid date recovers ${name}`, await ev(`document.querySelector('input[name="expiryDate"]').value===${JSON.stringify(display)}`));
    const before = report.writes.length;
    await click('.ui-dialog button[type="submit"], .ui-dialog .dialog-actions .btn-primary');
    await until('!document.querySelector(".ui-dialog")');
    check(`valid initial batch request ${name}`, report.writes.length === before + 1 && report.writes.at(-1).body.initialBatch.expiryDate === selected);
  }
  if (process.env.CLINIC_EXPIRY_BASELINE !== '1') {
    // Real standalone shared picker: DOB constraints, disabled state, manual keyboard entry.
    for (const width of [1366, 390]) for (const lang of ['en', 'ar']) {
      await mount(width, lang, 'light', true);
      await click('.MuiPickersInputBase-root button');
      await until(`!!document.querySelector('${calendar}')`);
      check(`shared DOB bounds and selection ${width}-${lang}`, await ev(`document.querySelector('${calendar} [aria-selected="true"]')?.textContent==='7'`));
      await click(day);
      await until(`!document.querySelector('${calendar}')`);
      check(`shared DOB selection persists ${width}-${lang}`, await ev(`document.querySelector('.MuiPickersInputBase-root input').value===${JSON.stringify(lang === 'ar' ? '01/05/2013' : '05/01/2013')}`));
      await ev('window.pickerDisabled=true;window.qaRoot.render(window.qaReact.createElement(window.qaTheme,null,window.qaReact.createElement(window.qaShared)))');
      await delay(100);
      check(`disabled shared picker ${width}-${lang}`, await ev('document.querySelector(".MuiPickersInputBase-root button").disabled'));
    }
    // The same batch field also appears in the Receive batch dialog.
    await mount(1366, 'en', 'dark');
    await click('.ui-dialog .dialog-actions button[type="button"]');
    await click('.pharmacy-action-trigger');
    await click('[role="menu"] button:nth-child(3)');
    await openCalendar(true);
    await click(day);
    await until(`!document.querySelector('${calendar}')`);
    await fill('#batch-batchNumber', 'QA-RECEIPT'); await fill('#batch-receivedQuantity', '3');
    const before = report.writes.length;
    await click('.ui-dialog .dialog-actions .btn-primary');
    await until('!!document.querySelector(".ui-dialog [role=alert]")');
    check('receive batch submits canonical expiry', report.writes.length === before + 1 && report.writes.at(-1).path.endsWith('/batches') && /^\d{4}-\d{2}-\d{2}$/.test(report.writes.at(-1).body.expiryDate));
  }
  check('no browser exceptions', report.exceptions.length === 0);
} finally {
  fs.writeFileSync(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ checks: report.checks.length, failed: report.checks.filter(check => !check.passed), exceptions: report.exceptions, output }, null, 2));
  await send('Page.close'); ws.close();
}
process.exitCode = report.checks.every(check => check.passed) ? 0 : 1;
