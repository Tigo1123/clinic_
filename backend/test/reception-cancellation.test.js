import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import request from 'supertest';
import { io as connectSocket } from 'socket.io-client';
import prisma from '../src/db.js';
import { app, httpServer, io, socketRevocation } from '../src/server.js';
import { signAccessToken } from '../src/services/accessTokens.js';
import { isolatedDatabaseUrl } from './helpers/testRunner.js';
const target=new URL(process.env.DATABASE_URL);const schema=target.searchParams.get('schema');
if(!/^test_[a-z0-9_]+$/.test(schema))throw Error('Isolated test schema required');
isolatedDatabaseUrl(process.env.DATABASE_URL,schema,process.env.TEST_DATABASE_PORT||'5433');
const api=request(app),users={};let doctor,patient,origin,sequence=0;
const unique=()=>crypto.randomUUID();
const auth=role=>({Authorization:`Bearer ${users[role].token}`});
const key=id=>`APPOINTMENT_CANCELLED:${id}`;
const notices=id=>prisma.notification.findMany({where:{entityId:id,type:'APPOINTMENT_CANCELLED'}});
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};
function event(socket,name,predicate=()=>true){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{socket.off(name,handler);reject(Error(`Timed out ${name}`));},5000);const handler=value=>{if(predicate(value)){clearTimeout(timer);socket.off(name,handler);resolve(value);}};socket.on(name,handler);});}
async function connect(role='RECEPTIONIST'){const socket=connectSocket(origin,{autoConnect:false,auth:{token:users[role].token},transports:['websocket'],reconnection:false});const ready=event(socket,'connect');socket.connect();await ready;return socket;}
async function appointment(status='PENDING'){const index=sequence++;return prisma.appointment.create({data:{patientId:patient.id,doctorId:doctor.id,appointmentDate:'2099-01-01',appointmentTime:`${String(8+Math.floor(index/60)).padStart(2,'0')}:${String(index%60).padStart(2,'0')}`,status}});}
before(async()=>{
 await prisma.user.updateMany({where:{role:'RECEPTIONIST'},data:{status:'INACTIVE'}});
 for(const role of ['RECEPTIONIST','ADMIN','DOCTOR','PHARMACIST','LAB_TECH']){const user=await prisma.user.create({data:{username:`cancel-${role}-${unique()}`,role,passwordHash:'isolated-only'}});users[role]={...user,token:signAccessToken(user)};}
 doctor=await prisma.doctor.create({data:{userId:users.DOCTOR.id,fullNameAr:'طبيب اختبار',fullNameEn:'Test doctor',specialtyAr:'عام',specialtyEn:'General',consultationFee:100,weeklySchedule:'{}'}});
 users.DOCTOR.token=signAccessToken({...users.DOCTOR,doctorId:doctor.id});
 patient=await prisma.patient.create({data:{fullNameAr:'سري',fullNameEn:'PRIVATE CLINICAL PATIENT',gender:'MALE',dateOfBirth:'1990-01-01',phone:'+249911111111',addressStateId:1,emergencyContact:'Self'}});
 await socketRevocation.start();assert.equal(socketRevocation.isReady(),true);httpServer.listen(0,'127.0.0.1');await once(httpServer,'listening');origin=`http://127.0.0.1:${httpServer.address().port}`;
});
after(async()=>{await socketRevocation.stop();await new Promise(resolve=>io.close(resolve));await prisma.$disconnect();});

