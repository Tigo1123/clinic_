import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { transformWithOxc } from 'vite';
import { pagingReplacements } from './helpers/staffPagingHarness.js';
import { staffCopy, staffErrorMessage } from '../src/features/admin/staffMessages.js';
const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'});
Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,Element:dom.window.Element,Node:dom.window.Node,ShadowRoot:dom.window.ShadowRoot,DocumentFragment:dom.window.DocumentFragment,getComputedStyle:dom.window.getComputedStyle,IS_REACT_ACT_ENVIRONMENT:true});
window.matchMedia=query=>({matches:false,media:query,addEventListener(){},removeEventListener(){}});
const {createElement:h,act}=await import('react');const {createRoot}=await import('react-dom/client');
let source=await readFile(new URL('../src/features/admin/StaffAccountsPanel.jsx',import.meta.url),'utf8');
source=source.replace(/import \{ useTheme \}[^;]+;/,"const useTheme = () => ({ theme: 'light' });")
 .replace(/import \{ fetchWithAuth \}[^;]+;/,'const fetchWithAuth = (...args) => globalThis.staffFetch(...args);')
 .replace("import './staffAccounts.css';",'')
 .replace(/from '([^']+\.js)'/g,(all,path)=>path.startsWith('.')?`from ${JSON.stringify(new URL('../src/features/admin/'+path,import.meta.url).href)}`:all);
const {default:i18n}=await import('../src/i18n.js');
let passwordSource=await readFile(new URL('../src/components/PasswordField.jsx',import.meta.url),'utf8');
passwordSource=passwordSource.replace(/import \{ useTheme \}[^;]+;/,"const useTheme = () => ({ theme: 'light' });").replace("'../utils/patientMuiTheme.js'",JSON.stringify(new URL('../src/utils/patientMuiTheme.js',import.meta.url).href));
const passwordFile=new URL(`.staff-password-${process.pid}.mjs`,import.meta.url);
await writeFile(passwordFile,(await transformWithOxc(passwordSource,'PasswordField.jsx',{jsx:{runtime:'automatic'}})).code);
source=source.replace("'../../components/PasswordField.jsx'",JSON.stringify(passwordFile.href));
source=await pagingReplacements(source,'staffFetch','staffPaging');
const file=new URL(`.staff-panel-${process.pid}.mjs`,import.meta.url);await writeFile(file,(await transformWithOxc(source,'StaffAccountsPanel.jsx',{jsx:{runtime:'automatic'}})).code);
let Panel;try{Panel=(await import(file.href)).default;}finally{await unlink(file);await unlink(passwordFile);}
let root,requests,rows,handler,lang,actor;
const response=(body={},status=200,hasMore=false)=>({ok:status<400,status,headers:{get:()=>String(hasMore)},json:async()=>body});
const baseline=[{id:'self',username:'admin@example.test',role:'ADMIN',status:'ACTIVE'},{id:'lab',username:'lab@example.test',role:'LAB_TECH',status:'ACTIVE'},{id:'pharmacy',username:'very-long-pharmacy-email-address@example.test',role:'PHARMACIST',status:'INACTIVE'}];
beforeEach(()=>{requests=[];rows=structuredClone(baseline);handler=null;lang='en';actor={id:'self',role:'ADMIN',mfaEnabled:false};});
afterEach(async()=>{if(root)await act(async()=>root.unmount());root=null;});
async function mount(){await i18n.changeLanguage(lang);globalThis.staffFetch=async(url,options)=>{requests.push({url,options});if(options)return handler?handler(url,options):response({});const parsed=new URL(url,'http://localhost');const q=parsed.searchParams;const filtered=rows.filter(r=>(!q.get('search')||r.username.toLowerCase().includes(q.get('search').toLowerCase()))&&(!q.get('role')||r.role===q.get('role'))&&(!q.get('status')||r.status===q.get('status')));const page=Number(q.get('page')||1),size=Number(q.get('pageSize')||50);return response(filtered.slice((page-1)*size,page*size),200,page*size<filtered.length);};root=createRoot(document.getElementById('root'));await act(async()=>root.render(h(Panel,{lang,user:actor,specialties:[{id:'specialty',nameEn:'General',nameAr:'عام',active:true}]})));}
async function click(text,scope=document){const button=[...scope.querySelectorAll('button,[role=menuitem]')].find(b=>b.textContent.trim()===text);assert.ok(button,`Missing ${text}`);await act(async()=>button.click());}
async function change(field,value){assert.ok(field,'field exists');await act(async()=>{const proto=field.tagName==='SELECT'?window.HTMLSelectElement.prototype:window.HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(field,value);field.dispatchEvent(new window.Event(field.tagName==='SELECT'?'change':'input',{bubbles:true}));});}
const submit=scope=>act(async()=>scope.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})));
const field=(label,scope=document)=>[...scope.querySelectorAll('input,select')].find(e=>e.closest('.MuiFormControl-root')?.querySelector('label')?.textContent.includes(label));
const actionForm=()=>document.querySelector('[role=dialog] form');
async function openAction(kind,id='lab'){const button=document.querySelector(`[data-staff-id="${id}"] button`);button.getBoundingClientRect=()=>({x:10,y:10,left:10,top:10,right:54,bottom:54,width:44,height:44});await act(async()=>button.click());await click(staffCopy[lang][kind],document.querySelector('[role=menu]'));}
async function openCreate(){await click(staffCopy[lang].add);return document.getElementById('staff-create-body');}
async function fillCreate(password='ValidStaff1'){const form=await openCreate();await change(field(staffCopy[lang].username,form),'new@example.test');await change(document.querySelector('#staff-create-password'),password);return form;}
const mutations=()=>requests.filter(r=>r.options);

