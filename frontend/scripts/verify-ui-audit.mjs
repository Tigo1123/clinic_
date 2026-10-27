// One existing headless Chrome target, sequential scenarios, synthetic API only.
import fs from 'node:fs';
import path from 'node:path';
const origin = process.env.CLINIC_UI_ORIGIN || 'http://127.0.0.1:5187';
const cdp = process.env.CLINIC_CDP_ORIGIN || 'http://127.0.0.1:9337';
for (const url of [origin, cdp]) if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw Error('Local origins required');
const labOnly = process.argv.includes('--lab-only');
const output = path.resolve(process.env.CLINIC_UI_OUTPUT || `../qa-evidence/ui-audit-resume${labOnly ? '/lab-detail' : ''}`);
fs.mkdirSync(output, { recursive: true });
const report = { checks: [], screenshots: [], exceptions: [], apiPaths: [], mockedWrites: [] };
const target = await (await fetch(`${cdp}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let sequence = 0, initId, scenario = 'normal'; const pending = new Map();
const person = { id: 'patient', fileNumber: 'MRN-001', fullNameAr: 'مريض الاختبار', fullNameEn: 'Test Patient', gender: 'MALE', dateOfBirth: '1990-01-01', phone: '+249911111111' };
const service = { id: 'cbc', labelAr: 'صورة دم كاملة', labelEn: 'Complete Blood Count', category: 'LABORATORY', status: 'ACTIVE', baseFeeSdg: 1000 };
const order = (id, status, released = false) => ({ id, status, patient: person, doctor: { ...person, fullNameAr: 'طبيب الاختبار', fullNameEn: 'Test Doctor' }, orderDate: '2026-10-20T10:00:00Z', releasedToPatientAt: released ? '2026-10-20T12:00:00Z' : null, items: [{ id: `${id}-item`, service, labReviewStatus: 'APPROVED', resultValue: released || status === 'COMPLETED' ? '13.5' : null, resultVersion: 0 }] });
function fixture(url, request) {
  const key = url.pathname; report.apiPaths.push(key);
  if (key.startsWith('/socket.io')) return [503, {}];
  if (key === '/api/public-config') return [200, { clinicTimeZone: 'Africa/Khartoum', googleClientId: '', staffMfaRequired: false }];
  if (request.method !== 'GET') {
    report.mockedWrites.push({ path: key, method: request.method });
    if (key.endsWith('/forgot-password')) return [200, { challengeId: 'synthetic', message: 'PRIVATE BACKEND SUCCESS' }];
    if (key.endsWith('/login')) return [401, { error: 'PRIVATE BACKEND ERROR' }];
    return [503, { error: { code: 'SERVICE_UNAVAILABLE', message: 'PRIVATE BACKEND ERROR' } }];
  }
  if (scenario === 'error' && !key.includes('public-config')) return [503, { error: { message: 'PRIVATE BACKEND ERROR' } }];
  if (key === '/api/patient/me') return [200, person];
  if (key === '/api/patient/summary') return [200, { appointments: 0, labResults: 0, prescriptions: 0 }];
  if (key === '/api/admin/analytics') return [503, { error: { code: 'SERVICE_UNAVAILABLE' } }];
  if (key === '/api/admin/pricing') return [200, { doctors: [], medicines: [], services: [] }];
  if (key === '/api/pharmacy/formulary') return [200, { items: [], pagination: { page: 1, totalPages: 1, total: 0 } }];
  if (key === '/api/notifications') return [200, { items: [], unreadCount: 0 }];
  if (key === '/api/billing/services') return [200, scenario === 'empty' ? [] : [service]];
  if (key === '/api/records/lab-orders/pending') return [200, scenario === 'empty' ? [] : [order('sample', 'SAMPLE_COLLECTED'), order('paid', 'PAID'), order('unpaid', 'PENDING_BILLING'), order('complete', 'COMPLETED')]];
  if (key === '/api/records/lab-orders/history') return [200, scenario === 'empty' ? [] : [order('released', 'COMPLETED', true)]];
  if (key === '/api/records/lab-order-items/pending-review') return [200, scenario === 'review' ? [{ id: 'review', customTestName: 'CRP', labOrder: order('custom', 'PENDING_BILLING') }] : []];
  return [200, []];
}
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  const timer = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout: ${method}`)); }, 15000);
  pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }));
});
ws.onmessage = async ({ data }) => {
  const message = JSON.parse(data);
  if (message.id) {
    const task = pending.get(message.id); if (!task) return;
    pending.delete(message.id); clearTimeout(task.timer);
    if (message.error) task.reject(Error(message.error.message)); else task.resolve(message.result);
  } else if (message.method === 'Fetch.requestPaused') {
    const { requestId, request } = message.params;
    const [status, body] = fixture(new URL(request.url), request);
    if (scenario === 'loading' && request.url.includes('/api/records/lab')) await new Promise(resolve => setTimeout(resolve, 1600));
    await send('Fetch.fulfillRequest', { requestId, responseCode: status, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'X-Has-More', value: 'false' }], body: Buffer.from(JSON.stringify(body)).toString('base64') }).catch(() => {});
  } else if (message.method === 'Runtime.exceptionThrown') report.exceptions.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const ev = async expression => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
