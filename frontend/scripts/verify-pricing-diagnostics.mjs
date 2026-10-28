// One browser/tab, synthetic endpoints only, deliberately delayed stale GET.
import fs from 'node:fs';
import path from 'node:path';
const origin = process.env.CLINIC_UI_ORIGIN || 'http://127.0.0.1:5187';
const cdp = process.env.CLINIC_CDP_ORIGIN || 'http://127.0.0.1:9337';
for (const url of [origin, cdp]) if (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) throw Error('Local origins only');
const output = path.resolve('../qa-evidence/pricing-diagnostics'); fs.mkdirSync(output, { recursive: true });
const production = process.argv.includes('--production');
const report = { checks: [], exceptions: [], requests: [] };
const target = await (await fetch(`${cdp}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let sequence = 0, reads = 0, held, initId, phase = production ? 'production' : 'enabled'; const pending = new Map();
const old = { id: 'medicine', labelEn: 'Diagnostic fixture', unitPriceSdg: 100, status: 'INACTIVE' }; let stored = { ...old };
const catalogue = medicine => ({ doctors: [], services: [], medicines: [medicine] });
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(Error(`Timeout ${method}`)); }, 15000);
  pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }));
});
const fulfill = (requestId, body, status = 200) => send('Fetch.fulfillRequest', { requestId, responseCode: status, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify(body)).toString('base64') });
ws.onmessage = async ({ data }) => {
  const message = JSON.parse(data);
  if (message.id) {
    const task = pending.get(message.id); if (!task) return; pending.delete(message.id); clearTimeout(task.timer);
    if (message.error) task.reject(Error(message.error.message)); else task.resolve(message.result);
  } else if (message.method === 'Fetch.requestPaused') {
    const { requestId, request } = message.params, url = new URL(request.url);
    if (url.pathname.startsWith('/socket.io')) { await fulfill(requestId, {}, 503).catch(() => {}); return; }
    if (url.pathname.startsWith('/api/admin/pricing')) {
      const diagnosticId = Object.entries(request.headers).find(([key]) => key.toLowerCase() === 'x-request-id')?.[1];
      report.requests.push({ phase, method: request.method, diagnosticId: diagnosticId || null });
      if (request.method === 'PATCH') {
        const body = JSON.parse(request.postData); stored = { ...stored, unitPriceSdg: body.priceSdg, status: body.status };
        await fulfill(requestId, { ...stored, token: 'PRIVATE_RESPONSE_FIELD' }); return;
      }
      reads++;
      if (phase === 'enabled' && reads === 2) { held = requestId; return; }
      await fulfill(requestId, catalogue(stored)); return;
    }
    await fulfill(requestId, url.pathname === '/api/public-config' ? { clinicTimeZone: 'Africa/Khartoum' } : url.pathname === '/api/notifications' ? { items: [], unreadCount: 0 } : []).catch(() => {});
  } else if (message.method === 'Runtime.exceptionThrown') report.exceptions.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
};
const ev = async expression => { const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result.value; };
const wait = expression => ev(`new Promise(resolve=>{const end=Date.now()+10000;const poll=()=>{if(${expression})resolve(true);else if(Date.now()>end)resolve(false);else setTimeout(poll,30)};poll()})`);
const check = (name, passed) => { report.checks.push({ name, passed: !!passed }); if (!passed) throw Error(name); };
async function mount(enabled) {
  if (initId) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: initId });
  const source = `sessionStorage.clear();localStorage.setItem('shifa_language','en');sessionStorage.setItem('cms_staff_user',JSON.stringify({id:'diagnostic-user',role:'ADMIN',username:'synthetic@example.test'}));sessionStorage.setItem('cms_staff_token','synthetic-only');${enabled ? "sessionStorage.setItem('shifa_pricing_diagnostics','1');" : ''}window.confirm=()=>true;const originalFetch=window.fetch.bind(window);window.fetch=(url,options)=>originalFetch(url,String(url)==='/api/admin/pricing'?{...options,signal:undefined}:options);`;
  initId = (await send('Page.addScriptToEvaluateOnNewDocument', { source })).identifier;
  await send('Page.navigate', { url: `${origin}/staff` });
  check(`Admin mounted ${enabled}`, await wait('!!document.querySelectorAll(".menu-btn")[2]'));
  await ev('document.querySelectorAll(".menu-btn")[2].click()');
  check(`Pricing loaded ${enabled}`, await wait('!!document.querySelector("input[aria-label^=medicines]")'));
}
try {
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
  await send('Fetch.enable', { patterns: [{ urlPattern: '*/api/*' }, { urlPattern: '*/socket.io/*' }] });
  await mount(true);
  if (production) {
    check('production ignores the diagnostic session flag', await ev('!window.__SHIFA_PRICING_DIAGNOSTICS__'));
    await ev(`(()=>{const i=document.querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'875');i.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    await wait('document.querySelector("input").value==="875"');
    await ev('document.querySelector("tbody button").click()');
    check('production Save still works', await wait('!!document.querySelector(".admin-workspace [role=status]")'));
    check('production sends no diagnostic headers', report.requests.length >= 2 && report.requests.every(r => r.diagnosticId === null));
    check('production never exposes a trace', await ev('!window.__SHIFA_PRICING_DIAGNOSTICS__'));
  } else {
  check('development opt-in exposes only the trace API', await ev('!!window.__SHIFA_PRICING_DIAGNOSTICS__?.getEvents'));
  await ev('window.dispatchEvent(new Event("focus"))');
  check('old refresh GET started', await wait('window.__SHIFA_PRICING_DIAGNOSTICS__.getEvents().filter(e=>e.type==="request.start"&&e.method==="GET").length>=2'));
  await ev('document.querySelectorAll(".menu-btn")[0].click()');
  await wait('document.querySelectorAll(".menu-btn")[0].classList.contains("active")');
  await ev('document.querySelectorAll(".menu-btn")[2].click()');
  check('newer GET restores editable rows', await wait('!!document.querySelector("input[aria-label^=medicines]")'));
  await ev(`(()=>{const i=document.querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'875');i.dispatchEvent(new Event('input',{bubbles:true}));const s=document.querySelector('select');s.value='ACTIVE';s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  await wait('document.querySelector("input").value==="875"');
  await ev('(()=>{const b=document.querySelector("tbody button");for(let i=0;i<8;i++)b.click()})()');
  check('Save succeeded', await wait('document.querySelector("input")?.value==="875"&&!!document.querySelector(".admin-workspace [role=status]")'));
  check('only one PATCH from rapid clicks', report.requests.filter(r => r.method === 'PATCH').length === 1);
  check('old GET remains held until after Save', !!held); await fulfill(held, catalogue(old)); held = null;
  check('stale GET decision recorded', await wait('window.__SHIFA_PRICING_DIAGNOSTICS__.getEvents().some(e=>e.type==="request.end"&&e.olderGetCompletedAfterSave)'));
  check('final UI captured after all requests settle', await wait('window.__SHIFA_PRICING_DIAGNOSTICS__.getEvents().filter(e=>e.type==="ui.settled").at(-1)?.rows[0]?.rendered?.priceSdg==="875"'));
  const events = await ev('window.__SHIFA_PRICING_DIAGNOSTICS__.getEvents()');
  check('stale GET did not overwrite the new value', events.some(e => e.type === 'request.end' && e.olderGetCompletedAfterSave && !e.applied && !e.overwroteNewerState));
  check('duplicate attempts recorded', events.some(e => e.type === 'save.blocked' && e.reason === 'duplicate'));
  check('generated PATCH request ID sent', report.requests.some(r => r.method === 'PATCH' && r.diagnosticId?.startsWith('pricing-patch-')));
  check('no raw response secrets in trace', !JSON.stringify(events).includes('PRIVATE_RESPONSE_FIELD'));
  fs.writeFileSync(path.join(output, 'browser-trace.json'), JSON.stringify(events, null, 2));
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); fs.writeFileSync(path.join(output, 'saved-after-late-get.png'), Buffer.from(shot.data, 'base64'));
  phase = 'disabled'; await mount(false);
  check('default development mode has no exposed diagnostics', await ev('!window.__SHIFA_PRICING_DIAGNOSTICS__'));
  check('opt-out sends no diagnostic headers', report.requests.filter(r => r.phase === 'disabled').every(r => r.diagnosticId === null));
  }
  check('no uncaught browser exceptions', report.exceptions.length === 0);
} catch (error) { report.fatal = error.stack; console.error(error.message); }
finally {
  if (held) await fulfill(held, catalogue(old)).catch(() => {});
  fs.writeFileSync(path.join(output, production ? 'browser-report-production.json' : 'browser-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ checks: report.checks.length, failed: report.checks.filter(c => !c.passed), exceptions: report.exceptions, fatal: report.fatal }));
  ws.close(); await fetch(`${cdp}/json/close/${target.id}`);
  process.exitCode = report.fatal || report.checks.some(c => !c.passed) ? 1 : 0;
}
