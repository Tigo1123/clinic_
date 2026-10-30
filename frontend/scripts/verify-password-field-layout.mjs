import fs from 'node:fs';
import assert from 'node:assert/strict';
const origin=process.env.CLINIC_UI_ORIGIN||'http://127.0.0.1:5187';
const browser=process.env.CLINIC_BROWSER_ORIGIN||'http://127.0.0.1:9337';
for(const url of [origin,browser])assert.ok(['localhost','127.0.0.1'].includes(new URL(url).hostname));
const output=process.env.CLINIC_UI_OUTPUT||'/tmp/clinic-password-layout';fs.mkdirSync(output,{recursive:true});
const report={checks:[],metrics:[],screenshots:[],exceptions:[],mockedWrites:[]};
const target=await(await fetch(`${browser}/json/new?about:blank`,{method:'PUT'})).json();
const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
let seq=0;const pending=new Map();
const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
const patient={id:'patient-layout-fixture',fullNameAr:'مريض الاختبار',fullNameEn:'Layout Test Patient',email:'layout@example.test',phone:'+249912345678',gender:'MALE',dateOfBirth:'1990-01-01',addressStateId:1,addressDetails:'Test address',emergencyContact:'Test contact',emailVerified:true,phoneVerified:false,googleAccount:{linked:false}};
ws.onmessage=async({data})=>{
 const event=JSON.parse(data);if(event.id){const task=pending.get(event.id);if(!task)return;pending.delete(event.id);event.error?task.reject(Error(event.error.message)):task.resolve(event.result);return;}
 if(event.method==='Runtime.exceptionThrown')report.exceptions.push(event.params.exceptionDetails.exception?.description||event.params.exceptionDetails.text);
 if(event.method!=='Fetch.requestPaused')return;
 const {requestId,request}=event.params;const path=new URL(request.url).pathname;
 let body=[];if(path==='/api/public-config')body={clinicTimeZone:'Africa/Khartoum',staffMfaRequired:false};
 if(path==='/api/patient/me')body=patient;
 if(path==='/api/lookups/states')body=[{id:1,labelAr:'الخرطوم',labelEn:'Khartoum'}];
 if(path==='/api/patient-auth/forgot-password')body={challengeId:'layout-reset-fixture'};
 if(request.method!=='GET')report.mockedWrites.push({path,method:request.method});
 await send('Fetch.fulfillRequest',{requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'application/json'}],body:Buffer.from(JSON.stringify(body)).toString('base64')}).catch(()=>{});
};
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function ev(expression){const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;}
async function until(expression){for(let i=0;i<120;i++){if(await ev(expression))return;await delay(50);}throw Error(`Timed out: ${expression}`);}
function check(name,passed){report.checks.push({name,passed:!!passed});if(!passed&&!process.env.CLINIC_LAYOUT_BASELINE)throw Error(name);}
async function fill(selector,value){await ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);}
async function shot(name,scope){await ev('document.fonts.ready');await ev(`document.querySelector(${JSON.stringify(scope)}).scrollIntoView({block:'center',behavior:'instant'})`);const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(`${output}/${name}.png`,Buffer.from(r.data,'base64'));report.screenshots.push(`${name}.png`);}
const metricExpression=scope=>`(()=>{
 const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,top:r.top,bottom:r.bottom,left:r.left,right:r.right,centerY:r.y+r.height/2}};
 const style=e=>{const s=getComputedStyle(e);return Object.fromEntries(['height','minHeight','maxHeight','paddingTop','paddingBottom','paddingInlineStart','paddingInlineEnd','lineHeight','marginTop','marginBottom','display','alignItems','boxSizing','fontSize'].map(key=>[key,s[key]]))};
 return [...document.querySelectorAll(${JSON.stringify(scope+' .shifa-password-field')})].map(field=>{const root=field.querySelector('.MuiOutlinedInput-root'),input=field.querySelector('input'),outline=field.querySelector('fieldset'),eye=field.querySelector('button'),label=field.querySelector('label'),form=field.closest('form');return{label:label.textContent,root:rect(root),rootStyle:style(root),input:rect(input),inputStyle:style(input),outline:rect(outline),outlineStyle:style(outline),eye:rect(eye),labelRect:rect(label),formStyle:style(form),inputType:input.type,outlineAriaHidden:outline.getAttribute('aria-hidden'),innerDirection:getComputedStyle(field).direction,inputDirection:getComputedStyle(input).direction,labelCount:input.labels.length,helper:field.querySelector('.MuiFormHelperText-root')?rect(field.querySelector('.MuiFormHelperText-root')):null};});})()`;
