import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import request from 'supertest';
import { io as connectSocket } from 'socket.io-client';
import { Client } from 'pg';
import prisma from '../src/db.js';
import { app, httpServer, io, socketRevocation } from '../src/server.js';
import { signAccessToken } from '../src/services/accessTokens.js';
import { scanStockNotifications } from '../src/services/stockNotifications.js';
import { NotificationDelivery, NOTIFICATION_CHANNEL } from '../src/services/notificationDelivery.js';

const api = request(app);
const users = {};
let doctor, otherDoctor, patient, appointment, record, url;
const auth = role => ({ Authorization: `Bearer ${users[role].token}` });
const unique = () => crypto.randomUUID();
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function waitEvent(socket, name, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(name, handler); reject(new Error(`Timed out: ${name}`)); }, 5000);
    const handler = data => { if (predicate(data)) { clearTimeout(timer); socket.off(name, handler); resolve(data); } };
    socket.on(name, handler);
  });
}
async function connect(role) {
  const socket = connectSocket(url, { autoConnect: false, auth: { token: users[role].token }, transports: ['websocket'], reconnection: false });
  const connected = waitEvent(socket, 'connect'); socket.connect(); await connected; return socket;
}
async function createMedicine() {
  const id = unique();
  return prisma.drugFormulary.create({ data: { brandName: id, genericName: id, identityKey: id, labelAr: 'دواء اختبار', labelEn: 'Test medicine', strength: '1mg', dosageForm: 'Tablet' } });
}
before(async () => {
  for (const role of ['ADMIN', 'RECEPTIONIST', 'DOCTOR', 'OTHER_DOCTOR', 'PHARMACIST', 'LAB_TECH', 'PATIENT']) {
    const user = await prisma.user.create({ data: { username: `notice-${role}-${unique()}`, role: role === 'OTHER_DOCTOR' ? 'DOCTOR' : role, passwordHash: 'isolated-test-only' } });
    users[role] = { ...user, token: signAccessToken(user) };
  }
  const makeDoctor = userId => prisma.doctor.create({ data: { userId, fullNameAr: 'طبيب اختبار', fullNameEn: 'Test doctor', specialtyAr: 'عام', specialtyEn: 'General', consultationFee: 100, weeklySchedule: '{}' } });
  doctor = await makeDoctor(users.DOCTOR.id); otherDoctor = await makeDoctor(users.OTHER_DOCTOR.id);
  users.DOCTOR.token = signAccessToken({ ...users.DOCTOR, doctorId: doctor.id });
  users.OTHER_DOCTOR.token = signAccessToken({ ...users.OTHER_DOCTOR, doctorId: otherDoctor.id });
  patient = await prisma.patient.create({ data: { fullNameAr: 'سري', fullNameEn: 'PRIVATE PATIENT NAME', gender: 'MALE', dateOfBirth: '1990-01-01', phone: '0991000001', addressStateId: 1, emergencyContact: 'Self' } });
  appointment = await prisma.appointment.create({ data: { patientId: patient.id, doctorId: doctor.id, appointmentDate: '2099-01-01', appointmentTime: '09:00', status: 'CONFIRMED' } });
  record = await prisma.medicalRecord.create({ data: { patientId: patient.id, doctorId: doctor.id, appointmentId: appointment.id, symptomsEncrypted: '', diagnosisEncrypted: '', treatmentEncrypted: '', vitalSignsJson: '{}', clinicalNotesEncrypted: '' } });
  await socketRevocation.start(); assert.equal(socketRevocation.isReady(), true);
  httpServer.listen(0, '127.0.0.1'); await once(httpServer, 'listening'); url = `http://127.0.0.1:${httpServer.address().port}`;
});
after(async () => { await socketRevocation.stop(); await new Promise(resolve => io.close(resolve)); await prisma.$disconnect(); });

test('durable registration and appointment notices target operational roles and only the assigned doctor', async () => {
  const rows = await prisma.notification.findMany({ where: { entityId: appointment.id, type: 'APPOINTMENT_BOOKED' } });
  for (const role of ['ADMIN', 'RECEPTIONIST', 'DOCTOR']) assert.ok(rows.some(r => r.userId === users[role].id));
  for (const role of ['OTHER_DOCTOR', 'PHARMACIST', 'LAB_TECH', 'PATIENT']) assert.ok(!rows.some(r => r.userId === users[role].id));
  const registered = await prisma.notification.count({ where: { entityId: patient.id, type: 'PATIENT_REGISTERED' } });
  await prisma.patient.update({ where: { id: patient.id }, data: { fullNameEn: 'PRIVATE UPDATED NAME' } });
  assert.equal(await prisma.notification.count({ where: { entityId: patient.id, type: 'PATIENT_REGISTERED' } }), registered);
});

