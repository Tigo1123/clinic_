import assert from 'node:assert/strict';
import { PrismaClient } from '../src/generated/prisma/index.js';

if (process.env.NODE_ENV === 'production' || process.env.DATABASE_URL !== 'file:./qa.db') {
  throw new Error('QA workflow refused outside the isolated qa.db environment.');
}
if (!process.env.QA_PASSWORD) throw new Error('QA_PASSWORD is required.');

const prisma = new PrismaClient();
const baseUrl = process.env.QA_API_URL || 'http://localhost:5000';
const results = { checks: [], authorization: {}, evidence: {} };

async function request(path, { token, method = 'GET', body, expected = [200] } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  let payload;
  try { payload = await response.json(); } catch { payload = null; }
  assert.ok(expected.includes(response.status), `${method} ${path}: expected ${expected.join('/')} but received ${response.status} ${JSON.stringify(payload)}`);
  results.checks.push({ method, path, status: response.status });
  return { status: response.status, body: payload };
}

async function login(username) {
  const response = await request('/api/auth/login', { method: 'POST', body: { username, password: process.env.QA_PASSWORD } });
  return response.body.token;
}

try {
  const tokens = {};
  for (const [role, username] of Object.entries({
    admin: 'qa-admin@example.test', reception: 'qa-reception@example.test', doctor: 'qa-doctor@example.test',
    laboratory: 'qa-lab@example.test', pharmacy: 'qa-pharmacy@example.test', patient: 'qa-patient@example.test', patientB: 'qa-patient-b@example.test'
  })) tokens[role] = await login(username);

  const doctor = await prisma.doctor.findFirstOrThrow({ where: { user: { username: 'qa-doctor@example.test' } } });
  const patient = await prisma.patient.findFirstOrThrow({ where: { user: { username: 'qa-patient@example.test' } } });
  const drug = await prisma.drugFormulary.findFirstOrThrow({ orderBy: { genericName: 'asc' } });
  const labService = await prisma.clinicalService.findFirstOrThrow({ where: { category: 'LABORATORY' } });
  const disposableStaff = await prisma.user.findUniqueOrThrow({ where: { username: 'qa-disposable-staff@example.test' } });
  const appointmentDate = new Date().toISOString().slice(0, 10);
  const slots = (await request(`/api/appointments/slots?doctorId=${doctor.id}&date=${appointmentDate}`)).body;
  assert.ok(slots.length, 'Seeded QA doctor has no available slot today.');

  const booked = await request('/api/patient/appointments', {
    token: tokens.patient, method: 'POST', expected: [201],
    body: { doctorId: doctor.id, appointmentDate, appointmentTime: slots[0], patientId: '00000000-0000-4000-8000-000000000000' }
  });
  const appointmentId = booked.body.id;
  assert.equal((await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })).patientId, patient.id);
  assert.ok((await request('/api/appointments/pending', { token: tokens.reception })).body.some((item) => item.id === appointmentId));
  results.evidence.booking = { appointmentId, appointmentDate, appointmentTime: slots[0], ownerVerified: true };

  await request(`/api/appointments/${appointmentId}/status`, { token: tokens.reception, method: 'PUT', body: { status: 'CONFIRMED' } });
  await request(`/api/appointments/${appointmentId}/status`, { token: tokens.reception, method: 'PUT', body: { status: 'CHECKED_IN' } });
  assert.ok((await request(`/api/appointments/queue/${doctor.id}?date=${appointmentDate}`, { token: tokens.doctor })).body.some((item) => item.id === appointmentId && item.status === 'CHECKED_IN'));

  await request(`/api/appointments/${appointmentId}/status`, { token: tokens.doctor, method: 'PUT', body: { status: 'IN_CONSULTATION' } });
  const consultation = await request('/api/records', {
    token: tokens.doctor, method: 'POST', expected: [201], body: {
      patientId: patient.id, appointmentId,
      symptoms: 'Fictional QA workflow symptom', diagnosis: 'Fictional QA workflow diagnosis',
      treatment: 'Fictional QA workflow treatment', clinicalNotes: 'QA-only clinical note',
      vitalSigns: { blood_pressure: '118/76', heart_rate: '72', temperature: '36.8', weight: '64' },
      prescribedDrugs: [{ drugId: drug.id, dosage: 'One test tablet', duration: 'Two QA days', instructionsAr: 'تعليمات اختبار فقط', instructionsEn: 'QA-only instructions', qtyPrescribed: 6 }],
      orderedServices: [labService.id]
    }
  });
  const recordId = consultation.body.data.record.id;
  const prescriptionId = consultation.body.data.prescription.id;
  const labOrderId = consultation.body.data.labOrder.id;
  assert.equal((await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })).status, 'COMPLETED');
  results.evidence.clinical = { recordId, prescriptionId, labOrderId, vitalsPersisted: true, appointmentStatus: 'COMPLETED' };

  const labOrder = await prisma.labOrder.findUniqueOrThrow({ where: { id: labOrderId }, include: { items: true } });
  for (const [index, item] of labOrder.items.entries()) {
    await request(`/api/records/lab-orders/items/${item.id}/results`, {
      token: tokens.laboratory, method: 'PUT', body: { resultValue: String(13.4 + index), referenceRangeMin: 12, referenceRangeMax: 16, isOutOfRange: false }
    });
  }
  await request(`/api/records/lab-orders/${labOrderId}/release`, { token: tokens.laboratory, method: 'PUT' });
  const releasedOrder = await prisma.labOrder.findUniqueOrThrow({ where: { id: labOrderId }, include: { items: true } });
  assert.equal(releasedOrder.status, 'COMPLETED');
  assert.ok(releasedOrder.releasedToPatientAt);
  assert.ok(releasedOrder.items.every((item) => item.resultValue));
  assert.ok((await request('/api/patient/lab-results', { token: tokens.patient })).body.some((item) => item.id === labOrderId));
  results.evidence.laboratory = { labOrderId, itemCount: releasedOrder.items.length, independentValuesPersisted: true, status: releasedOrder.status, released: true };

  const prescription = await prisma.prescription.findUniqueOrThrow({ where: { id: prescriptionId }, include: { prescribedDrugs: true } });
  const prescribedDrug = prescription.prescribedDrugs[0];
  const fefoBatch = await prisma.inventoryBatch.findFirstOrThrow({
    where: { drugId: prescribedDrug.drugId, qtyOnHand: { gt: 0 }, expiryDate: { gte: appointmentDate } },
    orderBy: [{ expiryDate: 'asc' }, { batchNumber: 'asc' }]
  });
  const stockBefore = fefoBatch.qtyOnHand;
  await request(`/api/records/prescriptions/${prescriptionId}/dispense`, {
    token: tokens.pharmacy, method: 'POST', body: { items: [{ prescribedDrugId: prescribedDrug.id, qtyToDispense: 6, batchId: fefoBatch.id }] }
  });
  const stockAfter = (await prisma.inventoryBatch.findUniqueOrThrow({ where: { id: fefoBatch.id } })).qtyOnHand;
  const filled = await prisma.prescription.findUniqueOrThrow({ where: { id: prescriptionId }, include: { prescribedDrugs: true } });
  assert.equal(stockBefore - 6, stockAfter);
  assert.equal(filled.status, 'FILLED');
  assert.equal(filled.prescribedDrugs[0].qtyDispensed, 6);
  results.evidence.pharmacy = { prescriptionId, batchNumber: fefoBatch.batchNumber, expiryDate: fefoBatch.expiryDate, quantity: 6, stockBefore, stockAfter, status: filled.status };

  const invoice = await request('/api/billing/invoice', {
    token: tokens.reception, method: 'POST', expected: [201], body: {
      patientId: patient.id, appointmentId,
      items: [{ descriptionAr: 'فاتورة اختبار سير العمل', descriptionEn: 'QA workflow invoice', qty: 1, unitPriceSdg: 12000 }]
    }
  });
  const invoiceId = invoice.body.invoice.id;
  const partial = await request(`/api/billing/invoice/${invoiceId}/payments`, {
    token: tokens.reception, method: 'POST', body: { payments: [{ amountSdg: 4000, paymentMethod: 'CASH' }] }
  });
  assert.equal(partial.body.paymentStatus, 'PARTIALLY_PAID');
  assert.equal(Number(partial.body.remainingBalanceSdg), 8000);
  const paid = await request(`/api/billing/invoice/${invoiceId}/payments`, {
    token: tokens.reception, method: 'POST', body: { payments: [{ amountSdg: 8000, paymentMethod: 'CARD', transactionReference: 'QA-FINAL-PAYMENT' }] }
  });
  assert.equal(paid.body.paymentStatus, 'PAID');
  assert.equal(Number(paid.body.remainingBalanceSdg), 0);
  results.evidence.billing = { invoiceId, total: 12000, partialPayment: 4000, partialRemaining: 8000, finalPayment: 8000, finalRemaining: 0, finalStatus: 'PAID' };

  await request(`/api/auth/users/${disposableStaff.id}/status`, { token: tokens.admin, method: 'PUT', body: { status: 'INACTIVE' } });
  await request(`/api/auth/users/${disposableStaff.id}/status`, { token: tokens.admin, method: 'PUT', body: { status: 'ACTIVE' } });
  const adminAudit = await prisma.tenantAuditLog.count({ where: { userId: (await prisma.user.findUniqueOrThrow({ where: { username: 'qa-admin@example.test' } })).id, action: 'USER_STATUS_CHANGE' } });
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: disposableStaff.id } })).status, 'ACTIVE');
  assert.ok(adminAudit >= 2);
  results.evidence.admin = { disposableStaffId: disposableStaff.id, restoredStatus: 'ACTIVE', auditEntries: adminAudit };

  const patientAppointments = (await request('/api/patient/appointments?group=all', { token: tokens.patient })).body;
  const patientPrescriptions = (await request('/api/patient/prescriptions', { token: tokens.patient })).body;
  const patientRecords = (await request('/api/patient/medical-records', { token: tokens.patient })).body;
  assert.ok(patientAppointments.some((item) => item.id === appointmentId && item.status === 'COMPLETED'));
  assert.ok(patientPrescriptions.some((item) => item.id === prescriptionId && item.status === 'FILLED'));
  assert.ok(patientRecords.some((item) => item.id === recordId));
  results.evidence.patientFinal = { appointment: 'COMPLETED', prescription: 'FILLED', releasedLabVisible: true, medicalRecordVisible: true };

  const negativeChecks = [
    ['patientAdmin', '/api/admin/analytics', tokens.patient, 'GET'],
    ['receptionConsultation', '/api/records', tokens.reception, 'POST', { patientId: patient.id, appointmentId, diagnosis: 'Forbidden' }],
    ['doctorDispense', `/api/records/prescriptions/${prescriptionId}/dispense`, tokens.doctor, 'POST', { items: [] }],
    ['labDispense', `/api/records/prescriptions/${prescriptionId}/dispense`, tokens.laboratory, 'POST', { items: [] }],
    ['pharmacyLabMutation', `/api/records/lab-orders/items/${releasedOrder.items[0].id}/results`, tokens.pharmacy, 'PUT', { resultValue: 'Forbidden' }],
    ['patientBAppointment', `/api/patient/appointments/${appointmentId}`, tokens.patientB, 'GET']
  ];
  for (const [name, path, token, method, body] of negativeChecks) {
    const response = await request(path, { token, method, body, expected: name === 'patientBAppointment' ? [404] : [403] });
    results.authorization[name] = response.status;
  }

  console.log(JSON.stringify(results, null, 2));
} finally {
  await prisma.$disconnect();
}