test('successful Reception cancellation commits exactly one safe bilingual Reception notice and one socket creation',async()=>{
 const value=await appointment();const socket=await connect(),other=await connect('PHARMACIST');const received=[],leaked=[];socket.on('notification',row=>{if(row.type==='APPOINTMENT_CANCELLED')received.push(row.id);});other.on('notification',row=>{if(row.type==='APPOINTMENT_CANCELLED')leaked.push(row.id);});
 try{assert.equal((await notices(value.id)).length,0);const delivered=event(socket,'notification',row=>row.type==='APPOINTMENT_CANCELLED');
  const response=await api.put(`/api/appointments/${value.id}/status`).set(auth('RECEPTIONIST')).send({status:'CANCELLED'}).expect(200);assert.equal(response.body.status,'CANCELLED');const wire=await delivered;
  const rows=await notices(value.id);assert.equal(rows.length,1);assert.equal(rows[0].userId,users.RECEPTIONIST.id);assert.equal(rows[0].eventKey,key(value.id));assert.equal(wire.id,rows[0].id);assert.equal(wire.titleEn,'Appointment cancelled');assert.equal(wire.titleAr,'تم إلغاء الموعد');assert.match(wire.messageAr,/افتح قسم الاستقبال/);assert.doesNotMatch(JSON.stringify(wire),/PRIVATE|diagnos|password|token/i);
  assert.equal(await prisma.notification.count({where:{entityId:value.id,userId:users.RECEPTIONIST.id,type:'APPOINTMENT_CHANGED'}}),0);
  assert.ok(await prisma.notification.findFirst({where:{entityId:value.id,userId:users.DOCTOR.id,type:'APPOINTMENT_CHANGED'}}));assert.ok(await prisma.notification.findFirst({where:{entityId:value.id,userId:users.ADMIN.id,type:'APPOINTMENT_CHANGED'}}));
  for(let i=0;i<2;i++)await api.put(`/api/appointments/${value.id}/status`).set(auth('RECEPTIONIST')).send({status:'CANCELLED'}).expect(409);
  await prisma.$executeRaw`SELECT clinic_notify('APPOINTMENT_CANCELLED',${key(value.id)},'Appointment',${value.id},ARRAY['RECEPTIONIST'])`;
  const feed=await api.get('/api/notifications?limit=50').set(auth('RECEPTIONIST')).expect(200);assert.equal(feed.body.notifications.filter(row=>row.id===rows[0].id).length,1);
  socket.disconnect();const reconnected=event(socket,'connect');socket.connect();await reconnected;await api.get('/api/notifications').set(auth('RECEPTIONIST')).expect(200);
  assert.deepEqual(received,[rows[0].id]);assert.equal((await notices(value.id)).length,1);assert.deepEqual(leaked,[]);
 }finally{socket.disconnect();other.disconnect();}
});

for(const status of [422,401,403,404,409])test(`failed ${status} cancellation creates no cancellation notice`,async()=>{
 const value=await appointment(status===409?'COMPLETED':'PENDING');const path=status===404?unique():value.id;const req=api.put(`/api/appointments/${path}/status`);
 if(status!==401)req.set(auth(status===403?'PHARMACIST':'RECEPTIONIST'));
 await req.send({status:status===422?'INVALID':'CANCELLED'}).expect(status);assert.equal((await notices(value.id)).length,0);
});

test('audit failure rolls cancellation and notices back; retry after 500 creates one notice',async()=>{
 const value=await appointment();const socket=await connect();const received=[];socket.on('notification',row=>{if(row.type==='APPOINTMENT_CANCELLED')received.push(row.id);});
 await prisma.$executeRawUnsafe(`ALTER TABLE "TenantAuditLog" ADD CONSTRAINT test_reception_cancel_rollback CHECK (action <> 'APPOINTMENT_STATUS_UPDATED' OR details NOT LIKE '%${value.id}%')`);
 try{await api.put(`/api/appointments/${value.id}/status`).set(auth('RECEPTIONIST')).send({status:'CANCELLED'}).expect(500);assert.equal((await prisma.appointment.findUniqueOrThrow({where:{id:value.id}})).status,'PENDING');assert.equal((await notices(value.id)).length,0);assert.deepEqual(received,[]);}
 finally{await prisma.$executeRawUnsafe('ALTER TABLE "TenantAuditLog" DROP CONSTRAINT test_reception_cancel_rollback');}
 try{const delivered=event(socket,'notification',row=>row.type==='APPOINTMENT_CANCELLED');await api.put(`/api/appointments/${value.id}/status`).set(auth('RECEPTIONIST')).send({status:'CANCELLED'}).expect(200);const row=await delivered;assert.equal((await notices(value.id)).length,1);assert.deepEqual(received,[row.id]);}finally{socket.disconnect();}
});

test('uncommitted cancellation is invisible to other readers and emits only after commit',async()=>{
 const value=await appointment();const socket=await connect();const received=[];socket.on('notification',row=>{if(row.type==='APPOINTMENT_CANCELLED')received.push(row.id);});const entered=deferred(),release=deferred();let rowId;
 try{const transaction=prisma.$transaction(async tx=>{await tx.appointment.update({where:{id:value.id},data:{status:'CANCELLED'}});rowId=(await tx.notification.findFirstOrThrow({where:{eventKey:key(value.id),userId:users.RECEPTIONIST.id}})).id;entered.resolve();await release.promise;});
  await entered.promise;assert.equal((await notices(value.id)).length,0);assert.deepEqual(received,[]);const delivered=event(socket,'notification',row=>row.id===rowId);release.resolve();await transaction;await delivered;assert.deepEqual(received,[rowId]);assert.equal((await notices(value.id)).length,1);
 }finally{release.resolve();socket.disconnect();}
});
