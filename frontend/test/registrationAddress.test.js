import test,{afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,unlink} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {transformWithOxc} from 'vite';
import i18n from '../src/i18n.js';
import * as onboarding from '../src/features/patient-auth/onboarding.js';
import * as countries from '../src/features/patient-auth/phoneCountries.js';
import {parseAddressStates,validAddressSelection} from '../src/features/patient-auth/addressSelection.js';
import {SUDANESE_STATES} from '../src/features/reception/clinicData.js';
const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'});
Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,Node:dom.window.Node,requestAnimationFrame:cb=>setTimeout(cb,0),IS_REACT_ACT_ENVIRONMENT:true});
const React=await import('react');const {act,createElement:h}=React;const {createRoot}=await import('react-dom/client');
const page=await readFile(new URL('../src/features/patient-auth/PatientAuthPages.jsx',import.meta.url),'utf8');
let register=page.slice(page.indexOf('export function PatientRegister()'),page.indexOf('export function PatientClaim()'));
register=register.replace('useState(INITIAL_ONBOARDING_FORM)','useState(globalThis.addressForm)').replace('const [step, setStep] = useState(0)','const [step, setStep] = useState(globalThis.addressStep)');
const hookFile=new URL(`.address-hook-${process.pid}.mjs`,import.meta.url);
let hook=await readFile(new URL('../src/features/patient-auth/useRegistrationStates.js',import.meta.url),'utf8');
hook=hook.replace(/import \{ publicApiRequest \}[^;]+;/,'const publicApiRequest = (...args) => globalThis.addressApi(...args);').replace("'./addressSelection.js'",JSON.stringify(new URL('../src/features/patient-auth/addressSelection.js',import.meta.url).href));
await writeFile(hookFile,hook);
const preamble=`import {useCallback,useEffect,useRef,useState} from 'react';
import {useRegistrationStates} from ${JSON.stringify(hookFile.href)};
import {validAddressSelection} from ${JSON.stringify(new URL('../src/features/patient-auth/addressSelection.js',import.meta.url).href)};
const {${Object.keys(onboarding).join(',')}}=globalThis.addressOnboarding;
const {${Object.keys(countries).join(',')}}=globalThis.addressCountries;
const useTranslation=()=>({t:globalThis.addressT,i18n:{language:globalThis.addressLanguage}});
const useNavigate=()=>globalThis.addressNavigate;
const useLocation=()=>({state:{googleOnboarding:globalThis.addressGoogle}});
const useAuth=()=>({login:globalThis.addressLogin});
const getGoogleOnboardingToken=()=>globalThis.addressGoogle?'synthetic-capability':null;
const clearGoogleOnboardingToken=()=>{};
const useGooglePatientAuth=()=>({});
const apiRequest=(...args)=>globalThis.addressApi(...args);
const AuthShell=({children})=><section>{children}</section>;
const Alert=({children})=><div role="alert">{children}</div>;
const GoogleIdentityButton=()=>null;
const Link=({children})=><span>{children}</span>;
const Check=()=>null;
const Field=({label,value,onChange,error,type='text',...props})=><label>{label}<input value={value} onChange={event=>onChange(event.target.value)} type={type} {...props}/>{error&&<span role="alert">{error}</span>}</label>;
`;
globalThis.addressOnboarding=onboarding;globalThis.addressCountries=countries;
const componentFile=new URL(`.address-register-${process.pid}.mjs`,import.meta.url);await writeFile(componentFile,(await transformWithOxc(preamble+register,'Register.jsx',{jsx:{runtime:'automatic'}})).code);
let Register;try{Register=(await import(componentFile.href)).PatientRegister;}finally{await unlink(componentFile);await unlink(hookFile);}
let root,requests,states,postHandler,reads;
const complete={...onboarding.INITIAL_ONBOARDING_FORM,firstNameAr:'اختبار',fatherNameAr:'عنوان',grandfatherNameAr:'ولاية',familyNameAr:'شمالية',firstNameEn:'Synthetic',fatherNameEn:'Northern',grandfatherNameEn:'Address',familyNameEn:'Test',gender:'MALE',dateOfBirth:'1990-01-01',phoneCountry:'SD',phone:'912345678',email:'synthetic@example.invalid',addressStateId:'10',password:'SecurePass1',confirmPassword:'SecurePass1'};
async function mount({language='en',google=true,step=6,reference=SUDANESE_STATES,handler}={}){
 await i18n.changeLanguage(language);globalThis.addressLanguage=language;globalThis.addressT=i18n.getFixedT(language);globalThis.addressGoogle=google;globalThis.addressForm={...complete};globalThis.addressStep=step;globalThis.addressNavigate=()=>{};globalThis.addressLogin=()=>{};
 requests=[];states=structuredClone(reference);postHandler=handler;reads=0;
 globalThis.addressApi=async(url,options)=>{requests.push({url,options});if(options)return postHandler?postHandler(url,options):{state:'VERIFICATION_REQUIRED',challengeId:'synthetic'};reads++;return {states:structuredClone(states),complete:states.length===18};};
 root=createRoot(document.getElementById('root'));await act(async()=>root.render(h(Register)));
}
afterEach(async()=>{if(root)await act(async()=>root.unmount());root=null;});
const submit=()=>act(async()=>document.querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})));
const wait=()=>act(async()=>new Promise(resolve=>setTimeout(resolve,130)));
async function click(key){const b=[...document.querySelectorAll('button')].find(button=>button.textContent.trim()===globalThis.addressT(key));assert.ok(b,key);await act(async()=>b.click());await wait();}
async function change(input,value){await act(async()=>{const p=input.tagName==='SELECT'?window.HTMLSelectElement.prototype:window.HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(input,value);input.dispatchEvent(new window.Event(input.tagName==='SELECT'?'change':'input',{bubbles:true}));});}
const mutations=()=>requests.filter(r=>r.options);

