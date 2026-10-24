import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { app } from '../src/server.js';
import prisma from '../src/db.js';
import { signAccessToken, verifyActiveAccessToken } from '../src/services/accessTokens.js';
import { deleteStaffAccount } from '../src/services/staffDeletion.js';
let admin, token, patient;
const createUser = (data={}) => prisma.user.create({data:{username:`staff-${crypto.randomUUID()}@example.test`,passwordHash:'unusable-test-hash',role:'LAB_TECH',status:'ACTIVE',...data}});
const remove = (id, authorization = token) => request(app).delete(`/api/auth/users/${id}`).set('Authorization',`Bearer ${authorization}`);
before(async()=>{
 admin=await createUser({role:'ADMIN',passwordHash:await bcrypt.hash('ValidAdmin1',4),createdAt:new Date('2030-01-01')});token=signAccessToken(admin);
 patient=await prisma.patient.create({data:{fullNameAr:'اختبار',fullNameEn:'Deletion test',gender:'MALE',dateOfBirth:'1990-01-01',phone:'+250788000001',addressStateId:(await prisma.state.findFirstOrThrow()).id,emergencyContact:'Test'}});
});
after(async()=>prisma.$disconnect());
for(const status of ['ACTIVE','INACTIVE'])test(`unused ${status} staff is irreversibly deleted from the directory without removing its identity anchor`,async()=>{
 const target=await createUser({status});const response=await remove(target.id);assert.equal(response.status,204,JSON.stringify(response.body));
 const tombstone=await prisma.user.findUniqueOrThrow({where:{id:target.id}});
 assert.equal(tombstone.status,'DELETED');assert.equal(tombstone.username,`deleted-${target.id}`);assert.equal(tombstone.authVersion,target.authVersion+1);assert.notEqual(tombstone.passwordHash,target.passwordHash);
 const listed=await request(app).get('/api/auth/users').set('Authorization',`Bearer ${token}`);assert.equal(listed.body.some(row=>row.id===target.id),false);
 const audit=await prisma.tenantAuditLog.findFirstOrThrow({where:{action:'STAFF_ACCOUNT_DELETED',details:{contains:target.id}}});assert.equal(audit.userId,admin.id);assert.equal(JSON.parse(audit.details).username,target.username);
 assert.equal((await remove(target.id)).status,404);
 assert.equal((await request(app).put(`/api/auth/users/${target.id}/status`).set('Authorization',`Bearer ${token}`).send({status:'ACTIVE'})).status,404);
});
test('deleted credentials cannot authenticate or be reset, and authentication artifacts are removed',async()=>{
 const target=await createUser({passwordHash:await bcrypt.hash('ValidStaff1',4),email:`${crypto.randomUUID()}@example.test`,phoneNormalized:'+250788000009'});const access=signAccessToken(target);
 await prisma.mfaConfiguration.create({data:{userId:target.id,secretEncrypted:'encrypted',state:'PENDING'}});
 await prisma.mfaRecoveryCode.create({data:{userId:target.id,codeHash:'hash'}});
 await prisma.mfaChallenge.create({data:{userId:target.id,tokenHash:crypto.randomUUID(),expiresAt:new Date('2190-01-01')}});
 await prisma.verificationChallenge.create({data:{userId:target.id,type:'EMAIL',targetNormalized:target.username,codeHash:'hash',expiresAt:new Date('2190-01-01')}});
 await prisma.userExternalIdentity.create({data:{userId:target.id,provider:'GOOGLE',providerSubject:crypto.randomUUID(),normalizedEmailAtLink:target.username}});
 assert.equal((await remove(target.id)).status,204);
 await assert.rejects(()=>verifyActiveAccessToken(access),error=>error.code==='SESSION_REVOKED');
 assert.equal((await request(app).get('/api/auth/users').set('Authorization',`Bearer ${access}`)).status,401);
 for(const model of ['mfaConfiguration','mfaRecoveryCode','mfaChallenge','verificationChallenge','userExternalIdentity'])assert.equal(await prisma[model].count({where:{userId:target.id}}),0);
 const tombstone=await prisma.user.findUniqueOrThrow({where:{id:target.id}});assert.equal(tombstone.email,null);assert.equal(tombstone.phoneNormalized,null);
 const reset=await request(app).post(`/api/auth/users/${target.id}/reset-password`).set('Authorization',`Bearer ${token}`).send({newPassword:'NewStaff123',currentAdminPassword:'ValidAdmin1'});assert.equal(reset.status,404);
 const recreate=await request(app).post('/api/auth/users').set('Authorization',`Bearer ${token}`).send({username:target.username,password:'ValidStaff1',role:'LAB_TECH'});assert.equal(recreate.status,201);assert.notEqual(recreate.body.user.id,target.id);
});
for(const history of ['audit-actor','audit-target','invoice','payment','payment-operation','emergency','notification','claim-code','refund','stock'])test(`${history} history blocks deletion and remains intact`,async()=>{
 const target=await createUser();
 const invoice=()=>prisma.invoice.create({data:{patientId:patient.id,createdBy:admin.id,totalAmountSdg:10,totalAmountUsd:1,invoiceExchangeRate:10}});
 if(history==='audit-actor')await prisma.tenantAuditLog.create({data:{userId:target.id,action:'LAB_RESULT_UPDATED',details:'Clinical action',ipAddress:'test'}});
 if(history==='audit-target')await prisma.tenantAuditLog.create({data:{userId:admin.id,action:'STAFF_PASSWORD_RESET_BY_ADMIN',details:target.id,ipAddress:'test'}});
 if(history==='invoice')await prisma.invoice.create({data:{patientId:patient.id,createdBy:target.id,totalAmountSdg:10,totalAmountUsd:1,invoiceExchangeRate:10}});
 if(history==='payment')await prisma.payment.create({data:{invoiceId:(await invoice()).id,amountSdg:10,amountUsd:1,paymentMethod:'CASH',receivedBy:target.id}});
 if(history==='payment-operation')await prisma.paymentOperation.create({data:{invoiceId:(await invoice()).id,idempotencyKey:crypto.randomUUID(),requestHash:'hash',receivedBy:target.id}});
 if(history==='emergency'){
  const doctor=await prisma.doctor.findFirstOrThrow();const appointment=await prisma.appointment.create({data:{patientId:patient.id,doctorId:doctor.id,appointmentDate:'2190-01-01',appointmentTime:'09:00'}});
  await prisma.emergencyOverride.create({data:{appointmentId:appointment.id,authorizedById:target.id,justification:'History'}});
 }
 if(history==='notification')await prisma.notification.create({data:{userId:target.id,title:'Lab work',message:'History'}});
 if(history==='claim-code')await prisma.patientClaimCode.create({data:{patientId:patient.id,createdById:target.id,codeHash:'hash',expiresAt:new Date('2190-01-01')}});
 if(history==='refund')await prisma.refund.create({data:{invoiceId:(await invoice()).id,amountSdg:1,amountUsd:1,refundMethod:'CASH',processedBy:target.id}});
 if(history==='stock'){
  const drug=await prisma.drugFormulary.findFirstOrThrow();const batch=await prisma.inventoryBatch.findFirstOrThrow({where:{drugId:drug.id}});
  await prisma.stockMovement.create({data:{drugId:drug.id,inventoryBatchId:batch.id,movementType:'RECEIPT',quantityDelta:1,resultingBalance:1,actorUserId:target.id}});
 }
 const response=await remove(target.id);assert.equal(response.status,409,JSON.stringify(response.body));assert.equal(response.body.error.code,'STAFF_HAS_HISTORY');
 assert.equal((await prisma.user.findUniqueOrThrow({where:{id:target.id}})).status,'ACTIVE');
});
test('doctor schedules and clinical ownership are protected; an unused profile is retained disabled',async()=>{
 const makeDoctor=async()=>{const u=await createUser({role:'DOCTOR'});return prisma.doctor.create({data:{userId:u.id,fullNameAr:'اختبار',fullNameEn:'Test',specialtyAr:'عام',specialtyEn:'General',consultationFee:1,weeklySchedule:'[]'}});};
 const unused=await makeDoctor();assert.equal((await remove(unused.userId)).status,204);assert.equal((await prisma.doctor.findUniqueOrThrow({where:{id:unused.id}})).status,'INACTIVE');
 const unknown=await makeDoctor();await prisma.doctor.update({where:{id:unknown.id},data:{weeklySchedule:'{}'}});assert.equal((await remove(unknown.userId)).body.error.code,'STAFF_HAS_HISTORY');
 const scheduled=await makeDoctor();await prisma.doctorSchedule.create({data:{doctorId:scheduled.id,effectiveFrom:'2190-01-01'}});assert.equal((await remove(scheduled.userId)).body.error.code,'STAFF_HAS_HISTORY');
 const clinical=await makeDoctor();await prisma.appointment.create({data:{doctorId:clinical.id,patientId:patient.id,appointmentDate:'2190-01-01',appointmentTime:'09:00'}});assert.equal((await remove(clinical.userId)).body.error.code,'STAFF_HAS_HISTORY');
});
test('self, primary administrator, patient targets and malformed IDs are protected',async()=>{
 assert.equal((await remove(admin.id)).body.error.code,'STAFF_DELETE_SELF');
 const primary=await prisma.user.findFirstOrThrow({where:{role:'ADMIN'},orderBy:[{createdAt:'asc'},{id:'asc'}]});assert.notEqual(primary.id,admin.id);assert.equal((await remove(primary.id)).body.error.code,'STAFF_PROTECTED_ADMIN');
 const target=await createUser({role:'PATIENT'});assert.equal((await remove(target.id)).status,422);assert.equal((await remove('invalid-id')).status,422);
 assert.equal((await request(app).delete(`/api/auth/users/${target.id}`)).status,401);
 const staff=await createUser();assert.equal((await request(app).delete(`/api/auth/users/${target.id}`).set('Authorization',`Bearer ${signAccessToken(staff)}`)).status,403);
});
test('last-active-admin guard is authoritative even with a stale actor, and status changes share the protection',async()=>{
 const active=await prisma.user.findMany({where:{role:'ADMIN',status:'ACTIVE'}});const target=await createUser({role:'ADMIN'});
 try{
  await prisma.user.updateMany({where:{role:'ADMIN',id:{not:target.id}},data:{status:'INACTIVE'}});
  await assert.rejects(()=>deleteStaffAccount({user:{id:admin.id,av:admin.authVersion},ip:'test'},target.id),error=>error.code==='STAFF_LAST_ACTIVE_ADMIN');
  const response=await request(app).put(`/api/auth/users/${target.id}/status`).set('Authorization',`Bearer ${signAccessToken(target)}`).send({status:'INACTIVE'});assert.equal(response.body.error.code,'STAFF_LAST_ACTIVE_ADMIN');
 }finally{await prisma.user.updateMany({where:{id:{in:active.map(row=>row.id)}},data:{status:'ACTIVE'}});}
});
test('concurrent duplicate deletion performs one mutation and one audit event',async()=>{
 const target=await createUser();const responses=await Promise.all([remove(target.id),remove(target.id)]);assert.deepEqual(responses.map(r=>r.status).sort(),[204,404]);
 assert.equal(await prisma.tenantAuditLog.count({where:{action:'STAFF_ACCOUNT_DELETED',details:{contains:target.id}}}),1);
});
test('staff filters apply before pagination and tombstones never return',async()=>{
 const needle=`filter-${crypto.randomUUID()}`;const target=await createUser({username:`${needle}@example.test`,role:'PHARMACIST',status:'INACTIVE'});
 const response=await request(app).get('/api/auth/users').query({search:needle.toUpperCase(),role:'PHARMACIST',status:'INACTIVE',pageSize:1}).set('Authorization',`Bearer ${token}`);
 assert.equal(response.status,200);assert.deepEqual(response.body.map(row=>row.id),[target.id]);assert.equal(response.headers['x-has-more'],'false');
 await remove(target.id);assert.equal((await request(app).get('/api/auth/users').query({search:needle}).set('Authorization',`Bearer ${token}`)).body.length,0);
});

