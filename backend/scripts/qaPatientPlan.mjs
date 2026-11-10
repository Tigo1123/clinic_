import { createHash, randomBytes } from 'node:crypto';
import { createQaRunNamespace, qaPatientIdentifiers } from './qaRunNamespace.mjs';
import { isSyntheticQaEmail } from '../src/utils/qaVerificationCapture.js';

export const PATIENT_COUNT = 100;
export const STAGING_API = 'https://clinic-staging-api.onrender.com';
export const STAGING_TARGET = 'clinic-staging-qa-20261106';
export const MAX_CONCURRENCY = 2;
export const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const STAGES = Object.freeze([
  'registration', 'capture', 'verification', 'login', 'profile', 'doctors', 'specialties',
  'slots', 'appointmentCreate', 'appointmentList', 'appointmentDetail', 'medicalRecords',
  'labResults', 'prescriptions', 'labWorkflow', 'pharmacyWorkflow', 'billingWorkflow'
]);

// Reviewed against server.js mounts and routes/{patientAuth,auth,patient,appointments}.js.
// No notification, OTP, payment, staff mutation, or unrelated-record route is allowed.
export function permittedQaRequest(url, method, allowedOrigin = STAGING_API) {
  // Only the fixed staging target or an explicitly pinned IPv4 loopback origin
  // may be supplied. The local QA preflight separately verifies that the port
  // and database are disposable and that external providers are disabled.
  const isStaging = allowedOrigin === STAGING_API;
  const localPort = /^http:\/\/127\.0\.0\.1:(\d{1,5})$/.exec(allowedOrigin)?.[1];
  const isLocal = localPort !== undefined && Number(localPort) >= 1 && Number(localPort) <= 65535;
  if (!(isStaging || isLocal) || url.origin !== allowedOrigin || url.username || url.password || url.hash) return false;
  const simple = {
    GET: ['/api/health/load-test-target', '/api/health', '/api/health/ready',
      '/api/patient-auth/address-states', '/api/patient/me', '/api/patient/doctors',
      '/api/patient/specialties', '/api/patient/appointments', '/api/patient/medical-records',
      '/api/patient/lab-results', '/api/patient/prescriptions', '/api/qa/verification-capture-auth-check'],
    POST: ['/api/patient-auth/register', '/api/patient-auth/verify', '/api/auth/login', '/api/patient/appointments']
  };
  if (!url.search && simple[method]?.includes(url.pathname)) return true;
  if (method !== 'GET') return false;
  if (!url.search && url.pathname.startsWith('/api/qa/verification-capture/')) return ID.test(url.pathname.slice('/api/qa/verification-capture/'.length));
  if (!url.search && url.pathname.startsWith('/api/patient/appointments/')) return ID.test(url.pathname.slice('/api/patient/appointments/'.length));
  return url.pathname === '/api/appointments/slots'
    && [...url.searchParams.keys()].sort().join(',') === 'date,doctorId'
    && ID.test(url.searchParams.get('doctorId') || '')
    && /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('date') || '');
}

export function safeConcurrency(value = '2') {
  if (!/^[12]$/.test(String(value))) throw new Error('invalid_concurrency');
  return Number(value);
}

// NANPA reserves 555-0100..0199 as non-working fictional numbers:
// https://nanpa.com/numbering/555-line-numbers
// This finite fixture pool may collide with earlier QA runs. Never reuse an
// existing account on conflict; report BLOCKED and leave it untouched.
const AREAS = [202, 212, 213, 214, 215, 216, 303, 305, 310, 312, 313, 404, 415, 424, 469, 503, 505, 512, 617, 646, 702, 703, 704, 713, 718, 720, 801, 818, 858, 901, 917, 919];

export function syntheticQaPhone(runNamespace, index) {
  if (!/^qa-\d{8}-[a-f0-9]{8}$/.test(runNamespace || '') || !Number.isInteger(index) || index < 1 || index > PATIENT_COUNT) {
    throw new Error('invalid_synthetic_identity');
  }
  const offset = createHash('sha256').update(runNamespace).digest().readUInt32BE(0);
  const fixture = (offset % (AREAS.length * 100) + index - 1) % (AREAS.length * 100);
  return `+1${AREAS[Math.floor(fixture / 100)]}55501${String(fixture % 100).padStart(2, '0')}`;
}

// Select through the regular namespace generator, retrying only if the next
// batch would reuse a phone belonging to a specifically reviewed prior QA run.
export function createCollisionFreeQaRunNamespace({ now = new Date(), createNamespace = () => createQaRunNamespace(now),
  reservedPatients = [], attempts = 32 } = {}) {
  const reservedPhones = new Set(reservedPatients.map(({ runNamespace, index }) => syntheticQaPhone(runNamespace, index)));
  for (let attempt = 0; attempt < attempts; attempt++) {
    const candidate = createNamespace();
    const batchPhones = new Set(Array.from({ length: PATIENT_COUNT }, (_, index) => syntheticQaPhone(candidate, index + 1)));
    if (batchPhones.size === PATIENT_COUNT && ![...batchPhones].some(phone => reservedPhones.has(phone))) return candidate;
  }
  throw new Error('qa_namespace_phone_collision');
}

export function syntheticPatient(runNamespace, index, addressStateId) {
  const identity = qaPatientIdentifiers(runNamespace, index);
  const offset = createHash('sha256').update(runNamespace).digest().readUInt32BE(0);
  const suffix = String(index).padStart(3, '0');
  const patient = {
    ...identity, username: identity.email,
    phone: syntheticQaPhone(runNamespace, index),
    dateOfBirth: new Date(Date.UTC(1980, 0, 1 + offset % 7300)).toISOString().slice(0, 10),
    firstNameEn: 'QA', fatherNameEn: runNamespace, grandfatherNameEn: 'Synthetic', familyNameEn: `Patient-${suffix}`,
    firstNameAr: 'اختبار', fatherNameAr: runNamespace, grandfatherNameAr: 'اصطناعي', familyNameAr: `مريض-${suffix}`,
    gender: index % 2 ? 'MALE' : 'FEMALE', addressStateId,
    password: `Qa1!${randomBytes(24).toString('base64url')}`
  };
  assertSyntheticPatient(patient, runNamespace, index);
  return patient;
}

export function assertSyntheticPatient(patient, runNamespace, index) {
  const expected = qaPatientIdentifiers(runNamespace, index);
  if (!isSyntheticQaEmail(patient.email) || patient.email !== expected.email || patient.username !== expected.email
      || !/^\+1\d{3}55501\d{2}$/.test(patient.phone || '')) throw new Error('non_synthetic_identity');
}

export function registrationBody(patient) {
  const keys = ['firstNameAr', 'fatherNameAr', 'grandfatherNameAr', 'familyNameAr', 'firstNameEn',
    'fatherNameEn', 'grandfatherNameEn', 'familyNameEn', 'phone', 'email', 'dateOfBirth', 'gender', 'password', 'addressStateId'];
  return Object.fromEntries(keys.map(key => [key, patient[key]]));
}
