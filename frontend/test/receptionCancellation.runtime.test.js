import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { transformWithOxc } from 'vite';
import { JSDOM } from 'jsdom';
import { createElement as h, useState, useRef, useCallback, act } from 'react';
import { createRoot } from 'react-dom/client';
const files=[];async function compile(name,path,replace=x=>x){const file=new URL(`.reception-cancel-${process.pid}-${name}.mjs`,import.meta.url);files.push(file);await writeFile(file,(await transformWithOxc(replace(await readFile(new URL(path,import.meta.url),'utf8')),name+'.jsx',{jsx:{runtime:'automatic'}})).code);return {module:await import(file.href),url:JSON.stringify(file.href)};}
const dialog=await compile('Dialog','../src/components/ui/Dialog.jsx');
const Cancellation=(await compile('Cancellation','../src/features/reception/ReceptionCancellationDialog.jsx',source=>source.replace("'../../components/ui/Dialog'",dialog.url).replace("'./receptionCancellation.js'",JSON.stringify(new URL('../src/features/reception/receptionCancellation.js',import.meta.url).href)).replace(/import \{ fetchWithAuth \}[^;]+;/,'const fetchWithAuth=(...args)=>globalThis.cancelRuntimeRequest(...args);'))).module.default;
await Promise.all(files.map(file=>unlink(file)));
const response=(status=200)=>new Response(JSON.stringify(status===200?{id:'appointment',status:'CANCELLED'}:{error:{code:status===409?'APPOINTMENT_STATE_CONFLICT':'FAILED',message:'RAW PRIVATE ENGLISH'}}),{status});
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};
async function mount(handler,lang='en'){
 const dom=new JSDOM('<button id="outside">Outside</button><div id="root"></div>',{url:'http://localhost',pretendToBeVisual:true});Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,Node:dom.window.Node,requestAnimationFrame:dom.window.requestAnimationFrame.bind(dom.window),IS_REACT_ACT_ENVIRONMENT:true});document.documentElement.dir=lang==='ar'?'rtl':'ltr';
 const calls=[],committed=[];let refreshes=0;
 globalThis.cancelRuntimeRequest=(...args)=>{calls.push(args);return handler(...args);};
 function Harness(){const [target,setTarget]=useState(null),fallback=useRef(null);const close=useCallback(()=>setTarget(null),[]);const success=useCallback(row=>{committed.push(row);setTarget(null);},[]);return h('div',null,h('button',{id:'trigger',onClick:()=>setTarget({id:'appointment',patient:{fullNameEn:'Test patient',fullNameAr:'مريض'},appointmentDate:'2026-10-30',appointmentTime:'09:00'})},'Cancel appointment'),h('button',{id:'fallback',ref:fallback},'Appointments'),h(Cancellation,{appointment:target,lang,onClose:close,onCommitted:success,onRevalidate:()=>{refreshes++;},fallbackFocusRef:fallback}));}
 const root=createRoot(document.querySelector('#root'));await act(async()=>root.render(h(Harness)));await act(async()=>{document.querySelector('#trigger').focus();document.querySelector('#trigger').click();});await act(async()=>new Promise(r=>setTimeout(r,25)));
 return{calls,committed,refreshes:()=>refreshes,submit:()=>act(async()=>document.querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}))),cleanup:async()=>{await act(async()=>root.unmount());dom.window.close();delete globalThis.cancelRuntimeRequest;}};
}
test('opening/Back/Escape send no request; dialog has labels, focus containment and focus return',async()=>{
 const app=await mount(async()=>response());
 try{const dialog=document.querySelector('[role=dialog]');assert.equal(dialog.getAttribute('aria-modal'),'true');assert.ok(document.getElementById(dialog.getAttribute('aria-labelledby')));assert.equal(app.calls.length,0);const buttons=dialog.querySelectorAll('button');assert.equal(document.activeElement,buttons[0]);
  buttons[buttons.length-1].focus();await act(async()=>document.activeElement.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true})));assert.equal(document.activeElement,buttons[0]);
  await act(async()=>dialog.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})));assert.equal(document.querySelector('[role=dialog]'),null);assert.equal(document.activeElement.id,'trigger');assert.equal(app.calls.length,0);
 }finally{await app.cleanup();}
});
test('rapid submits are single-flight, pending blocks Escape, and success clears pending and closes',async()=>{
 const slow=deferred();const app=await mount(()=>slow.promise);
 try{await act(async()=>{const form=document.querySelector('form');for(let i=0;i<3;i++)form.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));});assert.equal(app.calls.length,1);assert.ok([...document.querySelectorAll('[role=dialog] button')].every(button=>button.disabled));assert.equal(document.querySelector('form').getAttribute('aria-busy'),'true');assert.ok(document.querySelector('[role=status]'));
  await act(async()=>document.querySelector('[role=dialog]').dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})));assert.ok(document.querySelector('[role=dialog]'));
  await act(async()=>slow.resolve(response()));assert.equal(app.committed.length,1);assert.equal(document.querySelector('[role=dialog]'),null);
 }finally{await app.cleanup();}
});
for(const lang of ['ar','en'])for(const status of [400,401,403,404,409,422,500,'network'])test(`${lang} ${status} clears pending, announces a safe error, retries successfully`,async()=>{
 let fail=true;const app=await mount(async()=>{if(fail){if(status==='network')throw Error('RAW PRIVATE ENGLISH');return response(status);}return response();},lang);
 try{await app.submit();assert.ok(document.querySelector('[role=alert]'));assert.equal(document.querySelector('button[type=submit]').disabled,false);assert.equal(document.querySelector('form').getAttribute('aria-busy'),'false');assert.equal(app.committed.length,0);assert.doesNotMatch(document.querySelector('[role=alert]').textContent,/RAW PRIVATE/);assert.equal(/[\u0600-\u06ff]/u.test(document.querySelector('[role=alert]').textContent),lang==='ar');if([404,409,'network'].includes(status))assert.equal(app.refreshes(),1);
  fail=false;await app.submit();assert.equal(app.calls.length,2);assert.equal(app.committed.length,1);assert.equal(document.querySelector('[role=dialog]'),null);
 }finally{await app.cleanup();}
});