test('API ownership, newest-first cursor pagination, unread count and idempotent read operations survive reload', async () => {
  const owner = users.PHARMACIST.id;
  await prisma.notification.deleteMany({ where: { userId: owner } });
  for (let i = 0; i < 5; i++) await prisma.notification.create({ data: { userId: owner, title: `Notice ${i}`, message: 'Safe', createdAt: new Date(`2025-01-0${i + 1}`) } });
  let response = await api.get('/api/notifications?limit=2').set(auth('PHARMACIST'));
  assert.equal(response.status, 200); assert.equal(response.body.unreadCount, 5);
  assert.deepEqual(response.body.notifications.map(n => n.title), ['Notice 4', 'Notice 3']);
  assert.equal(response.headers['cache-control'].includes('no-store'), true);
  const firstId = response.body.notifications[0].id;
  assert.equal('userId' in response.body.notifications[0], false);
  const second = await api.get(`/api/notifications?limit=2&cursor=${response.body.nextCursor}`).set(auth('PHARMACIST'));
  assert.deepEqual(second.body.notifications.map(n => n.title), ['Notice 2', 'Notice 1']);
  const last = await api.get(`/api/notifications?limit=2&cursor=${second.body.nextCursor}`).set(auth('PHARMACIST'));
  assert.equal(last.body.notifications.length, 1); assert.equal(last.body.nextCursor, null);
  assert.equal((await api.patch(`/api/notifications/${firstId}/read`).set(auth('DOCTOR'))).status, 404);
  for (let i = 0; i < 2; i++) assert.equal((await api.patch(`/api/notifications/${firstId}/read`).set(auth('PHARMACIST'))).body.unreadCount, 4);
  assert.equal((await api.get('/api/notifications').set(auth('PHARMACIST'))).body.unreadCount, 4);
  await api.patch('/api/notifications/read-all').set(auth('PHARMACIST')).send({ before: '2025-01-03T00:00:00.000Z' }).expect(200);
  assert.equal((await api.get('/api/notifications').set(auth('PHARMACIST'))).body.unreadCount, 1);
  await api.patch('/api/notifications/read-all').set(auth('PHARMACIST')).send({}).expect(200);
  assert.equal((await api.get('/api/notifications').set(auth('PHARMACIST'))).body.unreadCount, 0);
  await api.get('/api/notifications?limit=5000').set(auth('PHARMACIST')).expect(400);
  await api.get('/api/notifications?cursor=broken').set(auth('PHARMACIST')).expect(400);
  const patientFeed = await api.get('/api/notifications').set(auth('PATIENT')).expect(200);
  assert.equal(patientFeed.body.notifications.length, 0);
  await api.get('/api/notifications').expect(401);
});

test('Reception check-in reaches only the assigned doctor without refresh and no-op retry creates no duplicates', async () => {
  const socket = await connect('DOCTOR'); const unrelated = await connect('OTHER_DOCTOR'); const leaked = [];
  unrelated.on('notification', event => leaked.push(event));
  try {
    const received = waitEvent(socket, 'notification');
    await api.put(`/api/appointments/${appointment.id}/status`).set(auth('RECEPTIONIST')).send({ status: 'CHECKED_IN' }).expect(200);
    const event = await received;
    assert.deepEqual(Object.keys(event), ['id', 'type', 'title', 'message', 'createdAt', 'isRead']);
    assert.equal(event.title, 'Patient checked in');
    assert.doesNotMatch(JSON.stringify(event), /PRIVATE|diagnosis|token|password/);
    const notice = await prisma.notification.findUniqueOrThrow({ where: { id: event.id } });
    assert.equal(notice.userId, users.DOCTOR.id); assert.equal(notice.type, 'PATIENT_READY');
    const count = await prisma.notification.count({ where: { entityId: appointment.id, type: 'PATIENT_READY' } });
    await prisma.appointment.update({ where: { id: appointment.id }, data: { status: 'CHECKED_IN' } });
    assert.equal(await prisma.notification.count({ where: { entityId: appointment.id, type: 'PATIENT_READY' } }), count);
    assert.equal(leaked.length, 0);
  } finally { socket.disconnect(); unrelated.disconnect(); }
});

