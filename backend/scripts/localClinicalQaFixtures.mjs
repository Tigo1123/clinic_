import { createQaRunNamespace } from './qaRunNamespace.mjs';
import { registrationBody, syntheticPatient, assertSyntheticPatient, ID } from './qaPatientPlan.mjs';
import { verifyLocalQaGate } from './stagingQaGate.mjs';

export const LOCAL_API_ORIGIN = 'http://127.0.0.1:5200';
export const LOCAL_QA_TARGET = 'clinic-local-disposable';
export const LOCAL_CLINICAL_QA_DATABASE = 'clinic_local_clinical_qa';
const REASONS = new Set([
  'unsafe_local_configuration', 'database_identity_mismatch', 'staff_authentication_failed',
  'registration_conflict', 'local_patient_verification_unavailable', 'no_seeded_doctor',
  'no_available_slot', 'consultation_invoice_unavailable', 'local_payment_simulation_unavailable',
  'lab_fixture_unavailable', 'pharmacy_fixture_unavailable', 'workflow_api_failed'
]);

function fail(reason, status = null) { throw Object.assign(new Error('local_clinical_fixture_blocked'), { reason, status }); }
function valid(value, reason = 'workflow_api_failed') { if (!value) fail(reason); }
function syntheticNamespace(value) { return /^qa-\d{8}-[a-f0-9]{8}$/.test(value || ''); }

export function validateLocalClinicalEnvironment(env) {
  let database;
  try { database = new URL(env.DATABASE_URL); } catch { fail('unsafe_local_configuration'); }
  const nodeEnv = String(env.NODE_ENV || '').trim().toLowerCase();
  const appEnv = String(env.APP_ENV || '').trim().toLowerCase();
  const deploymentEnv = String(env.DEPLOYMENT_ENV || '').trim().toLowerCase();
  const databaseEnv = String(env.DATABASE_ENVIRONMENT || '').trim().toLowerCase();
  const origin = env.QA_API_ORIGIN;
  const disabledProviderKeys = [
    'SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'SENDGRID_API_KEY', 'MAILGUN_API_KEY',
    'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'PAYMENT_PROVIDER', 'PAYMENT_GATEWAY',
    'PAYMENT_GATEWAY_ENABLED', 'PAYMENT_GATEWAY_URL', 'PAYMENT_API_URL', 'PAYMENT_API_KEY',
    'PAYMENT_SECRET_KEY', 'PAYMENT_WEBHOOK_SECRET', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET',
    'PAYPAL_CLIENT_SECRET', 'PAYPAL_WEBHOOK_ID', 'FAWRY_API_KEY', 'BANKAK_API_KEY',
    'PAYSTACK_SECRET_KEY', 'FLUTTERWAVE_SECRET_KEY', 'PESAPAL_CONSUMER_KEY', 'DPO_COMPANY_TOKEN',
    'SQUARE_ACCESS_TOKEN', 'PAYMOB_API_KEY'
  ];
  const allowedProviders = disabledProviderKeys.every(key => !env[key]
    || (key.endsWith('_ENABLED') && String(env[key]).trim().toLowerCase() === 'false'));
  if (!['development', 'test'].includes(nodeEnv)
      || !['development', 'test', 'local'].includes(appEnv)
      || !['development', 'test', 'local'].includes(deploymentEnv)
      || !['local', 'test'].includes(databaseEnv)
      || env.QA_LOCAL_EXECUTION !== 'true'
      || env.QA_PREPARE_LOCAL_CLINICAL_FIXTURES !== 'true'
      || origin !== LOCAL_API_ORIGIN || env.QA_EXPECTED_API_ORIGIN !== LOCAL_API_ORIGIN
      || env.QA_EXPECTED_TARGET_ID !== LOCAL_QA_TARGET
      || database.protocol !== 'postgresql:' || database.hostname !== '127.0.0.1'
      || database.port !== '55491' || decodeURIComponent(database.pathname.slice(1)) !== LOCAL_CLINICAL_QA_DATABASE
      || decodeURIComponent(database.username) !== 'shifa_local_qa'
      || env.DIRECT_URL !== env.DATABASE_URL || env.SOCKET_REVOCATION_DATABASE_URL !== env.DATABASE_URL
      || env.NOTIFICATIONS_DISABLED !== 'true' || env.SMS_PROVIDER !== 'disabled'
      || env.VERIFICATION_PROVIDER !== 'development' || env.PHONE_VERIFICATION_PROVIDER !== 'development'
      || env.QA_PAYMENT_MODE !== 'disabled' || !allowedProviders) {
    fail('unsafe_local_configuration');
  }
  return Object.freeze({ origin: LOCAL_API_ORIGIN, databaseName: LOCAL_CLINICAL_QA_DATABASE, databaseRole: 'shifa_local_qa' });
}

