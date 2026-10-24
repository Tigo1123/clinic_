import fs from 'node:fs';
import assert from 'node:assert/strict';
const origin = process.env.CLINIC_UI_ORIGIN || 'http://127.0.0.1:5187';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(origin).hostname));
const output = process.env.CLINIC_UI_OUTPUT || '/tmp/mfa-dialog-browser';
fs.mkdirSync(output, { recursive: true });
const target = await (await fetch('http://127.0.0.1:9337/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let requiredPolicy = false; let responseStatus = 500; let submission = null; let sequence = 0; const pending = new Map();
const report = { checks: [], captures: [], exceptions: [], unknownApi: [], mockedWrites: [] };
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
ws.onmessage = async ({ data }) => {
 const event = JSON.parse(data);
 if (event.id) { const task = pending.get(event.id); if (task) { pending.delete(event.id); if (event.error) task.reject(Error(event.error.message)); else task.resolve(event.result); } }
 else if (event.method === 'Fetch.requestPaused') {
  const { requestId, request } = event.params;
  let status = 200; let body = {clinicTimeZone:'Africa/Khartoum',staffMfaRequired:requiredPolicy};
  if(request.method==='DELETE') {
    const payload=JSON.parse(request.postData);
    submission={passwordPresent:typeof payload.currentPassword==='string'&&payload.currentPassword.length>0,leadingZero:typeof payload.totpCode==='string'&&payload.totpCode.startsWith('0'),proofLength:payload.totpCode?.length};
    status=responseStatus;body={error:{code:({401:'MFA_REAUTH_FAILED',403:'MFA_REQUIRED_POLICY',422:'VALIDATION_ERROR',429:'RATE_LIMIT_EXCEEDED',500:'INTERNAL_SERVER_ERROR'})[status],message:'Private diagnostic detail'}};
  }
  await send('Fetch.fulfillRequest',{requestId,responseCode:status,responseHeaders:[{name:'Content-Type',value:'application/json'}],body:Buffer.from(JSON.stringify(body)).toString('base64')});
 } else if (event.method === 'Runtime.exceptionThrown') report.exceptions.push(event.params.exceptionDetails.text);
};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const ev = async expression => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
const check = (name, passed) => report.checks.push({ name, passed: Boolean(passed) });
async function shot(name) { const png = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); fs.writeFileSync(`${output}/${name}.png`, Buffer.from(png.data, 'base64')); report.captures.push(name); }



await send('Page.enable');await send('Runtime.enable');await send('Fetch.enable',{patterns:[{urlPattern:'*/api/*',requestStage:'Request'}]});
async function mount(width,lang,mode,required=false){
 requiredPolicy=required;
 await send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<600});
 await send('Page.navigate',{url:origin});await delay(300);
 await ev(`(async()=>{localStorage.setItem('alshifa_theme',${JSON.stringify(mode)});sessionStorage.setItem('cms_staff_token','synthetic-test-session');const R=await import('/node_modules/.vite/deps/react.js');const D=await import('/node_modules/.vite/deps/react-dom_client.js');const T=await import('/src/app/theme/ThemeContext.jsx');const P=await import('/src/components/StaffSecurityDialog.jsx');await import('/src/App.css');await import('/src/features/patient-auth/patientAuth.css');await(await import('/src/utils/clinicTime.js')).loadClinicTimeZone();const i=(await import('/src/i18n.js')).default;await i.changeLanguage(${JSON.stringify(lang)});document.documentElement.dir=${JSON.stringify(lang==='ar'?'rtl':'ltr')};document.querySelector('#root').style.display='none';const n=document.createElement('div');document.body.appendChild(n);(D.default||D).createRoot(n).render((R.default||R).createElement(T.ThemeProvider,null,(R.default||R).createElement(P.default,{user:{mfaEnabled:true},onClose:()=>{},t:key=>i.t(key)})));})()`);await delay(200);
}
for(const width of [360,1366])for(const lang of ['ar','en'])for(const mode of ['light','dark']){
 const key=`${width}-${lang}-${mode}`;
 await mount(width,lang,mode);
 await ev(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent===${JSON.stringify(lang==='ar'?'تعطيل المصادقة الثنائية':'Disable two-factor authentication')})?.click()`);await delay(100);
 // Locate by the danger action if the localized product copy differs.
 if(!await ev('!!document.querySelector("#mfa-current-password")')){await ev('document.querySelector(".security-actions .btn-danger").click()');await delay(100);}
 check(`masked with one label ${key}`,await ev(`(()=>{const p=document.querySelector('#mfa-current-password');return p.type==='password'&&p.labels.length===1&&p.closest('.shifa-password-field').querySelector('button').getAttribute('aria-pressed')==='false'})()`));
 await ev(`(()=>{const p=document.querySelector('#mfa-current-password');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(p,'SyntheticExample123!');p.dispatchEvent(new Event('input',{bubbles:true}));})()`);await delay(50);
 check(`typing stays masked ${key}`,await ev('document.querySelector("#mfa-current-password").type==="password"'));
 await ev('document.querySelector(".shifa-password-field button").click()');await delay(50);
 check(`reveal matches eye ${key}`,await ev('document.querySelector("#mfa-current-password").type==="text"&&document.querySelector(".shifa-password-field button").getAttribute("aria-pressed")==="true"'));
 await ev('document.querySelector(".shifa-password-field button").click()');await delay(50);
 check(`remask matches eye ${key}`,await ev('document.querySelector("#mfa-current-password").type==="password"&&document.querySelector(".shifa-password-field button").getAttribute("aria-pressed")==="false"'));
 for(const [status,errorKey] of [[500,'mfaServiceUnavailable'],[401,'mfaReauthFailed'],[422,'mfaRequestInvalid'],[403,'mfaRequiredPolicy'],[429,'mfaRateLimited']]){
  responseStatus=status;submission=null;
  await ev(`document.querySelector('#mfa-proof').value='012345';document.querySelector('form').requestSubmit()`);
  const matched=await ev(`new Promise(resolve=>{const deadline=Date.now()+3000;const poll=async()=>{const i=(await import('/src/i18n.js')).default;if(document.querySelector('[role=alert]')?.textContent===i.t(${JSON.stringify(errorKey)}))resolve(true);else if(Date.now()>deadline)resolve(false);else setTimeout(poll,30)};poll()})`);
  check(`${status} safe error ${key}`,matched);
  check(`string proof sent ${status} ${key}`,submission?.passwordPresent&&submission.leadingZero&&submission.proofLength===6);
  check(`no private detail ${status} ${key}`,await ev('!document.body.textContent.includes("Private diagnostic detail")'));
 }
 check(`fits viewport ${key}`,await ev('document.documentElement.scrollWidth<=innerWidth'));
 await ev("document.querySelector('#mfa-proof').value=''");
 await shot(`optional-${key}`);
 await mount(width,lang,mode,true);
 check(`required policy blocks disable ${key}`,await ev('document.querySelector(".security-actions .btn-danger").disabled&&!!document.querySelector("[role=note]")'));
 await shot(`required-${key}`);
}
check('no exceptions',report.exceptions.length===0);fs.writeFileSync(`${output}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({checks:report.checks.length,failed:report.checks.filter(x=>!x.passed),captures:report.captures.length,exceptions:report.exceptions}));ws.close();process.exitCode=report.checks.every(x=>x.passed)?0:1;
