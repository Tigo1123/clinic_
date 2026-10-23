import fs from 'node:fs';
import path from 'node:path';

const origin = process.env.AUDIT_FRONTEND_URL || 'http://127.0.0.1:4173';
const cdp = process.env.AUDIT_CDP_URL || 'http://127.0.0.1:9222';
const reportPath = path.resolve(process.env.AUDIT_REPORT_PATH || 'docs/production-readiness/evidence/browser-local-baseline.json');
if (!/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(origin)) throw new Error('Browser baseline accepts localhost only.');

const profiles = {
  A: { latency: 100, down: 2 * 1024 * 1024 / 8, up: 750 * 1024 / 8, cpu: 4 },
  B: { latency: 250, down: 750 * 1024 / 8, up: 250 * 1024 / 8, cpu: 4 },
  C: { latency: 500, down: 300 * 1024 / 8, up: 100 * 1024 / 8, cpu: 6 }
};
const profileName = process.env.AUDIT_NETWORK_PROFILE || 'A';
const profile = profiles[profileName];
if (!profile) throw new Error('AUDIT_NETWORK_PROFILE must be A, B, or C.');
const routes = (process.env.AUDIT_ROUTES || '/,/patient-login,/register,/staff').split(',').map((x) => x.trim()).filter(Boolean);
const viewport = Number(process.env.AUDIT_VIEWPORT || 390);
const postLoadWaitMs = Math.max(0, Number(process.env.AUDIT_POST_LOAD_WAIT_MS || 600));
const readinessTimeoutMs = Math.max(0, Number(process.env.AUDIT_WAIT_FOR_USABLE_MS || 0));

class CdpClient {
  constructor(url) { this.socket = new WebSocket(url); this.id = 0; this.pending = new Map(); this.events = []; }
  async open() {
    await new Promise((resolve, reject) => { this.socket.onopen = resolve; this.socket.onerror = reject; });
    this.socket.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message)); else pending.resolve(message.result);
      } else this.events.push(message);
    };
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.socket.send(JSON.stringify({ id, method, params })); });
  }
  close() { this.socket.close(); }
}

const target = await (await fetch(`${cdp}/json/new?${encodeURIComponent(origin)}`, { method: 'PUT' })).json();
const client = new CdpClient(target.webSocketDebuggerUrl);
await client.open();
await Promise.all(['Page.enable', 'Network.enable', 'Runtime.enable', 'Performance.enable'].map((method) => client.send(method)));
await client.send('Network.setCacheDisabled', { cacheDisabled: true });
await client.send('Network.setBypassServiceWorker', { bypass: true });
await client.send('Emulation.setDeviceMetricsOverride', { width: viewport, height: 844, deviceScaleFactor: 1, mobile: viewport < 600 });
await client.send('Emulation.setCPUThrottlingRate', { rate: profile.cpu });
await client.send('Network.emulateNetworkConditions', {
  offline: false, latency: profile.latency, downloadThroughput: profile.down, uploadThroughput: profile.up, connectionType: 'cellular3g'
});
await client.send('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.clear();sessionStorage.clear()}catch{};window.__auditVitals={lcp:0,longTasks:[]};try{new PerformanceObserver(l=>{for(const e of l.getEntries())window.__auditVitals.lcp=e.startTime}).observe({type:'largest-contentful-paint',buffered:true});new PerformanceObserver(l=>{for(const e of l.getEntries())window.__auditVitals.longTasks.push({startTime:e.startTime,duration:e.duration})}).observe({type:'longtask',buffered:true})}catch{}` });

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function evaluate(expression) {
  const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Browser evaluation failed.');
  return result.result.value;
}
async function navigate(url) {
  const start = Date.now();
  const oldLoadCount = client.events.filter((e) => e.method === 'Page.loadEventFired').length;
  await client.send('Page.navigate', { url });
  const until = Date.now() + 45_000;
  while (Date.now() < until && client.events.filter((e) => e.method === 'Page.loadEventFired').length <= oldLoadCount) await wait(50);
  await wait(postLoadWaitMs);
  return Date.now() - start;
}
async function sample(route, mode) {
  client.events.length = 0;
  if (mode === 'cold') {
    await client.send('Network.setCacheDisabled', { cacheDisabled: true });
    await client.send('Network.clearBrowserCache');
  } else {
    await client.send('Network.setCacheDisabled', { cacheDisabled: false });
  }
  const navigationMs = await navigate(`${origin}${route}`);
  let firstUsableMs = null;
  if (readinessTimeoutMs > 0) {
    const readinessStartedAt = Date.now();
    const deadline = readinessStartedAt + readinessTimeoutMs;
    while (Date.now() < deadline) {
      const usable = await evaluate(`([...document.querySelectorAll('input:not([disabled]),button:not([disabled])')]).some(element=>element.getClientRects().length>0&&getComputedStyle(element).visibility!=='hidden')`);
      if (usable) {
        firstUsableMs = navigationMs + (Date.now() - readinessStartedAt);
        break;
      }
      await wait(100);
    }
  }
  const page = await evaluate(`(()=>{const n=performance.getEntriesByType('navigation')[0],r=performance.getEntriesByType('resource'),p=performance.getEntriesByType('paint'),v=window.__auditVitals||{};return {title:document.title,readyState:document.readyState,lang:document.documentElement.lang,dir:document.documentElement.dir,viewport:{width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth},domElements:document.getElementsByTagName('*').length,inputs:[...document.querySelectorAll('input')].length,buttons:[...document.querySelectorAll('button')].length,usableForm:[...document.querySelectorAll('input,button')].filter(e=>!e.disabled).length,loadingText:[...document.querySelectorAll('[role=status]')].map(e=>(e.innerText||'').slice(0,80)),errorBoundary:!!document.querySelector('[data-error-boundary]'),navigation:n?{ttfb:n.responseStart,domContentLoaded:n.domContentLoadedEventEnd,load:n.loadEventEnd,transfer:n.transferSize,decoded:n.decodedBodySize}:null,paint:Object.fromEntries(p.map(x=>[x.name,x.startTime])),lcp:v.lcp||null,longTasks:v.longTasks||[],resources:r.map(x=>({name:new URL(x.name).pathname,transfer:x.transferSize,decoded:x.decodedBodySize,duration:x.duration})).sort((a,b)=>b.transfer-a.transfer).slice(0,15)}})()`);
  const events = client.events;
  const requests = events.filter((x) => x.method === 'Network.requestWillBeSent').length;
  const encoded = events.filter((x) => x.method === 'Network.loadingFinished').reduce((sum, x) => sum + (x.params.encodedDataLength || 0), 0);
  const failed = events.filter((x) => x.method === 'Network.loadingFailed').map((x) => ({ error: x.params.errorText, canceled: x.params.canceled }));
  return { route, mode, navigationMs, firstUsableMs, requests, encodedBytes: encoded, failedRequests: failed, ...page };
}

const results = [];
for (const route of routes) {
  results.push(await sample(route, 'cold'));
  results.push(await sample(route, 'warm'));
}
const report = {
  generatedAt: new Date().toISOString(),
  environment: 'local production build served by vite preview; unauthenticated public pages only; no API/production data source',
  profile: { name: profileName, ...profile, viewport },
  postLoadWaitMs,
  readinessTimeoutMs,
  authenticatedWorkflows: 'Not measured: requires isolated staging data and role-specific accounts.',
  results
};
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
client.close();
