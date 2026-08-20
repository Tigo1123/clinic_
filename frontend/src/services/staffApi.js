import { apiFetch } from './apiClient';

export function apiErrorMessage(payload, fallback) {
  return typeof payload?.error === 'string' ? payload.error : payload?.error?.message || fallback;
}

export async function fetchWithAuth(url, options = {}) {
  const staffApiBase = import.meta.env.VITE_STAFF_API_URL || import.meta.env.VITE_API_BASE_URL || '';
  return apiFetch(url, options, 'staff', staffApiBase);
}
