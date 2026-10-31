import test from 'node:test';
import assert from 'node:assert/strict';
import { cancelReceptionAppointment, cancellationErrorMessage, createCancellationFence } from '../src/features/reception/receptionCancellation.js';
import { createPagedList } from '../src/services/pagedList.js';
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
test('cancellation uses the existing status contract and requires a verified committed response',async()=>{
 const calls=[];const row=await cancelReceptionAppointment(async(path,options)=>{calls.push({path,options});return reply({id:'appointment',status:'CANCELLED'});},'appointment');assert.equal(row.status,'CANCELLED');assert.equal(calls[0].path,'/api/appointments/appointment/status');assert.equal(calls[0].options.method,'PUT');assert.deepEqual(JSON.parse(calls[0].options.body),{status:'CANCELLED'});
 for(const body of [null,{}, {id:'other',status:'CANCELLED'},{id:'appointment',status:'PENDING'}])await assert.rejects(cancelReceptionAppointment(async()=>reply(body),'appointment'),error=>error.code==='CANCELLATION_RESPONSE_INVALID');
});
for(const status of [400,401,403,404,409,422,429,500])test(`${status} fails explicitly and maps to safe Arabic/English`,async()=>{
 let error;try{await cancelReceptionAppointment(async()=>reply({error:{code:status===409?'APPOINTMENT_STATE_CONFLICT':'PRIVATE_CODE',message:'RAW PRIVATE ENGLISH'}},status),'appointment');}catch(value){error=value;}
 assert.equal(error.status,status);assert.match(cancellationErrorMessage(error,'ar'),/[\u0600-\u06ff]/u);assert.doesNotMatch(cancellationErrorMessage(error,'en'),/RAW|[\u0600-\u06ff]/u);
});
test('network failure and invalid JSON cannot claim cancellation success',async()=>{
 await assert.rejects(cancelReceptionAppointment(async()=>{throw Error('network private diagnostic');},'appointment'));
 await assert.rejects(cancelReceptionAppointment(async()=>new Response('{'),'appointment'),error=>error.code==='CANCELLATION_RESPONSE_INVALID');
 assert.doesNotMatch(cancellationErrorMessage(Error('PRIVATE'),'ar'),/PRIVATE/);
});
test('a delayed old GET and even a newer stale snapshot cannot restore a committed cancellation',async()=>{
 const fence=createCancellationFence();let resolve;let calls=0;
 const list=createPagedList('/api/appointments/pending',async()=>++calls===1?new Promise(done=>{resolve=done;}):reply([{id:'appointment',status:'PENDING'},{id:'other',status:'PENDING'}]),50,fence.reconcile);
 const old=list.reload();fence.record('appointment');list.setData(rows=>rows.filter(row=>row.id!=='appointment'));resolve(reply([{id:'appointment',status:'PENDING'}]));await old;assert.deepEqual(list.getSnapshot().data,[]);
 await list.reload();assert.deepEqual(list.getSnapshot().data.map(row=>row.id),['other']);
});
test('conflicting requests are not recorded as committed cancellations',()=>{
 const fence=createCancellationFence();assert.deepEqual(fence.reconcile([],[{id:'appointment',status:'CONFIRMED'}]),[{id:'appointment',status:'CONFIRMED'}]);
});
