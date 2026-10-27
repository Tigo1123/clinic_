import { clearPatientSession, clearStaffSession, readPatientSession, readStaffSession } from './authStorage.js';

const API_BASE = import.meta.env?.VITE_API_BASE_URL || '';

export class ApiClientError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const SESSION_ENDING_CODES = new Set(['INVALID_TOKEN', 'SESSION_REVOKED', 'AUTHENTICATION_REQUIRED']);

async function endsSession(response) {
  if (response.status !== 401) return false;
  // Read a copy so callers can still read the original body.
  const body = await response.clone?.().json().catch(() => null);
  const code = body?.error?.code ?? body?.code;
  // A 401 without a recognizable code usually comes from an intermediary,
  // so keep the previous behavior and end the session.
  return !code || SESSION_ENDING_CODES.has(code);
}

export async function apiFetch(path, options = {}, auth = null, baseUrl = API_BASE) {
  const session = auth === 'staff'
    ? readStaffSession()
    : auth === 'patient'
      ? readPatientSession()
      : null;
  const token = session?.token;
  const targetUrl = /^https?:\/\//.test(path)
    ? path
    : `${baseUrl.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
  const response = await fetch(targetUrl, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers
    }
  });

  if (auth && await endsSession(response)) {
    if (auth === 'staff') clearStaffSession();
    if (auth === 'patient') clearPatientSession();
    window.location.replace(auth === 'staff' ? '/staff' : '/patient-login');
  }

  return response;
}

async function request(path, options = {}, auth = null, baseUrl = API_BASE) {
  const response = await apiFetch(path, options, auth, baseUrl);

  const payload =
    response.status === 204
      ? null
      : await response.json().catch(() => null);

  if (!response.ok) {
    const error = payload?.error;

    const code =
      payload?.code ||
      (typeof error === 'object' && error ? error.code : undefined) ||
      (typeof payload?.status === 'string' && payload.status ? payload.status : undefined) ||
      'REQUEST_FAILED';

    const message =
      typeof error === 'object'
        ? error.message
        : error || 'Request failed.';

    const details =
      typeof error === 'object'
        ? error.details
        : payload?.details;

    throw new ApiClientError(
      response.status,
      code,
      message,
      details
    );
  }

  return payload;
}

export function staffApiRequest(path, options = {}) {
  return request(path, options, 'staff', import.meta.env?.VITE_STAFF_API_URL || API_BASE);
}

export function patientApiRequest(path, options = {}) {
  return request(path, options, 'patient');
}

export function publicApiRequest(path, options = {}) {
  return request(path, options);
}
