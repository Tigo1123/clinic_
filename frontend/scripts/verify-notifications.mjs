import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

// Run after backend/scripts/qa-notifications.mjs and local Vite. Never accepts
// remote API URLs or an operational database, and never prints session tokens.
const fixture = JSON.parse(fs.readFileSync(process.env.NOTIFICATION_QA_FIXTURE || '/tmp/clinic-notifications-browser-fixture.json'));
const origin = 'http://127.0.0.1:5187'; const api = 'http://127.0.0.1:55438';
const dbUrl = new URL(fixture.databaseUrl);
assert.equal(dbUrl.hostname, '127.0.0.1'); assert.equal(dbUrl.pathname, '/clinic_test'); assert.match(fixture.schema, /^test_notifications_browser_\d+$/);
const require = createRequire(new URL('../../backend/package.json', import.meta.url));
const { Client } = require('pg'); const db = new Client({ connectionString: fixture.databaseUrl }); await db.connect();
// Approval/inspection pauses may exceed the normal access-token lifetime.
// Mint fresh, normally expiring tokens for these guarded synthetic identities;
// the real API and socket still validate their DB role/status/authVersion.
const jwt = require('jsonwebtoken');
Object.assign(process.env, { NODE_ENV: 'test', DATABASE_URL: fixture.databaseUrl, JWT_SECRET: 'isolated-notification-browser-jwt-not-for-deployment' });
const { signAccessToken } = await import('../../backend/src/services/accessTokens.js');
for (const session of Object.values(fixture.sessions)) {
  const row = (await db.query('SELECT id,username,role,status,"authVersion" FROM "User" WHERE id=$1', [session.user.id])).rows[0];
  assert.equal(row.status, 'ACTIVE'); assert.equal(row.role, session.user.role);
  const previous = jwt.decode(session.token);
  process.env.JWT_ISSUER = previous.iss; process.env.JWT_AUDIENCE = previous.aud;
  session.token = signAccessToken({ ...row, doctorId: session.user.doctorId });
}
const output = '/tmp/clinic-notifications-browser'; fs.mkdirSync(output, { recursive: true });
const report = { checks: [], frames: [], exceptions: [], schema: fixture.schema, headed: true, devtoolsOpen: false };
const check = (name, value) => { report.checks.push({ name, passed: !!value }); assert.ok(value, name); };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(read, name) { for (let i = 0; i < 200; i++) { const result = await read(); if (result) return result; await delay(50); } throw Error(`Timed out: ${name}`); }
class Cdp {
  constructor(url) { this.url = url; this.pending = new Map(); this.next = 0; }
  async open() {
    this.ws = new WebSocket(this.url); await new Promise((resolve, reject) => { this.ws.onopen = resolve; this.ws.onerror = reject; });
    this.ws.onmessage = ({ data }) => {
      const event = JSON.parse(data);
      if (event.id) {
        const task = this.pending.get(event.id); if (!task) return;
        clearTimeout(task.timer); this.pending.delete(event.id);
        if (event.error) task.reject(Error(event.error.message));
        else task.resolve(event.result);
      }
      else this.onEvent?.(event);
    }; return this;
  }
  send(method, params = {}) { return new Promise((resolve, reject) => { const id = ++this.next; const timer = setTimeout(() => reject(Error(`CDP timeout: ${method}`)), 15000); this.pending.set(id, { resolve, reject, timer }); this.ws.send(JSON.stringify({ id, method, params })); }); }
  async ev(expression) { const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result.value; }
  close() { this.ws.close(); }
}
const chromeLog = fs.openSync(`${output}/chrome.log`, 'w');
const chrome = spawn('/opt/google/chrome/chrome', ['--no-sandbox', '--disable-gpu', '--ozone-platform=x11', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=9338', `--user-data-dir=/tmp/clinic-notification-chrome-${process.pid}`, '--window-size=1500,1000', 'about:blank'], { stdio: ['ignore', chromeLog, chromeLog] });
const pages = new Map(); let browser;
async function action(role, path, body, method = 'POST') {
  const response = await fetch(`${api}${path}`, { method, headers: { Authorization: `Bearer ${fixture.sessions[role].token}`, 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify(body) });
  const value = await response.json(); assert.ok(response.ok, `${method} ${path}: ${response.status} ${JSON.stringify(value.error)}`); return value;
}
const count = async role => pages.get(role).ev("Number(document.querySelector('.notification-bell').getAttribute('aria-label').match(/\\((\\d+)\\)/)[1])");
const bellContains = async (role, text) => pages.get(role).ev(`document.querySelector('.notification-list')?.textContent.includes(${JSON.stringify(text)})`);
async function screenshot(role, name) { const result = await pages.get(role).send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(`${output}/${name}.png`, Buffer.from(result.data, 'base64')); }
try {
  const version = await until(async () => { try { return (await fetch('http://127.0.0.1:9338/json/version')).json(); } catch { return false; } }, 'headed Chrome');
  browser = await new Cdp(version.webSocketDebuggerUrl).open();
  for (const role of ['ADMIN', 'RECEPTIONIST', 'DOCTOR', 'PHARMACIST', 'LAB_TECH', 'OTHER_DOCTOR']) {
    const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank', newWindow: true });
    const page = await new Cdp(`ws://127.0.0.1:9338/devtools/page/${targetId}`).open(); pages.set(role, page);
    await page.send('Runtime.enable'); await page.send('Page.enable'); await page.send('Network.enable');
    page.onEvent = event => {
      if (event.method === 'Runtime.exceptionThrown') report.exceptions.push({ role, description: event.params.exceptionDetails.text });
      if (event.method === 'Network.webSocketFrameReceived') {
        const data = event.params.response.payloadData;
        if (!data.startsWith('42')) return;
        try { const [name, payload] = JSON.parse(data.slice(2)); if (['notification', 'notifications:changed', 'workflowUpdated'].includes(name)) report.frames.push({ role, event: name, keys: Object.keys(payload), ...(payload.topic ? { topic: payload.topic } : {}) }); } catch { /* Other transport frame. */ }
      }
    };
    const session = fixture.sessions[role];
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `sessionStorage.setItem('cms_staff_user',${JSON.stringify(JSON.stringify(session.user))}); sessionStorage.setItem('cms_staff_token',${JSON.stringify(session.token)}); localStorage.setItem('shifa_language','en'); localStorage.setItem('alshifa_theme','dark');` });
    await page.send('Page.navigate', { url: `${origin}/staff` });
    await until(() => page.ev("!!document.querySelector('.notification-bell')"), `${role} dashboard`);
    await until(() => page.ev("import('/src/services/staffSocket.js').then(m=>m.staffSocket.connected)"), `${role} authenticated socket`);
    await page.ev("document.querySelector('.notification-bell').click()");
    await until(() => page.ev("!document.querySelector('.notification-panel [role=status]')"), 'notification initial read');
    check(`${role} starts with an empty durable feed`, await count(role) === 0);
  }
  check('DevTools is closed', !(await browser.send('Target.getTargets')).targetInfos.some(t => t.url.startsWith('devtools://')));
  const doctorBefore = await count('DOCTOR'); const pharmacyBefore = await count('PHARMACIST');
  await action('RECEPTIONIST', `/api/appointments/${fixture.appointmentId}/status`, { status: 'CHECKED_IN' }, 'PUT');
  await until(() => bellContains('DOCTOR', 'Patient checked in'), 'Doctor live check-in');
  check('Reception action updates the Doctor bell without focus or reload', await count('DOCTOR') > doctorBefore);
  check('Check-in is isolated from Pharmacy and unrelated doctors', await count('PHARMACIST') === pharmacyBefore && await count('OTHER_DOCTOR') === 0);
  await pages.get('PHARMACIST').ev("document.querySelector('.notification-close').click(); document.querySelector('[aria-controls=pharmacy-section-inventory]').click()");
  const unique = `Notification medicine ${Date.now()}`;
  const created = await action('PHARMACIST', '/api/pharmacy/formulary', { brandName: unique, labelAr: 'دواء اختبار الإشعارات', labelEn: unique, genericName: unique, strength: '1mg', dosageForm: 'Tablet', initialBatch: { batchNumber: 'QA', expiryDate: '2099-01-01', qtyOnHand: 50, minReorderLevel: 2 } });
  const medicineId = created.medicine.id;
  await until(() => bellContains('ADMIN', 'Medicine pricing or activation required'), 'Admin pricing notice');
  await until(() => pages.get('PHARMACIST').ev(`document.querySelector('.pharmacy-inventory-table')?.textContent.includes(${JSON.stringify(unique)})`), 'live inventory creation');
  await action('ADMIN', `/api/admin/pricing/medicines/${medicineId}`, { priceSdg: 100, status: 'ACTIVE' }, 'PATCH');
  await until(() => pages.get('PHARMACIST').ev(`(()=>{const row=[...document.querySelectorAll('.pharmacy-inventory-table tbody tr')].find(r=>r.textContent.includes(${JSON.stringify(unique)}));return row&&row.textContent.includes('100 SDG')&&!row.querySelector('.pharmacy-admin-note')})()`), 'Pharmacy authoritative pricing refresh');
  const saved = await db.query('SELECT "unitPriceSdg",status FROM "DrugFormulary" WHERE id=$1', [medicineId]);
  check('Admin pricing persists and refreshes Pharmacy without focus or reload', saved.rows[0].status === 'ACTIVE' && Number(saved.rows[0].unitPriceSdg) === 100);
  await action('DOCTOR', `/api/appointments/${fixture.appointmentId}/status`, { status: 'IN_CONSULTATION' }, 'PUT');
  const consultation = await action('DOCTOR', '/api/records', { patientId: fixture.patientId, appointmentId: fixture.appointmentId, diagnosis: 'Isolated notification test', prescribedDrugs: [{ drugId: medicineId, dosage: '1 daily', duration: '1 day', qtyPrescribed: 1 }], orderedServices: [fixture.serviceId] });
  await pages.get('PHARMACIST').ev("document.querySelector('.notification-bell').click()");
  await until(() => bellContains('PHARMACIST', 'New prescription for pharmacy'), 'Pharmacy live prescription');
  check('Doctor prescription appears live in Pharmacy', await count('PHARMACIST') > 0);
  const rx = consultation.data.prescription; const order = consultation.data.labOrder;
  await action('RECEPTIONIST', '/api/billing/invoice', { patientId: fixture.patientId, labOrderId: order.id, invoiceType: 'LABORATORY' });
  const labInvoice = (await db.query('SELECT id,"totalAmountSdg" FROM "Invoice" WHERE "labOrderId"=$1', [order.id])).rows[0];
  await action('RECEPTIONIST', `/api/billing/invoice/${labInvoice.id}/payments`, { payments: [{ amountSdg: Number(labInvoice.totalAmountSdg), paymentMethod: 'CASH' }] });
  await until(() => bellContains('LAB_TECH', 'Paid laboratory order ready'), 'Lab paid notice');
  await action('LAB_TECH', `/api/records/lab-orders/${order.id}/collect-sample`, {}, 'PUT');
  const labItem = (await db.query('SELECT id FROM "LabOrderItem" WHERE "labOrderId"=$1', [order.id])).rows[0];
  await action('LAB_TECH', `/api/records/lab-orders/items/${labItem.id}/results`, { expectedVersion: 0, resultValue: 'Synthetic result' }, 'PUT');
  await until(() => bellContains('DOCTOR', 'Laboratory results completed'), 'Doctor lab result notice');
  check('Paid lab and completed result reach Lab and assigned Doctor', await count('LAB_TECH') > 0 && await count('OTHER_DOCTOR') === 0);
  const invoice = (await db.query('SELECT id,"totalAmountSdg" FROM "Invoice" WHERE "prescriptionId"=$1', [rx.id])).rows[0];
  await action('PHARMACIST', `/api/billing/invoice/${invoice.id}/payments`, { payments: [{ amountSdg: Number(invoice.totalAmountSdg), paymentMethod: 'CASH' }] });
  const drug = (await db.query('SELECT id FROM "PrescribedDrug" WHERE "prescriptionId"=$1', [rx.id])).rows[0];
  await action('PHARMACIST', `/api/records/prescriptions/${rx.id}/dispense`, { items: [{ prescribedDrugId: drug.id, qtyToDispense: 1 }] });
  await until(() => bellContains('DOCTOR', 'Prescription updated'), 'Doctor dispensing update');
  check('Dispense committed and notified the assigned Doctor', (await db.query('SELECT status FROM "Prescription" WHERE id=$1', [rx.id])).rows[0].status === 'FILLED');
  const pharmacy = pages.get('PHARMACIST');
  const unreadAfterDispense = Number((await db.query('SELECT count(*) FROM "Notification" WHERE "userId"=$1 AND "isRead"=false', [fixture.sessions.PHARMACIST.user.id])).rows[0].count);
  await until(async () => await count('PHARMACIST') === unreadAfterDispense && await pharmacy.ev("!document.querySelector('.notification-panel [role=status]')"), 'latest Pharmacy notification snapshot');
  await pharmacy.ev("document.querySelector('.notification-read-all').click()");
  await until(async () => await count('PHARMACIST') === 0, 'read all authoritative count');
  check('Read-all persists in the database', Number((await db.query('SELECT count(*) FROM "Notification" WHERE "userId"=$1 AND "isRead"=false', [fixture.sessions.PHARMACIST.user.id])).rows[0].count) === 0);
  await pharmacy.ev("import('/src/services/staffSocket.js').then(m=>{m.staffSocket.disconnect();return true;})");
  await action('ADMIN', `/api/admin/pricing/medicines/${medicineId}`, { priceSdg: 200, status: 'ACTIVE' }, 'PATCH');
  await pharmacy.ev("import('/src/services/staffSocket.js').then(m=>{m.staffSocket.connect();return true;})");
  await until(async () => await count('PHARMACIST') > 0, 'offline recovery on reconnect');
  check('Reconnect recovers missed durable notifications', await bellContains('PHARMACIST', 'Medicine catalog updated'));
  for (const lang of ['en', 'ar']) for (const theme of ['light', 'dark']) for (const mobile of [false, true]) {
    await pharmacy.send('Emulation.setDeviceMetricsOverride', { width: mobile ? 390 : 1440, height: mobile ? 844 : 1000, deviceScaleFactor: 1, mobile });
    await pharmacy.ev(`import('/src/i18n.js').then(m=>{m.default.changeLanguage(${JSON.stringify(lang)});return true;})`);
    await pharmacy.ev(`if(document.documentElement.dataset.theme!==${JSON.stringify(theme)})document.querySelector('.theme-toggle-btn').click()`);
    await until(() => pharmacy.ev(`document.documentElement.dataset.theme===${JSON.stringify(theme)}`), 'application theme toggle');
    await until(() => pharmacy.ev(`document.querySelector('.notification-root').dir===${JSON.stringify(lang === 'ar' ? 'rtl' : 'ltr')}`), 'localized direction');
    const layout = await pharmacy.ev("(()=>{const e=document.querySelector('.notification-panel'),r=e.getBoundingClientRect();return {left:r.left,right:r.right,width:innerWidth,background:getComputedStyle(e).backgroundColor,rows:document.querySelectorAll('.notification-list li').length,text:e.textContent}})()");
    check(`${lang}/${theme}/${mobile ? 'mobile' : 'desktop'} panel fits and has localized content`, layout.left >= 0 && layout.right <= layout.width + 1 && layout.rows > 0 && layout.text.includes(lang === 'ar' ? 'تم تحديث دليل الأدوية' : 'Medicine catalog updated'));
    await screenshot('PHARMACIST', `${lang}-${theme}-${mobile ? 'mobile' : 'desktop'}`);
  }
  const beforeReload = await count('PHARMACIST'); await pharmacy.send('Page.reload');
  await until(() => pharmacy.ev("!!document.querySelector('.notification-bell')"), 'reload');
  await until(async () => await count('PHARMACIST') === beforeReload, 'durable unread after reload');
  check('Reload preserves unread count', await count('PHARMACIST') === beforeReload);
  check('Socket payloads contain no clinical records', report.frames.every(f => f.event === 'workflowUpdated' ? f.keys.join(',') === 'topic' : f.event === 'notification' ? f.keys.join(',') === 'id,type,title,message,createdAt,isRead' : f.keys.join(',') === 'id' || f.keys.length === 0));
  check('No browser exceptions', report.exceptions.length === 0);
} catch (error) { report.error = error.message; process.exitCode = 1; }
finally {
  fs.writeFileSync(`${output}/report.json`, JSON.stringify(report, null, 2));
  for (const page of pages.values()) page.close();
  if (browser) { await browser.send('Browser.close').catch(() => {}); browser.close(); }
  chrome.kill('SIGTERM'); await db.end();
  console.log(JSON.stringify({ checks: report.checks.length, passed: report.checks.filter(c => c.passed).length, error: report.error, report: `${output}/report.json` }));
}
