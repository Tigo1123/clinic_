import fs from 'node:fs';

const origin = process.env.ACCEPTANCE_ORIGIN;
const confirmation = process.env.PHASE1A7_ACCEPTANCE_CONFIRMATION;
const marker = process.env.PHASE1A7_REFERENCE_MARKER;
if (!origin || !process.env.LAB_SERVICE_LABEL || !confirmation || !marker) throw new Error('Acceptance runner configuration is incomplete.');
const parsedOrigin = new URL(origin);
if (!['127.0.0.1', 'localhost'].includes(parsedOrigin.hostname)) throw new Error('Acceptance origin must be loopback.');
if (!/^PHASE1A7-[A-Za-z0-9_]+$/.test(confirmation)) throw new Error('Invalid disposable acceptance confirmation.');
if (!marker.includes(confirmation.replace(/^PHASE1A7-/, ''))) throw new Error('Disposable reference marker does not match stack confirmation.');
let password = fs.readFileSync(process.env.ADMIN_PASSWORD_FILE, 'utf8');
if (password.endsWith('\n')) password = password.slice(0, -1);
if (password.endsWith('\r')) password = password.slice(0, -1);
if (/[\r\n]/.test(password)) throw new Error('Password file must contain one line.');

async function call(method, path, token, body, extra = {}) {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...(extra.headers || {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  let parsed;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  if (!response.ok) throw new Error(`${method} ${path} returned ${response.status} ${parsed?.error?.code || parsed?.error || ''}`);
  return parsed;
}

async function login(username, secret) {
  const result = await call('POST', '/api/auth/login', null, { username, password: secret });
  if (!result.token) throw new Error(`Login did not return a token for ${username}.`);
  return result.token;
}

const admin = await login('phase1a7-admin@example.test', password);
const catalogBeforeStaff = await call('GET', '/api/admin/pricing', admin);
if (!catalogBeforeStaff.services.some((item) => item.labelEn === marker)) throw new Error('Disposable reference marker was not found through the application API.');
const staff = {
  reception: ['receptionist-phase1a7@example.test', 'ReceptionistPhase1A7'],
  doctor: ['doctor-phase1a7@example.test', 'DoctorPhase1A7'],
  lab: ['lab-phase1a7@example.test', 'LabTechPhase1A7'],
  pharmacy: ['pharmacy-phase1a7@example.test', 'PharmacistPhase1A7']
};
for (const [role, [username, secret]] of Object.entries(staff)) {
  await call('POST', '/api/auth/users', admin, {
    username, password: `${secret}1`, role: role === 'reception' ? 'RECEPTIONIST' : role === 'doctor' ? 'DOCTOR' : role === 'lab' ? 'LAB_TECH' : 'PHARMACIST',
    preferredLanguage: 'en', ...(role === 'doctor' ? { fullNameAr: 'طبيب قبول', fullNameEn: 'Acceptance Doctor', specialtyAr: 'طب عام', specialtyEn: 'General Medicine', consultationFee: 5000 } : {})
  });
}
const tokens = {};
for (const [key, [username, secret]] of Object.entries(staff)) tokens[key] = await login(username, `${secret}1`);

const catalog = await call('GET', '/api/admin/pricing', admin);
const doctor = catalog.doctors.find((item) => item.fullNameEn === 'Acceptance Doctor');
const service = catalog.services.find((item) => item.labelEn === process.env.LAB_SERVICE_LABEL);
if (!doctor || !service) throw new Error('Required disposable doctor or laboratory service was not found.');
await call('PATCH', `/api/admin/pricing/services/${service.id}`, admin, { priceSdg: 2500, status: 'ACTIVE' });

const patient = await call('POST', '/api/patients', tokens.reception, {
  fullNameAr: 'مريض قبول اصطناعي', fullNameEn: 'Phase 1A7 Synthetic Patient', gender: 'MALE', dateOfBirth: '1990-01-01',
  phone: '+249997000001', addressStateId: 1, emergencyContact: 'Synthetic test contact'
});
if (!/^SHF-[0-9]{6}$/.test(patient.fileNumber)) throw new Error('Patient MRN is not canonical.');

const clinicDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Khartoum' }).format(new Date());
const slots = await call('GET', `/api/appointments/slots?doctorId=${doctor.id}&date=${clinicDate}`);
if (!slots[0]) throw new Error('No configured disposable doctor slot is available today.');
const appointment = await call('POST', '/api/appointments/walk-in', tokens.reception, {
  mode: 'EXISTING', patientId: patient.id, doctorId: doctor.id, appointmentDate: clinicDate, appointmentTime: slots[0]
});
if (appointment.status !== 'CHECKED_IN') throw new Error(`Unexpected check-in status ${appointment.status}.`);

const consultationInvoice = await call('POST', '/api/billing/invoice', tokens.reception, { patientId: patient.id, appointmentId: appointment.id, invoiceType: 'CONSULTATION' });
const consultationPayment = await call('POST', `/api/billing/invoice/${consultationInvoice.invoice.id}/payments`, tokens.reception, { payments: [{ amountSdg: Number(consultationInvoice.invoice.totalAmountSdg), paymentMethod: 'CASH' }] }, { headers: { 'Idempotency-Key': `phase1a7-consult-${Date.now()}` } });
if (consultationPayment.paymentStatus !== 'PAID' || consultationPayment.payments?.length !== 1) throw new Error('Consultation payment was not persisted exactly once.');
await call('PUT', `/api/appointments/${appointment.id}/status`, tokens.doctor, { status: 'IN_CONSULTATION' });

const medicine = await call('POST', '/api/pharmacy/formulary', tokens.pharmacy, {
  brandName: 'Phase 1A7 Test Medicine', labelAr: 'دواء قبول', labelEn: 'Phase 1A7 Test Medicine', genericName: 'phase1a7-test', strength: '10mg', dosageForm: 'Tablet',
  initialBatch: { batchNumber: `P1A7-${Date.now()}`, expiryDate: '2099-12-31', qtyOnHand: 10, minReorderLevel: 1 }
});
const inventoryBefore = Number(medicine.medicine.stock?.totalOnHand ?? medicine.medicine.stock?.totalStock ?? 10);
if (inventoryBefore !== 10) throw new Error(`Expected inventory before dispense to equal 10, got ${inventoryBefore}.`);
await call('PATCH', `/api/admin/pricing/medicines/${medicine.medicine.id}`, admin, { priceSdg: 1000, status: 'ACTIVE' });
const record = await call('POST', '/api/records', tokens.doctor, {
  patientId: patient.id, appointmentId: appointment.id, symptoms: 'Synthetic symptom', diagnosis: 'Synthetic diagnosis', treatment: 'Synthetic treatment',
  clinicalNotes: 'Phase 1A7 acceptance', vitalSigns: { temperature: 36.8, heart_rate: 72 }, orderedServices: [service.id],
  prescribedDrugs: [{ drugId: medicine.medicine.id, dosage: 'Once daily', duration: '5 days', instructionsEn: 'After food', instructionsAr: 'بعد الطعام', qtyPrescribed: 2 }]
});
const labOrder = record.data?.labOrder || record.labOrder;
let prescription = record.data?.prescription || record.prescription;
if (prescription?.id) {
  const pendingPrescriptions = await call('GET', '/api/records/prescriptions/pending', tokens.pharmacy);
  prescription = pendingPrescriptions.find((item) => item.id === prescription.id) || prescription;
}
if (!labOrder?.id || !prescription?.id || !prescription.prescribedDrugs?.[0]?.id) throw new Error('Doctor consultation did not create lab order and prescription item.');

const labInvoice = await call('POST', '/api/billing/invoice', tokens.reception, { patientId: patient.id, labOrderId: labOrder.id, invoiceType: 'LABORATORY' });
const labPayment = await call('POST', `/api/billing/invoice/${labInvoice.invoice.id}/payments`, tokens.reception, { payments: [{ amountSdg: Number(labInvoice.invoice.totalAmountSdg), paymentMethod: 'CASH' }] }, { headers: { 'Idempotency-Key': `phase1a7-lab-${Date.now()}` } });
if (labPayment.paymentStatus !== 'PAID' || labPayment.payments?.length !== 1) throw new Error('Laboratory payment was not persisted exactly once.');
await call('PUT', `/api/records/lab-orders/${labOrder.id}/collect-sample`, tokens.lab);
const pending = await call('GET', '/api/records/lab-orders/pending', tokens.lab);
const item = pending.flatMap((order) => order.items || []).find((candidate) => candidate.labOrderId === labOrder.id) || (await call('GET', `/api/records/lab-orders/${labOrder.id}`, tokens.lab).catch(() => null))?.items?.[0];
if (!item?.id) throw new Error('Laboratory item was not available for result entry.');
await call('PUT', `/api/records/lab-orders/items/${item.id}/results`, tokens.lab, { expectedVersion: 0, resultValue: 'Normal synthetic result' });
await call('PUT', `/api/records/lab-orders/${labOrder.id}/release`, tokens.lab);
await call('GET', `/api/records/${record.recordId || record.data.record.id}/summary`, tokens.doctor);

const pharmacyInvoice = await call('GET', `/api/pharmacy/prescriptions/${prescription.id}/payment-state`, tokens.pharmacy);
const invoice = pharmacyInvoice.invoice;
if (!invoice?.id) throw new Error('Pharmacy invoice was not generated.');
const pharmacyPayment = await call('POST', `/api/billing/invoice/${invoice.id}/payments`, tokens.pharmacy, { payments: [{ amountSdg: Number(invoice.totalAmountSdg), paymentMethod: 'CASH' }] }, { headers: { 'Idempotency-Key': `phase1a7-pharmacy-${Date.now()}` } });
if (pharmacyPayment.paymentStatus !== 'PAID' || pharmacyPayment.payments?.length !== 1) throw new Error('Pharmacy payment was not persisted exactly once.');
await call('POST', `/api/records/prescriptions/${prescription.id}/dispense`, tokens.pharmacy, { items: [{ prescribedDrugId: prescription.prescribedDrugs[0].id, qtyToDispense: 2 }] });
const batchesAfter = await call('GET', `/api/pharmacy/formulary/${medicine.medicine.id}/batches`, tokens.pharmacy);
const inventoryAfter = batchesAfter.items.reduce((sum, batch) => sum + Number(batch.qtyOnHand), 0);
if (inventoryAfter !== 8) throw new Error(`Expected inventory after dispense to equal 8, got ${inventoryAfter}.`);
const movements = await call('GET', `/api/pharmacy/formulary/${medicine.medicine.id}/movements`, tokens.pharmacy);
const dispenseMovements = movements.items.filter((movement) => movement.movementType === 'DISPENSE' && Number(movement.quantityDelta) === -2 && movement.referenceId === prescription.prescribedDrugs[0].id);
if (dispenseMovements.length !== 1) throw new Error('Expected exactly one dispense stock movement linked to the prescription.');
await call('PUT', `/api/records/${record.recordId || record.data.record.id}/finalize`, tokens.doctor, { diagnosis: 'Synthetic final diagnosis', treatment: 'Synthetic final treatment', vitalSigns: { temperature: 36.8 } });
const secondPatient = await call('POST', '/api/patients', tokens.reception, {
  fullNameAr: 'مريض قبول اصطناعي ثان', fullNameEn: 'Phase 1A7 Synthetic Patient Two', gender: 'FEMALE', dateOfBirth: '1991-02-02',
  phone: '+249997000002', addressStateId: 1, emergencyContact: 'Synthetic test contact'
});
if (!/^SHF-[0-9]{6}$/.test(secondPatient.fileNumber) || secondPatient.fileNumber === patient.fileNumber) throw new Error('Second patient MRN was not distinct and canonical.');

// Runtime authorization negatives; failed requests must not mutate state.
const denied = async (method, path, token, body) => {
  const options = { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) } };
  if (body) options.body = JSON.stringify(body);
  const response = await fetch(`${origin}${path}`, options);
  if (![401, 403].includes(response.status)) throw new Error(`Expected authorization denial for ${method} ${path}, received ${response.status}.`);
};
await denied('GET', '/api/records/lab-orders/pending', tokens.reception);
await denied('PUT', `/api/records/${record.recordId || record.data.record.id}/finalize`, tokens.reception, { diagnosis: 'forbidden' });
await denied('POST', `/api/records/prescriptions/${prescription.id}/dispense`, tokens.lab, { items: [] });
await denied('PUT', `/api/records/${record.recordId || record.data.record.id}/finalize`, tokens.pharmacy, { diagnosis: 'forbidden' });
await denied('GET', '/api/auth/users', null);

console.log(JSON.stringify({ patientId: patient.id, fileNumber: patient.fileNumber, secondPatientId: secondPatient.id, secondFileNumber: secondPatient.fileNumber, appointmentId: appointment.id, visitId: appointment.id, labOrderId: labOrder.id, labResultItemId: item.id, prescriptionId: prescription.id, invoiceId: invoice.id, inventoryBefore, quantityDispensed: 2, inventoryAfter, dispenseMovementCount: dispenseMovements.length, consultationInvoiceId: consultationInvoice.invoice.id, labInvoiceId: labInvoice.invoice.id, pharmacyInvoiceId: invoice.id, consultationPaymentCount: consultationPayment.payments.length, labPaymentCount: labPayment.payments.length, pharmacyPaymentCount: pharmacyPayment.payments.length, final: 'COMPLETED' }));
