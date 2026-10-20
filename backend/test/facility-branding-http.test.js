import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

process.env.FACILITY_NAME_AR = 'مركز & <رعاية>';
process.env.FACILITY_NAME_EN = 'Care & <Partners>';
const { app, shutdown } = await import('../src/server.js');

test('public configuration exposes only validated Shifa and facility identity fields', async () => {
  const response = await request(app).get('/api/public-config');
  assert.equal(response.status, 200);
  assert.equal(response.body.productNameAr, 'شفاء');
  assert.equal(response.body.productNameEn, 'Shifa');
  assert.equal(response.body.productDescriptorAr, 'نظام إدارة المنشآت الصحية');
  assert.equal(response.body.productDescriptorEn, 'Healthcare Facility Management System');
  assert.equal(response.body.facilityNameAr, 'مركز & <رعاية>');
  assert.equal(response.body.facilityNameEn, 'Care & <Partners>');
  assert.equal(response.body.displayNameAr, 'مركز & <رعاية>');
  assert.equal(response.body.displayNameEn, 'Care & <Partners>');
  assert.equal(Object.hasOwn(response.body, 'DATABASE_URL'), false);
});

after(async () => { await shutdown('test'); });
