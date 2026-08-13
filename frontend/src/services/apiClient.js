const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

export class ApiClientError extends Error {
  constructor(status, code, message, details) { super(message); this.status = status; this.code = code; this.details = details; }
}

export async function apiRequest(path, options = {}) {
  const token = localStorage.getItem('cms_token');
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers }
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const error = payload?.error;
    throw new ApiClientError(response.status, typeof error === 'object' ? error.code : 'REQUEST_FAILED', typeof error === 'object' ? error.message : error || 'Request failed.', error?.details);
  }
  return payload;
}