test('reference parsing preserves Northern ID 10 and rejects duplicate IDs or translated label identities',()=>{
 assert.equal(parseAddressStates({states:SUDANESE_STATES}).length,18);assert.equal(validAddressSelection('10',SUDANESE_STATES),true);for(const value of ['Northern State','الولاية الشمالية','999','10.0'])assert.equal(validAddressSelection(value,SUDANESE_STATES),false);
 assert.throws(()=>parseAddressStates({states:[SUDANESE_STATES[9],SUDANESE_STATES[9]]}));assert.throws(()=>parseAddressStates({states:[SUDANESE_STATES[9],{...SUDANESE_STATES[9],id:18,labelEn:' NORTHERN '}]}));
});
for(const language of ['en','ar'])test(`${language}: state labels remain separate from canonical Google and normal payloads`,async()=>{
 await mount({language,step:4,reference:SUDANESE_STATES.map(s=>s.id===10?{...s,labelAr:'الولاية الشمالية',labelEn:'Northern State'}:s)});
 const select=document.querySelector('select');assert.equal(select.value,'10');assert.equal(select.querySelector('option[value="10"]').textContent,language==='ar'?'الولاية الشمالية':'Northern State');await change(select,'9');await change(select,'10');await click('onboardingNext');await click('onboardingNext');await submit();assert.equal(mutations().length,1);const body=JSON.parse(mutations()[0].options.body);assert.equal(body.addressStateId,10);assert.equal(body.phone,'+249912345678');assert.equal(body.addressAreaId,undefined);assert.equal(body.addressCountry,undefined);
});
test('normal registration uses the same current-reference guard and numeric ID',async()=>{
 await mount({google:false});await submit();assert.equal(mutations().length,1);assert.equal(mutations()[0].url,'/api/patient-auth/register');assert.equal(JSON.parse(mutations()[0].options.body).addressStateId,10);
});
test('stale Northern selection is cleared and redirected to address step before any POST',async()=>{
 await mount();states=states.filter(s=>s.id!==10);await submit();await wait();assert.equal(mutations().length,0);assert.equal(document.querySelector('select').value,'');assert.match(document.querySelector('[role=alert]').textContent,/Address data changed/);assert.ok(reads>=3);
});
test('a missing initial state is never offered and cannot reach Create Account',async()=>{
 await mount({reference:SUDANESE_STATES.filter(s=>s.id!==10)});assert.equal(document.querySelector('option[value="10"]'),null);assert.equal(document.querySelector('select').value,'');await submit();assert.equal(mutations().length,0);
});
for(const language of ['en','ar'])test(`${language}: backend state errors are localized and return to address selection`,async()=>{
 await mount({language,handler:async()=>{throw {status:422,code:'ADDRESS_STATE_NOT_FOUND',message:'raw database internal details'};}});await submit();await wait();assert.equal(document.querySelector('select').value,'');assert.ok([...document.querySelectorAll('[role=alert]')].some(el=>el.textContent.includes(i18n.getFixedT(language)('onboardingAddressStateInvalid'))));assert.equal(document.body.textContent.includes('raw database internal details'),false);
});
test('two submits while reference preflight is pending produce one Google completion',async()=>{
 let release;await mount({handler:async()=>({status:'AUTHENTICATED',token:'synthetic',user:{role:'PATIENT'}})});
 const original=globalThis.addressApi;globalThis.addressApi=(url,options)=>options?original(url,options):new Promise(resolve=>{release=()=>resolve({states:SUDANESE_STATES,complete:true});});
 await act(async()=>{for(let i=0;i<2;i++)document.querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));});assert.equal(mutations().length,0);await act(async()=>release());assert.equal(mutations().length,1);
});
test('phone country changes do not silently change the Sudanese residence ID',()=>{
 const original=onboarding.registrationPayload(complete);const other=onboarding.registrationPayload({...complete,phoneCountry:'SA',phone:'501234567'});assert.equal(original.addressStateId,10);assert.equal(other.addressStateId,10);assert.equal(other.phone,'+966501234567');
});
