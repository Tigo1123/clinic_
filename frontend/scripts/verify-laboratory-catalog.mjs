import fs from 'node:fs';
import assert from 'node:assert/strict';
const origin = process.env.CLINIC_UI_ORIGIN || 'http://127.0.0.1:5187';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(origin).hostname));
const output = process.env.CLINIC_UI_OUTPUT || '/tmp/lab-catalog-ui';
fs.mkdirSync(output, { recursive: true });
const target = await (await fetch('http://127.0.0.1:9337/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let sequence = 0; const pending = new Map();
const report = { checks: [], captures: [], exceptions: [], unknownApi: [], mockedWrites: [] };
const id = '10000000-0000-4000-8000-000000000001';
let scenario='normal';let items=[];
const fixture=()=>[{id,code:'cbc',labelAr:'صورة دم كاملة',labelEn:'Complete Blood Count',priceSdg:'10000',status:'ACTIVE',category:'LABORATORY'},{id:'10000000-0000-4000-8000-000000000002',code:'fbs',labelAr:'سكر صائم',labelEn:'Fasting Blood Sugar',priceSdg:'5000',status:'INACTIVE',category:'LABORATORY'}];
function response(url,request){
 if(url.pathname==='/api/public-config')return{status:200,body:{clinicTimeZone:'Africa/Khartoum'}};
 if(!url.pathname.startsWith('/api/admin/catalog/laboratory-tests')){report.unknownApi.push(url.pathname);return{status:200,body:[]};}
 if(request.method!=='GET'){
 const body=JSON.parse(request.postData);report.mockedWrites.push({method:request.method,body});
 if(scenario==='duplicate')return{status:409,body:{error:{code:'CATALOG_DUPLICATE'}}};
 if(request.method==='POST'){const item={...body,id:'20000000-0000-4000-8000-000000000001'};items.push(item);return{status:201,body:item};}
 const item=items.find(item=>url.pathname.endsWith(item.id));Object.assign(item,body);return{status:200,body:item};}
 if(scenario==='error')return{status:503,body:{error:{message:'Synthetic unavailable'}}};
 const filtered=items.filter(item=>(!url.searchParams.get('status')||item.status===url.searchParams.get('status'))&&[item.code,item.labelAr,item.labelEn].some(value=>value.toLowerCase().includes((url.searchParams.get('search')||'').toLowerCase())));
 return{status:200,body:{items:scenario==='empty'?[]:filtered,total:scenario==='empty'?0:filtered.length}};
}
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
ws.onmessage = async ({ data }) => {
 const event = JSON.parse(data);
 if (event.id) { const task = pending.get(event.id); if (task) { pending.delete(event.id); if (event.error) task.reject(Error(event.error.message)); else task.resolve(event.result); } }
 else if (event.method === 'Fetch.requestPaused') {
  const { requestId, request } = event.params;
  const result = response(new URL(request.url), request);
  if (scenario === 'loading' && request.url.includes('/catalog/')) await new Promise(resolve=>setTimeout(resolve,1200));
  await send('Fetch.fulfillRequest', { requestId, responseCode: result.status, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify(result.body)).toString('base64') }).catch(()=>{});
 } else if (event.method === 'Runtime.exceptionThrown') report.exceptions.push(event.params.exceptionDetails.text);
};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const ev = async expression => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
const check = (name, passed) => report.checks.push({ name, passed: Boolean(passed) });
async function shot(name) { const png = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); fs.writeFileSync(`${output}/${name}.png`, Buffer.from(png.data, 'base64')); report.captures.push(name); }

