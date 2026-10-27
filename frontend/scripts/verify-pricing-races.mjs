import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { execFileSync, spawn } from 'node:child_process';

// Headful Chrome on 9337, Vite on 5187 with VITE_PROXY_TARGET=http://127.0.0.1:55439,
// and the real isolated backend on 55438. No API response is fabricated.
const origin = process.env.CLINIC_UI_ORIGIN || 'http://127.0.0.1:5187';
const api = process.env.CLINIC_PRICING_API || 'http://127.0.0.1:55438';
for (const url of [origin, api]) assert.ok(['127.0.0.1', 'localhost'].includes(new URL(url).hostname));
const sessions = JSON.parse(fs.readFileSync(process.env.CLINIC_PRICING_SESSIONS || '/tmp/clinic-pricing-browser-sessions.json'));
const baseline = process.env.CLINIC_RACE_BASELINE === '1';
const output = process.env.CLINIC_UI_OUTPUT || `/tmp/clinic-pricing-races${baseline ? '-baseline' : ''}`;
fs.mkdirSync(output, { recursive: true });
const report = { checks: [], scenarios: [], requests: [], exceptions: [] };
const check = (name, passed) => { report.checks.push({ name, passed: !!passed }); if (!passed) console.error(`FAIL ${name}`); };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(read, label) { for (let i = 0; i < 150; i++) { const result = await read(); if (result) return result; await delay(50); } throw Error(`Timed out: ${label}`); }

// A response gate controls order rather than elapsed time. Original backend
// Cache-Control/ETag/Last-Modified/status/body go through the browser's HTTP stack.
let arm = false, held = null;
const proxy = http.createServer(async (req, res) => {
  if (req.url === '/api/__qa__/arm') { arm = true; res.end('armed'); return; }
  if (req.url === '/api/__qa__/status') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ held: !!held })); return; }
  if (req.url === '/api/__qa__/release') { held?.(); held = null; res.end('released'); return; }
  const hold = arm && req.method === 'GET' && req.url === '/api/admin/pricing';
  if (hold) arm = false;
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  try {
    const headers = { ...req.headers }; delete headers.host; delete headers.connection; delete headers['content-length'];
    const response = await fetch(api + req.url, { method: req.method, headers, ...(body.length ? { body } : {}) });
    const bytes = Buffer.from(await response.arrayBuffer());
    const resultHeaders = Object.fromEntries(response.headers);
    delete resultHeaders['content-encoding']; delete resultHeaders['transfer-encoding']; delete resultHeaders['content-length'];
    report.requests.push({ method: req.method, path: req.url, status: response.status, cacheControl: response.headers.get('cache-control'), etag: response.headers.get('etag'), lastModified: response.headers.get('last-modified'), conditional: req.headers['if-none-match'] || null, held: hold });
    res.writeHead(response.status, resultHeaders);
    // Send no-store headers before holding the body, so Chrome does not
    // serialize a second identical GET behind an as-yet-unknown cache policy.
    if (hold) { res.write(bytes.subarray(0, 1)); held = () => res.end(bytes.subarray(1)); } else res.end(bytes);
  } catch (error) { res.writeHead(502); res.end(JSON.stringify({ error: { message: error.message } })); }
});
await new Promise(resolve => proxy.listen(55439, '127.0.0.1', resolve));

