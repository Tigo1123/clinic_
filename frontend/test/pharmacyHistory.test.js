import test from 'node:test';
import assert from 'node:assert/strict';
import { createPharmacyHistoryRead, pharmacyReadErrorMessage } from '../src/services/pharmacyReads.js';
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const rx=id=>({id,patient:{fullNameAr:'مريض',fullNameEn:'Patient'},doctor:{fullNameAr:'طبيب',fullNameEn:'Doctor'},prescriptionDate:'2026-10-30T08:00:00Z',status:'FILLED',prescribedDrugs:[{id:'item',drug:{labelAr:'دواء',labelEn:'Medicine'},qtyPrescribed:2,qtyDispensed:2,dosage:'1',duration:'2 days'}]});
const kinds=['prescription-history','batch-history','movement-history'];
function payload(kind,ids=['old'],page=1){const items=ids.map(id=>kind==='prescription-history'?rx(id):kind==='batch-history'?{id,batchNumber:id,expiryDate:'2030-01-01',qtyOnHand:10,minReorderLevel:2}:{id,movementType:'DISPENSE',createdAt:'2026-10-30T08:00:00Z',quantityDelta:-2,resultingBalance:10,batch:{batchNumber:id},actor:{username:'pharmacy'}});return kind==='prescription-history'?items:{items,pagination:{page,totalPages:ids.length?2:0,total:ids.length?10:0}};}
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
const rows=(resource,kind)=>kind==='prescription-history'?resource.getSnapshot().data:resource.getSnapshot().data?.items;
for(const kind of kinds){
 test(`${kind}: valid data and genuinely empty success remain distinct from initial state`,async()=>{
  let ids=['one'];const resource=createPharmacyHistoryRead(async()=>reply(payload(kind,ids)),'/history',kind);
  assert.equal(resource.getSnapshot().status,'idle');await resource.reload();assert.equal(resource.getSnapshot().status,'success');assert.equal(rows(resource,kind).length,1);
  ids=[];await resource.reload();assert.deepEqual(rows(resource,kind),[]);assert.equal(resource.getSnapshot().status,'success');assert.equal(resource.getSnapshot().loading,false);
 });
 for(const failure of [401,403,404,500,'network','malformed'])test(`${kind}: ${failure} preserves last success, localizes errors and retries without duplicates`,async()=>{
  let phase='success';const resource=createPharmacyHistoryRead(async()=>{
   if(phase==='failure'){if(failure==='network')throw Error('RAW PRIVATE ENGLISH');if(failure==='malformed')return reply({unexpected:true});return reply({error:{message:'RAW PRIVATE ENGLISH'}},failure);}
   return reply(payload(kind,phase==='retry'?['new','new']:['old']));
  },'/history',kind);
  await resource.reload();const snapshot=resource.getSnapshot().data;phase='failure';await resource.reload();
  assert.equal(resource.getSnapshot().loading,false);assert.ok(resource.getSnapshot().error);assert.strictEqual(resource.getSnapshot().data,snapshot);
  assert.notEqual(resource.getSnapshot().status,'success');assert.match(pharmacyReadErrorMessage(resource.getSnapshot().error,'ar'),/[\u0600-\u06ff]/u);assert.doesNotMatch(pharmacyReadErrorMessage(resource.getSnapshot().error,'en'),/RAW|[\u0600-\u06ff]/u);
  phase='retry';await resource.reload();assert.equal(resource.getSnapshot().status,'success');assert.deepEqual(rows(resource,kind).map(item=>item.id),['new']);
 });
 test(`${kind}: initial failure never becomes a successful empty history`,async()=>{
  const resource=createPharmacyHistoryRead(async()=>reply({},500),'/history',kind);await resource.reload();assert.ok(resource.getSnapshot().error);assert.notEqual(resource.getSnapshot().status,'success');assert.equal(resource.getSnapshot().loading,false);
 });
 test(`${kind}: a slow old request cannot overwrite a newer completed snapshot`,async()=>{
  const slow=deferred();const signals=[];let count=0;const resource=createPharmacyHistoryRead(async(_path,{signal})=>{signals.push(signal);return ++count===1?slow.promise:reply(payload(kind,['new']));},'/history',kind);
  const old=resource.reload();await Promise.resolve();assert.equal(resource.getSnapshot().status,'pending');await resource.reload();assert.equal(signals[0].aborted,true);assert.deepEqual(rows(resource,kind).map(item=>item.id),['new']);
  slow.resolve(reply(payload(kind,['obsolete'])));await old;await Promise.resolve();assert.deepEqual(rows(resource,kind).map(item=>item.id),['new']);assert.equal(resource.getSnapshot().loading,false);
 });
 test(`${kind}: cancellation during body read settles and retains the last snapshot`,async()=>{
  const slow=deferred();let count=0;const resource=createPharmacyHistoryRead(async()=>++count===1?reply(payload(kind)):({ok:true,json:()=>slow.promise}),'/history',kind);
  await resource.reload();const snapshot=resource.getSnapshot().data;const pending=resource.reload();await Promise.resolve();resource.cancel();await pending;assert.strictEqual(resource.getSnapshot().data,snapshot);assert.equal(resource.getSnapshot().loading,false);assert.equal(resource.getSnapshot().error.code,'CANCELLED');
  slow.resolve(payload(kind,['late']));await Promise.resolve();assert.strictEqual(resource.getSnapshot().data,snapshot);
 });
 test(`${kind}: tab suspension/unmount aborts pending work and rejects late publications`,async()=>{
  let count=0;const slow=deferred();let signal;const resource=createPharmacyHistoryRead(async(_path,options)=>{signal=options.signal;return ++count===1?reply(payload(kind)):slow.promise;},'/history',kind);
  await resource.reload();const snapshot=resource.getSnapshot().data;const pending=resource.reload();resource.suspend();assert.equal(signal.aborted,true);assert.equal(resource.getSnapshot().loading,false);
  let notifications=0;const unsubscribe=resource.subscribe(()=>notifications++);slow.resolve(reply(payload(kind,['obsolete'])));await pending;await Promise.resolve();assert.equal(notifications,0);assert.strictEqual(resource.getSnapshot().data,snapshot);unsubscribe();
 });
}
for(const kind of ['batch-history','movement-history'])test(`${kind}: failed next-page retry requests that page and retains the previous successful page`,async()=>{
 let fail=true;const requested=[];const resource=createPharmacyHistoryRead(async path=>{const page=Number(new URL(path,'http://localhost').searchParams.get('page'));requested.push(page);return page===2&&fail?reply({},500):reply(payload(kind,[`page-${page}`],page));},'/history',kind);
 await resource.loadPage(1);const snapshot=resource.getSnapshot().data;await resource.loadPage(2);assert.strictEqual(resource.getSnapshot().data,snapshot);assert.equal(snapshot.pagination.page,1);
 fail=false;await resource.reload();assert.deepEqual(requested,[1,2,2]);assert.equal(resource.getSnapshot().data.pagination.page,2);assert.deepEqual(rows(resource,kind).map(item=>item.id),['page-2']);
});
test('invalid history dates, nested objects, quantities, JSON and mismatched page metadata fail explicitly',async()=>{
 const cases=[['prescription-history',[{...rx('bad'),prescriptionDate:'impossible'}]],['prescription-history',[{...rx('bad'),patient:{fullNameEn:{private:'bad'}}}]],['batch-history',{items:[{id:'bad'}],pagination:{page:1,total:1,totalPages:1}}],['movement-history',{items:[{id:'bad',createdAt:'bad'}],pagination:{page:1,total:1,totalPages:1}}],['movement-history',payload('movement-history',['bad'],2)],['movement-history',{items:[],pagination:{page:1,total:10,totalPages:1}}],['batch-history',{items:[],pagination:{page:1,total:0,totalPages:1}}]];
 for(const [kind,data]of cases){const resource=createPharmacyHistoryRead(async()=>reply(data),'/history',kind);await resource.reload();assert.equal(resource.getSnapshot().error.code,'MALFORMED_PAYLOAD');assert.equal(resource.getSnapshot().loading,false);}
 const resource=createPharmacyHistoryRead(async()=>new Response('{'),'/history','prescription-history');await resource.reload();assert.equal(resource.getSnapshot().error.code,'MALFORMED_PAYLOAD');
});
