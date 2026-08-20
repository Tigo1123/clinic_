import { clearPatientSession, clearStaffSession, readPatientSession, readStaffSession } from './authStorage';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

export class ApiClientError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
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

  if (response.status === 401 && auth) {
    if (auth === 'staff') clearStaffSession();
    if (auth === 'patient') clearPatientSession();
    window.location.replace(auth === 'staff' ? '/staff' : '/patient-login');
  }

  return response;
}

async function request(path, options = {}, auth = null) {
  const response = await apiFetch(path, options, auth);

  const payload =
    response.status === 204
      ? null
      : await response.json().catch(() => null);

  if (!response.ok) {
    const error = payload?.error;

    const code =
      payload?.code ||
      (typeof error === 'object'
        ? error.code
        : 'REQUEST_FAILED');

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
  return request(path, options, 'staff');
}

export function patientApiRequest(path, options = {}) {
  return request(path, options, 'patient');
}

export function publicApiRequest(path, options = {}) {
  return request(path, options);
}