export function safeClinicalFixtureReport(namespace, values = {}) {
  return Object.freeze({
    namespace: syntheticNamespace(namespace) ? namespace : null,
    patientFixtureIndex: 1,
    labOrderCreated: values.labOrderCreated === true,
    labResultReleased: values.labResultReleased === true,
    patientLabReadConfirmed: values.patientLabReadConfirmed === true,
    prescriptionCreated: values.prescriptionCreated === true,
    pharmacistWorkflowConfirmed: values.pharmacistWorkflowConfirmed === true,
    patientPrescriptionReadConfirmed: values.patientPrescriptionReadConfirmed === true,
    invoiceCreated: values.invoiceCreated === true,
    localPaymentSimulationStatus: ['ledger_cash_recorded', 'local_payment_simulation_unavailable', 'not_required'].includes(values.localPaymentSimulationStatus)
      ? values.localPaymentSimulationStatus : 'not_started',
    workflowResult: ['PASS', 'PARTIAL', 'BLOCKED', 'FAILED'].includes(values.workflowResult) ? values.workflowResult : 'BLOCKED',
    reason: REASONS.has(values.reason) ? values.reason : null
  });
}

const ROUTES = [
  ['POST', /^\/api\/auth\/login$/], ['GET', /^\/api\/patient-auth\/address-states$/],
  ['POST', /^\/api\/patient-auth\/register$/], ['POST', /^\/api\/patient-auth\/verify$/],
  ['GET', /^\/api\/patient\/me$/], ['GET', /^\/api\/appointments\/doctors$/],
  ['GET', /^\/api\/patient\/lab-results$/], ['GET', /^\/api\/patient\/prescriptions$/],
  ['GET', /^\/api\/appointments\/slots$/], ['POST', /^\/api\/patient\/appointments$/],
  ['PUT', /^\/api\/appointments\/[0-9a-f-]+\/status$/],
  ['GET', /^\/api\/billing\/payment-methods$/], ['POST', /^\/api\/billing\/invoice$/],
  ['POST', /^\/api\/billing\/invoice\/[0-9a-f-]+\/payments$/], ['GET', /^\/api\/billing\/services$/],
  ['GET', /^\/api\/records\/medication-reviews\/pending$/], ['POST', /^\/api\/records$/],
  ['GET', /^\/api\/records\/lab-orders\/pending$/],
  ['PUT', /^\/api\/records\/lab-orders\/[0-9a-f-]+\/collect-sample$/],
  ['PUT', /^\/api\/records\/lab-orders\/items\/[0-9a-f-]+\/results$/],
  ['PUT', /^\/api\/records\/lab-orders\/[0-9a-f-]+\/release$/],
  ['GET', /^\/api\/records\/prescriptions\/pending$/], ['GET', /^\/api\/patients\/[0-9a-f-]+\/profile$/]
];

