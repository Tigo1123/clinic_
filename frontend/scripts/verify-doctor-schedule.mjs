// Actual component, controlled API fixture. PostgreSQL coverage: test:schedule-workflow.
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, unlink } from 'node:fs/promises';
import assert from 'node:assert/strict';
const profile = await mkdtemp('/tmp/clinic-schedule-browser-');
const page = `test/.schedule-browser-${process.pid}.html`;
const pause = ms => new Promise(r => setTimeout(r, ms));
async function wait(fn, name) { for (let i = 0; i < 100; i++) { const v = await fn(); if (v) return v; await pause(100); } throw Error(name); }
let server, chrome, socket;
try {
 await writeFile(page, `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">
 import '../src/index.css'; import '../src/App.css'; import '../src/components/ui/ui.css';
 import React from 'react'; import { createRoot } from 'react-dom/client'; import Panel from '../src/features/admin/AdminSchedulePanel.jsx';
 import i18n from '../src/i18n.js';
 const original = window.fetch; window.saved = {}; window.mutations = [];
 window.fetch = async (url, options = {}) => {
  const reply = (data, status = 200) => new Response(JSON.stringify(data), { status });
  if (url.endsWith('/api/public-config')) return reply({ clinicTimeZone: 'Africa/Khartoum' });
  if (url.includes('/api/admin/doctors?')) return reply([{ id:'A', fullNameEn:'Doctor A', fullNameAr:'طبيب أ' }, { id:'B', fullNameEn:'Doctor B', fullNameAr:'طبيب ب' }]);
  const match = url.match(/\\/api\\/admin\\/doctors\\/(A|B)\\/(schedules|schedule-exceptions)/);
  if (!match) return original(url, options);
  const [, id, kind] = match;
  if (kind === 'schedule-exceptions') return reply([]);
  if (!options.method || options.method === 'GET') return reply(window.saved[id] ? [window.saved[id]] : []);
  window.mutations.push({ id, method: options.method }); const data = JSON.parse(options.body);
  for (let i=0; i<data.periods.length; i++) for (let j=0; j<i; j++) { const a=data.periods[i], b=data.periods[j]; if(a.active && b.active && a.dayOfWeek===b.dayOfWeek && a.startTime<b.endTime && b.startTime<a.endTime) return reply({error:{message:a.dayOfWeek+': '+a.startTime+'–'+a.endTime+' overlaps '+b.startTime+'–'+b.endTime}},422); }
  window.saved[id] = { ...data, id:'schedule-'+id }; return reply(window.saved[id]);
 };
 const root = createRoot(document.getElementById('root'));
 const t = i18n.t.bind(i18n);
 window.setScheduleLanguage = async lang => { await i18n.changeLanguage(lang); document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'; root.render(React.createElement(Panel, { t, lang })); };
 await window.setScheduleLanguage('en');
 </script></body></html>`);
 server = await createServer({ server: { host:'127.0.0.1', port:5189, strictPort:true }, logLevel:'error' }); await server.listen();
 chrome = spawn('/opt/google/chrome/chrome', ['--headless=new','--no-sandbox','--disable-gpu','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'], { stdio:'ignore' }); chrome.on('error',()=>{});
 const debugPort = await wait(async()=>{try{return (await readFile(profile+'/DevToolsActivePort','utf8')).split('\n')[0];}catch{return null;}},'Chrome start');
 const target = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`,{method:'PUT'})).json();
 socket = new WebSocket(target.webSocketDebuggerUrl); await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j;});
 let seq=0; const pending=new Map(); const errors=[];
 socket.onmessage=({data})=>{const m=JSON.parse(data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(m.error){p.reject(Error(m.error.message));}else{p.resolve(m.result);}}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);};
 const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text);return r.result.value;};
 const click=text=>evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes(${JSON.stringify(text)})).click()`);
 const select=(selector,value)=>evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
 const ready=()=>wait(()=>evaluate(`document.querySelector('form>fieldset')?.disabled===false`),'Editable schedule');
 await send('Runtime.enable'); await send('Page.enable');
 await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:`http://127.0.0.1:${server.httpServer.address().port}/${page}`}); await ready();
 await click('Add working period'); await click('Add working period');
 assert.equal(await evaluate(`document.querySelector('.admin-period select').options.length`),7);
 await click('Save schedule'); await wait(()=>evaluate(`document.querySelector('[role=alert]')?.textContent.includes('MONDAY')`),'Overlap error');
 assert.equal(await evaluate(`document.querySelectorAll('.admin-period').length`),2);
 await select('.admin-period:nth-child(2) select','SUNDAY'); await click('Save schedule');
 await wait(()=>evaluate(`Boolean(document.querySelector('.badge-success'))`),'Save success'); await ready();
 assert.deepEqual(await evaluate(`window.saved.A.periods.map(p=>p.dayOfWeek)`),['MONDAY','SUNDAY']);
 // The first save starts today; the second creates tomorrow's version. The third edits it.
 await click('Save schedule'); await ready(); await click('Save schedule'); await ready();
 assert.equal(await evaluate(`window.mutations.at(-1).method`),'PUT');
 await select('#schedule-doctor','B'); await ready(); assert.equal(await evaluate(`document.querySelectorAll('.admin-period').length`),0);
 await select('#schedule-doctor','A'); await ready(); assert.equal(await evaluate(`document.querySelectorAll('.admin-period').length`),2);
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 await pause(150);
 assert.equal(await evaluate(`innerWidth`),390);
 assert.equal(await evaluate(`document.documentElement.scrollWidth<=innerWidth`),true);
 const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await writeFile(profile+'/schedule.png',Buffer.from(shot.data,'base64'));
 await evaluate(`window.setScheduleLanguage('ar')`); await ready(); await pause(150);
 assert.equal(await evaluate(`document.documentElement.dir`),'rtl');
 assert.equal(await evaluate(`document.documentElement.scrollWidth<=innerWidth`),true);
 const rtlShot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await writeFile(profile+'/schedule-rtl.png',Buffer.from(rtlShot.data,'base64'));
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({passed:['seven weekdays','overlap message and preserved input','multi-day save and reload','repeat edit uses PUT','doctor switching','mobile width','Arabic RTL mobile','no browser exceptions'],api:'controlled fixture',screenshots:[profile+'/schedule.png',profile+'/schedule-rtl.png']},null,2));
} finally { socket?.close();chrome?.kill();await server?.close();await unlink(page).catch(()=>{}); }