test('commit relay never delivers a phantom notice and deduplicates an event key within a transaction or retry', async () => {
  const socket = await connect('PHARMACIST'); const events = [];
  socket.on('notification', event => events.push(event.id));
  const entered = deferred(); const release = deferred(); const key = `test:${unique()}`;
  let id;
  try {
    const transaction = prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT clinic_notify('PRESCRIPTION_READY',${key},'Prescription','safe',ARRAY['PHARMACIST'])`;
      id = (await tx.notification.findFirstOrThrow({ where: { eventKey: key, userId: users.PHARMACIST.id } })).id;
      entered.resolve(); await release.promise;
    });
    await entered.promise; assert.equal(events.length, 0);
    const received = waitEvent(socket, 'notification', event => event.id === id);
    release.resolve(); await transaction; await received;
    await prisma.$executeRaw`SELECT clinic_notify('PRESCRIPTION_READY',${key},'Prescription','safe',ARRAY['PHARMACIST'])`;
    assert.equal(await prisma.notification.count({ where: { eventKey: key, userId: users.PHARMACIST.id } }), 1);
    const failed = `failed:${unique()}`;
    await assert.rejects(prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT clinic_notify('PRESCRIPTION_READY',${failed},'Prescription','safe',ARRAY['PHARMACIST'])`;
      throw new Error('Business transaction failed');
    }), /Business transaction failed/);
    assert.equal(await prisma.notification.count({ where: { eventKey: failed } }), 0);
    assert.deepEqual(events, [id]);
  } finally { release.resolve(); socket.disconnect(); }
});

test('Doctor prescription, lab paid/completed, catalog pricing and dispense status produce the expected notices and refresh hints', async () => {
  const medicine = await createMedicine();
  assert.equal(await prisma.notification.count({ where: { entityId: medicine.id, userId: users.ADMIN.id, type: 'MEDICINE_PRICING_REQUIRED' } }), 1);
  const pharmacy = await connect('PHARMACIST'); const lab = await connect('LAB_TECH');
  try {
    const changed = waitEvent(pharmacy, 'workflowUpdated', e => e.topic === 'catalog');
    await api.patch(`/api/admin/pricing/medicines/${medicine.id}`).set(auth('ADMIN')).send({ priceSdg: 100, status: 'ACTIVE' }).expect(200);
    await changed;
    const returned = await api.get(`/api/pharmacy/formulary/${medicine.id}`).set(auth('PHARMACIST'));
    assert.equal(returned.body.status, 'ACTIVE'); assert.equal(returned.body.unitPriceSdg, 100);
    const created = waitEvent(pharmacy, 'notification');
    const rx = await prisma.prescription.create({ data: { medicalRecordId: record.id, patientId: patient.id, doctorId: doctor.id, prescribedDrugs: { create: { drugId: medicine.id, dosage: '1', duration: '1', instructionsAr: '', instructionsEn: '', qtyPrescribed: 1 } } } });
    await created;
    assert.equal(await prisma.notification.count({ where: { entityId: rx.id, userId: users.PHARMACIST.id, type: 'PRESCRIPTION_READY' } }), 1);
    const order = await prisma.labOrder.create({ data: { medicalRecordId: record.id, patientId: patient.id, doctorId: doctor.id } });
    const paid = waitEvent(lab, 'notification');
    await prisma.labOrder.update({ where: { id: order.id }, data: { status: 'PAID' } }); await paid;
    await prisma.labOrder.update({ where: { id: order.id }, data: { status: 'COMPLETED' } });
    assert.equal(await prisma.notification.count({ where: { entityId: order.id, userId: users.DOCTOR.id, type: 'LAB_RESULTS_COMPLETED' } }), 1);
    assert.equal(await prisma.notification.count({ where: { entityId: order.id, userId: users.OTHER_DOCTOR.id } }), 0);
    await prisma.prescription.update({ where: { id: rx.id }, data: { status: 'FILLED' } });
    assert.equal(await prisma.notification.count({ where: { entityId: rx.id, userId: users.DOCTOR.id, type: 'PRESCRIPTION_UPDATED' } }), 1);
    const list = await api.get('/api/notifications?limit=50').set(auth('DOCTOR'));
    const safe = JSON.stringify(list.body);
    assert.doesNotMatch(safe, /PRIVATE|symptomsEncrypted|diagnosis|password|token|eventKey/);
    assert.ok(list.body.notifications.some(n => n.titleAr && n.titleEn));
  } finally { pharmacy.disconnect(); lab.disconnect(); }
});

