import fs from 'fs';
import path from 'path';

const origin = process.env.QA_FRONTEND_URL || 'http://localhost:5173';
const cdpOrigin = process.env.QA_CDP_URL || 'http://127.0.0.1:9222';
const outputDir = path.resolve(process.cwd(), '..', 'qa-evidence');
if (!origin.startsWith('http://localhost:')) throw new Error('Browser QA only accepts the configured localhost development origin.');
if (!process.env.QA_PASSWORD) throw new Error('QA_PASSWORD is required.');
fs.mkdirSync(outputDir, { recursive: true });

class Cdp {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
  }
  async open() {
    await new Promise((resolve, reject) => { this.socket.onopen = resolve; this.socket.onerror = reject; });
    this.socket.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (pending) {
          this.pending.delete(message.id);
          if (message.error) pending.reject(new Error(message.error.message));
          else pending.resolve(message.result);
        }
      } else this.events.push(message);
    };
  }
  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.socket.send(JSON.stringify({ id, method, params })); });
  }
  close() { this.socket.close(); }
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const target = await (await fetch(`${cdpOrigin}/json/new?${encodeURIComponent(`${origin}/staff`)}`, { method: 'PUT' })).json();
const cdp = new Cdp(target.webSocketDebuggerUrl);
await cdp.open();
await Promise.all([cdp.send('Page.enable'), cdp.send('Runtime.enable'), cdp.send('Network.enable'), cdp.send('Log.enable')]);

const report = { screenshots: [], pages: [], consoleErrors: [], failedRequests: [], corsErrors: [], duplicateMutations: [], keyboard: [] };
const mutationCounts = new Map();

async function evaluate(expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Browser evaluation failed.');
  return result.result.value;
}
async function viewport(width, height) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
}
async function navigate(url) {
  await cdp.send('Page.navigate', { url });
  await delay(1400);
}
async function authenticate(username, destination = '/staff') {
  const result = await evaluate(`(async()=>{const r=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:${JSON.stringify(username)},password:${JSON.stringify(process.env.QA_PASSWORD)}})});const d=await r.json();if(!r.ok)throw new Error('login '+r.status);localStorage.setItem('cms_user',JSON.stringify(d.user));localStorage.setItem('cms_token',d.token);return {role:d.user.role,status:r.status}})()`);
  await navigate(`${origin}${destination}`);
  return result;
}
async function clickText(texts) {
  const found = await evaluate(`(()=>{const labels=${JSON.stringify(texts)};const el=[...document.querySelectorAll('button,a,[role=button],li,.queue-card-item')].find(node=>labels.some(label=>(node.textContent||'').includes(label)));if(!el)return false;el.click();return true})()`);
  await delay(900);
  return found;
}
async function clickQueueItem(texts, statuses) {
  const found = await evaluate(`(()=>{const labels=${JSON.stringify(texts)};const states=${JSON.stringify(statuses)};const el=[...document.querySelectorAll('.queue-card-item')].find(node=>labels.some(label=>(node.textContent||'').includes(label))&&states.some(state=>(node.textContent||'').includes(state)));if(!el)return false;el.click();return true})()`);
  await delay(900);
  return found;
}
async function setInput(selector, value) {
  const changed = await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)return false;const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
  await delay(700);
  return changed;
}
async function shot(name, width, height) {
  await viewport(width, height);
  await delay(400);
  const layout = await evaluate(`({url:location.pathname,width:innerWidth,scrollWidth:document.documentElement.scrollWidth,dir:document.documentElement.dir,title:document.title,active:document.activeElement?.tagName})`);
  const capture = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const file = path.join(outputDir, `${name}.png`);
  fs.writeFileSync(file, Buffer.from(capture.data, 'base64'));
  report.screenshots.push({ name, file, width, height, layout });
  report.pages.push({ name, ...layout, overflow: layout.scrollWidth > layout.width });
}
async function toggleToEnglish() {
  const dir = await evaluate('document.documentElement.dir');
  if (dir === 'rtl') await clickText(['English']);
}
async function keyboardProbe(label) {
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab' });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab' });
  const focused = await evaluate(`({tag:document.activeElement?.tagName,text:(document.activeElement?.textContent||'').trim().slice(0,80),label:document.activeElement?.getAttribute('aria-label'),outline:getComputedStyle(document.activeElement).outlineStyle})`);
  report.keyboard.push({ label, focused });
}

await navigate(`${origin}/patient-login`);
await shot('reference-patient-login-mobile', 390, 844);
await navigate(`${origin}/register`);
await shot('reference-patient-registration-mobile', 390, 844);