async function mount(width,lang,mode,state='normal'){
 scenario=state;items=fixture();
 await send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<600});
 await send('Page.navigate',{url:origin});await delay(250);
 await ev(`(async()=>{localStorage.setItem('alshifa_theme',${JSON.stringify(mode)});sessionStorage.setItem('cms_staff_token','synthetic-only');document.documentElement.lang=${JSON.stringify(lang)};document.documentElement.dir=${JSON.stringify(lang==='ar'?'rtl':'ltr')};document.querySelector('#root').style.display='none';const node=document.createElement('div');node.style.padding='12px';document.body.appendChild(node);const R=await import('/node_modules/.vite/deps/react.js');const D=await import('/node_modules/.vite/deps/react-dom_client.js');const T=await import('/src/app/theme/ThemeContext.jsx');const P=await import('/src/features/admin/ClinicSetupPanel.jsx');await(await import('/src/i18n.js')).default.changeLanguage(${JSON.stringify(lang)});window.testRoot=(D.default||D).createRoot(node);window.testRoot.render((R.default||R).createElement(T.ThemeProvider,null,(R.default||R).createElement(P.default,{initialTab:'labs',lang:${JSON.stringify(lang)}})));})()`);await delay(state==='loading'?50:100);
 const ready = state === 'normal' ? '!!document.querySelector("table")?.textContent.includes("cbc")' : state === 'empty' ? `document.body.textContent.includes(${JSON.stringify(lang==='ar'?'لا توجد فحوص مخبرية':'No laboratory tests yet')})` : state === 'error' ? '!!document.querySelector("[role=alert]")' : '!!document.querySelector("[role=status]")';
 await ev(`new Promise(resolve=>{const deadline=Date.now()+5000;const poll=()=>{if(${ready})resolve(true);else if(Date.now()>deadline)resolve(false);else setTimeout(poll,30)};poll()})`);
}
async function click(text,dialog=false){await ev(`(()=>{const scope=${dialog?"[...document.querySelectorAll('[role=dialog]')].at(-1)":"document"};[...scope.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}&&b.getClientRects().length).click()})()`);await delay(140);}
async function fill(name,value){await ev(`(()=>{const i=document.querySelector('input[name=${name}]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,${JSON.stringify(value)});i.dispatchEvent(new Event('input',{bubbles:true}))})()`);await delay(30);}
await send('Page.enable');await send('Runtime.enable');await send('Fetch.enable',{patterns:[{urlPattern:'*/api/*',requestStage:'Request'}]});
for(const width of [320,360,390,1366])for(const lang of ['ar','en'])for(const mode of ['light','dark']){
 const key=`${width}-${lang}-${mode}`,ar=lang==='ar';
 await mount(width,lang,mode);
 check(`no page overflow ${key}`,await ev('document.documentElement.scrollWidth<=innerWidth'));
 check(`table or mobile cards ${key}`,await ev(width>=900?'document.querySelector("table").getClientRects().length>0':'[...document.querySelectorAll("article")].some(e=>e.getClientRects().length>0)&&!document.querySelector("table").getClientRects().length'));
 check(`both names and currency ${key}`,await ev('document.body.textContent.includes("Complete Blood Count")&&document.body.textContent.includes("صورة دم كاملة")&&document.body.textContent.includes("SDG")'));
 await shot(`list-${key}`);
 await click(ar?'إضافة فحص':'Add Test');await fill('code','CRP');await fill('labelAr','البروتين المتفاعل');await fill('labelEn','C Reactive Protein');await fill('priceSdg','7500');
 check(`normalized code ${key}`,await ev('document.querySelector("input[name=code]").value==="crp"'));
 check(`editor fits ${key}`,await ev('document.querySelector("[role=dialog]").getBoundingClientRect().width<=innerWidth&&document.documentElement.scrollWidth<=innerWidth'));
 await shot(`editor-${key}`);
 await ev('document.querySelector("form").requestSubmit()');await delay(120);await click(ar?'حفظ':'Save',true);await delay(150);
 check(`add success ${key}`,await ev(`document.body.textContent.includes(${JSON.stringify(ar?'تم حفظ التغييرات.':'Changes saved.')})`));
 check(`category authority ${key}`,report.mockedWrites.at(-1).body.category==='LABORATORY');
 await click(ar?'تعديل':'Edit');await fill('priceSdg','11000');await ev('document.querySelector("form").requestSubmit()');await delay(120);await click(ar?'حفظ':'Save',true);await delay(150);
 check(`edit success ${key}`,report.mockedWrites.at(-1).body.priceSdg==='11000');
 await click(ar?'تعطيل':'Deactivate');await click(ar?'تأكيد تغيير الإعدادات':'Confirm configuration change',true);await delay(150);
 check(`deactivate ${key}`,report.mockedWrites.at(-1).body.status==='INACTIVE');
 scenario='duplicate';await click(ar?'إضافة فحص':'Add Test');await fill('code','CBC');await fill('labelAr','صورة دم كاملة');await fill('labelEn','Complete Blood Count');await fill('priceSdg','10000');await ev('document.querySelector("form").requestSubmit()');await delay(100);await click(ar?'حفظ':'Save',true);
 check(`duplicate localized ${key}`,await ev(`new Promise(resolve=>{const deadline=Date.now()+2500;const poll=()=>{if(document.querySelector('[role=dialog] [role=alert]')?.textContent.includes(${JSON.stringify(ar?'يوجد مدخل':'already exists')}))resolve(true);else if(Date.now()>deadline)resolve(false);else setTimeout(poll,50)};poll()})`));await shot(`duplicate-${key}`);
 for(const state of ['empty','error','loading']){await mount(width,lang,mode,state);check(`${state} state ${key}`,await ev(state==='empty'?`document.body.textContent.includes(${JSON.stringify(ar?'لا توجد فحوص مخبرية':'No laboratory tests yet')})`:state==='error'?'!!document.querySelector("[role=alert]")':'!!document.querySelector("[role=status]")'));await shot(`${state}-${key}`);}
}
check('no exceptions',report.exceptions.length===0);check('only intercepted API',report.unknownApi.length===0);fs.writeFileSync(`${output}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({checks:report.checks.length,failed:report.checks.filter(x=>!x.passed),captures:report.captures.length,exceptions:report.exceptions}));ws.close();process.exitCode=report.checks.every(x=>x.passed)?0:1;
