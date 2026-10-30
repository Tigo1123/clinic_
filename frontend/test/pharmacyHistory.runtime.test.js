import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { transformWithOxc } from 'vite';
import { JSDOM } from 'jsdom';
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
const files=[];
const abs=path=>JSON.stringify(new URL(path,import.meta.url).href);
async function compile(name,path,replace){const source=replace(await readFile(new URL(path,import.meta.url),'utf8'));const file=new URL(`.history-${name}-${process.pid}.mjs`,import.meta.url);files.push(file);await writeFile(file,(await transformWithOxc(source,`${name}.jsx`,{jsx:{runtime:'automatic'}})).code);const module=await import(file.href);return {module,url:JSON.stringify(file.href)};}
const readImports=source=>source.replace(/import \{ fetchWithAuth \}[^;]+;/,'const fetchWithAuth=(...args)=>globalThis.historyRuntimeFetch(...args);').replace("'../../services/pharmacyReads.js'",abs('../src/services/pharmacyReads.js'));
const history=await compile('hook','../src/features/pharmacy/usePharmacyHistory.js',readImports);
const read=await compile('read','../src/features/pharmacy/usePharmacyRead.js',readImports);
const feedback=await compile('feedback','../src/features/pharmacy/PharmacyReadFeedback.jsx',source=>source.replace("'../../services/pharmacyReads.js'",abs('../src/services/pharmacyReads.js')));
const common=source=>source.replace(/import '\.\/pharmacy\.css';/,'')
 .replace("'./usePharmacyHistory.js'",history.url).replace("'./usePharmacyRead.js'",read.url).replace("'./PharmacyReadFeedback.jsx'",feedback.url)
 .replace("'../../services/pharmacyReads.js'",abs('../src/services/pharmacyReads.js')).replace("'../../utils/pharmacyManagement'",abs('../src/utils/pharmacyManagement.js'))
 .replace(/'..\/..\/utils\/clinicTime(?:\.js)?'/,abs('../src/utils/clinicTime.js'))
 .replace(/import Dialog[^;]+;/,'const Dialog=({open,children,title})=>open?<section role="dialog"><h2>{title}</h2>{children}</section>:null;')
 .replace(/import AppDatePicker[^;]+;/,'const AppDatePicker=()=>null;')
 .replace(/import \{[^}]+\} from 'lucide-react';/,'const PackagePlus=()=>null,RefreshCw=PackagePlus,Search=PackagePlus,AlertTriangle=PackagePlus,FileText=PackagePlus,HelpCircle=PackagePlus,Sliders=PackagePlus,Stethoscope=PackagePlus;')
 .replace(/import \{(?: apiErrorMessage,)? fetchWithAuth \}[^;]+;/,'const fetchWithAuth=(...args)=>globalThis.historyRuntimeFetch(...args);const apiErrorMessage=()=>"Localized error";');
const Management=(await compile('management','../src/features/pharmacy/PharmacyManagement.jsx',common)).module.default;
const Dashboard=(await compile('dashboard','../src/features/pharmacy/PharmacyDashboard.jsx',source=>common(source)
 .replace(/import \{ useWorkflowRefresh \}[^;]+;/,'const useWorkflowRefresh=()=>{};')
 .replace(/import RoleHero[^;]+;/,'const RoleHero=()=>null;').replace(/import PharmacyManagement[^;]+;/,'const PharmacyManagement=()=>null;').replace(/import PharmacyPayment[^;]+;/,'const PharmacyPayment=()=>null;'))).module.default;
