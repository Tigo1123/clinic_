import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import request from 'supertest';
import prisma from '../src/db.js';
import { app, shutdown } from '../src/server.js';
import { REFERENCE_BOOTSTRAP_STATES, runReferenceBootstrap } from '../src/services/referenceBootstrap.js';
import { resolveAddressStateId } from '../src/services/patientAddress.js';
import { stagingStateRepairConfiguration, SUDAN_REPAIR_STAGING_HOST, repairSudanStates } from '../scripts/repair-sudan-states.js';
import { generateOnboardingCapability, hashOnboardingCapability } from '../src/services/externalAuthCapability.js';
const canonical = REFERENCE_BOOTSTRAP_STATES;
const northern=canonical.find(state=>state.id===10);
const bootstrap=()=>runReferenceBootstrap({prisma,manifest:{version:1,services:[]},environment:{REFERENCE_BOOTSTRAP_ENABLED:'true',REFERENCE_BOOTSTRAP_ENVIRONMENT:'test',REFERENCE_BOOTSTRAP_EXPECTED_DATABASE:'clinic_test',REFERENCE_BOOTSTRAP_DRY_RUN:'false'}});
const names={firstNameAr:'اختبار',fatherNameAr:'عنوان',grandfatherNameAr:'ولاية',familyNameAr:'شمالية',firstNameEn:'Synthetic',fatherNameEn:'Northern',grandfatherNameEn:'Address',familyNameEn:'Test'};
let sequence=710000;
const fields=()=>({...names,gender:'MALE',dateOfBirth:'1990-01-01',phone:`+250788${++sequence}`,password:'SyntheticPass1!',addressStateId:10});
after(async()=>shutdown('sudan-state-repair-test'));
async function pending(){const token=generateOnboardingCapability();const row=await prisma.pendingExternalAuth.create({data:{provider:'GOOGLE',providerSubject:crypto.randomUUID(),verifiedEmail:`${crypto.randomUUID()}@example.invalid`,capabilityHash:hashOnboardingCapability(token),expiresAt:new Date(Date.now()+600000)}});return {token,row};}

