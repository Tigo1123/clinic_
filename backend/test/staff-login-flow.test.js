import test, { beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import * as OTPAuth from 'otpauth';
import request from 'supertest';
import prisma from '../src/db.js';
import { app, httpServer } from '../src/server.js';
import { encryptMfaSecret } from '../src/services/mfaCrypto.js';
import { findMfaChallenge } from '../src/services/mfa.js';
import { resetTestRateLimiters } from '../src/utils/edgeSecurity.js';

const api = request(app);
const password = 'Isolated-Login-Flow@123';
beforeEach(async()=>resetTestRateLimiters());
after(async()=>{if(httpServer.listening)await new Promise(resolve=>httpServer.close(resolve));await prisma.$disconnect();});
async function account(role){
 const user=await prisma.user.create({data:{username:`single-login-${crypto.randomUUID()}@example.test`,role,passwordHash:await bcrypt.hash(password,4),mfaEnabled:true}});
 const secret=new OTPAuth.Secret({size:20});
 const totp=new OTPAuth.TOTP({algorithm:'SHA1',digits:6,period:30,secret});
 await prisma.mfaConfiguration.create({data:{userId:user.id,state:'ACTIVE',secretEncrypted:encryptMfaSecret(secret.base32,user.id)}});
 return {user,totp};
}
for(const role of ['ADMIN','PHARMACIST','RECEPTIONIST'])test(`${role}: one password request creates one challenge, TOTP creates a session, replay stays rejected`,async()=>{
 const {user,totp}=await account(role);
 const login=await api.post('/api/auth/login').send({username:user.username,password});
 assert.equal(login.status,200);assert.equal(login.body.mfaRequired,true);assert.equal('token' in login.body,false);
 assert.equal(await prisma.mfaChallenge.count({where:{userId:user.id,purpose:'LOGIN',usedAt:null}}),1);
 assert.equal(await prisma.tenantAuditLog.count({where:{userId:user.id,action:'MFA_CHALLENGE_CREATED'}}),1);
 const verify=await api.post('/api/auth/mfa/verify').send({challengeToken:login.body.challengeToken,code:totp.generate()});
 assert.equal(verify.status,200);assert.ok(typeof verify.body.token==='string');assert.equal(verify.body.user.role,role);
 assert.equal((await api.get('/api/billing/payment-methods').set('Authorization',`Bearer ${verify.body.token}`)).status,200);
 assert.equal(await findMfaChallenge(login.body.challengeToken),null);
 const replay=await api.post('/api/auth/mfa/verify').send({challengeToken:login.body.challengeToken,code:totp.generate()});
 assert.equal(replay.status,401);assert.equal(replay.body.error.code,'MFA_CHALLENGE_INVALID');
});
test('a deliberate newer LOGIN challenge invalidates the older one without changing expiry or authVersion checks',async()=>{
 const {user,totp}=await account('ADMIN');
 const first=await api.post('/api/auth/login').send({username:user.username,password});
 const second=await api.post('/api/auth/login').send({username:user.username,password});
 assert.equal(first.status,200);assert.equal(second.status,200);assert.ok(first.body.challengeToken!==second.body.challengeToken);
 assert.equal(await findMfaChallenge(first.body.challengeToken),null);assert.ok(await findMfaChallenge(second.body.challengeToken));
 const rejected=await api.post('/api/auth/mfa/verify').send({challengeToken:first.body.challengeToken,code:totp.generate()});
 assert.equal(rejected.status,401);assert.equal(rejected.body.error.code,'MFA_CHALLENGE_INVALID');
 const accepted=await api.post('/api/auth/mfa/verify').send({challengeToken:second.body.challengeToken,code:totp.generate()});assert.equal(accepted.status,200);
});

// Optional real-browser test. Standard CI remains independent of a local Chrome
// process. Run only through the guarded isolated runner with this flag enabled.
test('real staff UI: password → one challenge → TOTP → role dashboard', {skip:process.env.STAFF_LOGIN_BROWSER_QA!=='true'}, async()=>{
 const { verifyStaffLoginBrowser }=await import('../scripts/verify-staff-login-browser.js');
 if(!httpServer.listening)await new Promise(resolve=>httpServer.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${httpServer.address().port}`;
 for(const role of ['ADMIN','PHARMACIST','RECEPTIONIST']){
  await resetTestRateLimiters();
  const {user,totp}=await account(role);
  await verifyStaffLoginBrowser({apiOrigin:origin,username:user.username,password,totp,role});
  assert.equal(await prisma.tenantAuditLog.count({where:{userId:user.id,action:'MFA_CHALLENGE_CREATED'}}),1);
  assert.equal(await prisma.mfaChallenge.count({where:{userId:user.id,usedAt:null}}),0);
 }
});