await Promise.all(files.map(file=>unlink(file)));
const medicine={id:'medicine',labelAr:'دواء',labelEn:'Medicine',brandName:'Medicine',status:'ACTIVE',unitPriceSdg:500,stock:{}};
const rx=id=>({id,patient:{fullNameAr:id,fullNameEn:id},doctor:{fullNameAr:'طبيب',fullNameEn:'Doctor'},prescriptionDate:'2026-10-30T08:00:00Z',status:'FILLED',prescribedDrugs:[{id:'item',drug:{labelAr:'دواء',labelEn:'Medicine'},qtyPrescribed:2,qtyDispensed:2,dosage:'1',duration:'2 days'}]});
const page=(kind,ids=['OLD'])=>({items:ids.map(id=>kind==='batches'?{id,batchNumber:id,expiryDate:'2030-01-01',qtyOnHand:4,minReorderLevel:2}:{id,movementType:'DISPENSE',batch:{batchNumber:id},createdAt:'2026-10-30T08:00:00Z',quantityDelta:-2,resultingBalance:4,actor:{username:'pharmacy'}}),pagination:{page:1,total:ids.length,totalPages:ids.length?1:0}});
const response=(payload,status=200)=>new Response(JSON.stringify(payload),{status,headers:{'Content-Type':'application/json'}});
const payload=(kind,ids=['OLD'])=>kind==='prescriptions'?ids.map(rx):page(kind,ids);
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};
async function mount(kind,handler,lang='en'){
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/',pretendToBeVisual:true});Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,Node:dom.window.Node,IS_REACT_ACT_ENVIRONMENT:true});
 const requests=[];globalThis.historyRuntimeFetch=(path,options)=>{requests.push({path,signal:options?.signal});if(path.includes(`/prescriptions/history`)||path.includes(`/medicine/${kind}`)||path.includes(`/medicine/${kind}?`))return handler(path,options);if(path.includes('/api/pharmacy/formulary?'))return Promise.resolve(response({items:[medicine],pagination:{page:1,total:1,totalPages:1}}));if(path.includes('/api/records/drugs'))return Promise.resolve(response([medicine]));return Promise.resolve(response([]));};
 const root=createRoot(document.querySelector('#root'));const Component=kind==='prescriptions'?Dashboard:Management;
 await act(async()=>root.render(h(Component,{lang})));
 const click=async selector=>act(async()=>{const element=document.querySelector(selector);assert.ok(element,selector);element.click();});
 const open=async()=>{if(kind==='prescriptions')await click('.pharmacy-queue-tabs button:nth-child(2)');else{await click('.pharmacy-action-trigger');await act(async()=>[...document.querySelectorAll('[role=menuitem]')].find(button=>(kind==='batches'?['View batches','عرض الدفعات']:['Movement history','سجل الحركات']).includes(button.textContent)).click());}};
 await open();
 return{requests,click,open,scope:()=>document.querySelector(kind==='prescriptions'?'.pharmacy-queue-column':'[role=dialog]'),refresh:()=>click(kind==='prescriptions'?'.pharmacy-queue-column .panel-header button':'[role=dialog] .dialog-actions button:first-child'),close:()=>click(kind==='prescriptions'?'.pharmacy-queue-tabs button:first-child':'[role=dialog] .dialog-actions button:last-child'),render:async language=>act(async()=>root.render(h(Component,{lang:language}))),cleanup:async()=>{await act(async()=>root.unmount());dom.window.close();delete globalThis.historyRuntimeFetch;}};
}
for(const kind of ['prescriptions','batches','movements']){
 test(`${kind} UI retains snapshot on refresh failure, retries without duplicate rows, and localizes an existing error`,async()=>{
  let phase='success';const app=await mount(kind,async()=>phase==='failure'?response({error:'RAW ENGLISH ERROR'},500):response(payload(kind,phase==='retry'?['NEW','NEW']:['OLD'])));
  try{assert.match(app.scope().textContent,/OLD/);phase='failure';await app.refresh();assert.match(app.scope().textContent,/OLD/);assert.ok(app.scope().querySelector('[role=alert]'));assert.doesNotMatch(app.scope().textContent,/No .*history|No .*movements|No inventory batches|RAW ENGLISH/);
   await app.render('ar');assert.match(app.scope().querySelector('[role=alert]').textContent,/[\u0600-\u06ff]/u);assert.match(app.scope().textContent,/OLD/);
   phase='retry';await app.click(`${kind==='prescriptions'?'.pharmacy-queue-column':'[role=dialog]'} .pharmacy-read-feedback button`);assert.match(app.scope().textContent,/NEW/);assert.doesNotMatch(app.scope().textContent,/OLD/);assert.equal(app.scope().querySelector('[role=alert]'),null);
   assert.equal(app.scope().querySelectorAll(kind==='prescriptions'?'.queue-card-item':'tbody tr').length,1);
  }finally{await app.cleanup();}
 });
 for(const status of [401,403,404,500,'network','malformed'])test(`${kind} UI initial ${status} is an error with Retry, never no-history`,async()=>{
  const app=await mount(kind,async()=>{if(status==='network')throw Error('RAW ENGLISH');return status==='malformed'?response({wrong:true}):response({error:'RAW ENGLISH'},status);},'ar');
  try{assert.ok(app.scope().querySelector('[role=alert]'));assert.match(app.scope().querySelector('[role=alert]').textContent,/[\u0600-\u06ff]/u);assert.equal(app.scope().querySelector('.pharmacy-read-feedback [role=status]'),null);assert.match(app.scope().querySelector('.pharmacy-read-feedback button').textContent,/إعادة المحاولة/);assert.doesNotMatch(app.scope().textContent,/لا توجد وصفات محفوظة|لا توجد حركات مخزون|لا توجد دفعات مسجلة|RAW ENGLISH/);}finally{await app.cleanup();}
 });
 test(`${kind} UI renders empty only after successful empty response`,async()=>{
  const slow=deferred();const app=await mount(kind,()=>slow.promise);
  try{assert.ok(app.scope().querySelector('.pharmacy-read-feedback [role=status]'));assert.doesNotMatch(app.scope().textContent,/No prescription history|No stock movements|No inventory batches/);await act(async()=>slow.resolve(response(payload(kind,[]))));assert.equal(app.scope().querySelector('.pharmacy-read-feedback'),null);assert.match(app.scope().textContent,/No prescription history|No stock movements|No inventory batches/);}finally{await app.cleanup();}
 });
 test(`${kind} UI cancels tab/dialog work, resumes with fresh data, and ignores late response`,async()=>{
  const slow=deferred();let count=0;const app=await mount(kind,async()=>++count===1?slow.promise:response(payload(kind,['NEW'])));
  try{const oldRequest=app.requests.find(request=>request.path.includes(kind==='prescriptions'?'/prescriptions/history':`/medicine/${kind}`));assert.ok(oldRequest);await app.close();assert.equal(oldRequest.signal.aborted,true);await app.open();assert.match(app.scope().textContent,/NEW/);await act(async()=>slow.resolve(response(payload(kind,['OBSOLETE']))));assert.doesNotMatch(app.scope().textContent,/OBSOLETE/);assert.equal(app.scope().querySelector('.pharmacy-read-feedback [role=status]'),null);}finally{await app.cleanup();}
 });
 test(`${kind} UI unmount aborts current history read`,async()=>{
  const app=await mount(kind,()=>new Promise(()=>{}));const request=app.requests.find(request=>request.path.includes(kind==='prescriptions'?'/prescriptions/history':`/medicine/${kind}`));await app.cleanup();assert.equal(request.signal.aborted,true);
 });
}
test('historical prescription selection uses label-only drug DTOs without inventory/payment reads',async()=>{
 const app=await mount('prescriptions',async()=>response([rx('FILLED')]));
 try{const before=app.requests.length;await app.click('.pharmacy-queue-column .queue-card-item');assert.match(document.querySelector('.pharmacy-dispense-column').textContent,/Dispensed: 2/);assert.doesNotMatch(document.querySelector('.pharmacy-dispense-column').textContent,/Checking stock/);assert.equal(app.requests.length,before);}finally{await app.cleanup();}
});