test('the deployed failure is reproduced for canonical Northern ID 10, then missing-row repair restores both registration flows',async()=>{
 await prisma.state.delete({where:{id:10}});
 const google=await pending();const payload=fields();
 const failure=await request(app).post('/api/patient-auth/google/complete').send({...payload,onboardingToken:google.token});
 assert.equal(failure.status,422);assert.equal(failure.body.error.code,'ADDRESS_STATE_NOT_FOUND');assert.deepEqual(failure.body.error.details,[{field:'addressStateId',id:10}]);
 assert.equal(await prisma.user.count({where:{email:google.row.verifiedEmail}}),0);assert.equal((await prisma.pendingExternalAuth.findUniqueOrThrow({where:{id:google.row.id}})).consumedAt,null);
 const normalPayload={...fields(),email:`${crypto.randomUUID()}@example.invalid`};
 const missing=await request(app).post('/api/patient-auth/register').send(normalPayload);assert.equal(missing.status,422);assert.equal(missing.body.error.code,'ADDRESS_STATE_NOT_FOUND');assert.equal(await prisma.user.count({where:{email:normalPayload.email}}),0);
 const partial=await request(app).get('/api/patient-auth/address-states');assert.equal(partial.status,200);assert.equal(partial.body.complete,false);assert.equal(partial.body.states.some(state=>state.id===10),false);
 const before=await prisma.state.findMany({orderBy:{id:'asc'}});await bootstrap();
 assert.deepEqual(await prisma.state.findMany({where:{id:{not:10}},orderBy:{id:'asc'}}),before);
 assert.deepEqual(await prisma.state.findUnique({where:{id:10}}),northern);await bootstrap();assert.equal(await prisma.state.count({where:{id:10}}),1);
 const success=await request(app).post('/api/patient-auth/google/complete').send({...payload,onboardingToken:google.token});assert.equal(success.status,201);assert.equal(success.body.status,'AUTHENTICATED');
 const googleUser=await prisma.user.findUniqueOrThrow({where:{email:google.row.verifiedEmail},include:{patient:true}});assert.equal(googleUser.patient.addressStateId,10);assert.equal(await prisma.patient.count({where:{userId:googleUser.id}}),1);
 assert.equal((await request(app).post('/api/patient-auth/google/complete').send({...payload,onboardingToken:google.token})).status,422);assert.equal(await prisma.patient.count({where:{userId:googleUser.id}}),1);
 const registered=await request(app).post('/api/patient-auth/register').send(normalPayload);assert.equal(registered.status,201);
 const verified=await request(app).post('/api/patient-auth/verify').send({challengeId:registered.body.challengeId,code:registered.body.developmentCode});assert.equal(verified.status,200);
 const user=await prisma.user.findUniqueOrThrow({where:{email:normalPayload.email},include:{patient:true}});assert.equal(user.patient.addressStateId,10);assert.equal(await prisma.patient.count({where:{userId:user.id}}),1);
});
test('all 18 advertised state IDs resolve and labels never serve as lookup keys',async()=>{
 const response=await request(app).get('/api/patient-auth/address-states');assert.equal(response.status,200);assert.equal(response.body.complete,true);assert.deepEqual(response.body.states,canonical);
 assert.equal(new Set(response.body.states.map(row=>row.id)).size,18);assert.equal(new Set(response.body.states.map(row=>row.labelAr)).size,18);assert.equal(new Set(response.body.states.map(row=>row.labelEn)).size,18);
 for(const row of response.body.states)assert.equal(await prisma.$transaction(tx=>resolveAddressStateId(tx,row.id)),row.id);
 for(const invalid of [0,19,999,1.5,'الولاية الشمالية','Northern State'])await assert.rejects(()=>prisma.$transaction(tx=>resolveAddressStateId(tx,invalid)),error=>error.code==='ADDRESS_STATE_INVALID');
});
test('conflicting Northern identity or duplicate normalized labels abort atomically and preserve patients',async()=>{
 const snapshot=await prisma.patient.findMany({orderBy:{id:'asc'}});
 await prisma.state.update({where:{id:10},data:{labelEn:'Incorrect reference label'}});
 try{await assert.rejects(bootstrap(),error=>error.code==='REFERENCE_STATE_CONFLICT');assert.equal((await prisma.state.findUnique({where:{id:10}})).labelEn,'Incorrect reference label');}finally{await prisma.state.update({where:{id:10},data:northern});}
 await prisma.state.create({data:{...northern,id:99,labelAr:`  ${northern.labelAr}  `,labelEn:'NORTHERN'}});
 try{await assert.rejects(bootstrap(),error=>error.code==='REFERENCE_STATE_CONFLICT');assert.equal(await prisma.state.count(),19);}finally{await prisma.state.delete({where:{id:99}});}
 assert.deepEqual(await prisma.patient.findMany({orderBy:{id:'asc'}}),snapshot);
});
test('unsupported locality or address-country fields are rejected instead of inventing a hierarchy',async()=>{
 for(const extra of [{addressAreaId:10},{localityId:'label'},{addressCountry:'SD'}]){
  assert.equal((await request(app).post('/api/patient-auth/register').send({...fields(),email:`${crypto.randomUUID()}@example.invalid`,...extra})).status,422);
  assert.equal((await request(app).post('/api/patient-auth/google/complete').send({...fields(),onboardingToken:'synthetic-unused',...extra})).status,422);
 }
});
test('the staging-only operator policy rejects production, alternate schemas and credentials in output',()=>{
 const valid=`postgresql://operator:synthetic-secret@${SUDAN_REPAIR_STAGING_HOST}/neondb?sslmode=require`;
 const absent={...process.env};delete absent.DATABASE_URL;delete absent.DIRECT_URL;
 const noEnvironment=spawnSync(process.execPath,['scripts/repair-sudan-states.js','--check'],{env:absent,encoding:'utf8'});assert.equal(noEnvironment.status,1);assert.match(noEnvironment.stderr,/must already be configured/);
 assert.equal(stagingStateRepairConfiguration({DIRECT_URL:valid},['--check']).apply,false);
 assert.equal(new URL(stagingStateRepairConfiguration({DIRECT_URL:valid},['--apply']).url).searchParams.get('sslmode'),'verify-full');
 for(const url of [valid.replace('ep-muddy-unit-b4hvj7be.c-6','ep-purple-brook-b5g403vw.c-7'),valid+'&schema=other',valid+'&schema=public&schema=public',valid+'&options=-csearch_path=other',valid+'&host=production.invalid',valid+'&dbname=other',valid+'&sslaccept=accept_invalid_certs'])assert.throws(()=>stagingStateRepairConfiguration({DIRECT_URL:url},['--apply']));
 const refused=spawnSync(process.execPath,['scripts/repair-sudan-states.js','--apply'],{env:{...process.env,DIRECT_URL:'postgresql://operator:synthetic-secret@production.invalid/neondb'},encoding:'utf8'});assert.equal(refused.status,1);assert.doesNotMatch(refused.stdout+refused.stderr,/synthetic-secret|postgresql:\/\//);
});
test('operator wrapper fixes only State rows, is idempotent, and refuses conflicts',async()=>{
 const rows=[];const client={$queryRaw:async()=>[{name:'neondb'}],state:{findMany:async()=>structuredClone(rows),create:async({data})=>rows.push(structuredClone(data))},clinicalService:{findMany:async()=>[]},$transaction:async callback=>callback(client)};
 const environment={DIRECT_URL:`postgresql://operator:synthetic-secret@${SUDAN_REPAIR_STAGING_HOST}/neondb?sslmode=require`};
 const dry=await repairSudanStates(client,false,environment);assert.equal(dry.report.states.missing.length,18);assert.equal(rows.length,0);
 await repairSudanStates(client,true,environment);assert.deepEqual(rows,canonical);await repairSudanStates(client,true,environment);assert.equal(rows.length,18);
 rows.push({...canonical[9]});await assert.rejects(()=>repairSudanStates(client,true,environment),error=>error.code==='REFERENCE_STATE_CONFLICT');rows.pop();
 rows[9].labelEn='Conflicting';await assert.rejects(()=>repairSudanStates(client,true,environment),error=>error.code==='REFERENCE_STATE_CONFLICT');assert.equal(rows[9].labelEn,'Conflicting');
});

test('registration rejects malformed IDs rather than coercing labels, booleans or arrays',async()=>{
 for(const addressStateId of [true,[10],'10.0','الولاية الشمالية','Northern State',999]){
  const result=await request(app).post('/api/patient-auth/register').send({...fields(),email:`${crypto.randomUUID()}@example.invalid`,addressStateId});
  assert.equal(result.status,422);assert.equal(result.body.error.code,'VALIDATION_ERROR');
 }
});