test('directory renders localized role/status chips, isolated long usernames and one action button per row',async()=>{
 await mount();assert.equal(document.querySelectorAll('[data-staff-id]').length,3);assert.match(document.body.textContent,/Lab Technician/);assert.match(document.body.textContent,/Inactive/);assert.equal(document.querySelector('[data-staff-id=pharmacy] bdi').dir,'ltr');assert.equal(document.querySelector('[data-staff-id=self] button').disabled,true);assert.ok([...document.querySelectorAll('[data-staff-id]')].every(row=>row.querySelectorAll('button').length===1));
});
test('role, status and username filters work together and are sent to the server',async()=>{
 await mount();const selects=document.querySelectorAll('[aria-labelledby=staff-directory-title] select');await change(selects[0],'PHARMACIST');assert.equal(document.querySelectorAll('[data-staff-id]').length,1);await change(selects[1],'INACTIVE');await change(document.querySelector('input[type=search]'),'PHARMACY');await act(async()=>new Promise(r=>setTimeout(r,300)));assert.equal(document.querySelectorAll('[data-staff-id]').length,1);assert.ok(requests.some(r=>r.url.includes('search=PHARMACY')&&r.url.includes('role=PHARMACIST')&&r.url.includes('status=INACTIVE')));
 await change(document.querySelector('input[type=search]'),'missing');assert.match(document.body.textContent,/No staff match/);
});
test('successful creation clears and masks the password and adds the returned row',async()=>{
 handler=async(url,options)=>response({user:{id:'created',username:JSON.parse(options.body).username,role:'RECEPTIONIST',status:'ACTIVE'}},201);await mount();const form=await fillCreate();await act(async()=>form.querySelector('button[aria-label="Show password"]').click());assert.equal(document.querySelector('#staff-create-password').type,'text');await submit(form);assert.equal(document.querySelector('#staff-create-password').value,'');assert.equal(document.querySelector('#staff-create-password').type,'password');assert.ok(document.querySelector('[data-staff-id=created]'));assert.equal(JSON.parse(mutations()[0].options.body).role,'RECEPTIONIST');assert.equal(JSON.parse(mutations()[0].options.body).specialtyId,undefined);
});
for(const language of ['en','ar'])test(`${language}: duplicate username is localized and password remains only for retry`,async()=>{
 lang=language;handler=()=>response({error:{code:'USERNAME_ALREADY_REGISTERED',message:'Username is already registered.'}},409);await mount();const form=await fillCreate();await submit(form);assert.equal(document.querySelector('[role=alert]').textContent,staffCopy[lang].USERNAME_ALREADY_REGISTERED);assert.equal(document.querySelector('#staff-create-password').value,'ValidStaff1');
});
test('password policy rejects weak input and duplicate create submissions are blocked',async()=>{
 let resolve;handler=()=>new Promise(r=>{resolve=r});await mount();const form=await fillCreate('weak');await submit(form);assert.equal(mutations().length,0);assert.match(document.querySelector('[role=alert]').textContent,/10–200/);await change(document.querySelector('#staff-create-password'),'ValidStaff1');await act(async()=>{for(let i=0;i<2;i++)form.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));});assert.equal(mutations().length,1);await act(async()=>resolve(response({user:{id:'new',username:'new@example.test',role:'RECEPTIONIST',status:'ACTIVE'}},201)));
});
test('doctor creation preserves profile, specialty and fee fields',async()=>{
 handler=()=>response({user:{id:'doctor',username:'new@example.test',role:'DOCTOR',status:'ACTIVE'}},201);await mount();const form=await fillCreate();await change(field('Role',form),'DOCTOR');await change(field('Full name (Arabic)',form),'د. اختبار');await change(field('Full name (English)',form),'Dr. Test');await change(field('Specialty',form),'specialty');await change(field('Consultation fee',form),'100');await submit(form);const data=JSON.parse(mutations()[0].options.body);assert.equal(data.specialtyId,'specialty');assert.equal(data.fullNameAr,'د. اختبار');assert.equal(Number(data.consultationFee),100);
});
for(const language of ['en','ar'])test(`${language}: deleting an account requires confirmation and removes only its row`,async()=>{
 lang=language;handler=()=>response({},204);await mount();await openAction('delete');assert.equal(mutations().length,0);assert.equal(document.querySelector('#staff-action-title').textContent,staffCopy[lang].deleteTitle);assert.equal(document.querySelector('#staff-action-description').textContent,staffCopy[lang].deleteDescription);await click(staffCopy[lang].confirmDelete,document.querySelector('[role=dialog]'));assert.equal(mutations()[0].options.method,'DELETE');assert.equal(document.querySelector('[data-staff-id=lab]'),null);assert.ok(document.querySelector('[data-staff-id=self]'));assert.match(document.querySelector('[role=status]').textContent,new RegExp(staffCopy[lang].deleted.replaceAll('.','\\.')));
});
for(const language of ['en','ar'])test(`${language}: blocked history is localized and offers disable without deleting the row`,async()=>{
 lang=language;handler=()=>response({error:{code:'STAFF_HAS_HISTORY',message:'Unsafe internal details'}},409);await mount();await openAction('delete');await submit(actionForm());assert.equal(document.querySelector('[role=alert]').textContent,staffCopy[lang].STAFF_HAS_HISTORY);assert.ok(document.querySelector('[data-staff-id=lab]'));await click(staffCopy[lang].disable,document.querySelector('[role=dialog]'));assert.equal(document.querySelector('#staff-action-title').textContent,staffCopy[lang].disableTitle);assert.equal(mutations().length,1);
});
test('cancel never deletes and two confirmed delete submissions send one request',async()=>{
 let resolve;handler=()=>new Promise(r=>{resolve=r});await mount();await openAction('delete');await click('Cancel',document.querySelector('[role=dialog]'));assert.equal(mutations().length,0);await act(async()=>new Promise(r=>setTimeout(r,250)));await openAction('delete');const form=actionForm();await act(async()=>{for(let i=0;i<2;i++)form.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));});assert.equal(mutations().length,1);await act(async()=>resolve(response({},204)));assert.equal(document.querySelector('[data-staff-id=lab]'),null);
});
test('disable and enable require confirmation and keep existing status payloads',async()=>{
 handler=()=>response({});await mount();await openAction('disable');assert.equal(mutations().length,0);await submit(actionForm());assert.equal(JSON.parse(mutations()[0].options.body).status,'INACTIVE');assert.match(document.querySelector('[data-staff-id=lab]').textContent,/Inactive/);await act(async()=>new Promise(r=>setTimeout(r,250)));await openAction('enable');await submit(actionForm());assert.equal(JSON.parse(mutations()[1].options.body).status,'ACTIVE');assert.match(document.querySelector('[data-staff-id=lab]').textContent,/Active/);
});
test('terminate sessions is separate and duplicate submissions are blocked',async()=>{
 let resolve;handler=()=>new Promise(r=>{resolve=r});await mount();await openAction('revoke');assert.equal(mutations().length,0);assert.match(document.querySelector('#staff-action-description').textContent,/does not deactivate/);const form=actionForm();await act(async()=>{form.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));form.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));});assert.equal(mutations().length,1);assert.ok(mutations()[0].url.endsWith('/revoke-sessions'));await act(async()=>resolve(response({})));assert.match(document.querySelector('[data-staff-id=lab]').textContent,/Active/);
});
test('reset confirms passwords and preserves administrator reauthentication and MFA requirements',async()=>{
 actor.mfaEnabled=true;handler=()=>response({});await mount();await openAction('reset');await change(document.querySelector('#staff-reset-new-password'),'NewStaff123');await change(document.querySelector('#staff-reset-confirm-password'),'Different123');await submit(actionForm());assert.equal(mutations().length,0);await change(document.querySelector('#staff-reset-confirm-password'),'NewStaff123');await change(document.querySelector('#staff-reset-admin-password'),'AdminSecret123');await change(document.querySelector('#staff-reset-mfa-code'),'123456');await submit(actionForm());const data=JSON.parse(mutations()[0].options.body);assert.deepEqual(data,{newPassword:'NewStaff123',currentAdminPassword:'AdminSecret123',mfaCode:'123456'});assert.equal(document.querySelector('#staff-reset-admin-password')?.value||'','');assert.equal(document.querySelector('#staff-reset-new-password')?.value||'','');
});
test('reset failures clear administrator secrets and never display unknown backend text',async()=>{
 handler=()=>response({error:{code:'ADMIN_REAUTHENTICATION_FAILED',message:'secret SQL'}},401);await mount();await openAction('reset');for(const [id,value]of[['staff-reset-new-password','NewStaff123'],['staff-reset-confirm-password','NewStaff123'],['staff-reset-admin-password','WrongSecret123']])await change(document.getElementById(id),value);await submit(actionForm());assert.equal(document.querySelector('#staff-reset-admin-password').value,'');assert.equal(document.querySelector('[role=alert]').textContent,staffCopy.en.ADMIN_REAUTHENTICATION_FAILED);assert.equal(staffErrorMessage({error:{code:'UNKNOWN',message:'secret SQL'}},'ar',500),staffCopy.ar.failure);
});
test('empty and API failure states are clear and retryable',async()=>{
 rows=[];await mount();assert.match(document.body.textContent,/No staff accounts yet/);await act(async()=>root.unmount());root=null;globalThis.staffFetch=async()=>response({error:'secret SQL'},500);root=createRoot(document.getElementById('root'));await act(async()=>root.render(h(Panel,{lang:'en',user:actor})));assert.match(document.querySelector('[role=alert]').textContent,/Unable to load staff/);assert.ok([...document.querySelectorAll('button')].some(b=>b.textContent==='Retry'));
});
test('Arabic root, menu and dialog use RTL and usernames stay isolated LTR',async()=>{
 lang='ar';await mount();assert.equal(document.querySelector('.staff-accounts-panel').dir,'rtl');assert.equal(document.querySelector('[data-staff-id=pharmacy] bdi').dir,'ltr');await openAction('delete');assert.ok(document.querySelector('[dir=rtl][role=presentation]')||document.querySelector('.MuiDialog-root[dir=rtl]'));assert.match(document.querySelector('#staff-action-title').textContent,/حذف حساب الموظف/);
});

