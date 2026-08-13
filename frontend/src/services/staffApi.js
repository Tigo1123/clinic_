export function apiErrorMessage(payload, fallback) {
  return typeof payload?.error === 'string' ? payload.error : payload?.error?.message || fallback;
}

export async function fetchWithAuth(url, options = {}) {
  const token = localStorage.getItem('cms_token');
  const headers = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers };
  let targetUrl = url;
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    const cleanPath = url.startsWith('/') ? url : `/${url}`;
    const backendHost = window.location.hostname === 'localhost' ? 'localhost' : window.location.hostname;
    targetUrl = `http://${backendHost}:5000${cleanPath}`;
  }
  const response = await fetch(targetUrl, { ...options, headers });
  if (response.status === 401) {
    localStorage.removeItem('cms_user');
    localStorage.removeItem('cms_token');
    if (token) window.location.href = '/staff';
  }
  return response;
}
