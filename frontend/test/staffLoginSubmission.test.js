import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { transformWithOxc } from 'vite';
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, sessionStorage: dom.window.sessionStorage, Node: dom.window.Node, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, ShadowRoot: dom.window.ShadowRoot, DocumentFragment: dom.window.DocumentFragment, getComputedStyle: dom.window.getComputedStyle, IS_REACT_ACT_ENVIRONMENT: true });
const React = await import('react');
const { createElement: h, act, StrictMode } = React;
const { createRoot } = await import('react-dom/client');
const { I18nextProvider } = await import('react-i18next');
const { default: i18n } = await import('../src/i18n.js');
async function compile(source, name) {
 const file = new URL(`.staff-login-${process.pid}-${name}.mjs`, import.meta.url);
 await writeFile(file, (await transformWithOxc(source, name+'.jsx', { jsx: { runtime: 'automatic' } })).code);
 try { return await import(file.href); } finally { await unlink(file); }
}
let password = await readFile(new URL('../src/components/PasswordField.jsx', import.meta.url), 'utf8');
password = password.replace(/import \{ useTheme \}[^;]+;/, "const useTheme = () => ({ theme: 'light' });").replace("'../utils/patientMuiTheme.js'", JSON.stringify(new URL('../src/utils/patientMuiTheme.js', import.meta.url).href));
globalThis.loginPasswordField = (await compile(password, 'PasswordField')).default;
const app = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
const body = app.slice(app.indexOf('function LoginView('), app.indexOf('/* ==========================================\n   ROLE DASHBOARDS CONTAINER'));
const imports = `import React,{useState,useEffect,useRef,useCallback} from 'react';
import {startStaffLogin,completeStaffMfa,completeStaffMfaRecovery,isTerminalMfaError} from ${JSON.stringify(new URL('../src/services/staffLogin.js', import.meta.url).href)};
import {localizedApiErrorMessage} from ${JSON.stringify(new URL('../src/services/apiClient.js', import.meta.url).href)};
import {withLoginSubmissionLock} from ${JSON.stringify(new URL('../src/features/patient-auth/loginSubmission.js', import.meta.url).href)};
import MfaCodeInput from ${JSON.stringify(new URL('../src/components/MfaCodeInput.js', import.meta.url).href)};
const PasswordField=globalThis.loginPasswordField;const HeartPulse=()=>null;const ShieldCheck=()=>null;
`;
const { default: LoginView } = await compile(imports+body+'\nexport default LoginView;', 'LoginView');
let root, calls, completed, enrollments, originalFetch;
const deferred = () => { let resolve,reject; const promise = new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}; };
const reply = (body, status=200) => ({ok:status>=200&&status<300,status,json:async()=>body});
const challenge = () => ({mfaRequired:true,challengeToken:'synthetic-challenge-fixture',expiresAt:new Date(Date.now()+300000).toISOString()});
beforeEach(async()=>{
 sessionStorage.clear();localStorage.clear();calls=[];completed=[];enrollments=[];originalFetch=globalThis.fetch;
 globalThis.fetch=async(path,options)=>{const request=deferred();calls.push({path,options,request});return request.promise;};
 await i18n.changeLanguage('en');root=createRoot(document.getElementById('root'));
});
afterEach(async()=>{await act(async()=>root.unmount());globalThis.fetch=originalFetch;});
async function mount(){await act(async()=>root.render(h(StrictMode,null,h(I18nextProvider,{i18n},h(LoginView,{onLogin:(...args)=>completed.push(args),onMfaEnrollmentRequired:value=>enrollments.push(value),t:key=>i18n.t(key),lang:'en'})))));}
async function fill(id,value){const input=document.getElementById(id);await act(async()=>{Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new window.Event('input',{bubbles:true}));});}
const submitEvent=()=>new window.Event('submit',{bubbles:true,cancelable:true});
async function prepare(){await mount();await fill('staff-username','synthetic@example.test');await fill('staff-password','SyntheticExample123!');}
async function submit(){await act(async()=>document.querySelector('form').dispatchEvent(submitEvent()));}
async function resolve(index,body,status=200){await act(async()=>calls[index].request.resolve(reply(body,status)));}
function handler(form){return form[Object.keys(form).find(key=>key.startsWith('__reactProps$'))].onSubmit;}

