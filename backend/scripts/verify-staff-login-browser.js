import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

// Called only by the isolated API test. Credential values remain in memory;
// evidence contains counts and booleans, never request/response bodies.
export async function verifyStaffLoginBrowser({apiOrigin,username,password,totp,role}){
 const frontend=process.env.STAFF_LOGIN_FRONTEND_ORIGIN||'http://127.0.0.1:5187';
 const cdp=process.env.STAFF_LOGIN_CDP_ORIGIN||'http://127.0.0.1:9337';
 for(const value of [frontend,cdp,apiOrigin])assert.ok(['localhost','127.0.0.1'].includes(new URL(value).hostname));
 const target=await(await fetch(`${cdp}/json/new?about:blank`,{method:'PUT'})).json();
 const ws=new WebSocket(target.webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
 let sequence=0;const pending=new Map();const counts={login:0,verify:0};const exceptions=[];
 let releaseLogin;const holdLogin=new Promise(resolve=>{releaseLogin=resolve;});
 const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`Browser command timed out: ${method}`));},15000);pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});ws.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw new Error('Browser evaluation failed.');return result.result.value;};
 const waitFor=async(expression,label)=>{const passed=await evaluate(`new Promise(resolve=>{const deadline=Date.now()+12000;const poll=()=>{if(${expression})resolve(true);else if(Date.now()>deadline)resolve(false);else setTimeout(poll,30)};poll()})`);assert.ok(passed,label);};
 ws.onmessage=async({data})=>{
  const event=JSON.parse(data);
  if(event.id){const task=pending.get(event.id);if(task){pending.delete(event.id);event.error?task.reject(new Error('Browser command failed.')):task.resolve(event.result);}return;}
  if(event.method==='Runtime.exceptionThrown'){exceptions.push('Browser exception');return;}
  if(event.method!=='Fetch.requestPaused')return;
  const {requestId,request}=event.params;
  try{
   const url=new URL(request.url);
   if(url.pathname==='/api/auth/login'){counts.login++;await holdLogin;}
   if(url.pathname==='/api/auth/mfa/verify')counts.verify++;
   const headers={};for(const [key,value]of Object.entries(request.headers))if(['authorization','content-type','accept'].includes(key.toLowerCase()))headers[key]=value;
   const response=await fetch(`${apiOrigin}${url.pathname}${url.search}`,{method:request.method,headers,...(request.postData?{body:request.postData}:{})});
   const body=await response.text();
   const responseHeaders=[{name:'Content-Type',value:response.headers.get('content-type')||'application/json'}];
   for(const key of ['x-has-more','x-total-count','cache-control'])if(response.headers.has(key))responseHeaders.push({name:key,value:response.headers.get(key)});
   await send('Fetch.fulfillRequest',{requestId,responseCode:response.status,responseHeaders,body:Buffer.from(body).toString('base64')});
  }catch{await send('Fetch.failRequest',{requestId,errorReason:'Failed'}).catch(()=>{});}
 };
 try{
  await send('Page.enable');await send('Runtime.enable');await send('Network.enable');
  // Prevent the test session from connecting to any unrelated dev Socket.IO server.
  await send('Network.setBlockedURLs',{urls:['*socket.io*']});
  await send('Fetch.enable',{patterns:[{urlPattern:'*/api/*',requestStage:'Request'}]});
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:900,deviceScaleFactor:1,mobile:true});
  await send('Page.navigate',{url:`${frontend}/staff`});
  await waitFor('!!document.querySelector("#staff-username")','staff form loads');
  await evaluate(`(()=>{sessionStorage.clear();localStorage.setItem('i18nextLng','en');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;for(const [id,value]of ${JSON.stringify([['staff-username',username],['staff-password',password]])}){const input=document.getElementById(id);set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));}})()`);
  await evaluate('document.querySelector("#staff-password").focus()');
  // Real browser default Enter behavior, followed by a queued form submit and
  // a disabled-button click while the intercepted login remains pending.
  for(let i=0;i<2;i++){await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r',unmodifiedText:'\r'});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});}
  await waitFor('document.querySelector("form[aria-busy=true]")!==null','pending form is busy');
  await evaluate('document.querySelector("form").dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));document.querySelector("button[type=submit]").click()');
  assert.equal(counts.login,1,'one pending password request');releaseLogin();
  await waitFor('!!document.querySelector("#staff-mfa-code")','MFA step loads');
  assert.equal(counts.login,1,'MFA transition did not re-submit password');
  assert.ok(await evaluate('!sessionStorage.getItem("cms_staff_token")'),'challenge does not authenticate');
  await evaluate(`document.querySelector('#staff-mfa-code').value=${JSON.stringify(totp.generate())};document.querySelector('form').requestSubmit()`);
  await waitFor('!!document.querySelector(".app-layout")&&!!sessionStorage.getItem("cms_staff_token")','dashboard and session load');
  const dashboardSelector=({ADMIN:'.admin-workspace',PHARMACIST:'.pharmacy-workspace-tabs',RECEPTIONIST:'.reception-dashboard'})[role];
  await waitFor(`!!document.querySelector(${JSON.stringify(dashboardSelector)})`,'role dashboard component loads');
  const result=await evaluate('({role:JSON.parse(sessionStorage.getItem("cms_staff_user")).role,challengeAbsent:!document.querySelector("#staff-mfa-code"),passwordAbsent:!document.querySelector("#staff-password")})');
  assert.equal(result.role,role);assert.equal(result.challengeAbsent,true);assert.equal(result.passwordAbsent,true);assert.equal(counts.login,1);assert.equal(counts.verify,1);assert.equal(exceptions.length,0);
  const output=process.env.STAFF_LOGIN_BROWSER_OUTPUT||'/tmp/staff-login-browser';await fs.mkdir(output,{recursive:true});
  await fs.writeFile(`${output}/${role.toLowerCase()}.json`,JSON.stringify({role,counts,dashboard:true,session:true,challengeCleared:true,exceptions:exceptions.length},null,2)+'\n');
  const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile(`${output}/${role.toLowerCase()}.png`,Buffer.from(shot.data,'base64'));
 }finally{releaseLogin();await fetch(`${cdp}/json/close/${target.id}`).catch(()=>{});ws.close();}
}