test('disconnected recipients recover durable notices after reconnect and read state synchronizes across sockets', async () => {
  let socket = await connect('PHARMACIST'); socket.disconnect();
  const medicine = await createMedicine();
  await prisma.drugFormulary.update({ where: { id: medicine.id }, data: { status: 'ACTIVE', unitPriceSdg: 100 } });
  const notice = await prisma.notification.findFirstOrThrow({ where: { userId: users.PHARMACIST.id, entityId: medicine.id } });
  socket = await connect('PHARMACIST');
  try {
    const response = await api.get('/api/notifications?limit=50').set(auth('PHARMACIST'));
    assert.ok(response.body.notifications.some(n => n.id === notice.id && !n.isRead));
    const read = waitEvent(socket, 'notifications:changed', e => e.id === notice.id);
    await api.patch(`/api/notifications/${notice.id}/read`).set(auth('PHARMACIST')).expect(200); await read;
    assert.equal((await prisma.notification.findUniqueOrThrow({ where: { id: notice.id } })).isRead, true);
  } finally { socket.disconnect(); }
});

test('a missed PG listener event recovers connected clients without requiring a transport reconnect', async () => {
  const socket = await connect('PHARMACIST');
  try {
    await socketRevocation.stop();
    const medicine = await createMedicine();
    await prisma.drugFormulary.update({ where: { id: medicine.id }, data: { unitPriceSdg: 100, status: 'ACTIVE' } });
    const recovered = waitEvent(socket, 'workflowUpdated', event => event.topic === 'reconnected');
    await socketRevocation.start(); await recovered;
    assert.equal(socket.connected, true);
    const response = await api.get('/api/notifications?limit=50').set(auth('PHARMACIST'));
    assert.ok(response.body.notifications.some(n => n.entityId === medicine.id));
  } finally { socket.disconnect(); await socketRevocation.start(); }
});

test('batched delivery coalesces duplicate/read-all hints with bounded queries and no global emission', async () => {
  const sent = []; let queries = 0;
  const rows = Array.from({ length: 50 }, (_, index) => ({ id: `notice-${index}`, userId: 'recipient', type: 'MEDICINE_UPDATED' }));
  const target = room => ({ emit: (event, payload) => sent.push({ room, event, payload }) });
  const relay = new NotificationDelivery({ local: { to: target } }, { prismaClient: {
    notification: { findMany: async query => { queries++; assert.equal(query.where.id.in.length, 50); return rows; } },
    user: { findMany: async () => { queries++; return [{ id: 'recipient' }]; } }
  } });
  for (const row of rows) for (let i = 0; i < 2; i++) relay.receive(NOTIFICATION_CHANNEL, JSON.stringify({ id: row.id, change: 'read' }));
  await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve));
  assert.equal(queries, 2); assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], { room: 'user_recipient', event: 'notifications:changed', payload: { id: 'notice-0' } }); relay.stop();
});

test('notification sockets reject missing authentication', async () => {
  const socket = connectSocket(url, { autoConnect: false, transports: ['websocket'], reconnection: false });
  try {
    const failed = waitEvent(socket, 'connect_error'); socket.connect();
    const error = await failed; assert.equal(error.data.code, 'AUTHENTICATION_REQUIRED'); assert.equal(socket.connected, false);
  } finally { socket.disconnect(); }
});

test('new notification timestamps stay UTC under a non-UTC database session and read-all includes the visible snapshot', async () => {
  const key = unique(); const started = Date.now();
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`SET LOCAL TIME ZONE 'Africa/Kigali'`;
    await tx.$executeRaw`SELECT clinic_notify('MEDICINE_UPDATED',${key},'DrugFormulary','safe',ARRAY['PHARMACIST'])`;
  });
  const row = await prisma.notification.findFirstOrThrow({ where: { eventKey: key, userId: users.PHARMACIST.id } });
  assert.ok(Math.abs(row.createdAt.getTime() - started) < 5000, 'timestamp is an actual UTC instant, not local wall time');
  const snapshot = await api.get('/api/notifications').set(auth('PHARMACIST'));
  await api.patch('/api/notifications/read-all').set(auth('PHARMACIST')).send({ before: snapshot.body.asOf }).expect(200);
  assert.equal((await prisma.notification.findUniqueOrThrow({ where: { id: row.id } })).isRead, true);
});