test('an audit failure rolls back deletion, credential cleanup and session revocation',async()=>{
 const target=await createUser();await prisma.mfaRecoveryCode.create({data:{userId:target.id,codeHash:'preserved'}});
 const name=`staff_delete_fail_${process.pid}`;
 await prisma.$executeRawUnsafe(`CREATE FUNCTION ${name}() RETURNS trigger AS $$ BEGIN IF NEW."action" = 'STAFF_ACCOUNT_DELETED' THEN RAISE EXCEPTION 'forced test failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
 await prisma.$executeRawUnsafe(`CREATE TRIGGER ${name} BEFORE INSERT ON "TenantAuditLog" FOR EACH ROW EXECUTE FUNCTION ${name}()`);
 try{
  const result=await remove(target.id);assert.equal(result.status,500);assert.equal(result.body.error.code,'STAFF_DELETE_FAILED');assert.equal(JSON.stringify(result.body).includes('forced test failure'),false);
  const current=await prisma.user.findUniqueOrThrow({where:{id:target.id}});assert.equal(current.status,'ACTIVE');assert.equal(current.authVersion,target.authVersion);assert.equal(current.username,target.username);assert.equal(await prisma.mfaRecoveryCode.count({where:{userId:target.id}}),1);
 }finally{await prisma.$executeRawUnsafe(`DROP TRIGGER ${name} ON "TenantAuditLog"`);await prisma.$executeRawUnsafe(`DROP FUNCTION ${name}()`);}
});

test('deletion commits the existing cross-process session revocation notification',async()=>{
 const {Client}=await import('pg');const client=new Client({connectionString:process.env.DATABASE_URL});await client.connect();
 const target=await createUser();const notificationAdmin=await createUser({role:'ADMIN'});let timer;
 try{
  await client.query('LISTEN clinic_auth_revocation_v1');
  const notification=new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(new Error('No committed revocation notification')),3000);client.on('notification',event=>{const value=JSON.parse(event.payload);if(value.userId===target.id)resolve(value);});});
  assert.equal((await remove(target.id,signAccessToken(notificationAdmin))).status,204);const event=await notification;assert.equal(event.type,'AUTH_VERSION_CHANGED');assert.equal(event.authVersion,target.authVersion+1);
 }finally{clearTimeout(timer);await client.end();}
});