test('failed creation keeps a retry password masked even if it was revealed before submission',async()=>{
 handler=()=>response({error:{code:'USERNAME_ALREADY_REGISTERED'}},409);await mount();const form=await fillCreate();await act(async()=>form.querySelector('button[aria-label="Show password"]').click());assert.equal(document.querySelector('#staff-create-password').type,'text');await submit(form);assert.equal(document.querySelector('#staff-create-password').value,'ValidStaff1');assert.equal(document.querySelector('#staff-create-password').type,'password');
});

test('collapsing the create form clears its password while retaining the username draft',async()=>{
 await mount();await fillCreate();await click('Close form');await act(async()=>new Promise(r=>setTimeout(r,30)));await openCreate();assert.equal(document.querySelector('#staff-create-password').value,'');assert.equal(field('Username / Email',document.querySelector('#staff-create-body')).value,'new@example.test');
});

test('deleting from a paged directory refills the shifted page and never skips the next account',async()=>{
 rows=[baseline[0],baseline[1],...Array.from({length:53},(_,i)=>({id:`extra-${i}`,username:`extra-${i}@example.test`,role:'RECEPTIONIST',status:'ACTIVE'}))];
 handler=()=>{rows=rows.filter(row=>row.id!=='lab');return response({},204);};
 await mount();assert.equal(document.querySelectorAll('[data-staff-id]').length,50);assert.equal(document.querySelector('[data-staff-id="extra-48"]'),null);
 await openAction('delete');await submit(actionForm());assert.equal(document.querySelector('[data-staff-id=lab]'),null);assert.ok(document.querySelector('[data-staff-id="extra-48"]'));
 await click('Load more staff');assert.equal(document.querySelectorAll('[data-staff-id]').length,54);assert.ok(document.querySelector('[data-staff-id="extra-52"]'));
});