const check = (name, passed) => { report.checks.push({ name, passed: Boolean(passed) }); if (!passed) console.log(`FAIL ${name}`); };
async function checkContrast(name, backgroundSelector, foregroundSelector) {
  const sample = await ev(`(()=>{
    const background=getComputedStyle(document.querySelector(${JSON.stringify(backgroundSelector)})).backgroundColor;
    const foreground=getComputedStyle(document.querySelector(${JSON.stringify(foregroundSelector)})).color;
    const canvas=document.createElement('canvas');canvas.width=canvas.height=1;
    const ctx=canvas.getContext('2d');
    const lum=color=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);const rgb=[...ctx.getImageData(0,0,1,1).data].slice(0,3).map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4});return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722};
    const a=lum(foreground),b=lum(background);
    return {foreground,background,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
  })()`);
  (report.contrastSamples ||= []).push({ name, ...sample });
  check(name, sample.background !== 'rgba(0, 0, 0, 0)' && sample.ratio >= 4.5);
}
async function wait(expression) {
  return ev(`new Promise(resolve=>{const end=Date.now()+8000; const poll=()=>{if(${expression})resolve(true);else if(Date.now()>end)resolve(false);else setTimeout(poll,40)};poll()})`);
}
async function mount(route, role, width, lang, mode, state = 'normal') {
  scenario = state;
  if (initId) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: initId });
  const user = role ? { id: 'synthetic-user', role, username: 'audit@example.test', patientLinked: true, patientId: 'patient', doctorId: 'doctor', mfaEnabled: true } : null;
  const namespace = role === 'PATIENT' ? 'patient' : 'staff';
  const source = `localStorage.clear();sessionStorage.clear();localStorage.setItem('shifa_language',${JSON.stringify(lang)});localStorage.setItem('alshifa_theme',${JSON.stringify(mode)});${user ? `sessionStorage.setItem('cms_${namespace}_user',${JSON.stringify(JSON.stringify(user))});sessionStorage.setItem('cms_${namespace}_token','synthetic-only');` : ''}`;
  initId = (await send('Page.addScriptToEvaluateOnNewDocument', { source })).identifier;
  await send('Emulation.setDeviceMetricsOverride', { width, height: width === 768 ? 1024 : 900, deviceScaleFactor: 1, mobile: width < 600 });
  await send('Page.navigate', { url: `${origin}${route}` });
  check(`mounted ${route} ${role || 'public'}`, await wait('document.querySelector("#root").textContent.length>80'));
  if (role && role !== 'PATIENT') check(`workspace ready ${role}-${width}-${lang}-${mode}`, await wait('!!document.querySelector(".dashboard-wrapper")&&!document.querySelector(".portal-loading,.route-loading")'));
  if (role === 'PATIENT') check(`patient page ready ${route}`, await wait('!!document.querySelector("#patient-main")&&!document.querySelector(".route-loading")'));
  await delay(state === 'loading' ? 30 : 250);
}
async function shot(name) {
  const layout = await ev('({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,lang:document.documentElement.lang,dir:document.documentElement.dir,theme:document.documentElement.dataset.theme})');
  check(`no overflow ${name}`, layout.scrollWidth <= layout.width);
  const png = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(path.join(output, `${name}.png`), Buffer.from(png.data, 'base64'));
  report.screenshots.push({ name, ...layout });
}
async function click(text) { check(`button ${text}`, await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b)return false;b.click();return true})()`)); await delay(60); }
async function fill(selector, value) { await ev(`(()=>{const i=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,${JSON.stringify(value)});i.dispatchEvent(new Event('input',{bubbles:true}))})()`); await delay(30); }
try {
  await send('Page.enable'); await send('Runtime.enable');
  await send('Fetch.enable', { patterns: [{ urlPattern: '*/api/*' }, { urlPattern: '*/socket.io/*' }] });
  const areas = labOnly ? [] : [['staff-login', '/staff', null], ['patient-login', '/patient-login', null], ['register', '/register', null], ['forgot-password', '/forgot-password', null], ['admin', '/staff', 'ADMIN'], ['reception', '/staff', 'RECEPTIONIST'], ['doctor', '/staff', 'DOCTOR'], ['pharmacy', '/staff', 'PHARMACIST'], ['patient-portal', '/patient', 'PATIENT']];
  for (const [width, lang, mode] of [[390, 'ar', 'dark'], [1366, 'en', 'light'], [768, 'ar', 'light'], [390, 'en', 'dark']]) {
    for (const [area, route, role] of areas) {
      await mount(route, role, width, lang, mode);
      check(`direction/theme ${area}-${width}-${lang}-${mode}`, await ev(`document.documentElement.dir===${JSON.stringify(lang === 'ar' ? 'rtl' : 'ltr')}&&document.documentElement.dataset.theme===${JSON.stringify(mode)}`));
      await shot(`${area}-${width}-${lang}-${mode}`);
      if (area.endsWith('login')) {
        await fill('input[autocomplete="username"]', 'audit@example.test'); await fill('input[type="password"]', 'Synthetic123!');
        await ev('document.querySelector("form").requestSubmit()');
        check(`localized login error ${area}-${lang}-${mode}`, await wait(`document.querySelector('[role=alert]')?.textContent.includes(${JSON.stringify(lang === 'ar' ? 'اسم المستخدم' : 'username or password')})`));
      }
      if (area === 'forgot-password') {
        await fill('input[type="email"]', 'audit@example.test'); await ev('document.querySelector("form").requestSubmit()');
        check(`localized reset confirmation ${lang}-${mode}`, await wait('!!document.querySelector("input[autocomplete=one-time-code]")'));
        check(`no backend success leak ${lang}-${mode}`, await ev('!document.body.textContent.includes("PRIVATE BACKEND SUCCESS")&&!!document.querySelector("[role=status]")'));
        await shot(`reset-password-${width}-${lang}-${mode}`);
      }
      if (area === 'doctor') {
        const t = await ev(`(async()=>(await import('/src/i18n.js')).default.t('securitySettings'))()`);
        await click(t); check('security initial focus', await ev('document.querySelector("[role=dialog]").contains(document.activeElement)'));
        await shot(`security-${width}-${lang}-${mode}`);
        await ev(`(()=>{const d=document.querySelector('[role=dialog]');const b=[...d.querySelectorAll('button:not(:disabled)')];b.at(-1).focus();d.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));return document.activeElement===b[0]})()`).then(passed => check('security Tab containment', passed));
        await click(await ev(`(async()=>(await import('/src/i18n.js')).default.t('changePassword'))()`)); await shot(`change-password-${width}-${lang}-${mode}`);
        await ev(`document.querySelector('[role=dialog]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))`);
        check('security Escape closes', await ev('!document.querySelector("[role=dialog]")'));
      }
    }
  }
  for (const width of [390, 768, 1366]) for (const lang of ['ar', 'en']) for (const mode of ['light', 'dark']) {
    const name = `lab-${width}-${lang}-${mode}`;
    await mount('/staff', 'LAB_TECH', width, lang, mode);
    check(`Lab queue ready ${name}`, await wait('!!document.querySelector(".laboratory-order-card")'));
    await ev('document.querySelector(".laboratory-order-card").click()');
    check(`named result input ${name}`, await wait('!!document.querySelector(".laboratory-results-panel input[type=text][aria-label]")'));
    await checkContrast(`Lab completion contrast ${name}`, '.laboratory-workflow .is-done>span', '.laboratory-workflow .is-done>span');
    await checkContrast(`Lab panel contrast ${name}`, '.laboratory-orders-panel', '.laboratory-orders-panel .panel-title');
    await checkContrast(`Lab current step contrast ${name}`, '.laboratory-workflow', '.laboratory-workflow .is-current small');
    await shot(name);
    if (width === 390 && labOnly) {
      await ev('document.querySelector(".laboratory-results-panel").scrollIntoView({block:"start",behavior:"instant"})');
      check(`Lab mobile result controls visible ${name}`, await wait('(()=>{const p=document.querySelector(".laboratory-results-panel");const r=p.querySelector("input[type=text]").getBoundingClientRect();const b=p.querySelector("button").getBoundingClientRect();return r.top>=0&&b.bottom<=innerHeight})()'));
      await shot(`lab-entry-${width}-${lang}-${mode}`);
      await ev('scrollTo({top:0,behavior:"instant"})');
    }
    await ev(`document.querySelector('#laboratory-tab-work').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}))`);
    check(`Lab keyboard history ${name}`, await ev('document.activeElement.id==="laboratory-tab-history"&&document.querySelector("#laboratory-tab-history").tabIndex===0'));
    await ev('document.querySelector(".laboratory-order-card").click()'); await delay(30);
    check(`released history read only ${name}`, await ev('!!document.querySelector(".laboratory-released-banner")&&!document.querySelector(".laboratory-results-panel input")'));
    if (width === 390 && lang === 'ar' && mode === 'dark') await shot('lab-released-history-390-ar-dark');
  }
  for (const state of ['error', 'empty', 'loading', 'review']) {
    await mount('/staff', 'LAB_TECH', 390, 'ar', 'dark', state);
    if (state === 'error') { check('Lab error has alerts', await wait('document.querySelectorAll("[role=alert]").length>=2')); check('Lab error no backend English', await ev('!document.body.textContent.includes("PRIVATE BACKEND")')); }
    if (state === 'empty') check('Lab empty after success', await wait('!!document.querySelector(".laboratory-review-empty")'));
    if (state === 'loading') check('Lab loading never claims empty', await ev('!document.querySelector(".laboratory-review-empty")&&!!document.querySelector("[role=status]")'));
    if (state === 'review') { await click('ربط بخدمة موجودة'); check('Lab named service selector', await ev('!!document.querySelector(".laboratory-review-card select[aria-label]")')); }
    await shot(`lab-${state}-390-ar-dark`);
  }
  for (const route of (labOnly ? [] : ['/patient/lab-results', '/patient/prescriptions', '/patient/records', '/patient/profile'])) {
    await mount(route, 'PATIENT', 390, 'ar', 'dark'); await shot(`patient-${route.split('/').at(-1)}-390-ar-dark`);
  }
  check('no uncaught browser exceptions', report.exceptions.length === 0);
} catch (error) { report.fatal = error.stack; console.error(error.message); }
finally {
  report.apiPaths = [...new Set(report.apiPaths)];
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ checks: report.checks.length, failed: report.checks.filter(c => !c.passed), screenshots: report.screenshots.length, exceptions: report.exceptions, fatal: report.fatal }));
  ws.close(); await fetch(`${cdp}/json/close/${target.id}`);
  process.exitCode = report.fatal || report.checks.some(c => !c.passed) ? 1 : 0;
}
