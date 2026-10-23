import { assertLoadTarget, assertLoadTargetMarker } from './safety-guards.mjs';
import http from 'k6/http';
import { check, fail, sleep } from 'k6';

// Read-only clinic data workload. It never books, edits, dispenses, bills,
// uploads, or mutates clinical/business records. Optional login checks can
// update auth/audit metadata, so use only disposable local/staging accounts.
const stage = __ENV.LOAD_STAGE || 'smoke';
const plans = {
  smoke: { target: 10, stages: [{ duration: '30s', target: 2 }, { duration: '1m', target: 10 }, { duration: '30s', target: 0 }] },
  normal: { target: 50, stages: [{ duration: '1m', target: 10 }, { duration: '2m', target: 25 }, { duration: '3m', target: 50 }, { duration: '1m', target: 0 }] },
  busy: { target: 100, stages: [{ duration: '1m', target: 20 }, { duration: '2m', target: 50 }, { duration: '3m', target: 100 }, { duration: '1m', target: 0 }] },
  high: { target: 250, stages: [{ duration: '1m', target: 25 }, { duration: '2m', target: 100 }, { duration: '3m', target: 250 }, { duration: '1m', target: 0 }] },
  stress: { target: 500, stages: [{ duration: '1m', target: 50 }, { duration: '2m', target: 200 }, { duration: '3m', target: 500 }, { duration: '1m', target: 0 }] },
  upper: { target: 1000, stages: [{ duration: '1m', target: 50 }, { duration: '2m', target: 250 }, { duration: '3m', target: 500 }, { duration: '3m', target: 750 }, { duration: '3m', target: 1000 }, { duration: '1m', target: 0 }] }
};
const plan = plans[stage];
if (!plan) fail('LOAD_STAGE must be smoke, normal, busy, high, stress, or upper.');

let target;
try { target = assertLoadTarget(__ENV); } catch (error) { fail(error.message); }
const base = target.base;

let personas = [];
try { personas = JSON.parse(__ENV.LOAD_TEST_PERSONAS_JSON || '[]'); } catch { fail('LOAD_TEST_PERSONAS_JSON must be valid JSON.'); }
if (!Array.isArray(personas) || !personas.length) fail('Provide test personas with role and either a bearer token or isolated test login credentials.');
for (const persona of personas) {
  const hasToken = typeof persona.token === 'string' && persona.token;
  const hasLogin = typeof persona.username === 'string' && persona.username && typeof persona.password === 'string' && persona.password;
  if (!['PATIENT', 'DOCTOR', 'PHARMACIST', 'LAB_TECH', 'RECEPTIONIST', 'ADMIN'].includes(persona.role) || (!hasToken && !hasLogin)) {
    fail('Each persona needs a supported role and either token or login credentials.');
  }
}
if (personas.some((persona) => persona.username || persona.password)) {
  try { assertLoadTarget(__ENV, { writes: true }); } catch (error) { fail(error.message); }
  const usernames = personas.map((persona) => persona.username).filter(Boolean);
  if (usernames.length !== plan.target || new Set(usernames).size !== usernames.length || personas.some((persona) => !persona.username || !persona.password)) {
    fail('Login load requires one distinct disposable local/staging test user per planned VU.');
  }
}

export const options = {
  maxRedirects: 0,
  scenarios: { clinic_read_workflow: { executor: 'ramping-vus', startVUs: 1, stages: plan.stages, gracefulRampDown: '30s' } },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{class:auth}': ['p(95)<1000'],
    'http_req_duration{class:common}': ['p(95)<500'],
    'http_req_duration{class:business}': ['p(95)<1000']
  },
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)']
};

function request(path, token, tag, metricClass = 'common') {
  const response = http.get(`${base}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    tags: { endpoint: tag, class: metricClass },
    timeout: '20s'
  });
  check(response, { [`${tag} returns 2xx`]: (res) => res.status >= 200 && res.status < 300 });
  return response;
}

// Verify an independent server-side marker before starting any VUs.
export function setup() {
  const response = http.get(`${base}/api/health/load-test-target`, { redirects: 0, timeout: '10s' });
  let marker;
  try { marker = response.status === 200 ? response.json() : null; assertLoadTargetMarker(target, marker); }
  catch { fail('Server staging identity could not be verified.'); }
  console.log(`Confirmed load target hostname: ${target.host}`);
}

export default function () {
  const persona = personas[(__VU - 1) % personas.length];
  if (!persona.token) {
    const login = http.post(`${base}/api/auth/login`, JSON.stringify({ username: persona.username, password: persona.password }), {
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      tags: { endpoint: 'login', class: 'auth' },
      timeout: '20s'
    });
    const body = login.status === 200 ? login.json() : null;
    check(login, { 'isolated test login succeeds': (res) => res.status === 200 && typeof body?.token === 'string' });
    if (typeof body?.token !== 'string') { sleep(1); return; }
    persona.token = body.token;
  }
  request('/api/health/live', persona.token, 'health');

  if (persona.role === 'PATIENT') {
    request('/api/patient/me', persona.token, 'patient_me');
    request('/api/patient/doctors', persona.token, 'patient_doctors');
    request('/api/patient/appointments?group=upcoming', persona.token, 'patient_appointments');
    request('/api/patient/medical-records', persona.token, 'patient_records', 'business');
    request('/api/patient/prescriptions', persona.token, 'patient_prescriptions', 'business');
    request('/api/patient/lab-results', persona.token, 'patient_lab_results', 'business');
  } else if (persona.role === 'DOCTOR') {
    if (!persona.doctorId) fail('Doctor personas require doctorId.');
    request(`/api/appointments/queue/${encodeURIComponent(persona.doctorId)}`, persona.token, 'doctor_queue', 'business');
  } else if (persona.role === 'PHARMACIST') {
    request('/api/pharmacy/formulary?page=1&pageSize=20', persona.token, 'pharmacy_formulary');
    request('/api/records/prescriptions/pending', persona.token, 'pharmacy_queue', 'business');
  } else if (persona.role === 'LAB_TECH') {
    request('/api/records/lab-orders/pending', persona.token, 'lab_queue', 'business');
  } else if (persona.role === 'RECEPTIONIST' || persona.role === 'ADMIN') {
    request('/api/appointments/pending', persona.token, 'reception_pending', 'business');
    request('/api/patients/search?q=a&limit=20', persona.token, 'patient_search');
  }

  sleep(1);
}