async function run({ env, fetchImpl = fetch, databaseProbe, staffCredentials, now = () => new Date() }) {
  const safe = validateLocalClinicalEnvironment(env);
  let namespace = null;
  const report = { labOrderCreated: false, labResultReleased: false, patientLabReadConfirmed: false,
    prescriptionCreated: false, pharmacistWorkflowConfirmed: false, patientPrescriptionReadConfirmed: false,
    invoiceCreated: false, localPaymentSimulationStatus: 'not_started', workflowResult: 'BLOCKED', reason: null };
  let response;

  async function request(method, path, { token, body, expected = [200], headers: extraHeaders = {} } = {}) {
    const url = new URL(path, safe.origin);
    if (url.origin !== safe.origin || !ROUTES.some(([verb, pattern]) => verb === method && pattern.test(url.pathname))) fail('unsafe_local_configuration');
    let result;
    try {
      result = await fetchImpl(url, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}), ...extraHeaders }, ...(body ? { body: JSON.stringify(body) } : {}) });
    } catch { fail('workflow_api_failed'); }
    let payload;
    try { payload = result.status === 204 ? null : await result.json(); } catch { fail('workflow_api_failed'); }
    if (!expected.includes(result.status)) fail('workflow_api_failed', result.status);
    return payload;
  }

  try {
    const gate = await verifyLocalQaGate({ env, fetchImpl, databaseProbe, expectedDatabaseName: LOCAL_CLINICAL_QA_DATABASE });
    valid(gate?.gate === 'PASS' && gate.apiOrigin === safe.origin && gate.targetId === LOCAL_QA_TARGET,
      'unsafe_local_configuration');
    namespace = createQaRunNamespace(now());
    const staff = {};
    for (const [key, expectedRole] of [['doctor', 'DOCTOR'], ['lab', 'LAB_TECH'], ['pharmacist', 'PHARMACIST'], ['receptionist', 'RECEPTIONIST']]) {
      const credential = staffCredentials?.[key];
      valid(credential?.role === expectedRole && credential.username, 'unsafe_local_configuration');
      response = await request('POST', '/api/auth/login', { body: { username: credential.username, password: credential.password } });
      valid(typeof response?.token === 'string' && response.token && response.user?.role === expectedRole, 'staff_authentication_failed');
      staff[key] = { token: response.token, user: response.user };
    }
    valid(ID.test(staff.doctor.user.doctorId || ''), 'no_seeded_doctor');
    const addressResponse = await request('GET', '/api/patient-auth/address-states');
    const addressStateId = addressResponse?.states?.find(state => Number.isInteger(state.id))?.id;
    valid(addressStateId, 'workflow_api_failed');
    // Patient discovery is authenticated and unavailable until registration.
    // Use the application's public appointment discovery route for this
    // pre-registration prerequisite, then verify patient-facing reads later.
    const doctors = await request('GET', '/api/appointments/doctors');
    // This public DTO intentionally omits internal status; the API itself only
    // returns active, bookable doctors. Match the authenticated seeded doctor.
    const doctor = doctors?.find(item => item.id === staff.doctor.user.doctorId);
    valid(doctor, 'no_seeded_doctor');
    const dateCandidates = Array.from({ length: 14 }, (_, index) => {
      const date = new Date(now().getTime() + (index + 1) * 86_400_000);
      const parts = Object.fromEntries(new Intl.DateTimeFormat('en', { timeZone: 'Africa/Khartoum', year: 'numeric', month: '2-digit', day: '2-digit' })
        .formatToParts(date).map(({ type, value }) => [type, value]));
      return `${parts.year}-${parts.month}-${parts.day}`;
    });
    let slot;
    for (const date of dateCandidates) {
      const times = await request('GET', `/api/appointments/slots?doctorId=${doctor.id}&date=${date}`);
      const time = Array.isArray(times) && times.find(value => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value));
      if (time) { slot = { doctorId: doctor.id, appointmentDate: date, appointmentTime: time }; break; }
    }
    valid(slot, 'no_available_slot');
    const services = await request('GET', '/api/billing/services');
    const labService = services?.find(service => service.category === 'LABORATORY'
      && Number.isSafeInteger(Number(service.baseFeeSdg)) && Number(service.baseFeeSdg) > 0);
    valid(labService, 'lab_fixture_unavailable');
    const patient = syntheticPatient(namespace, 1, addressStateId);
    assertSyntheticPatient(patient, namespace, 1);
    let registered;
    try { registered = await request('POST', '/api/patient-auth/register', { body: registrationBody(patient), expected: [201] }); }
    catch (error) { if (error.status === 409) fail('registration_conflict', 409); throw error; }
    valid(registered?.state === 'VERIFICATION_REQUIRED' && ID.test(registered.challengeId || ''), 'workflow_api_failed');
    valid(env.VERIFICATION_PROVIDER === 'development' && /^\d{6}$/.test(registered.developmentCode || ''), 'local_patient_verification_unavailable');
    const verified = await request('POST', '/api/patient-auth/verify', { body: { challengeId: registered.challengeId, code: registered.developmentCode } });
    valid(['CLAIMED', 'VERIFIED'].includes(verified?.state) && ID.test(verified.patient?.id || '')
      && verified.patient.phone === patient.phone
      && verified.patient.fullNameEn === `${patient.firstNameEn} ${patient.fatherNameEn} ${patient.grandfatherNameEn} ${patient.familyNameEn}`,
    'workflow_api_failed');
    response = await request('POST', '/api/auth/login', { body: { username: patient.email, password: patient.password } });
    valid(response?.user?.role === 'PATIENT' && response.user.patientLinked === true
      && response.user.patientId === verified.patient.id && response.token, 'workflow_api_failed');
    const patientToken = response.token;
    const profile = await request('GET', '/api/patient/me', { token: patientToken });
    valid(profile?.id === verified.patient.id && profile.phone === patient.phone, 'workflow_api_failed');

    const appointment = await request('POST', '/api/patient/appointments', { token: patientToken, body: slot, expected: [201] });
    valid(ID.test(appointment?.id || '') && appointment.status === 'PENDING'
      && appointment.doctorId === doctor.id, 'workflow_api_failed');
    await request('PUT', `/api/appointments/${appointment.id}/status`, { token: staff.receptionist.token, body: { status: 'CONFIRMED' } });
    await request('PUT', `/api/appointments/${appointment.id}/status`, { token: staff.receptionist.token, body: { status: 'CHECKED_IN' } });

    const consultationInvoice = await request('POST', '/api/billing/invoice', { token: staff.receptionist.token,
      body: { patientId: verified.patient.id, appointmentId: appointment.id, invoiceType: 'CONSULTATION' }, expected: [201] });
    valid(consultationInvoice?.invoice?.patientId === verified.patient.id, 'consultation_invoice_unavailable');
    report.invoiceCreated = true;
    const cashMethods = await request('GET', '/api/billing/payment-methods', { token: staff.receptionist.token });
    if (!Array.isArray(cashMethods) || !cashMethods.some(method => method.code === 'CASH')) {
      report.localPaymentSimulationStatus = 'local_payment_simulation_unavailable';
      fail('local_payment_simulation_unavailable');
    }
    const consultationAmount = Number(consultationInvoice.invoice.totalAmountSdg);
    valid(Number.isSafeInteger(consultationAmount) && consultationAmount > 0, 'consultation_invoice_unavailable');
    const payInvoice = async (invoice, amount, suffix) => request('POST', `/api/billing/invoice/${invoice.id}/payments`, {
      token: staff.receptionist.token, expected: [200], headers: { 'Idempotency-Key': `local-qa-${namespace}-${suffix}` },
      body: { payments: [{ amountSdg: amount, paymentMethod: 'CASH', transactionReference: `local-qa-${namespace}-${Math.random().toString(16).slice(2, 10)}` }] }
    });
    const consultationPayment = await payInvoice(consultationInvoice.invoice, consultationAmount, 'consultation');
    valid(consultationPayment?.paymentStatus === 'PAID', 'local_payment_simulation_unavailable');
    report.localPaymentSimulationStatus = 'ledger_cash_recorded';
    await request('PUT', `/api/appointments/${appointment.id}/status`, { token: staff.doctor.token, body: { status: 'IN_CONSULTATION' } });

    const consultation = await request('POST', '/api/records', { token: staff.doctor.token, expected: [201], body: {
      patientId: verified.patient.id, appointmentId: appointment.id, diagnosis: 'Synthetic local QA fixture',
      orderedServices: [labService.id], prescribedDrugs: [{ customDrugName: 'Synthetic local QA medication',
        dosage: 'One tablet', duration: '3 days', qtyPrescribed: 3 }]
    } });
    // The real consultation endpoint nests created records under `data`.
    // Accept this public response shape and the flatter unit-fixture shape.
    const labOrder = consultation?.data?.labOrder || consultation?.labOrder;
    const prescription = consultation?.data?.prescription || consultation?.prescription;
    valid(ID.test(labOrder?.id || '') && labOrder.patientId === verified.patient.id
      && ID.test(prescription?.id || '') && prescription.patientId === verified.patient.id, 'workflow_api_failed');
    report.labOrderCreated = true;
    report.prescriptionCreated = true;
    const labInvoice = await request('POST', '/api/billing/invoice', { token: staff.receptionist.token, expected: [201], body: {
      patientId: verified.patient.id, invoiceType: 'LABORATORY', labOrderId: labOrder.id
    } });
    valid(labInvoice?.invoice?.patientId === verified.patient.id && labInvoice.invoice.labOrderId === labOrder.id, 'workflow_api_failed');
    report.invoiceCreated = true;
    const labAmount = Number(labInvoice.invoice.totalAmountSdg);
    valid(Number.isSafeInteger(labAmount) && labAmount > 0, 'workflow_api_failed');
    const labPayment = await payInvoice(labInvoice.invoice, labAmount, 'laboratory');
    valid(labPayment?.paymentStatus === 'PAID', 'local_payment_simulation_unavailable');

    const pendingLabs = await request('GET', '/api/records/lab-orders/pending', { token: staff.lab.token });
    const matchingLab = pendingLabs?.find(order => order.id === labOrder.id && order.patientId === verified.patient.id);
    valid(matchingLab?.items?.length === 1 && ID.test(matchingLab.items[0].id || ''), 'lab_fixture_unavailable');
    await request('PUT', `/api/records/lab-orders/${labOrder.id}/collect-sample`, { token: staff.lab.token, body: {} });
    await request('PUT', `/api/records/lab-orders/items/${matchingLab.items[0].id}/results`, { token: staff.lab.token,
      body: { expectedVersion: 0, resultValue: '12.4', referenceRangeMin: 4, referenceRangeMax: 14, isOutOfRange: false } });
    await request('PUT', `/api/records/lab-orders/${labOrder.id}/release`, { token: staff.lab.token, body: {} });
    report.labResultReleased = true;
    const patientLabs = await request('GET', '/api/patient/lab-results', { token: patientToken });
    report.patientLabReadConfirmed = Array.isArray(patientLabs) && patientLabs.some(order => order.id === labOrder.id
      && order.tests?.some(test => test.resultValue === '12.4'));
    valid(report.patientLabReadConfirmed, 'lab_fixture_unavailable');

    const pharmacyQueue = await request('GET', '/api/records/medication-reviews/pending', { token: staff.pharmacist.token });
    report.pharmacistWorkflowConfirmed = Array.isArray(pharmacyQueue) && pharmacyQueue.some(item => item.prescriptionId === prescription.id
      && item.pharmacyReviewStatus === 'PENDING_REVIEW');
    const patientPrescriptions = await request('GET', '/api/patient/prescriptions', { token: patientToken });
    report.patientPrescriptionReadConfirmed = Array.isArray(patientPrescriptions) && patientPrescriptions.some(item => item.id === prescription.id);
    valid(report.pharmacistWorkflowConfirmed && report.patientPrescriptionReadConfirmed, 'pharmacy_fixture_unavailable');
    const patientBilling = await request('GET', `/api/patients/${verified.patient.id}/profile`, { token: staff.receptionist.token });
    valid(patientBilling?.id === verified.patient.id && patientBilling.portalLinked === true
      && patientBilling.invoices?.some(invoice => invoice.id === labInvoice.invoice.id && invoice.invoiceType === 'LABORATORY'),
    'workflow_api_failed');
    report.workflowResult = 'PASS';
    return safeClinicalFixtureReport(namespace, report);
  } catch (error) {
    const internalReason = error?.reason || error?.code;
    const reason = ['local_database_identity_mismatch', 'local_database_unavailable'].includes(internalReason)
      ? 'database_identity_mismatch' : REASONS.has(internalReason) ? internalReason : 'workflow_api_failed';
    report.workflowResult = error?.reason === 'local_payment_simulation_unavailable' ? 'PARTIAL' : 'FAILED';
    report.reason = reason;
    return safeClinicalFixtureReport(namespace, report);
  }
}

export const localClinicalFixtureInternals = Object.freeze({ run });
