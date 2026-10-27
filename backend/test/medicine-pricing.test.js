import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { Client } from 'pg';
import prisma from '../src/db.js';
import adminRoutes from '../src/routes/admin.js';
import pharmacyRoutes from '../src/routes/pharmacy.js';
import { signAccessToken } from '../src/services/accessTokens.js';
import { errorHandler } from '../src/utils/apiError.js';

const app = express();
app.use(express.json());
app.use('/api/admin', adminRoutes);
app.use('/api/pharmacy', pharmacyRoutes);
app.use(errorHandler);
const api = request(app);
let admin, pharmacist;
let counter = 0;
before(async () => {
  const user = async role => {
    const created = await prisma.user.create({ data: { username: `pricing-${role}-${crypto.randomUUID()}`, passwordHash: 'unused-test-hash', role } });
    return { ...created, token: signAccessToken(created) };
  };
  admin = await user('ADMIN'); pharmacist = await user('PHARMACIST');
});
after(async () => { await prisma.$disconnect(); });
const auth = user => ({ Authorization: `Bearer ${user.token}` });
async function createMedicine() {
  const unique = `${Date.now()}-${++counter}`;
  const response = await api.post('/api/pharmacy/formulary').set(auth(pharmacist)).send({
    brandName: `Pricing ${unique}`, labelAr: 'دواء اختبار الأسعار', labelEn: `Pricing ${unique}`,
    genericName: `Pricing generic ${unique}`, strength: '1 mg', dosageForm: 'Tablet',
    initialBatch: { batchNumber: `LOT-${unique}`, expiryDate: '2099-01-01', qtyOnHand: 12, minReorderLevel: 2 }
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  assert.equal(response.body.medicine.status, 'INACTIVE'); assert.equal(response.body.medicine.unitPriceSdg, null);
  return response.body.medicine;
}

test('Admin price and ACTIVE status persist to PostgreSQL and both refreshed APIs', async () => {
  const medicine = await createMedicine();
  const before = await prisma.drugFormulary.update({ where: { id: medicine.id }, data: { updatedAt: new Date('2020-01-01') } });
  const batches = await prisma.inventoryBatch.findMany({ where: { drugId: medicine.id } });
  const movements = await prisma.stockMovement.findMany({ where: { drugId: medicine.id } });
  const doctor = await prisma.doctor.findFirstOrThrow();
  const patient = await prisma.patient.create({ data: { fullNameAr: 'اختبار الأسعار', fullNameEn: 'Pricing history test', gender: 'MALE', dateOfBirth: '1990-01-01', phone: '0991000001', addressStateId: 1, emergencyContact: 'Self' } });
  const appointment = await prisma.appointment.create({ data: { patientId: patient.id, doctorId: doctor.id, appointmentDate: '2020-01-01', appointmentTime: '09:00', status: 'COMPLETED' } });
  const record = await prisma.medicalRecord.create({ data: { patientId: patient.id, doctorId: doctor.id, appointmentId: appointment.id, symptomsEncrypted: '', diagnosisEncrypted: '', treatmentEncrypted: '', vitalSignsJson: '{}', clinicalNotesEncrypted: '' } });
  const historical = await prisma.prescription.create({ data: { medicalRecordId: record.id, patientId: patient.id, doctorId: doctor.id, status: 'FILLED', prescribedDrugs: { create: { drugId: medicine.id, dosage: '1 daily', duration: '2 days', instructionsAr: '', instructionsEn: '', qtyPrescribed: 2, qtyDispensed: 2 } } }, include: { prescribedDrugs: true } });
  const invoice = await prisma.invoice.create({ data: { patientId: patient.id, prescriptionId: historical.id, invoiceType: 'PHARMACY', totalAmountSdg: 1000, totalAmountUsd: '0.666666666666666666666666666667', invoiceExchangeRate: 1500, paymentStatus: 'PAID', createdBy: admin.id, items: { create: { descriptionAr: 'دواء تاريخي', descriptionEn: 'Historical medicine', qty: 2, unitPriceSdg: 500, unitPriceUsd: '0.333333333333333333333333333333' } } }, include: { items: true } });
  const response = await api.patch(`/api/admin/pricing/medicines/${medicine.id}`).set(auth(admin)).send({ priceSdg: 2450, status: 'ACTIVE' });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.unitPriceSdg, 2450); assert.equal(response.body.status, 'ACTIVE');
  const stored = await prisma.drugFormulary.findUniqueOrThrow({ where: { id: medicine.id } });
  assert.equal(stored.unitPriceSdg.toString(), '2450'); assert.equal(stored.status, 'ACTIVE');
  assert.ok(stored.updatedAt > before.updatedAt);
  const catalogue = await api.get('/api/admin/pricing').set(auth(admin));
  assert.equal(catalogue.status, 200);
  const adminMedicine = catalogue.body.medicines.find(item => item.id === medicine.id);
  assert.equal(Number(adminMedicine.unitPriceSdg), 2450); assert.equal(adminMedicine.status, 'ACTIVE');
  // GET keeps Prisma's existing Decimal string serialization; PATCH and Pharmacy
  // keep their existing bounded, whole-SDG JSON numbers. Neither converts currency.
  assert.equal(adminMedicine.unitPriceSdg, '2450');
  const pharmacy = await api.get(`/api/pharmacy/formulary/${medicine.id}`).set(auth(pharmacist));
  assert.equal(pharmacy.status, 200); assert.equal(pharmacy.body.unitPriceSdg, 2450); assert.equal(pharmacy.body.status, 'ACTIVE');
  const listing = await api.get(`/api/pharmacy/formulary?status=ACTIVE&search=${encodeURIComponent(medicine.brandName)}`).set(auth(pharmacist));
  assert.equal(listing.status, 200); assert.equal(listing.body.items[0].id, medicine.id);
  assert.equal(listing.body.items[0].unitPriceSdg, 2450); assert.equal(listing.body.items[0].status, 'ACTIVE');
  assert.deepEqual(await prisma.inventoryBatch.findMany({ where: { drugId: medicine.id } }), batches);
  assert.deepEqual(await prisma.stockMovement.findMany({ where: { drugId: medicine.id } }), movements);
  assert.deepEqual(await prisma.prescription.findUnique({ where: { id: historical.id }, include: { prescribedDrugs: true } }), historical);
  assert.deepEqual(await prisma.invoice.findUnique({ where: { id: invoice.id }, include: { items: true } }), invoice);
  assert.equal(await prisma.tenantAuditLog.count({ where: { action: 'MEDICINE_SELLING_PRICE_UPDATED', details: { contains: medicine.id } } }), 1);
});

test('price-only updates preserve status and status changes preserve the submitted official price', async () => {
  const medicine = await createMedicine();
  for (const payload of [{ priceSdg: 1000 }, { priceSdg: 1000, status: 'ACTIVE' }, { priceSdg: 1200 }, { priceSdg: 1200, status: 'INACTIVE' }]) {
    const response = await api.patch(`/api/admin/pricing/medicines/${medicine.id}`).set(auth(admin)).send(payload);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const stored = await prisma.drugFormulary.findUniqueOrThrow({ where: { id: medicine.id } });
    assert.equal(stored.unitPriceSdg.toNumber(), payload.priceSdg);
    if (payload.status) assert.equal(stored.status, payload.status);
  }
});

test('invalid or empty prices cannot activate a medicine or modify its timestamp', async () => {
  const medicine = await createMedicine();
  const before = await prisma.drugFormulary.findUniqueOrThrow({ where: { id: medicine.id } });
  for (const priceSdg of [-1, 0, '', null, '2450', 'bad', 2.5, 1_000_000_001]) {
    const response = await api.patch(`/api/admin/pricing/medicines/${medicine.id}`).set(auth(admin)).send({ priceSdg, status: 'ACTIVE' });
    assert.equal(response.status, 422, JSON.stringify(response.body)); assert.equal(response.body.error.code, 'VALIDATION_ERROR');
  }
  const missing = await api.patch(`/api/admin/pricing/medicines/${medicine.id}`).set(auth(admin)).send({ status: 'ACTIVE' });
  assert.equal(missing.status, 422);
  assert.deepEqual(await prisma.drugFormulary.findUniqueOrThrow({ where: { id: medicine.id } }), before);
});

test('pharmacists cannot change the official price or activation state', async () => {
  const medicine = await createMedicine();
  const response = await api.patch(`/api/admin/pricing/medicines/${medicine.id}`).set(auth(pharmacist)).send({ priceSdg: 500, status: 'ACTIVE' });
  assert.equal(response.status, 403);
  const stored = await prisma.drugFormulary.findUniqueOrThrow({ where: { id: medicine.id } });
  assert.equal(stored.unitPriceSdg, null); assert.equal(stored.status, 'INACTIVE');
});

test('an audit failure rolls back the price, status and timestamp and returns an explicit failure', async () => {
  const medicine = await createMedicine();
  const before = await prisma.drugFormulary.findUniqueOrThrow({ where: { id: medicine.id } });
  const pg = new Client({ connectionString: process.env.DATABASE_URL });
  await pg.connect();
  const schema = (await pg.query('SELECT current_schema() AS schema')).rows[0].schema;
  assert.match(schema, /^test_[a-z0-9_]+$/);
  try {
    await pg.query(`CREATE FUNCTION "${schema}".test_fail_medicine_price_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'MEDICINE_SELLING_PRICE_UPDATED' THEN RAISE EXCEPTION 'forced pricing audit failure'; END IF; RETURN NEW; END; $$`);
    await pg.query(`CREATE TRIGGER test_fail_medicine_price_audit BEFORE INSERT ON "${schema}"."TenantAuditLog" FOR EACH ROW EXECUTE FUNCTION "${schema}".test_fail_medicine_price_audit()`);
    const response = await api.patch(`/api/admin/pricing/medicines/${medicine.id}`).set(auth(admin)).send({ priceSdg: 1000, status: 'ACTIVE' });
    assert.equal(response.status, 500); assert.equal(response.body.error.code, 'MEDICINE_PRICE_UPDATE_FAILED');
    assert.deepEqual(await prisma.drugFormulary.findUniqueOrThrow({ where: { id: medicine.id } }), before);
    assert.equal(await prisma.tenantAuditLog.count({ where: { action: 'MEDICINE_SELLING_PRICE_UPDATED', details: { contains: medicine.id } } }), 0);
  } finally {
    await pg.query(`DROP TRIGGER IF EXISTS test_fail_medicine_price_audit ON "${schema}"."TenantAuditLog"`);
    await pg.query(`DROP FUNCTION IF EXISTS "${schema}".test_fail_medicine_price_audit()`);
    await pg.end();
  }
});