test('one submit sends exactly one login request and disables the form while pending',async()=>{
 await prepare();await submit();assert.equal(calls.length,1);assert.equal(calls[0].path,'/api/auth/login');assert.equal(calls[0].options.method,'POST');assert.equal(document.querySelector('button[type=submit]').disabled,true);assert.equal(document.querySelector('form').getAttribute('aria-busy'),'true');
});
test('rapid double click and repeated submit events remain single-flight before React commits',async()=>{
 await prepare();const form=document.querySelector('form');const button=form.querySelector('button[type=submit]');
 await act(async()=>{button.click();button.click();form.dispatchEvent(submitEvent());form.dispatchEvent(submitEvent());});assert.equal(calls.length,1);
});
test('a queued password submit after the MFA response cannot create a second challenge',async()=>{
 await prepare();const queuedSubmit=handler(document.querySelector('form'));await submit();await resolve(0,challenge());assert.ok(document.getElementById('staff-mfa-code'));
 await act(async()=>{void queuedSubmit({preventDefault(){}});});assert.equal(calls.length,1);
});
test('MFA uses the sole challenge response and successful completion finalizes exactly once',async()=>{
 await prepare();await submit();const data=challenge();await resolve(0,data);assert.equal(completed.length,0);assert.equal(document.getElementById('staff-password'),null);
 document.getElementById('staff-mfa-code').value='012345';await submit();assert.equal(calls.length,2);assert.equal(calls[1].path,'/api/auth/mfa/verify');const body=JSON.parse(calls[1].options.body);assert.ok(body.challengeToken===data.challengeToken);assert.ok(body.code==='012345');
 await resolve(1,{user:{id:'fixture',role:'ADMIN'},token:'synthetic-access-fixture'});assert.equal(completed.length,1);assert.equal(document.getElementById('staff-mfa-code'),null);
});
test('genuine failure releases the guard and permits one deliberate retry without automatic POST retry',async()=>{
 await prepare();await submit();await resolve(0,{error:{code:'LOGIN_FAILED',message:'Synthetic failure'}},401);assert.equal(calls.length,1);assert.equal(document.querySelector('button[type=submit]').disabled,false);
 await submit();assert.equal(calls.length,2);await resolve(1,challenge());assert.ok(document.getElementById('staff-mfa-code'));
});
test('non-MFA login still finalizes once and rejects a queued duplicate after success',async()=>{
 await prepare();const queuedSubmit=handler(document.querySelector('form'));await submit();await resolve(0,{user:{id:'fixture',role:'RECEPTIONIST'},token:'synthetic-access-fixture'});assert.equal(completed.length,1);
 await act(async()=>{void queuedSubmit({preventDefault(){}});});assert.equal(calls.length,1);
});

test('rapid Enter submissions and a queued MFA verification create only one verification request',async()=>{
 await prepare();const passwordForm=document.querySelector('form');
 await act(async()=>{for(let i=0;i<3;i++){passwordForm.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));passwordForm.dispatchEvent(submitEvent());}});assert.equal(calls.length,1);
 await resolve(0,challenge());document.getElementById('staff-mfa-code').value='012345';const mfaForm=document.querySelector('form');const queued=handler(mfaForm);
 await act(async()=>{mfaForm.dispatchEvent(submitEvent());mfaForm.dispatchEvent(submitEvent());});assert.equal(calls.length,2);assert.equal(document.querySelector('button[type=submit]').disabled,true);
 await resolve(1,{user:{id:'fixture',role:'PHARMACIST'},token:'synthetic-access-fixture'});
 await act(async()=>{void queued({preventDefault(){}});});assert.equal(calls.length,2);assert.equal(completed.length,1);
});
test('cancel and terminal error remove the old challenge before a deliberate new login',async()=>{
 await prepare();await submit();const first=challenge();await resolve(0,first);
 await act(async()=>[...document.querySelectorAll('button')].find(button=>button.textContent===i18n.t('backToLogin')).click());assert.equal(document.getElementById('staff-mfa-code'),null);
 await fill('staff-password','SyntheticExample123!');await submit();const next={...challenge(),challengeToken:'synthetic-new-challenge-fixture'};await resolve(1,next);
 document.getElementById('staff-mfa-code').value='012345';await submit();assert.ok(JSON.parse(calls[2].options.body).challengeToken===next.challengeToken);
 await resolve(2,{error:{code:'MFA_CHALLENGE_INVALID',message:'Synthetic expired challenge'}},401);assert.equal(document.getElementById('staff-mfa-code'),null);assert.ok(document.getElementById('staff-password'));
});
test('rerenders cannot submit again and late responses after unmount cannot finalize login',async()=>{
 await prepare();await submit();await act(async()=>i18n.changeLanguage('ar'));assert.equal(calls.length,1);
 await act(async()=>root.unmount());root=createRoot(document.getElementById('root'));
 await resolve(0,{user:{id:'fixture',role:'ADMIN'},token:'synthetic-access-fixture'});assert.equal(completed.length,0);assert.equal(enrollments.length,0);
});
test('a network failure is not retried automatically and the next deliberate submit works',async()=>{
 await prepare();await submit();await act(async()=>calls[0].request.reject(new Error('Synthetic network failure')));assert.equal(calls.length,1);assert.equal(document.querySelector('button[type=submit]').disabled,false);
 await submit();assert.equal(calls.length,2);await resolve(1,challenge());assert.ok(document.getElementById('staff-mfa-code'));
});
