import 'reflect-metadata';
import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import request from 'supertest';
import prisma from '../src/db.js';
import { app as expressApp } from '../src/server.js';
import { signAccessToken } from '../src/services/accessTokens.js';
import { backendDir } from './helpers/testRunner.js';

const distRoot = process.env.NEST_DIST_DIR
  ? path.resolve(process.env.NEST_DIST_DIR)
  : path.join(backendDir, 'dist');
const nestBuilt = fs.existsSync(path.join(distRoot, 'app.module.js'));

async function listenLocal(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

function closeServer(server) {
  return new Promise((resolve) => (server.listening ? server.close(resolve) : resolve()));
}

async function createFixtures(suffix) {
  const admin = await prisma.user.create({
    data: { username: `ins-admin-${suffix}`, passwordHash: 'unused', role: 'ADMIN', status: 'ACTIVE' }
  });
  const receptionist = await prisma.user.create({
    data: { username: `ins-recep-${suffix}`, passwordHash: 'unused', role: 'RECEPTIONIST', status: 'ACTIVE' }
  });
  const doctorUser = await prisma.user.create({
    data: { username: `ins-doc-${suffix}`, passwordHash: 'unused', role: 'DOCTOR', status: 'ACTIVE' }
  });
  const pharmacist = await prisma.user.create({
    data: { username: `ins-pharma-${suffix}`, passwordHash: 'unused', role: 'PHARMACIST', status: 'ACTIVE' }
  });
  const labTech = await prisma.user.create({
    data: { username: `ins-lab-${suffix}`, passwordHash: 'unused', role: 'LAB_TECH', status: 'ACTIVE' }
  });
  const patientUser = await prisma.user.create({
    data: { username: `ins-pat-${suffix}`, passwordHash: 'unused', role: 'PATIENT', status: 'ACTIVE' }
  });

  const doctor = await prisma.doctor.create({
    data: {
      userId: doctorUser.id,
      fullNameAr: `د. اختبار ${suffix}`,
      fullNameEn: `Dr. Insurance Test ${suffix}`,
      specialtyAr: 'طب عام',
      specialtyEn: 'General Medicine',
      consultationFee: 20000,
      weeklySchedule: '[]',
      status: 'ACTIVE'
    }
  });

  const state = await prisma.state.findFirst()
    || await prisma.state.create({ data: { id: 991, labelAr: 'الخرطوم', labelEn: 'Khartoum' } });

  const patient = await prisma.patient.create({
    data: {
      userId: patientUser.id,
      fullNameAr: `مريض تأمين ${suffix}`,
      fullNameEn: `Insurance Patient ${suffix}`,
      gender: 'MALE',
      dateOfBirth: '1990-01-01',
      phone: `+24990000${String(Math.floor(1000 + Math.random() * 8999))}`,
      addressStateId: state.id,
      emergencyContact: 'Self',
      status: 'ACTIVE'
    }
  });

  const service = await prisma.clinicalService.create({
    data: {
      code: `ins-svc-${suffix}`.toLowerCase(),
      labelAr: `خدمة اختبار ${suffix}`,
      labelEn: `Insurance Test Service ${suffix}`,
      category: 'CLINICAL_PROCEDURE',
      baseFeeSdg: 10000,
      baseFeeUsd: 6.67,
      status: 'ACTIVE'
    }
  });

  await prisma.paymentMethod.upsert({
    where: { code: 'CASH' },
    update: { active: true },
    create: { code: 'CASH', labelAr: 'نقدي', labelEn: 'Cash', active: true }
  });

  return {
    patient,
    doctor,
    service,
    tokens: {
      admin: signAccessToken(admin),
      receptionist: signAccessToken(receptionist),
      doctor: signAccessToken({ ...doctorUser, doctorId: doctor.id }),
      pharmacist: signAccessToken(pharmacist),
      labTech: signAccessToken(labTech),
      patient: signAccessToken(patientUser)
    }
  };
}

function registerServerSuite(label, getBaseUrl) {
  let fixtures;

  before(async () => {
    fixtures = await createFixtures(`${label.toLowerCase()}-${Date.now()}`);
  });

  test(`${label}: access control restricts insurance configuration to ADMIN and billing list to ADMIN/RECEPTIONIST`, async () => {
    const baseUrl = getBaseUrl();
    const unauth = await request(baseUrl).get('/api/admin/catalog/insurance-companies');
    assert.equal(unauth.status, 401);

    const payload = {
      labelAr: `شركة صلاحيات ${label}`,
      labelEn: `Auth Provider ${label}`,
      copayPercentage: 15,
      billingCycleDays: 30
    };

    for (const role of ['receptionist', 'doctor', 'pharmacist', 'labTech', 'patient']) {
      const getRes = await request(baseUrl)
        .get('/api/admin/catalog/insurance-companies')
        .set('Authorization', `Bearer ${fixtures.tokens[role]}`);
      assert.equal(getRes.status, 403, `${role} GET admin insurance must be 403`);

      const postRes = await request(baseUrl)
        .post('/api/admin/catalog/insurance-companies')
        .set('Authorization', `Bearer ${fixtures.tokens[role]}`)
        .send(payload);
      assert.equal(postRes.status, 403, `${role} POST admin insurance must be 403`);
    }

    const docBilling = await request(baseUrl)
      .get('/api/billing/insurance-companies')
      .set('Authorization', `Bearer ${fixtures.tokens.doctor}`);
    assert.equal(docBilling.status, 403);

    const recepBilling = await request(baseUrl)
      .get('/api/billing/insurance-companies')
      .set('Authorization', `Bearer ${fixtures.tokens.receptionist}`);
    assert.equal(recepBilling.status, 200);
    assert.ok(Array.isArray(recepBilling.body));
  });

  test(`${label}: validation enforces bilingual labels, copay bounds (0-100, <=2 decimals), billing cycle (1-365), and uniqueness`, async () => {
    const baseUrl = getBaseUrl();
    const adminAuth = `Bearer ${fixtures.tokens.admin}`;

    const invalidPayloads = [
      {},
      { labelAr: 'شركة', labelEn: 'Provider', copayPercentage: -1, billingCycleDays: 30 },
      { labelAr: 'شركة', labelEn: 'Provider', copayPercentage: 100.01, billingCycleDays: 30 },
      { labelAr: 'شركة', labelEn: 'Provider', copayPercentage: '12.345', billingCycleDays: 30 },
      { labelAr: 'شركة', labelEn: 'Provider', copayPercentage: 'abc', billingCycleDays: 30 },
      { labelAr: 'شركة', labelEn: 'Provider', copayPercentage: 10, billingCycleDays: 0 },
      { labelAr: 'شركة', labelEn: 'Provider', copayPercentage: 10, billingCycleDays: 366 },
      { labelAr: 'شركة', labelEn: 'Provider', copayPercentage: 10, billingCycleDays: 30.5 },
      { labelAr: ' ', labelEn: 'Provider', copayPercentage: 10, billingCycleDays: 30 },
      { labelAr: 'شركة', labelEn: 'Provider', copayPercentage: 10, billingCycleDays: 30, extraField: 'nope' }
    ];

    for (const body of invalidPayloads) {
      const res = await request(baseUrl)
        .post('/api/admin/catalog/insurance-companies')
        .set('Authorization', adminAuth)
        .send(body);
      assert.equal(res.status, 422, `Expected 422 for payload ${JSON.stringify(body)}, got ${res.status}`);
      assert.equal(res.body?.error?.code, 'VALIDATION_ERROR');
    }

    const validZero = await request(baseUrl)
      .post('/api/admin/catalog/insurance-companies')
      .set('Authorization', adminAuth)
      .send({
        labelAr: `شركة صفر ${label}`,
        labelEn: `Zero Copay Provider ${label}`,
        copayPercentage: 0,
        billingCycleDays: 1
      });
    assert.equal(validZero.status, 201);
    assert.equal(validZero.body.copayPercentage, 0);
    assert.equal(validZero.body.billingCycleDays, 1);
    assert.equal(validZero.body.active, true);

    const dup = await request(baseUrl)
      .post('/api/admin/catalog/insurance-companies')
      .set('Authorization', adminAuth)
      .send({
        labelAr: `شركة مختلفة ${label}`,
        labelEn: `  zero   copay provider ${label.toLowerCase()}  `,
        copayPercentage: '12.5',
        billingCycleDays: 365
      });
    assert.equal(dup.status, 409);
    assert.equal(dup.body?.error?.code, 'INSURANCE_COMPANY_DUPLICATE');

    const emptyPatch = await request(baseUrl)
      .patch(`/api/admin/catalog/insurance-companies/${validZero.body.id}`)
      .set('Authorization', adminAuth)
      .send({});
    assert.equal(emptyPatch.status, 422);

    const missingPatch = await request(baseUrl)
      .patch('/api/admin/catalog/insurance-companies/00000000-0000-4000-8000-000000000000')
      .set('Authorization', adminAuth)
      .send({ copayPercentage: 20 });
    assert.equal(missingPatch.status, 404);
    assert.equal(missingPatch.body?.error?.code, 'INSURANCE_COMPANY_NOT_FOUND');
  });

  test(`${label}: admin configuration updates reception visibility while preserving historical invoices, payments, and patient history`, async () => {
    const baseUrl = getBaseUrl();
    const adminAuth = `Bearer ${fixtures.tokens.admin}`;
    const recepAuth = `Bearer ${fixtures.tokens.receptionist}`;

    // 1. Admin configures a new bilingual provider (10% copay, 30-day billing cycle)
    const created = await request(baseUrl)
      .post('/api/admin/catalog/insurance-companies')
      .set('Authorization', adminAuth)
      .send({
        labelAr: `تأمين الرعاية ${label}`,
        labelEn: `Care Shield ${label}`,
        copayPercentage: '10',
        billingCycleDays: 30,
        active: true
      });
    assert.equal(created.status, 201);
    const providerId = created.body.id;

    // 2. Reception sees it in /api/billing/insurance-companies with billingCycleDays
    const recepList1 = await request(baseUrl)
      .get('/api/billing/insurance-companies')
      .set('Authorization', recepAuth);
    assert.equal(recepList1.status, 200);
    const found1 = recepList1.body.find((c) => c.id === providerId);
    assert.ok(found1, 'Newly created active provider must appear in reception billing list');
    assert.equal(Number(found1.copayPercentage), 10);
    assert.equal(found1.billingCycleDays, 30);

    // 3. Admin creates a manual general invoice using this provider.
    const invoice1 = await request(baseUrl)
      .post('/api/billing/invoice')
      .set('Authorization', adminAuth)
      .send({
        patientId: fixtures.patient.id,
        insuranceCompanyId: providerId,
        invoiceType: 'GENERAL',
        items: [{ serviceId: fixtures.service.id, quantity: 1 }]
      });
    assert.equal(invoice1.status, 201);
    assert.equal(invoice1.body.grossTotalSdg, 10000);
    assert.equal(invoice1.body.insuranceCoverageSdg, 9000);
    assert.equal(invoice1.body.patientShareSdg, 1000);

    // 4. Admin updates copay to 50%, billing cycle to 60 days, renames, and deactivates provider
    const updated = await request(baseUrl)
      .patch(`/api/admin/catalog/insurance-companies/${providerId}`)
      .set('Authorization', adminAuth)
      .send({
        labelAr: `تأمين الرعاية المحدث ${label}`,
        labelEn: `Care Shield Updated ${label}`,
        copayPercentage: 50,
        billingCycleDays: 60,
        active: false
      });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.active, false);
    assert.equal(updated.body.copayPercentage, 50);
    assert.equal(updated.body.billingCycleDays, 60);

    // 5. Inactive provider is excluded from Reception billing list and rejected for NEW preview/invoices
    const recepList2 = await request(baseUrl)
      .get('/api/billing/insurance-companies')
      .set('Authorization', recepAuth);
    assert.equal(recepList2.status, 200);
    assert.equal(recepList2.body.some((c) => c.id === providerId), false);

    const previewInactive = await request(baseUrl)
      .post('/api/billing/insurance-preview')
      .set('Authorization', adminAuth)
      .send({
        patientId: fixtures.patient.id,
        insuranceCompanyId: providerId,
        invoiceType: 'GENERAL',
        items: [{ serviceId: fixtures.service.id, quantity: 1 }]
      });
    assert.equal(previewInactive.status, 422);
    assert.equal(previewInactive.body?.error?.code, 'INSURANCE_COMPANY_INVALID');

    const invoiceInactive = await request(baseUrl)
      .post('/api/billing/invoice')
      .set('Authorization', adminAuth)
      .send({
        patientId: fixtures.patient.id,
        insuranceCompanyId: providerId,
        invoiceType: 'GENERAL',
        items: [{ serviceId: fixtures.service.id, quantity: 1 }]
      });
    assert.equal(invoiceInactive.status, 422);
    assert.equal(invoiceInactive.body?.error?.code, 'INSURANCE_COMPANY_INVALID');

    // 6. Historical invoice #1 preserves original 1000 SDG patient share & 9000 SDG claim and can still be settled
    const payHistorical = await request(baseUrl)
      .post(`/api/billing/invoice/${invoice1.body.invoice.id}/payments`)
      .set('Authorization', recepAuth)
      .set('Idempotency-Key', `hist-pay-${label}-${Date.now()}`)
      .send({ payments: [{ amountSdg: 1000, paymentMethod: 'CASH' }] });
    assert.equal(payHistorical.status, 200);
    assert.equal(payHistorical.body.paymentStatus, 'PAID');
    assert.equal(payHistorical.body.patientShareSdg, 1000);
    assert.equal(payHistorical.body.insuranceCoverageSdg, 9000);

    const storedClaim1 = await prisma.insuranceClaim.findUnique({ where: { invoiceId: invoice1.body.invoice.id } });
    assert.equal(Number(storedClaim1.claimAmountSdg), 9000);

    // 7. Patient profile preserves historical insurance record even while provider is inactive
    const profileRes = await request(baseUrl)
      .get(`/api/patients/${fixtures.patient.id}/profile`)
      .set('Authorization', recepAuth);
    assert.equal(profileRes.status, 200);
    assert.equal(profileRes.body.insurance?.coverageRate, 90);
    assert.ok(profileRes.body.invoices.some((inv) => inv.id === invoice1.body.invoice.id));

    // 8. Admin reactivates provider; new invoices use the updated 50% copay while invoice #1 remains unchanged
    const reactivated = await request(baseUrl)
      .patch(`/api/admin/catalog/insurance-companies/${providerId}`)
      .set('Authorization', adminAuth)
      .send({ active: true });
    assert.equal(reactivated.status, 200);
    assert.equal(reactivated.body.active, true);
    assert.equal(reactivated.body.copayPercentage, 50);

    const invoice2 = await request(baseUrl)
      .post('/api/billing/invoice')
      .set('Authorization', adminAuth)
      .send({
        patientId: fixtures.patient.id,
        insuranceCompanyId: providerId,
        invoiceType: 'GENERAL',
        items: [{ serviceId: fixtures.service.id, quantity: 1 }]
      });
    assert.equal(invoice2.status, 201);
    assert.equal(invoice2.body.patientShareSdg, 5000);
    assert.equal(invoice2.body.insuranceCoverageSdg, 5000);

    // Audit log entries recorded
    const audits = await prisma.tenantAuditLog.findMany({
      where: { action: { in: ['INSURANCE_COMPANY_CREATED', 'INSURANCE_COMPANY_UPDATED'] } }
    });
    assert.ok(audits.some((a) => a.action === 'INSURANCE_COMPANY_CREATED' && a.details.includes(providerId)));
    assert.ok(audits.some((a) => a.action === 'INSURANCE_COMPANY_UPDATED' && a.details.includes(providerId)));
  });

  test(`${label}: patient profile retains full recorded coverage and reports unavailable legacy coverage`, async () => {
    const baseUrl = getBaseUrl();
    const isolated = await createFixtures(`snapshot-${label}-${Date.now()}`);
    const company = await prisma.insuranceCompany.create({ data: {
      labelAr: `تأمين كامل ${label}`, labelEn: `Full coverage ${label}`, copayPercentage: 0, active: true
    } });
    const issued = await request(baseUrl)
      .post('/api/billing/invoice')
      .set('Authorization', `Bearer ${isolated.tokens.admin}`)
      .send({
        patientId: isolated.patient.id,
        insuranceCompanyId: company.id,
        invoiceType: 'GENERAL',
        items: [{ serviceId: isolated.service.id, quantity: 1 }]
      });
    assert.equal(issued.status, 201);
    assert.equal(issued.body.patientShareSdg, 0);
    const readProfile = () => request(baseUrl)
      .get(`/api/patients/${isolated.patient.id}/profile`)
      .set('Authorization', `Bearer ${isolated.tokens.receptionist}`);
    const insured = await readProfile();
    assert.equal(insured.status, 200);
    assert.equal(insured.body.insurance?.coverageRate, 100);

    // A legacy claim can exist without a linked invoice.
    await prisma.invoice.update({
      where: { id: issued.body.invoice.id },
      data: { insuranceClaimId: null }
    });
    const legacy = await readProfile();
    assert.equal(legacy.status, 200);
    assert.equal(legacy.body.insurance?.providerName, company.labelAr);
    assert.equal(legacy.body.insurance?.coverageRate, null);
  });
}

describe('Express insurance configuration', () => {
  let expressServer;
  let expressBaseUrl;

  before(async () => {
    expressServer = http.createServer(expressApp);
    expressBaseUrl = await listenLocal(expressServer);
  });

  after(async () => {
    await closeServer(expressServer);
  });

  registerServerSuite('Express', () => expressBaseUrl);
});

if (!nestBuilt) {
  test.skip('NestJS insurance configuration suite skipped: dist/app.module.js is missing (build with npm run build:nest first)', () => {});
} else {
  describe('NestJS insurance configuration', () => {
    let nestApp;
    let nestBaseUrl;

    before(async () => {
      const { createApp } = await import(pathToFileURL(path.join(distRoot, 'main.js')).href);
      nestApp = await createApp({ logger: false });
      await nestApp.init();
      nestBaseUrl = await listenLocal(nestApp.getHttpServer());
    });

    after(async () => {
      await nestApp?.close();
    });

    registerServerSuite('NestJS', () => nestBaseUrl);
  });
}

after(async () => {
  await prisma.$disconnect();
});