for(const kind of ['prescriptions','batches','movements'])test(`${kind} reopens its last successful snapshot while a new read is slow or fails`,async()=>{
 const slow=deferred();let phase='success';const app=await mount(kind,async()=>phase==='success'?response(payload(kind,['OLD'])):slow.promise);
 try{assert.match(app.scope().textContent,/OLD/);await app.close();phase='slow';await app.open();assert.match(app.scope().textContent,/OLD/);assert.ok(app.scope().querySelector('.pharmacy-read-feedback [role=status]'));
  await act(async()=>slow.resolve(response({error:'RAW ENGLISH'},500)));assert.ok(app.scope().querySelector('[role=alert]'));assert.match(app.scope().textContent,/OLD/);assert.equal(app.scope().querySelector('.pharmacy-read-feedback [role=status]'),null);
 }finally{await app.cleanup();}
});
test('malformed nested prescription history preserves the previous renderable snapshot',async()=>{
 let malformed=false;const app=await mount('prescriptions',async()=>response(malformed?[{...rx('BAD'),patient:{fullNameEn:{private:'bad'}}}]:[rx('OLD')]));
 try{malformed=true;await app.refresh();assert.ok(app.scope().querySelector('[role=alert]'));assert.match(app.scope().textContent,/OLD/);assert.doesNotMatch(app.scope().textContent,/BAD|private/);}finally{await app.cleanup();}
});

for(const kind of ['batches','movements'])test(`${kind} empty items with nonempty server count is an error, not no-history`,async()=>{
 const app=await mount(kind,async()=>response({items:[],pagination:{page:1,total:10,totalPages:1}}));
 try{assert.ok(app.scope().querySelector('[role=alert]'));assert.doesNotMatch(app.scope().textContent,/No stock movements|No inventory batches/);}finally{await app.cleanup();}
});