async function inspect(name,scope,expected){await until(`document.querySelectorAll(${JSON.stringify(scope+' .shifa-password-field')}).length===${expected}`);await ev('document.fonts.ready');const fields=await ev(metricExpression(scope));report.metrics.push({name,fields});
 check(`field count ${name}`,fields.length===expected);
 check(`50px control and outline ${name}`,fields.every(f=>f.root.height>=48&&f.root.height<=50.5&&Math.abs(f.outline.height-f.root.height)<=1));
 check(`44px centered eye and input ${name}`,fields.every(f=>f.eye.width>=44&&f.eye.height>=44&&Math.abs(f.eye.centerY-f.root.centerY)<=1&&Math.abs(f.input.centerY-f.root.centerY)<=1));
 check(`localized direction and adornment placement ${name}`,fields.every(f=>f.innerDirection===(name.includes('-ar-')?'rtl':'ltr')&&f.inputDirection==='ltr'&&(f.innerDirection==='rtl'?f.eye.right<=f.input.left:f.eye.left>=f.input.right)));
 check(`input padding and no clipping ${name}`,fields.every(f=>parseFloat(f.rootStyle.paddingInlineStart)>=10&&f.input.height>=parseFloat(f.inputStyle.lineHeight)-1&&f.input.height<=f.root.height&&f.input.left>=f.root.left&&f.input.right<=f.root.right));
 check(`labels and helper do not overlap ${name}`,fields.every(f=>f.labelCount===1&&f.labelRect.bottom<=f.root.top&&f.root.top-f.labelRect.bottom>=4&&(!f.helper||f.helper.top>=f.root.bottom)));
 check(`no horizontal overflow ${name}`,await ev(`document.documentElement.scrollWidth<=innerWidth&&[...document.querySelectorAll(${JSON.stringify(scope+' .MuiOutlinedInput-root')})].every(e=>{const r=e.getBoundingClientRect();return r.left>=-1&&r.right<=innerWidth+1})`));
 await shot(name,scope);
 if(!process.env.CLINIC_LAYOUT_BASELINE){
   await fill(`${scope} .shifa-password-field input`,'SyntheticLayout123!');
   await ev(`document.querySelector(${JSON.stringify(scope+' .shifa-password-field button')}).click()`);
   check(`reveal preserves geometry and value ${name}`,await ev(`(()=>{const f=document.querySelector(${JSON.stringify(scope+' .shifa-password-field')}),i=f.querySelector('input');return i.type==='text'&&i.value==='SyntheticLayout123!'&&f.querySelector('.MuiOutlinedInput-root').getBoundingClientRect().height>=48&&f.querySelector('button').getAttribute('aria-pressed')==='true'})()`));
   await ev(`document.querySelector(${JSON.stringify(scope+' .shifa-password-field button')}).click()`);
   check(`remask and focus ${name}`,await ev(`(()=>{const f=document.querySelector(${JSON.stringify(scope+' .shifa-password-field')});f.querySelector('input').focus();return f.querySelector('input').type==='password'&&document.activeElement===f.querySelector('input')})()`));
 }
 return fields;
}
await send('Page.enable');await send('Runtime.enable');await send('Network.enable');await send('Network.setBlockedURLs',{urls:['*socket.io*','*accounts.google.com*']});await send('Fetch.enable',{patterns:[{urlPattern:'*/api/*'}]});
await send('Page.addScriptToEvaluateOnNewDocument',{source:`if(location.origin===${JSON.stringify(origin)}){const q=new URLSearchParams(location.search);localStorage.setItem('shifa_language',q.get('lang')||'en');localStorage.setItem('alshifa_theme',q.get('mode')||'light');sessionStorage.clear();if(location.pathname.startsWith('/patient/')){sessionStorage.setItem('cms_patient_user',JSON.stringify({id:'patient-user-fixture',role:'PATIENT',patientLinked:true}));sessionStorage.setItem('cms_patient_token','layout-fixture-only');}}`});
async function nav(route,lang,mode,width){await send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<600});await send('Page.navigate',{url:`${origin}${route}?lang=${lang}&mode=${mode}`});await until('!!document.querySelector("#root")');}
async function security(lang){await ev(`(async()=>{const R=await import('/node_modules/.vite/deps/react.js'),D=await import('/node_modules/.vite/deps/react-dom_client.js'),T=await import('/src/app/theme/ThemeContext.jsx'),S=await import('/src/components/StaffSecurityDialog.jsx'),i=(await import('/src/i18n.js')).default;await import('/src/App.css');document.querySelector('#root').style.display='none';const host=document.createElement('div');host.id='password-dialog-host';document.body.appendChild(host);(D.default||D).createRoot(host).render((R.default||R).createElement(T.ThemeProvider,null,(R.default||R).createElement(S.default,{user:{mfaEnabled:true},onClose:()=>{},t:key=>i.t(key)})));})()`);await until('!!document.querySelector(".security-actions")');await ev(`document.querySelector('.security-actions .btn-danger').click()`);await until('!!document.querySelector("#mfa-current-password")');}
try{
 const widths=process.env.CLINIC_LAYOUT_BASELINE?[1366]:[1366,390];
 const languages=process.env.CLINIC_LAYOUT_BASELINE?['en']:['ar','en'];
 const modes=process.env.CLINIC_LAYOUT_BASELINE?['light']:['light','dark'];
 for(const width of widths)for(const lang of languages)for(const mode of modes){const key=`${width}-${lang}-${mode}`;
  await nav('/patient/profile',lang,mode,width);await until('!!document.querySelector(".patient-profile .shifa-password-field")');
  const profile=await inspect(`profile-${key}`,'.patient-profile > section:nth-child(2) > div:first-of-type > form',3);
  if(process.env.CLINIC_LAYOUT_BASELINE){console.log(JSON.stringify(profile,null,2));continue;}
  check(`profile MUI outline margins reset ${key}`,profile.every(f=>f.outlineAriaHidden==='true'&&f.outlineStyle.marginTop==='0px'&&f.outlineStyle.marginBottom==='0px'));
  check(`profile native fieldset spacing retained ${key}`,await ev(`(()=>{const group=document.createElement('fieldset');group.innerHTML='<legend>Native group</legend>';document.querySelector('.patient-profile .patient-card').appendChild(group);const s=getComputedStyle(group),l=getComputedStyle(group.firstElementChild),ok=parseFloat(s.marginTop)>0&&parseFloat(s.marginBottom)>0&&parseFloat(l.paddingInlineStart)>0;group.remove();return ok})()`));
  check(`profile direction/theme ${key}`,await ev(`document.documentElement.dir===${JSON.stringify(lang==='ar'?'rtl':'ltr')}&&document.documentElement.dataset.theme===${JSON.stringify(mode)}`));
  // Compare actual staff/patient login and reset routes after importing patient CSS.
  await nav('/staff',lang,mode,width);await inspect(`staff-login-${key}`,'.patient-auth-shell--staff',1);
  await nav('/patient-login',lang,mode,width);await inspect(`patient-login-${key}`,'.patient-auth',1);
  await nav('/forgot-password',lang,mode,width);await until('!!document.querySelector("input[type=email]")');await fill('input[type=email]','layout@example.test');await ev('document.querySelector("form").requestSubmit()');await until('document.querySelectorAll(".shifa-password-field").length===2');await inspect(`reset-password-${key}`,'.patient-auth',2);
  await nav('/staff',lang,mode,width);await until('!!document.querySelector(".patient-auth")');await security(lang);await inspect(`mfa-dialog-${key}`,'#password-dialog-host',1);
  await ev(`(()=>{const t=[...document.querySelectorAll('#password-dialog-host button')].find(b=>b.textContent.trim()===${JSON.stringify(lang==='ar'?'إلغاء':'Cancel')});t.click()})()`);await until('!!document.querySelector(".security-actions")');
  await ev(`(()=>{const t=[...document.querySelectorAll('#password-dialog-host button')].find(b=>b.textContent.trim()===${JSON.stringify(lang==='ar'?'تغيير كلمة المرور':'Change password')});t.click()})()`);await until('document.querySelectorAll("#password-dialog-host .shifa-password-field").length===3');await inspect(`password-security-dialog-${key}`,'#password-dialog-host',3);
 }
 check('no uncaught browser exceptions',report.exceptions.length===0);
}catch(error){report.failure=error.message;process.exitCode=1;console.error(error.message);console.error(await ev('document.body.innerText.slice(-1600)'));}
finally{fs.writeFileSync(`${output}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({checks:report.checks.length,failed:report.checks.filter(c=>!c.passed),exceptions:report.exceptions,failure:report.failure,screenshots:report.screenshots.length,output},null,2));await send('Page.close');ws.close();}