class Cdp {
  constructor(url) { this.ws = new WebSocket(url); this.next = 0; this.pending = new Map(); }
  async open() {
    await new Promise((resolve, reject) => { this.ws.onopen = resolve; this.ws.onerror = reject; });
    this.ws.onmessage = ({ data }) => {
      const event = JSON.parse(data);
      if (event.id) { const p = this.pending.get(event.id); if (!p) return; this.pending.delete(event.id); clearTimeout(p.timer); if (event.error) p.reject(Error(event.error.message)); else p.resolve(event.result); }
      else if (event.method === 'Page.javascriptDialogOpening') this.send('Page.handleJavaScriptDialog', { accept: true });
      else if (event.method === 'Runtime.exceptionThrown') report.exceptions.push(event.params.exceptionDetails.exception?.description || event.params.exceptionDetails.text);
      else this.onEvent?.(event);
    };
    return this;
  }
  send(method, params = {}) { return new Promise((resolve, reject) => { const id = ++this.next; const timer = setTimeout(() => { this.pending.delete(id); reject(Error(`CDP timeout: ${method}`)); }, 15000); this.pending.set(id, { resolve, reject, timer }); this.ws.send(JSON.stringify({ id, method, params })); }); }
  async ev(expression) { const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; }
  close() { this.ws.close(); }
}
let chrome;
if (process.env.CLINIC_LAUNCH_CHROME === '1') {
  const log = fs.openSync(`${output}/chrome.log`, 'w');
  chrome = spawn('/opt/google/chrome/chrome', ['--no-sandbox', '--disable-gpu', '--ozone-platform=x11', '--no-first-run', '--no-default-browser-check', '--remote-allow-origins=devtools://devtools', '--remote-debugging-port=9337', `--user-data-dir=/tmp/clinic-race-headed-${process.pid}`, '--window-size=1600,1100', 'about:blank'], { stdio: ['ignore', log, log] });
  chrome.on('exit', (code, signal) => { report.chromeExit = { code, signal }; });
}
const browserInfo = await until(async () => { try { return await (await fetch('http://127.0.0.1:9337/json/version')).json(); } catch { return false; } }, 'headed Chrome debugging endpoint');
const browser = await new Cdp(browserInfo.webSocketDebuggerUrl).open();
const openPages = [];
async function page(url = 'about:blank') {
  const { targetId } = await browser.send('Target.createTarget', { url, newWindow: true });
  const cdp = await new Cdp(`ws://127.0.0.1:9337/devtools/page/${targetId}`).open(); cdp.id = targetId;
  openPages.push(cdp); await cdp.send('Runtime.enable'); await cdp.send('Page.enable'); return cdp;
}
let baselinePath;
if (baseline) {
  baselinePath = new URL(`../src/features/admin/.pricing-baseline-${process.pid}.jsx`, import.meta.url);
  fs.writeFileSync(baselinePath, execFileSync('git', ['show', 'HEAD:frontend/src/features/admin/AdminDashboard.jsx'], { encoding: 'utf8' }));
}
async function mount(cdp, kind, tag) {
  await cdp.send('Page.navigate', { url: `${origin}/?pricing-race=${tag}-${kind}` });
  await until(() => cdp.ev(`location.search===${JSON.stringify(`?pricing-race=${tag}-${kind}`)}&&!!window.$RefreshReg$&&!!document.querySelector('#root')`), 'Vite page');
  const path = kind === 'admin' ? `/src/features/admin/${baseline ? `.pricing-baseline-${process.pid}.jsx` : 'AdminDashboard.jsx'}` : '/src/features/pharmacy/PharmacyManagement.jsx';
  await cdp.ev(`(async()=>{
    const main=await(await fetch('/src/main.jsx')).text();const r=await import(main.match(/"([^"]*react\\.js[^"]*)"/)[1]),d=await import(main.match(/"([^"]*react-dom_client\\.js[^"]*)"/)[1]);const R=r.default||r,D=d.default||d;
    const T=await import('/src/app/theme/ThemeContext.jsx');const C=await import(${JSON.stringify(path)});await import('/src/App.css');await import('/src/styles/medical.css');
    const i=(await import('/src/i18n.js')).default;await i.changeLanguage('en');document.documentElement.dir='ltr';const s=${JSON.stringify(sessions[kind === 'admin' ? 'admin' : 'pharmacy'])};sessionStorage.setItem('cms_staff_user',JSON.stringify(s.user));sessionStorage.setItem('cms_staff_token',s.token);
    document.querySelector('#root').style.display='none';const host=document.createElement('div');document.body.appendChild(host);window.qaIdentity=${JSON.stringify(tag)};
    // Ignore cancellation only in this test transport, to prove version checks
    // also protect responses whose body processing can no longer be cancelled.
    const originalFetch=window.fetch.bind(window);window.fetch=(url,options)=>originalFetch(url,String(url)==='/api/admin/pricing'?{...options,signal:undefined}:options);
    D.createRoot(host).render(R.createElement(R.StrictMode,null,R.createElement(T.ThemeProvider,null,R.createElement(C.default,{user:s.user,lang:'en',t:key=>i.t(key)}))));
  })()`);
  await until(() => cdp.ev(kind === 'admin' ? '!!document.querySelector(".admin-workspace .menu-btn:nth-child(3)")' : '!!document.querySelector(".pharmacy-inventory-table")'), 'component');
}
async function click(cdp, selector) {
  const p = await cdp.ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center',behavior:'instant'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...p }); await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...p });
}
const enter = async cdp => { await click(cdp, '.admin-workspace .menu-btn:nth-child(3)'); await until(() => cdp.ev('document.querySelector(".admin-workspace .menu-btn:nth-child(3)").classList.contains("active")'), 'pricing tab'); };
const leave = async cdp => { await click(cdp, '.admin-workspace .menu-btn:first-child'); await until(() => cdp.ev('document.querySelector(".admin-workspace .menu-btn:first-child").classList.contains("active")'), 'profile tab'); };
async function identifyRow(cdp, name) { await until(() => cdp.ev(`(()=>{const r=[...document.querySelectorAll('tr')].find(r=>r.textContent.includes(${JSON.stringify(name)}));if(!r)return false;r.dataset.pricingTest='target';return true})()`), 'medicine row'); }
const value = cdp => cdp.ev(`(()=>{const r=document.querySelector('[data-pricing-test=target]');return r?{price:r.querySelector('input').value,status:r.querySelector('select').value}:null})()`);
try {
  for (const mode of ['closed-cache-enabled', 'open-cache-enabled', 'open-cache-disabled']) {
    const admin = await page(), pharmacy = await page();
    let tools;
    await admin.send('Network.enable'); await admin.send('Network.setCacheDisabled', { cacheDisabled: false });
    const network = []; admin.onEvent = event => {
      if (event.method === 'Network.responseReceived' && event.params.response.url.includes('/api/admin/pricing')) network.push({ requestId: event.params.requestId, url: event.params.response.url, fromDiskCache: !!event.params.response.fromDiskCache, fromServiceWorker: !!event.params.response.fromServiceWorker, status: event.params.response.status, finished: false });
      if (event.method === 'Network.loadingFinished') { const response = network.find(r => r.requestId === event.params.requestId); if (response) response.finished = true; }
    };
    const scenario = { mode, network }; report.scenarios.push(scenario);
    const unique = `Timing ${mode} ${Date.now()}`;
    const createdResponse = await fetch(`${api}/api/pharmacy/formulary`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessions.pharmacy.token}` }, body: JSON.stringify({ brandName: unique, labelAr: unique, labelEn: unique, genericName: unique, strength: '1 mg', dosageForm: 'Tablet' }) });
    assert.equal(createdResponse.status, 201); const { medicine } = await createdResponse.json(); scenario.medicineId = medicine.id;
    await mount(pharmacy, 'pharmacy', mode);
    await pharmacy.ev(`(()=>{const e=document.querySelector('#pharmacy-formulary-search');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(unique)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await click(pharmacy, '.pharmacy-toolbar button[type=submit]');
    await until(() => pharmacy.ev(`!![...document.querySelectorAll('tbody tr')].find(r=>r.textContent.includes(${JSON.stringify(unique)}))`), 'Pharmacy original row');
    await mount(admin, 'admin', mode);
    if (mode.startsWith('open')) {
      tools = await page(`devtools://devtools/bundled/inspector.html?ws=127.0.0.1:9337/devtools/page/${admin.id}&panel=network`);
      await until(() => tools.ev('document.title.includes("DevTools")'), 'actual DevTools frontend');
      scenario.devtools = await until(() => tools.ev(`(async()=>{try{const C=await import('./core/common/common.js');const settings=C.Settings.Settings.instance();for(const name of ['cache-disabled','cacheDisabled']){try{const setting=settings.moduleSetting(name);setting.set(${mode.endsWith('disabled')});return {setting:name,disabled:setting.get(),title:document.title}}catch{}}}catch{}return null})()`), 'initialized DevTools cache setting');
      await admin.send('Network.setCacheDisabled', { cacheDisabled: mode.endsWith('disabled') });
    }
    scenario.devtoolsTargets = (await browser.send('Target.getTargets')).targetInfos.filter(t => t.url.startsWith('devtools://')).length;
    check(`actual DevTools condition ${mode}`, mode.startsWith('closed') ? scenario.devtoolsTargets === 0 : scenario.devtoolsTargets > 0);
    await browser.send('Target.activateTarget', { targetId: admin.id });
    await enter(admin); await identifyRow(admin, unique);
    await leave(admin);
    await fetch(`${origin}/api/__qa__/arm`);
    await enter(admin); // old catalogue GET A remains pending
    await until(async () => (await (await fetch(`${origin}/api/__qa__/status`)).json()).held, 'old GET response gate');
    await leave(admin); await enter(admin); // newer GET B shows the editable row
    await identifyRow(admin, unique);
    await admin.ev(`(()=>{const e=document.querySelector('[data-pricing-test=target] input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'4560');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await until(async () => (await value(admin))?.price === '4560', 'price edit');
    await admin.ev(`(()=>{const e=document.querySelector('[data-pricing-test=target] select');e.value='ACTIVE';e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await until(async () => (await value(admin))?.status === 'ACTIVE', 'status edit');
    const before = report.requests.filter(r => r.method === 'PATCH').length;
    await click(admin, '[data-pricing-test=target] button');
    await until(() => admin.ev('!!document.querySelector(".admin-workspace [role=status]")'), 'save success');
    scenario.afterSave = await value(admin);
    await fetch(`${origin}/api/__qa__/release`);
    // Two rendering frames drain the released response without a timing delay.
    await until(async () => network.filter(r => r.url.endsWith('/api/admin/pricing') && r.finished).length >= 3, 'released GET');
    await admin.ev('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    scenario.afterOldGet = await value(admin);
    check(`old GET cannot overwrite save ${mode}`, scenario.afterOldGet?.price === '4560' && scenario.afterOldGet.status === 'ACTIVE');
    check(`one click one PATCH ${mode}`, report.requests.filter(r => r.method === 'PATCH').length === before + 1);
    check(`no page reload on save ${mode}`, await admin.ev(`window.qaIdentity===${JSON.stringify(mode)}`));
    await leave(admin); await enter(admin); await identifyRow(admin, unique);
    const refreshed = await value(admin); check(`Admin explicit refresh ${mode}`, refreshed.price === '4560' && refreshed.status === 'ACTIVE');
    await browser.send('Target.activateTarget', { targetId: pharmacy.id });
    await until(() => pharmacy.ev(`(()=>{const r=[...document.querySelectorAll('tbody tr')].find(r=>r.textContent.includes(${JSON.stringify(unique)}));return !!r&&!r.querySelector('.pharmacy-admin-note')})()`), 'Pharmacy focus revalidation');
    check(`Pharmacy focus gets authoritative values ${mode}`, await pharmacy.ev(`document.querySelector('.pharmacy-numeric bdi').textContent.includes((4560).toLocaleString())`));
    const shot = await admin.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); fs.writeFileSync(`${output}/${mode}.png`, Buffer.from(shot.data, 'base64'));
    check(`no HTTP cache hit ${mode}`, network.every(r => !r.fromDiskCache && !r.fromServiceWorker && r.status === 200));
    for (const p of [tools, admin, pharmacy].filter(Boolean)) { await browser.send('Target.closeTarget', { targetId: p.id }); p.close(); }
  }
  const getHeaders = report.requests.filter(r => r.method === 'GET' && (r.path === '/api/admin/pricing' || r.path.startsWith('/api/pharmacy/formulary')));
  check('authenticated GET responses are no-store', getHeaders.every(r => r.cacheControl?.includes('no-store')));
  check('no browser conditional revalidation or 304', getHeaders.every(r => !r.conditional && r.status === 200));
  check('no browser exceptions', report.exceptions.length === 0);
} catch (error) {
  report.failure = error.message;
  for (const p of openPages) {
    try { const state = await p.ev('({url:location.href,hidden:document.hidden,text:document.body.innerText.slice(0,1000)})'); report.failurePages ||= []; report.failurePages.push(state); } catch {}
  }
  throw error;
}
finally {
  held?.(); for (const p of openPages) { try { await browser.send('Target.closeTarget', { targetId: p.id }); } catch {} p.close(); }
  if (chrome) await browser.send('Browser.close');
  browser.close(); proxy.closeAllConnections(); await new Promise(resolve => proxy.close(resolve)); if (baselinePath) fs.unlinkSync(baselinePath);
  fs.writeFileSync(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ checks: report.checks, failure: report.failure, scenarios: report.scenarios, output }, null, 2));
}
process.exitCode = report.checks.every(c => c.passed) ? 0 : 1;
