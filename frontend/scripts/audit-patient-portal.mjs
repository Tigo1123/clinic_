import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const origin = process.env.PORTAL_AUDIT_ORIGIN || 'http://127.0.0.1:5187';
const cdpOrigin = process.env.PORTAL_AUDIT_CDP || 'http://127.0.0.1:9337';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(origin).hostname));
const output = process.env.PORTAL_AUDIT_OUTPUT || '/tmp/shifa-patient-portal-audit';
fs.mkdirSync(output, { recursive: true });
const target = await (await fetch(`${cdpOrigin}/json/new?about:blank`, { method: 'PUT' })).json();
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let sequence = 0;
const pending = new Map();
const report = { pages: [], checks: [], consoleErrors: [], unmatchedApi: [], mutations: [] };
let scenario = 'normal';
let appointmentStatus = 'CONFIRMED';
let raceFirstDate;
let googleLinked = true;
const doctor = { id: 'doctor-fixture', fullNameAr: 'د. سارة محمد أحمد', fullNameEn: 'Dr. Sarah Mohamed Ahmed', specialtyAr: 'الطب الباطني', specialtyEn: 'Internal Medicine', consultationFee: 15000 };
const profile = { id: 'patient-fixture', fileNumber: 'SHF-000042', fullNameAr: 'أحمد محمد عبد الرحمن النور', fullNameEn: 'Ahmed Mohamed Abdelrahman Alnour', email: 'ahmed.patient@example.test', phone: '+249912345678', phoneNormalized: '+249912345678', gender: 'MALE', dateOfBirth: '1990-01-02', addressStateId: 1, addressDetails: 'Khartoum', emergencyContact: 'Family', bloodType: 'O+', preferredLanguage: 'ar', emailVerified: true, phoneVerified: false, googleAccount: { linked: true, email: 'ahmed.patient@example.test', linkedAt: '2026-09-01T10:00:00Z' } };
const appointment = () => ({ id: 'appointment-fixture', doctor, appointmentDate: '2026-11-15', appointmentTime: '10:30', status: appointmentStatus });
const record = { id: 'record-fixture', doctor, visitDate: '2026-10-10T10:30:00Z', diagnosis: 'Routine follow-up · متابعة دورية', symptoms: 'Headache · صداع', treatment: 'Rest and follow-up · الراحة والمتابعة', vitalSigns: { temperature: 0, blood_pressure: '120/80', pulse: 72 }, prescriptions: [{ id: 'rx-fixture', medicines: [{ id: 'medicine-fixture', medicine: { labelAr: 'باراسيتامول', labelEn: 'Paracetamol' }, dosage: '500 mg', duration: '3 days', instructionsAr: 'عند الحاجة', instructionsEn: 'As needed' }] }], releasedLabResults: [{ id: 'result-fixture', testNameAr: 'سكر الدم', testNameEn: 'Blood glucose', resultValue: '0', referenceRangeMin: 0, referenceRangeMax: 100, releasedToPatientAt: '2026-10-11T12:00:00Z' }] };
function response(url, method) {
  const p = url.pathname;
  if (p === '/api/public-config') return { clinicTimeZone: 'Africa/Khartoum' };
  if (method !== 'GET') {
    report.mutations.push({ path: p, method, mocked: true });
    if (p === '/api/auth/logout') return {};
    if (p === '/api/patient/me/external-identities/google' && method === 'DELETE') { googleLinked = false; return {}; }
    if (p.endsWith('/cancel')) { appointmentStatus = 'CANCELLED'; return appointment(); }
    if (p.endsWith('/reschedule')) return appointment();
    if (p === '/api/patient/appointments') return { ...appointment(), id: 'booked-fixture', status: 'PENDING' };
    if (/email-change\/request|phone-change\/request/.test(p)) return { challengeId: 'challenge-fixture', deliveredTo: 'a***@example.test' };
    if (p === '/api/patient-auth/register' || p.endsWith('/verification/resend') || p.endsWith('/verification/resend-by-identity')) return { challengeId: 'challenge-fixture', state: 'VERIFICATION_REQUIRED', identity: { ...profile } };
    if (p === '/api/patient-auth/verify') return { state: 'CLAIMED', patient: profile };
    if (p === '/api/patient-auth/forgot-password') return { challengeId: 'recovery-fixture' };
    if (p === '/api/auth/login') return { user: { id: 'user-fixture', role: 'PATIENT', patientLinked: true }, token: 'audit-fixture-only' };
    return {};
  }
  if (p === '/api/patient/me' && scenario === 'structured-name') return { ...profile, firstNameAr: 'تاج', firstNameEn: 'Tag' };
  if (p === '/api/patient/me' && scenario === 'missing-name') return { ...profile, fullNameAr: null, fullNameEn: null };
  if (p === '/api/patient/me' && scenario === 'long-token') return { ...profile, firstNameAr: 'تاج'.repeat(80), firstNameEn: 'Tag'.repeat(80) };
  if (p === '/api/patient/me') return scenario === 'long' ? { ...profile, fullNameAr: profile.fullNameAr.repeat(4), fullNameEn: profile.fullNameEn.repeat(4), email: `${'longemail'.repeat(12)}@example.test` } : { ...profile, googleAccount: { ...profile.googleAccount, linked: googleLinked } };
  if (p === '/api/patient/doctors') return scenario === 'empty' ? [] : [doctor, { ...doctor, id: 'doctor-two', fullNameAr: 'د. عبد الرحمن علي', fullNameEn: 'Dr. Abdelrahman Ali', specialtyAr: 'طب الأسنان', specialtyEn: 'Dentistry' }];
  if (p.startsWith('/api/patient/doctors/')) return doctor;
  if (p === '/api/appointments/slots') return scenario === 'empty' ? [] : url.searchParams.get('date')?.endsWith('02') ? ['14:00'] : ['09:00', '10:30', '11:00'];
  if (p === '/api/patient/appointments') return scenario === 'empty' ? [] : [appointment()];
  if (p.startsWith('/api/patient/appointments/')) return appointment();
  if (p === '/api/patient/medical-records') return scenario === 'empty' ? [] : [record];
  if (p.startsWith('/api/patient/medical-records/')) return record;
  if (p === '/api/patient/prescriptions') return scenario === 'empty' ? [] : [{ ...record.prescriptions[0], prescriptionDate: record.visitDate }];
  if (p === '/api/patient/lab-results') return scenario === 'empty' ? [] : [{ id: 'lab-fixture', doctor, orderDate: record.visitDate, releasedAt: '2026-10-11T12:00:00Z', tests: [{ id: 'test-fixture', service: { labelAr: 'سكر الدم', labelEn: 'Blood glucose', category: 'LABORATORY' }, resultValue: '0', referenceRangeMin: 0, referenceRangeMax: 100, isOutOfRange: false }] }];
  report.unmatchedApi.push({ path: p, method });
  return {};
}
function send(method, params = {}) {
  const id = ++sequence;
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const contrast = (first, second) => {
  const luminance = color => color.match(/[\d.]+/g).slice(0,3).map(Number).map(value => { const channel=value/255; return channel<=.04045 ? channel/12.92 : ((channel+.055)/1.055)**2.4; }).reduce((sum,value,index)=>sum+value*[.2126,.7152,.0722][index],0);
  const values = [luminance(first),luminance(second)].sort((a,b)=>b-a);
  return (values[0]+.05)/(values[1]+.05);
};
socket.onmessage = async ({ data }) => {
  const event = JSON.parse(data);
  if (event.id) {
    const request = pending.get(event.id);
          if (request) { pending.delete(event.id); if (event.error) request.reject(new Error(event.error.message)); else request.resolve(event.result); }
  } else if (event.method === 'Fetch.requestPaused') {
    const { requestId, request } = event.params;
    const url = new URL(request.url);
    let status = 200;
    let body;
    if (scenario === 'not-found' && /\/api\/patient\/(doctors|appointments)\//.test(url.pathname)) { status = 404; body = { error: { code: 'NOT_FOUND', message: 'This item is unavailable. هذا العنصر غير متاح.' } }; }
    else if (scenario === 'legacy-unlinked' && url.pathname === '/api/patient/me') { status = 409; body = { error: { code: 'PATIENT_RECORD_NOT_LINKED', message: 'This account is not linked to a patient record.' } }; }
    else if (scenario === 'pending-login' && url.pathname === '/api/auth/login') { status = 403; body = { error: { code: 'ACCOUNT_PENDING_VERIFICATION', message: 'Verification required.' } }; }
    else if (scenario === 'action-error' && request.method !== 'GET') { status = 401; body = { error: { code: 'REAUTHENTICATION_FAILED', message: 'Current password is incorrect.' } }; }
    else if ((scenario === 'error' && url.pathname !== '/api/public-config') || (scenario === 'slots-error' && url.pathname === '/api/appointments/slots') || (scenario === 'partial-error' && url.pathname === '/api/patient/lab-results')) { status = 503; body = { error: { code: 'AUDIT_UNAVAILABLE', message: 'Unable to load patient information. تعذر تحميل البيانات.' } }; }
    else body = response(url, request.method);
    if (scenario === 'slots-race' && url.pathname === '/api/appointments/slots') {
      const date = url.searchParams.get('date');
      raceFirstDate ||= date;
      body = date === raceFirstDate ? ['09:00'] : ['14:00'];
      await delay(date === raceFirstDate ? 450 : 30);
    }
    if (scenario === 'slow' && /\/api\/patient\//.test(url.pathname)) await delay(1800);
    await send('Fetch.fulfillRequest', { requestId, responseCode: status, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' }], body: Buffer.from(JSON.stringify(body)).toString('base64') }).catch(() => {});
  } else if (event.method === 'Runtime.exceptionThrown') report.consoleErrors.push(event.params.exceptionDetails.text);
};
await Promise.all(['Page.enable', 'Runtime.enable', 'Network.enable'].map(method => send(method)));
// Intercept every application API request, including mutations. No backend is contacted.
await send('Fetch.enable', { patterns: [{ urlPattern: '*/api/*', requestStage: 'Request' }] });
const ev = async expression => {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
};
await send('Page.addScriptToEvaluateOnNewDocument', { source: `if(location.origin===${JSON.stringify(origin)}){if(!sessionStorage.getItem('audit-logged-out')){sessionStorage.setItem('cms_patient_user',JSON.stringify({id:'user-fixture',role:'PATIENT',patientLinked:!sessionStorage.getItem('audit-unlinked')}));sessionStorage.setItem('cms_patient_token','audit-fixture-only')}}` });
const size = async width => { await send('Emulation.setDeviceMetricsOverride', { width, height: ({360:800,390:844,768:1024,1024:768,1366:900,1600:1000})[width] || 900, deviceScaleFactor: 1, mobile: width < 600 }); };
const nav = async route => { await send('Page.navigate', { url: origin + route }); await delay(400); await ev(`document.fonts.ready`); await delay(100); };
const language = async lang => { await ev(`(async()=>{const m=await import('/src/i18n.js');await m.default.changeLanguage(${JSON.stringify(lang)})})()`); await delay(60); await ev(`new Promise(resolve=>{const end=Date.now()+10000;const ready=()=>{const e=document.querySelector('.patient-google-button');if(!e||e.getAttribute('aria-busy')==='false'||Date.now()>end)resolve();else setTimeout(ready,50)};ready()})`); };
const theme = async value => { await ev(`localStorage.setItem('alshifa_theme',${JSON.stringify(value)})`); };
const check = (name, passed, details) => { report.checks.push({ name, passed: Boolean(passed), ...(details === undefined ? {} : { details }) }); };
const click = async selector => { const found = await ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return false;e.focus();e.click();return true})()`); assert.ok(found, `Missing control: ${selector}`); await delay(60); };
const clickText = async text => { const found = await ev(`(()=>{const e=[...document.querySelectorAll('button,a')].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!e)return false;e.focus();e.click();return true})()`); assert.ok(found, `Missing control: ${text}`); await delay(160); };
const fill = async (selector, value) => { await ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing input');const p=e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}))})()`); await delay(30); };
const key = async value => { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: value, code: value }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: value, code: value }); await delay(60); };
async function shotCurrent(name, full = false) {
  const metrics = await send('Page.getLayoutMetrics');
  const content = metrics.cssContentSize;
  const png = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: full, ...(full ? { clip: { x: 0, y: 0, width: content.width, height: Math.min(content.height, 12000), scale: 1 } } : {}) });
  fs.writeFileSync(path.join(output, `${name}.png`), Buffer.from(png.data, 'base64'));
}
async function capture(name, route, width, lang, mode) {
  await size(width);
  await ev(`sessionStorage.${route === '/patient/claim' ? "setItem('audit-unlinked','true')" : "removeItem('audit-unlinked')"}`);
  await theme(mode);
  await nav(route);
  await language(lang);
  const metrics = await ev(`(()=>{const visible=e=>e.getBoundingClientRect().width&&e.getBoundingClientRect().height;return{path:location.pathname,lang:document.documentElement.lang,dir:document.documentElement.dir,theme:document.documentElement.dataset.theme,width:innerWidth,scrollWidth:document.documentElement.scrollWidth,h1:[...document.querySelectorAll('h1')].map(e=>({text:e.textContent,size:getComputedStyle(e).fontSize})),heroHeight:document.querySelector('.patient-hero')?.getBoundingClientRect().height,unlabelledInputs:[...document.querySelectorAll('input,select,textarea')].filter(visible).filter(e=>!e.labels?.length&&!e.getAttribute('aria-label')&&!e.getAttribute('aria-labelledby')).map(e=>({type:e.type,placeholder:e.placeholder})),text:document.body.innerText.slice(0,2500)}})()`);
  const png = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(path.join(output, `${name}.png`), Buffer.from(png.data, 'base64'));
  report.pages.push({ name, route, width, lang, mode, ...metrics });
  if (['/register', '/patient-login'].includes(route)) {
    const googleText = await ev(`document.querySelector('.patient-google-button')?.textContent || ''`);
    if (googleText) check(`Google button matches ${lang} on ${name}`, lang === 'ar' ? /[\u0600-\u06ff]/.test(googleText) : /Continue|Sign in|Sign up/.test(googleText), googleText);
  }
  if (['/register', '/patient-login', '/forgot-password', '/patient/claim'].includes(route)) {
    const colors = await ev(`(()=>{const button=document.querySelector('.patient-auth .patient-button:not(:disabled)');const input=document.querySelector('.patient-auth input');return{button:button?{color:getComputedStyle(button).color,background:getComputedStyle(button).backgroundColor}:null,input:input?{border:getComputedStyle(input).borderColor,background:getComputedStyle(input).backgroundColor}:null}})()`);
    if (colors.button) check(`primary button contrast on ${name}`,contrast(colors.button.color,colors.button.background)>=4.5);
    if (colors.input) check(`input border contrast on ${name}`,contrast(colors.input.border,colors.input.background)>=3);
  }
  return metrics;
}
async function functionalChecks() {
  scenario = 'normal';
  await size(390); await nav('/patient'); await language('en');
  check('dashboard has one compact primary heading', await ev(`document.querySelectorAll('h1').length===1&&document.querySelector('.patient-hero').getBoundingClientRect().height<300`));
  await key('Tab');
  check('keyboard navigation exposes a visible focus ring', await ev(`getComputedStyle(document.activeElement).outlineStyle==='solid'&&parseFloat(getComputedStyle(document.activeElement).outlineWidth)>=2`));
  await click('.patient-skip-link');
  check('skip link moves focus to main content', await ev(`document.activeElement.id==='patient-main'`));
  await click('.patient-nav a[href="/patient/doctors"]');
  check('mobile navigation opens the doctors route', await ev(`location.pathname==='/patient/doctors'`));
  await click('.patient-header button[aria-haspopup="dialog"]');
  check('updates control opens a useful dialog', await ev(`!!document.querySelector('[role=dialog] a[href="/patient/lab-results"]')`));
  await shotCurrent('updates-dialog-390-en');
  await key('Escape');
  check('updates Escape restores focus to opener', await ev(`!document.querySelector('[role=dialog]')&&document.activeElement.getAttribute('aria-haspopup')==='dialog'`));
  await click('.patient-header .theme-toggle-btn');
  const selectedTheme = await ev('document.documentElement.dataset.theme');
  await nav('/patient/doctors');
  check('theme survives direct navigation and refresh', await ev(`document.documentElement.dataset.theme===${JSON.stringify(selectedTheme)}`));
  check('language survives direct navigation and refresh', await ev(`document.documentElement.lang==='en'`));
  await click('.patient-header button[aria-label="العربية"]');
  check('language control changes direction', await ev(`document.documentElement.dir==='rtl'`));
  await nav('/patient/doctors');
  check('Arabic preference survives refresh', await ev(`document.documentElement.lang==='ar'`));
  await language('en');
  await fill('.doctor-search input', 'no-doctor-matches');
  check('directory search has an empty result state', await ev(`document.querySelectorAll('.doctor-card').length===0&&!!document.querySelector('.patient-empty')`));
  await fill('.doctor-search input', 'Sarah');
  check('directory search filters doctors', await ev(`document.querySelectorAll('.doctor-card').length===1`));
  scenario = 'error'; await nav('/patient/records'); await language('ar');
  check('Arabic API errors have localized headings and retry controls', await ev(`document.querySelector('.error-state h2').textContent==='تعذر تحميل البيانات'&&!!document.querySelector('.error-state button')`));
  scenario = 'normal'; await click('.error-state button'); await delay(100);
  check('retry recovers the patient collection', await ev(`!!document.querySelector('.medical-record-card')`));
  scenario = 'partial-error'; await nav('/patient'); await language('en');
  check('failed dashboard counts are unavailable rather than false zero', await ev(`document.querySelector('.health-summary-card[href="/patient/lab-results"]').textContent.includes('Unavailable')`));
  scenario = 'normal';

  scenario = 'slots-race'; raceFirstDate = undefined;
  await nav('/patient/book/doctor-fixture'); await language('en');
  await click('.date-chip');
  await click('.date-chip:nth-child(2)');
  check('booking is disabled while slots load', await ev(`document.querySelector('form button:not([type=button])').disabled`));
  await delay(550);
  check('late slot responses cannot replace the current date', await ev(`document.querySelectorAll('.slot-chip').length===1&&document.querySelector('.slot-chip').textContent==='14:00'`));
  scenario = 'normal';
  await click('.slot-chip');
  await ev(`document.querySelector('.patient-main form').requestSubmit()`); await delay(200);
  check('mock booking succeeds with pending-review confirmation', await ev(`!!document.querySelector('.patient-booking-pending')`));
  await shotCurrent('booking-pending-confirmation-390-en');

  await nav('/patient/appointments/appointment-fixture'); await language('en');
  await clickText('Cancel appointment');
  check('cancellation requires confirmation', await ev(`!!document.querySelector('[role=dialog]')`));
  await shotCurrent('cancel-dialog-390-en');
  await key('Escape');
  check('cancellation Escape returns focus', await ev(`!document.querySelector('[role=dialog]')&&document.activeElement.textContent==='Cancel appointment'`));
  await clickText('Cancel appointment'); await click('[role=dialog] .ui-button--danger'); await delay(150);
  check('mock cancellation updates the appointment status', await ev(`!document.querySelector('[role=dialog]')&&document.querySelector('.status-badge').textContent==='Cancelled'`));
  appointmentStatus = 'CONFIRMED';
  await nav('/patient/appointments/appointment-fixture/reschedule');
  await click('.patient-main fieldset button');
  const nextDate = '2026-12-02';
  await fill('input[type=date]', nextDate);
  check('reschedule clears the previous time selection', await ev(`document.querySelector('.patient-main form>button').disabled`));
  await delay(100); await click('.patient-main fieldset button');
  await ev(`document.querySelector('.patient-main form').requestSubmit()`); await delay(250);
  check('mock reschedule returns to appointment details', await ev(`location.pathname==='/patient/appointments/appointment-fixture'`));

  for (const lang of ['ar', 'en']) {
    await nav('/patient/records'); await language(lang); await click('.medical-record-card'); await delay(100);
    check(`record detail dialog loads (${lang})`, await ev(`!!document.querySelector('[role=dialog] .medical-record-details')`));
    check(`record detail preserves numeric zero (${lang})`, await ev(`document.querySelector('[role=dialog]').textContent.includes('0 – 100')`));
    await shotCurrent(`record-dialog-390-${lang}`);
    await key('Tab');
    check(`dialog keyboard focus remains inside (${lang})`, await ev(`!!document.activeElement.closest('[role=dialog]')`));
    await key('Escape');
    check(`record dialog restores opener focus (${lang})`, await ev(`!!document.activeElement.closest('.medical-record-card')`));
  }
  scenario = 'slow';
  await nav('/patient/records'); await delay(1900); await click('.medical-record-card'); await key('Escape'); await delay(1900);
  check('closing a loading record prevents a late reopen', await ev(`!document.querySelector('[role=dialog]')`));

  scenario = 'normal';
  for (const lang of ['ar', 'en']) {
    await size(lang === 'ar' ? 360 : 1366); await nav('/patient/profile'); await language(lang); await shotCurrent(`profile-full-${lang}`, true);
  }
  await size(390); await nav('/patient/profile'); await language('en');
  await clickText('Change Email');
  await fill('input[type=email]', 'updated@example.test');
  await fill('.patient-profile section:nth-child(2) form:nth-of-type(1) input[type=password]', '');
  check('email change has labeled email and password fields', await ev(`!!document.querySelector('input[type=email]').labels.length&&[...document.querySelectorAll('input[type=password]')].every(e=>e.labels.length)`));
  await shotCurrent('profile-email-change-390-en', true);
  // Identify the email form by its email input rather than relying on section order.
  await ev(`(()=>{const f=document.querySelector('input[type=email]').form;const e=f.querySelector('input[type=password]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'SyntheticPass123!');e.dispatchEvent(new Event('input',{bubbles:true}))})()`); await delay(50);
  await ev(`document.querySelector('input[type=email]').form.requestSubmit()`); await delay(100);
  check('email change reaches verification-code step', await ev(`!!document.querySelector('input[inputmode=numeric]')`));
  await fill('input[inputmode=numeric]', '123456');
  await ev(`sessionStorage.setItem('audit-logged-out','true');document.querySelector('input[inputmode=numeric]').form.requestSubmit()`); await delay(300);
  check('mock email change requires a new sign-in', await ev(`location.pathname==='/patient-login'&&!sessionStorage.getItem('cms_patient_token')`));
  await ev(`sessionStorage.removeItem('audit-logged-out')`);
  await nav('/patient/profile'); await language('en');
  await clickText('Change Phone');
  check('phone change opens its authorization form', await ev(`document.querySelectorAll('.patient-profile form').length>=3`));
  await shotCurrent('profile-phone-change-390-en', true);
  await fill('input[type=tel]', '+249912345679'); await ev(`document.querySelector('input[type=tel]').form.requestSubmit()`); await delay(100);
  check('phone change requests authorization from verified email', await ev(`!!document.querySelector('input[inputmode=numeric]')`));
  await fill('input[inputmode=numeric]', '123456');
  await ev(`sessionStorage.setItem('audit-logged-out','true');document.querySelector('input[inputmode=numeric]').form.requestSubmit()`); await delay(300);
  check('mock phone change requires a new sign-in', await ev(`location.pathname==='/patient-login'&&!sessionStorage.getItem('cms_patient_token')`));
  await ev(`sessionStorage.removeItem('audit-logged-out')`);
  await nav('/patient/profile'); await language('en'); await clickText('Disconnect');
  check('Google unlink requires current password', await ev(`!!document.querySelector('#linked-accounts-section input[autocomplete=current-password]')`));
  await shotCurrent('profile-google-unlink-390-en', true);
  await fill('#linked-accounts-section input[type=password]', 'SyntheticPass123!'); scenario = 'action-error';
  await ev(`document.querySelector('#linked-accounts-section form').requestSubmit()`); await delay(100);
  check('reauthentication failure is visible and preserves the session', await ev(`!!document.querySelector('#linked-accounts-section [role=alert]')&&!!sessionStorage.getItem('cms_patient_token')`));
  scenario = 'normal'; await ev(`document.querySelector('#linked-accounts-section form').requestSubmit()`); await delay(150);
  check('mock Google unlink refreshes linked-account state', await ev(`document.querySelector('#linked-accounts-section').textContent.includes('Not connected')`));
  await clickText('Connect Google'); await shotCurrent('profile-google-connect-390-en', true);
  googleLinked = true;

  await nav('/forgot-password'); await language('en'); await fill('input[type=email]', 'recovery@example.test');
  await ev(`document.querySelector('main form, .patient-auth form').requestSubmit()`); await delay(100);
  check('recovery reaches code and password step', await ev(`document.querySelectorAll('input[type=password]').length>=1`));
  await shotCurrent('recovery-code-390-en', true);
  await nav('/patient-login'); await language('en');
  await fill('.patient-auth-identifier', 'pending@example.test'); await fill('input[type=password]', 'SyntheticPass123!'); scenario = 'pending-login';
  await ev(`document.querySelector('.patient-auth form').requestSubmit()`); await delay(100);
  check('unverified login offers a verification recovery action', await ev(`!!document.querySelector('.patient-auth form>button[type=button]')`));
  scenario = 'normal'; await click('.patient-auth form>button[type=button]');
  check('unverified login reaches its code-entry page', await ev(`!!document.querySelector('input[inputmode=numeric]')`));
  await shotCurrent('login-verification-390-en', true); await language('ar'); await shotCurrent('login-verification-390-ar', true);

  await nav('/register'); await language('en');
  await clickText('Next');
  check('registration validates required names before advancing', await ev(`document.querySelectorAll('input[aria-invalid=true]').length>0`));
  // Exercise the real seven-step form against mocked registration/verification APIs.
  for (const [step, values] of [[0,['أحمد','محمد','علي','النور']],[1,['Ahmed','Mohamed','Ali','Alnour']]]) {
    // Inputs are nested in labels, so address them by stable DOM order.
    for (let index=0;index<values.length;index++) {
      await ev(`(()=>{const e=document.querySelectorAll('.onboarding-step-panel input')[${index}];Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(values[index])});e.dispatchEvent(new Event('input',{bubbles:true}))})()`); await delay(25);
    }
    void step;
    await clickText('Next');
  }
  await fill('.onboarding-step-panel input[type=date]', '1990-01-02');
  await fill('.onboarding-step-panel select', 'MALE'); await clickText('Next');
  await fill('.onboarding-step-panel input[type=tel]', '+249912345678'); await fill('.onboarding-step-panel input[type=email]', 'onboarding@example.test'); await clickText('Next');
  await shotCurrent('registration-address-step-390-en', true); await clickText('Next');
  const passwords = ['SyntheticPass123!', 'SyntheticPass123!'];
  for(let index=0;index<2;index++){ await ev(`(()=>{const e=document.querySelectorAll('.onboarding-step-panel input[type=password]')[${index}];Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(passwords[index])});e.dispatchEvent(new Event('input',{bubbles:true}))})()`); await delay(30); }
  await clickText('Next'); await shotCurrent('registration-review-390-en', true);
  await ev(`document.querySelector('.patient-onboarding form, form.onboarding-form, .patient-auth form').requestSubmit()`); await delay(150);
  check('registration reaches verification step', await ev(`!!document.querySelector('input[inputmode=numeric]')`));
  await shotCurrent('registration-verification-390-en', true);
  check('registration resend cooldown starts disabled', await ev(`document.querySelector('.onboarding-resend-button').disabled`));
  await fill('.onboarding-verification input', '123456'); await ev(`document.querySelector('.onboarding-verification').requestSubmit()`); await delay(150);
  check('mock email verification reaches the registration success screen', await ev(`!!document.querySelector('.onboarding-success')`));
  await shotCurrent('registration-success-390-en', true);

  await ev(`sessionStorage.setItem('audit-logged-out','true');sessionStorage.removeItem('cms_patient_user');sessionStorage.removeItem('cms_patient_token')`);
  await nav('/patient/records');
  check('direct protected route redirects anonymous users', await ev(`location.pathname==='/patient-login'`));
  await ev(`sessionStorage.setItem('cms_patient_user',JSON.stringify({id:'unlinked-fixture',role:'PATIENT',patientLinked:false}));sessionStorage.setItem('cms_patient_token','audit-fixture-only')`);
  await nav('/patient/records');
  check('unlinked accounts remain restricted to claim', await ev(`location.pathname==='/patient/claim'`));
  await shotCurrent('claim-unlinked-390-en', true);
  await ev(`sessionStorage.removeItem('audit-logged-out')`); await nav('/patient'); await language('en');
  await ev(`sessionStorage.setItem('audit-logged-out','true')`); await click('.patient-header button[aria-label="Sign out"], .patient-header button[aria-label="Logout"], .patient-header button[aria-label="Log out"]');
  await delay(150);
  check('logout clears the local session and redirects', await ev(`location.pathname==='/patient-login'&&!sessionStorage.getItem('cms_patient_token')`));
  await ev(`sessionStorage.removeItem('audit-logged-out')`);
}
async function negativeChecks() {
  for (const state of ['error','slow','not-found']) {
    scenario = state;
    for (const [name,route] of [['doctor','/patient/doctors/doctor-fixture'],['appointment','/patient/appointments/appointment-fixture'],['reschedule','/patient/appointments/appointment-fixture/reschedule']]) {
      for(const lang of ['ar','en']) {
        await capture(`${state}-${name}-390-${lang}`,route,390,lang,lang==='ar'?'light':'dark');
        check(`${state} ${name} presents an appropriate state (${lang})`, await ev(state==='slow' ? `!!document.querySelector('[role=status]')` : `!!document.querySelector('.error-state,.empty-state,[role=alert]')`));
      }
    }
  }
  scenario = 'normal'; await nav('/patient/book/doctor-fixture'); await language('ar');
  scenario = 'slots-error'; await click('.date-chip'); await delay(100);
  check('booking availability failure is announced and cannot be submitted',await ev(`!!document.querySelector('[role=alert]')&&document.querySelector('.patient-main form>button').disabled`));
  await shotCurrent('booking-availability-error-390-ar',true);
  scenario = 'normal'; await nav('/patient/profile'); await language('en');
  scenario = 'error'; await ev(`document.querySelector('.patient-profile section:first-child form').requestSubmit()`); await delay(100);
  check('profile save failure is shown without leaving the form',await ev(`!!document.querySelector('.patient-profile [role=alert]')&&!!document.querySelector('.patient-profile form')`));
  await shotCurrent('profile-save-error-390-en',true);
  scenario = 'normal'; await nav('/forgot-password'); await language('en'); await fill('input[type=email]','recovery@example.test');
  scenario = 'error'; await ev(`document.querySelector('.patient-auth form').requestSubmit()`); await delay(100);
  check('password recovery API failure is visible',await ev(`!!document.querySelector('[role=alert]')`));
  await shotCurrent('recovery-api-error-390-en',true);
  scenario = 'legacy-unlinked'; await nav('/patient');
  check('legacy unlinked sessions retain a path to record claim',await ev(`!!document.querySelector('.patient-main a[href="/patient/claim"]')`));
  await shotCurrent('legacy-record-claim-recovery-390-en',true);
  check('negative-state views do not overflow',report.pages.every(p=>p.scrollWidth<=p.width));
  if(report.checks.some(c=>!c.passed))process.exitCode=1;
}
const routes = [['dashboard','/patient'],['doctors','/patient/doctors'],['doctor','/patient/doctors/doctor-fixture'],['booking','/patient/book/doctor-fixture'],['appointments','/patient/appointments'],['appointment','/patient/appointments/appointment-fixture'],['reschedule','/patient/appointments/appointment-fixture/reschedule'],['records','/patient/records'],['labs','/patient/lab-results'],['prescriptions','/patient/prescriptions'],['profile','/patient/profile'],['login','/patient-login'],['register','/register'],['recovery','/forgot-password'],['claim','/patient/claim']];
try {
  await nav('/patient');
  if (process.argv.includes('--dashboard-edge')) {
    for (const nextScenario of ['structured-name', 'missing-name', 'long-token']) {
      scenario = nextScenario;
      for (const width of [360, 1366]) for (const lang of ['ar', 'en']) for (const mode of ['light', 'dark']) {
        const name = `dashboard-${scenario}-${width}-${lang}-${mode}`;
        const metrics = await capture(name, '/patient', width, lang, mode);
        const heading = metrics.h1[0]?.text || '';
        if (scenario === 'structured-name') check(`structured first name ${name}`, lang === 'ar' ? heading.endsWith('، تاج') : heading.endsWith(', Tag'));
        if (scenario === 'missing-name') check(`generic greeting ${name}`, /^(Good morning|Good evening|صباح الخير|مساء الخير)$/.test(heading));
        check(`compact safe greeting ${name}`, metrics.heroHeight < 300 && metrics.scrollWidth <= width);
      }
    }
    await size(390); await nav('/patient'); await language('en');
    await click('.patient-dashboard__booking a');
    check('primary booking action opens the doctors directory', await ev(`location.pathname === '/patient/doctors'`));
    await nav('/patient');
    await click('.health-summary-card[href="/patient/lab-results"]');
    check('lab summary opens released results', await ev(`location.pathname === '/patient/lab-results'`));
    await nav('/patient'); await key('Tab');
    check('dashboard keyboard focus remains visible', await ev(`getComputedStyle(document.activeElement).outlineStyle === 'solid'`));
    check('edge checks never reach backend or mutate data', report.unmatchedApi.length === 0 && report.mutations.length === 0);
    check('no browser exceptions in edge cases', report.consoleErrors.length === 0);
    if(report.checks.some(c=>!c.passed))process.exitCode=1;
  } else if (process.argv.includes('--dashboard')) {
    for (const nextScenario of ['normal', 'empty', 'long']) {
      scenario = nextScenario;
      for (const width of [360, 390, 768, 1024, 1366, 1600]) for (const lang of ['ar', 'en']) for (const mode of ['light', 'dark']) {
        const name = `dashboard-${scenario}-${width}-${lang}-${mode}`;
        const metrics = await capture(name, '/patient', width, lang, mode);
        check(`first-name-only greeting ${name}`, metrics.h1.length === 1 && !/Mohamed|محمد|عبد/.test(metrics.h1[0].text) && (lang === 'ar' ? metrics.h1[0].text.endsWith('، أحمد') : metrics.h1[0].text.endsWith(', Ahmed')));
        check(`compact greeting ${name}`, metrics.heroHeight < 300);
        check(`theme and direction ${name}`, metrics.theme === mode && metrics.dir === (lang === 'ar' ? 'rtl' : 'ltr'));
        const details = await ev(`(()=>{const button=document.querySelector('.patient-dashboard__booking .MuiButton-root');const styles=getComputedStyle(button);return{disabled:button.disabled===true,href:button.getAttribute('href'),summaries:document.querySelectorAll('.health-summary-card').length,activity:document.querySelectorAll('.patient-dashboard__activity').length,color:styles.color,background:styles.backgroundColor,bookingHelp:!!document.getElementById('dashboard-booking-status')}})()`);
        check(`four meaningful summaries ${name}`, details.summaries === 4);
        if (scenario === 'empty') check(`no dead booking or fake activity ${name}`, details.disabled && details.bookingHelp && details.activity === 0);
        else check(`booking and recent activity ${name}`, details.href === '/patient/doctors' && details.activity === 2);
        if (!details.disabled) check(`booking contrast ${name}`, contrast(details.color, details.background) >= 4.5);
      }
    }
    for (const nextScenario of ['slow', 'error', 'partial-error']) for (const lang of ['ar', 'en']) {
      scenario = nextScenario;
      await capture(`dashboard-${scenario}-390-${lang}`, '/patient', 390, lang, lang === 'ar' ? 'light' : 'dark');
    }
    check('no dashboard horizontal overflow', report.pages.every(p=>p.scrollWidth<=p.width));
    check('no dashboard browser exceptions', report.consoleErrors.length===0);
    check('only fixture API responses', report.unmatchedApi.length===0 && report.mutations.length===0);
    if(report.checks.some(c=>!c.passed))process.exitCode=1;
  } else if (process.argv.includes('--failures')) {
    await negativeChecks();
  } else if (process.argv.includes('--revisit')) {
    for (const [name, route] of routes.filter(([name]) => (process.argv.includes('--auth-only') ? ['login', 'register', 'recovery', 'claim'] : ['login', 'register', 'labs', 'records', 'appointment']).includes(name))) for (const [width,lang,mode] of [[360,'ar','light'],[390,'en','dark'],[768,'ar','dark'],[1024,'en','light'],[1366,'ar','light'],[1600,'en','dark']]) await capture(`${name}-${width}-${lang}-${mode}`,route,width,lang,mode);
    check('no overflow on revisited pages', report.pages.every(p=>p.scrollWidth<=p.width));
    if (report.checks.some(c=>!c.passed)) process.exitCode=1;
  } else if (process.argv.includes('--functional')) {
    await functionalChecks();
    if (report.checks.some(c=>!c.passed)) process.exitCode=1;
  } else if (process.argv.includes('--baseline')) {
    for (const [name, route] of routes) for (const [width,lang,mode] of [[1366,'ar','light'],[390,'en','dark']]) await capture(`before-${name}-${width}-${lang}`,route,width,lang,mode);
  } else {
    for (const [name, route] of routes) for (const [width,lang,mode] of [[360,'ar','light'],[390,'en','dark'],[768,'ar','dark'],[1024,'en','light'],[1366,'ar','light'],[1600,'en','dark']]) await capture(`${name}-${width}-${lang}-${mode}`,route,width,lang,mode);
    for (const nextScenario of ['empty', 'error', 'slow', 'long', 'partial-error']) {
      scenario = nextScenario;
      const selected = nextScenario === 'long' ? routes.filter(([name])=>['dashboard','profile'].includes(name)) : nextScenario === 'partial-error' ? routes.slice(0,1) : routes.filter(([name])=>['dashboard','doctors','appointments','records','labs','prescriptions','profile'].includes(name));
      for (const [name, route] of selected) for (const lang of ['ar','en']) await capture(`${nextScenario}-${name}-390-${lang}`,route,390,lang,lang==='ar'?'light':'dark');
    }
    await functionalChecks();
    check('no horizontal overflow across the responsive matrix', report.pages.every(p=>p.scrollWidth<=p.width));
    check('all visible inputs have accessible names', report.pages.every(p=>p.unlabelledInputs.length===0));
    check('no unhandled browser exceptions', report.consoleErrors.length===0);
    check('all API calls were handled by fixtures', report.unmatchedApi.length===0);
    if(report.checks.some(c=>!c.passed)) process.exitCode=1;
  }
} finally {
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ captures: report.pages.length, checks: report.checks.length, failedChecks: report.checks.filter(c=>!c.passed), overflows: report.pages.filter(p=>p.scrollWidth>p.width).map(p=>p.name), unlabelledInputs: report.pages.filter(p=>p.unlabelledInputs.length).map(p=>({name:p.name,inputs:p.unlabelledInputs})), consoleErrors: report.consoleErrors, unmatchedApi: report.unmatchedApi, output }));
  socket.close();
}