test('stock and expiry alerts use existing rules, are durable, deduplicate scans and rearm after replenishment', async () => {
  const medicine = await createMedicine();
  const batch = await prisma.inventoryBatch.create({ data: { drugId: medicine.id, batchNumber: 'A', normalizedBatchNumber: 'A', expiryDate: '2099-01-15', qtyOnHand: 1, minReorderLevel: 2 } });
  const instant = new Date('2099-01-01T12:00:00Z');
  await scanStockNotifications(prisma, instant); await scanStockNotifications(prisma, instant);
  const notices = () => prisma.notification.findMany({ where: { userId: users.PHARMACIST.id, entityId: { in: [medicine.id, batch.id] } } });
  assert.equal((await notices()).filter(n => n.type === 'STOCK_LOW').length, 1);
  assert.equal((await notices()).filter(n => n.type === 'BATCH_NEAR_EXPIRY').length, 1);
  await prisma.inventoryBatch.update({ where: { id: batch.id }, data: { qtyOnHand: 5 } }); await scanStockNotifications(prisma, instant);
  await prisma.inventoryBatch.update({ where: { id: batch.id }, data: { qtyOnHand: 0 } }); await scanStockNotifications(prisma, instant);
  assert.equal((await notices()).filter(n => n.type === 'STOCK_OUT').length, 1);
  assert.equal(await prisma.notification.count({ where: { userId: users.ADMIN.id, entityId: medicine.id, type: 'STOCK_OUT' } }), 1);
});

test('notification triggers remain security invoker and runtime privileges do not require ownership', async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL }); await client.connect();
  const schema = new URL(process.env.DATABASE_URL).searchParams.get('schema'); const role = `notice_runtime_${Date.now()}`;
  try {
    const definitions = await client.query("SELECT proname,prosecdef FROM pg_proc WHERE pronamespace=$1::regnamespace AND proname LIKE 'clinic_%'", [schema]);
    assert.ok(definitions.rows.filter(r => r.proname.startsWith('clinic_notify') || r.proname === 'clinic_workflow_notice').every(r => !r.prosecdef));
    await client.query(`CREATE ROLE "${role}" NOLOGIN`);
    await client.query(`GRANT USAGE ON SCHEMA "${schema}" TO "${role}"`);
    await client.query(`GRANT SELECT ON "User","Doctor" TO "${role}"`);
    await client.query(`GRANT INSERT ON "DrugFormulary" TO "${role}"`);
    await client.query(`SET ROLE "${role}"`);
    await assert.rejects(client.query('INSERT INTO "DrugFormulary" (id,"brandName","labelAr","labelEn","genericName",strength,"dosageForm","identityKey") VALUES ($1,$1,$1,$1,$1,$1,$1,$1)', [unique()]), /permission denied for table Notification/);
    await client.query('RESET ROLE');
    await client.query(`GRANT SELECT,INSERT ON "Notification" TO "${role}"`);
    await client.query(`SET ROLE "${role}"`);
    const id = unique();
    await client.query('INSERT INTO "DrugFormulary" (id,"brandName","labelAr","labelEn","genericName",strength,"dosageForm","identityKey") VALUES ($1,$1,$1,$1,$1,$1,$1,$1)', [id]);
    await client.query('RESET ROLE');
    assert.ok(await prisma.notification.findFirst({ where: { entityId: id, userId: users.ADMIN.id } }));
  } finally { await client.query('RESET ROLE'); await client.query(`DROP OWNED BY "${role}"`); await client.query(`DROP ROLE "${role}"`); await client.end(); }
});

test('legacy future timestamps remain readable without rewriting history or breaking older read-all clients', async () => {
  const createdAt = new Date('2099-01-01T00:00:00.000Z');
  const create = () => prisma.notification.create({ data: { userId: users.PHARMACIST.id, title: 'Legacy notice', message: 'Safe', createdAt } });
  const notice = await create();
  const snapshot = await api.get('/api/notifications').set(auth('PHARMACIST'));
  assert.equal(snapshot.body.asOf, createdAt.toISOString());
  await api.patch('/api/notifications/read-all').set(auth('PHARMACIST')).send({ before: snapshot.body.asOf }).expect(200);
  const saved = await prisma.notification.findUniqueOrThrow({ where: { id: notice.id } });
  assert.equal(saved.isRead, true); assert.equal(saved.createdAt.toISOString(), createdAt.toISOString());
  const olderClient = await create();
  await api.patch('/api/notifications/read-all').set(auth('PHARMACIST')).send({}).expect(200);
  assert.equal((await prisma.notification.findUniqueOrThrow({ where: { id: olderClient.id } })).isRead, true);
});
