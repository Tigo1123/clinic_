import { apiFetch, localizedApiErrorMessage } from './apiClient.js';

export function apiErrorMessage(payload, fallback) {
  const error = payload?.error;
  return localizedApiErrorMessage({
    code: payload?.code || (typeof error === 'object' && error ? error.code : undefined)
      || (typeof payload?.status === 'string' ? payload.status : undefined),
    status: payload?.status
  }, fallback);
}

export async function fetchWithAuth(url, options = {}) {
  const staffApiBase = import.meta.env.VITE_STAFF_API_URL || import.meta.env.VITE_API_BASE_URL || '';
  return apiFetch(url, options, 'staff', staffApiBase);
}