await authenticate('qa-reception@example.test');
await clickText(['د. اختبار سير العمل', 'Dr. QA Workflow']);
await shot('reception-checked-in-desktop-ar', 1366, 900);
await toggleToEnglish();
await clickText(['Billing']);
await setInput('input[placeholder*="Search patient"]', 'QA Workflow');
await clickText(['QA Workflow Patient']);
await clickText(['General Medicine Consultation']);
await keyboardProbe('Reception billing');
await shot('reception-billing-populated-mobile-en', 390, 844);

await authenticate('qa-doctor@example.test');
await clickQueueItem(['مريض اختبار سير العمل', 'QA Workflow Patient'], ['انتظار', 'Waiting', 'CHECKED_IN']);
await keyboardProbe('Doctor consultation');
await shot('doctor-consultation-tablet-ar', 768, 1024);
await toggleToEnglish();
await shot('doctor-clinical-history-desktop-en', 1366, 900);

await authenticate('qa-lab@example.test');
await clickText(['مريض اختبار سير العمل', 'QA Workflow Patient']);
const labInputs = await evaluate(`(()=>{const inputs=[...document.querySelectorAll('input[placeholder^="Result value"]')];inputs.forEach((el,i)=>{const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(el,i?'14.2':'13.4');el.dispatchEvent(new Event('input',{bubbles:true}))});return inputs.length})()`);
await keyboardProbe('Laboratory result entry');
await shot('laboratory-independent-results-mobile-ar', 390, 844);
await toggleToEnglish();
await shot('laboratory-queue-desktop-en', 1366, 900);
report.labIndependentInputCount = labInputs;

await authenticate('qa-pharmacy@example.test');
await clickText(['مريض اختبار سير العمل', 'QA Workflow Patient']);
await keyboardProbe('Pharmacy dispensing');
await shot('pharmacy-dispensing-mobile-ar', 430, 900);
await toggleToEnglish();
await shot('pharmacy-queue-desktop-en', 1366, 900);

await authenticate('qa-admin@example.test');
await clickText(['حسابات الموظفين', 'Staff Accounts']);
await keyboardProbe('Admin staff management');
await shot('admin-staff-management-mobile-ar', 390, 844);
await toggleToEnglish();
await shot('admin-staff-management-desktop-en', 1440, 1000);
await clickText(['Reports & Analytics', 'التقارير والتحليلات']);
await shot('reference-admin-analytics-desktop', 1440, 1000);

await authenticate('qa-patient@example.test', '/patient/appointments');
await shot('patient-completed-appointment-mobile', 390, 844);
await navigate(`${origin}/patient`);
await shot('reference-patient-dashboard-mobile', 390, 844);
await shot('reference-patient-dashboard-360', 360, 800);
await shot('reference-patient-dashboard-desktop', 1366, 900);
await navigate(`${origin}/patient/doctors`);
await shot('reference-doctor-directory-mobile', 390, 844);
await clickText(['Details', 'التفاصيل']);
await shot('reference-doctor-details-mobile', 390, 844);
await clickText(['Book appointment', 'حجز موعد طبي جديد']);
await shot('reference-booking-mobile', 390, 844);
await navigate(`${origin}/patient/lab-results`);
await shot('patient-released-lab-result-mobile', 390, 844);
await navigate(`${origin}/patient/prescriptions`);
await shot('patient-filled-prescription-desktop', 1366, 900);
await navigate(`${origin}/patient/records`);
await shot('patient-final-medical-record-desktop', 1440, 1000);

for (const event of cdp.events) {
  if (event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error') {
    const message = event.params.args.map((arg) => arg.value || arg.description || '').join(' ');
    report.consoleErrors.push(message);
    if (/cors/i.test(message)) report.corsErrors.push(message);
  }
  if (event.method === 'Runtime.exceptionThrown') report.consoleErrors.push(event.params.exceptionDetails?.text || 'Uncaught exception');
  if (event.method === 'Network.responseReceived') {
    const { status, url } = event.params.response;
    if (status >= 400 && url.includes('/api/')) report.failedRequests.push({ status, url });
  }
  if (event.method === 'Network.requestWillBeSent') {
    const { method, url, postData = '' } = event.params.request;
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && url.includes('/api/') && !url.endsWith('/auth/login')) {
      const key = `${method} ${url} ${postData}`;
      mutationCounts.set(key, (mutationCounts.get(key) || 0) + 1);
    }
  }
}
report.duplicateMutations = [...mutationCounts.entries()].filter(([, count]) => count > 1).map(([request, count]) => ({ request, count }));
fs.writeFileSync(path.join(outputDir, 'browser-qa-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
cdp.close();
