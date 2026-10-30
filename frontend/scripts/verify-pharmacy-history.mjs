import fs from 'node:fs';
import assert from 'node:assert/strict';
const origin=process.env.CLINIC_UI_ORIGIN||'http://127.0.0.1:5187';
const browser=process.env.CLINIC_BROWSER_ORIGIN||'http://127.0.0.1:9337';
for(const value of [origin,browser])assert.ok(['localhost','127.0.0.1'].includes(new URL(value).hostname));
const output=process.env.CLINIC_UI_OUTPUT||'/tmp/clinic-pharmacy-history';fs.mkdirSync(output,{recursive:true});
const report={checks:[],requests:[],exceptions:[],screenshots:[],unexpectedWrites:[]};
const target=await(await fetch(`${browser}/json/new?about:blank`,{method:'PUT'})).json();
const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
let seq=0,scenario={},held=[];const tasks=new Map();
const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;tasks.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
const medicine={id:'medicine-1',labelAr:'دواء الاختبار',labelEn:'Test medicine',brandName:'Test medicine',status:'ACTIVE',unitPriceSdg:500,stock:{usableStock:40,totalOnHand:40,batchCount:1,nearestUnexpiredExpiry:'2030-01-01'}};
const prescription=(id,status='FILLED')=>({id,patient:{fullNameAr:id,fullNameEn:id},doctor:{fullNameAr:'طبيب الاختبار',fullNameEn:'Test Doctor'},prescriptionDate:'2026-10-30T08:00:00Z',status,prescribedDrugs:[{id:`item-${id}`,drug:status==='FILLED'?{labelAr:medicine.labelAr,labelEn:medicine.labelEn}:medicine,qtyPrescribed:2,qtyDispensed:status==='FILLED'?2:0,dosage:'1',duration:'2 days'}]});
const matches=(source,path)=>source==='prescriptions'?path==='/api/records/prescriptions/history':source==='payment'?path.endsWith('/payment-state'):path.endsWith(`/${source}`);
function historyBody(source,phase,page=1){
 const ids=phase==='empty'?[]:phase==='duplicate'?['NEW-HISTORY','NEW-HISTORY']:[phase==='old'?'OLD-HISTORY':phase==='obsolete'?'OBSOLETE-HISTORY':'NEW-HISTORY'];
 if(source==='prescriptions')return ids.map(id=>prescription(id));
 if(source==='payment')return {prescriptionId:'pending-rx',invoice:{id:'invoice-1',totalAmountSdg:500,paidAmountSdg:phase==='old'?100:200,outstandingAmountSdg:phase==='old'?400:300,paymentStatus:'PARTIALLY_PAID'},dispensingAllowed:false,allowedPaymentMethods:['CASH']};
 return {items:ids.map(id=>source==='batches'?{id,batchNumber:id,expiryDate:'2030-01-01',qtyOnHand:40,minReorderLevel:5}:{id,movementType:'DISPENSE',batch:{batchNumber:id},createdAt:'2026-10-30T08:00:00Z',quantityDelta:-2,resultingBalance:40,actor:{username:'pharmacy'}}),pagination:{page,pageSize:50,total:ids.length,totalPages:ids.length?1:0}};
}
async function fulfill(requestId,body,status=200){await send('Fetch.fulfillRequest',{requestId,responseCode:status,responseHeaders:[{name:'Content-Type',value:'application/json'}],body:Buffer.from(JSON.stringify(body)).toString('base64')});}
ws.onmessage=async({data})=>{
 const e=JSON.parse(data);if(e.id){const task=tasks.get(e.id);if(!task)return;tasks.delete(e.id);e.error?task.reject(Error(e.error.message)):task.resolve(e.result);return;}
 if(e.method==='Runtime.exceptionThrown')report.exceptions.push(e.params.exceptionDetails.exception?.description||e.params.exceptionDetails.text);
 if(e.method!=='Fetch.requestPaused')return;
 const {requestId,request}=e.params;const url=new URL(request.url),path=url.pathname;const entry={scenario:scenario.name,path,page:url.searchParams.get('page'),phase:scenario.phase};report.requests.push(entry);
 try{
  if(request.method!=='GET'){report.unexpectedWrites.push({path,method:request.method});await fulfill(requestId,{},400);return;}
  if(matches(scenario.source,path)){
   if(scenario.phase==='hold'){held.push({requestId,page:Number(url.searchParams.get('page')||1)});return;}
   if(scenario.phase==='network'){entry.result='network failure';await send('Fetch.failRequest',{requestId,errorReason:'ConnectionReset'});return;}
   if(typeof scenario.phase==='number'){entry.result=scenario.phase;await fulfill(requestId,{error:{code:scenario.phase===401?'AUTHENTICATION_REQUIRED':'HISTORY_FAILED',message:'RAW PRIVATE BACKEND ENGLISH'}},scenario.phase);return;}
   if(scenario.phase==='contradictory-empty'){await fulfill(requestId,{items:[],pagination:{page:1,total:10,totalPages:1}});return;}
   if(scenario.phase==='malformed'){entry.result='malformed';await fulfill(requestId,{items:null,unexpected:true});return;}
   await fulfill(requestId,historyBody(scenario.source,scenario.phase,Number(url.searchParams.get('page')||1)));return;
  }
  let body=[];
  if(path==='/api/public-config')body={clinicTimeZone:'Africa/Khartoum'};
  if(path==='/api/notifications')body={notifications:[],unreadCount:0,nextCursor:null};
  if(path==='/api/records/prescriptions/pending')body=[prescription('ACTIVE-PRESCRIPTION','ACTIVE')];
  if(path==='/api/records/drugs')body=[medicine];
  if(path==='/api/pharmacy/formulary')body={items:[medicine],pagination:{page:1,total:1,totalPages:1}};
  if(path==='/api/pharmacy/formulary/medicine-1')body=medicine;
  if(path.endsWith('/payment-state'))body=historyBody('payment','old');
  await fulfill(requestId,body);
 }catch(error){if(!error.message.includes('Invalid InterceptionId'))report.exceptions.push(`fixture: ${error.message}`);}
};
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function ev(expression){const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;}
async function until(expression){for(let i=0;i<120;i++){try{if(await ev(expression))return;}catch(error){if(!/Inspected target navigated|Execution context was destroyed|Cannot find context/.test(error.message))throw error;}await delay(50);}throw Error(`Timed out ${scenario.name}: ${expression}`);}
function check(name,passed){report.checks.push({scenario:scenario.name,name,passed:!!passed});if(!passed)throw Error(`FAIL ${scenario.name}: ${name}`);}
const scope=()=>scenario.source==='prescriptions'?'.pharmacy-queue-column':scenario.source==='payment'?'.pharmacy-payment':'.ui-dialog';
const click=selector=>ev(`document.querySelector(${JSON.stringify(selector)}).click()`);
const text=()=>ev(`document.querySelector(${JSON.stringify(scope())}).textContent`);
const selector=child=>`${scope()} ${child}`;
async function untilText(value){await until(`document.querySelector(${JSON.stringify(scope())})?.textContent.includes(${JSON.stringify(value)})`);}
async function shot(name){await ev('document.fonts.ready');await ev(`document.querySelector(${JSON.stringify(scope())}).scrollIntoView({block:'center',behavior:'instant'})`);const image=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(`${output}/${name}.png`,Buffer.from(image.data,'base64'));report.screenshots.push(`${name}.png`);}
async function openHistory(){
 if(scenario.source==='prescriptions'){await click('.pharmacy-queue-tabs button:nth-child(2)');return;}
 if(scenario.source==='payment'){await click('.queue-card-item');return;}
 await click('.pharmacy-workspace-tabs button:nth-child(2)');await until('!!document.querySelector(".pharmacy-action-trigger")');await click('.pharmacy-action-trigger');await ev(`(()=>{const labels=${JSON.stringify(scenario.source==='batches'?['View batches','عرض الدفعات']:['Movement history','سجل الحركات'])};[...document.querySelectorAll('[role=menuitem]')].find(e=>labels.includes(e.textContent)).click()})()`);await until('!!document.querySelector(".ui-dialog")');
}
async function closeHistory(){if(scenario.source==='prescriptions')await click('.pharmacy-queue-tabs button:first-child');else await click('.ui-dialog .dialog-actions button:last-child');}
async function refresh(){await click(scenario.source==='prescriptions'?'.pharmacy-queue-column .panel-header button':scenario.source==='payment'?'.pharmacy-payment .pharmacy-management-header button':'.ui-dialog .dialog-actions button:first-child');}
async function mount(source,phase,key,lang,mode,width){scenario={source,phase,name:`${source}-${key}-${width}-${lang}-${mode}`};held=[];await send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<600});const query=`history-qa=${encodeURIComponent(scenario.name)}&lang=${lang}&mode=${mode}`;await send('Page.navigate',{url:`${origin}/staff?${query}`});await until(`location.search.includes(${JSON.stringify(encodeURIComponent(scenario.name))})&&!!document.querySelector('.queue-card-item')`);await openHistory();}
await send('Page.enable');await send('Runtime.enable');await send('Network.enable');await send('Network.setBlockedURLs',{urls:['*socket.io*']});await send('Fetch.enable',{patterns:[{urlPattern:'*/api/*'}]});
await send('Page.addScriptToEvaluateOnNewDocument',{source:`if(location.search.includes('history-qa=')){const q=new URLSearchParams(location.search);sessionStorage.setItem('cms_staff_user',JSON.stringify({id:'fixture-pharmacist',role:'PHARMACIST',username:'pharmacy'}));sessionStorage.setItem('cms_staff_token','fixture-only');localStorage.setItem('shifa_language',q.get('lang'));localStorage.setItem('alshifa_theme',q.get('mode'));}`});
try{
 for(const width of [1366,390])for(const lang of ['ar','en'])for(const mode of ['light','dark']){
  if(process.env.CLINIC_HISTORY_METADATA_ONLY){
   for(const source of ['batches','movements']){
    await mount(source,'contradictory-empty','metadata',lang,mode,width);await until(`!!document.querySelector(${JSON.stringify(selector('[role=alert]'))})`);
    check(`contradictory count is localized error ${source}-${width}-${lang}-${mode}`,await ev(`/[\u0600-\u06ff]/u.test(document.querySelector(${JSON.stringify(selector('[role=alert]'))}).textContent)===${lang==='ar'}`));
    check(`contradictory count is never empty history ${source}-${width}-${lang}-${mode}`,!/No stock movements|No inventory batches|لا توجد حركات مخزون|لا توجد دفعات مسجلة/.test(await text()));
    check(`contradictory response terminates loading ${source}-${width}-${lang}-${mode}`,await ev(`!document.querySelector(${JSON.stringify(selector('.pharmacy-read-feedback [role=status]'))})`));
   }
   console.log(`Completed metadata ${width}-${lang}-${mode}`);continue;
  }
  if(!process.env.CLINIC_HISTORY_AUTH_ONLY){
  for(const source of ['prescriptions','batches','movements']){
   const key=`${source}-${width}-${lang}-${mode}`;
   await mount(source,'old','snapshots',lang,mode,width);await untilText('OLD-HISTORY');check(`data renders ${key}`,true);
   for(const failure of [403,404,500,'malformed','network']){
    scenario.phase=failure;await refresh();await until(`!!document.querySelector(${JSON.stringify(selector('[role=alert]'))})`);
    const body=await text();check(`failed ${failure} retains last rows ${key}`,body.includes(failure===403?'OLD-HISTORY':'NEW-HISTORY'));
    check(`error is distinct from empty ${failure} ${key}`,!body.includes('RAW PRIVATE')&&!/No prescription history|No stock movements|No inventory batches|لا توجد وصفات محفوظة|لا توجد حركات مخزون|لا توجد دفعات مسجلة/.test(body));
    check(`localized ${failure} ${key}`,await ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector('[role=alert]'))});return /[\u0600-\u06ff]/u.test(e.textContent)===${lang==='ar'}})()`));
    check(`failed request loading clears ${failure} ${key}`,await ev(`!document.querySelector(${JSON.stringify(selector('.pharmacy-read-feedback [role=status]'))})`));
    if(failure===500)await shot(`preserved-error-${key}`);
    scenario.phase='duplicate';await click(selector('.pharmacy-read-feedback button'));await untilText('NEW-HISTORY');await until(`!document.querySelector(${JSON.stringify(selector('[role=alert]'))})`);
    check(`retry has one row ${failure} ${key}`,await ev(`document.querySelectorAll(${JSON.stringify(selector(source==='prescriptions'?'.queue-card-item':'tbody tr'))}).length===1`));
   }
   check(`viewport fits ${key}`,await ev('document.documentElement.scrollWidth<=innerWidth'));
   await mount(source,'empty','empty',lang,mode,width);await untilText(source==='prescriptions'?(lang==='ar'?'لا توجد وصفات محفوظة':'No prescription history'):source==='batches'?(lang==='ar'?'لا توجد دفعات مسجلة':'No inventory batches'):(lang==='ar'?'لا توجد حركات مخزون':'No stock movements'));
   check(`genuine empty has no error ${key}`,await ev(`!document.querySelector(${JSON.stringify(selector('[role=alert]'))})`));
   await mount(source,500,'initial-error',lang,mode,width);await until(`!!document.querySelector(${JSON.stringify(selector('[role=alert]'))})`);check(`initial error has no false empty ${key}`,!/No prescription history|No stock movements|No inventory batches|لا توجد وصفات محفوظة|لا توجد حركات مخزون|لا توجد دفعات مسجلة/.test(await text()));
   await closeHistory();await until(source==='prescriptions'?'!!document.querySelector(".queue-card-item")':'!document.querySelector(".ui-dialog")');check(`partial failure leaves other content usable ${key}`,await ev(source==='prescriptions'?'document.querySelector(".queue-card-item").textContent.includes("ACTIVE-PRESCRIPTION")':'!!document.querySelector(".pharmacy-inventory-table tbody tr")'));
   await mount(source,'hold','slow-stale',lang,mode,width);await until(`!!document.querySelector(${JSON.stringify(selector('.pharmacy-read-feedback [role=status]'))})`);check(`slow read shows loading ${key}`,true);await shot(`slow-${key}`);
   const old=[...held];await closeHistory();scenario.phase='new';await openHistory();await untilText('NEW-HISTORY');
   for(const request of old){try{await fulfill(request.requestId,historyBody(source,'obsolete',request.page));}catch{}}
   check(`old response cannot replace newer rows ${key}`,!(await text()).includes('OBSOLETE-HISTORY'));
   if(source==='prescriptions'){
    const before=report.requests.length;await click('.pharmacy-queue-column .queue-card-item');await until(`document.querySelector('.pharmacy-dispense-column').textContent.includes(${JSON.stringify(lang==='ar'?'المصروف: 2':'Dispensed: 2')})`);
    check(`historical selection uses no stock/payment endpoint ${key}`,report.requests.slice(before).filter(r=>/formulary\/undefined|payment-state/.test(r.path)).length===0);
   }
  }
  await mount('payment','old','payment-refresh',lang,mode,width);await untilText('100');scenario.phase=500;await refresh();await until('!!document.querySelector(".pharmacy-payment [role=alert]")');check(`payment snapshot preserved ${width}-${lang}-${mode}`,(await text()).includes('100'));check(`payment refresh failure localized ${width}-${lang}-${mode}`,await ev(`/[\u0600-\u06ff]/u.test(document.querySelector('.pharmacy-payment [role=alert]').textContent)===${lang==='ar'}`));await shot(`payment-preserved-${width}-${lang}-${mode}`);
  scenario.phase='new';await refresh();await untilText('200');check(`payment retry recovers ${width}-${lang}-${mode}`,await ev('!document.querySelector(".pharmacy-payment [role=alert]")'));
  }
  await mount('prescriptions',401,'auth-failure',lang,mode,width);await until('location.search===""&&!!document.querySelector("#staff-username")&&!sessionStorage.getItem("cms_staff_token")');check(`401 returns to login without fake empty ${width}-${lang}-${mode}`,await ev('!document.querySelector(".pharmacy-workspace")'));
  console.log(`Completed ${width}-${lang}-${mode}`);
 }
 check('no browser exceptions',report.exceptions.length===0);check('no writes',report.unexpectedWrites.length===0);
}catch(error){report.failure=error.message;console.error(error.message);console.error(await ev('document.body.innerText.slice(-1800)'));process.exitCode=1;}
finally{fs.writeFileSync(`${output}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({checks:report.checks.length,failed:report.checks.filter(c=>!c.passed),exceptions:report.exceptions,failure:report.failure,screenshots:report.screenshots.length,output},null,2));await send('Page.close');ws.close();}
