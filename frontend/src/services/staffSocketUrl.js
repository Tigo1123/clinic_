export function resolveStaffSocketUrl(environment, origin) {
  if (environment.VITE_STAFF_SOCKET_URL) return environment.VITE_STAFF_SOCKET_URL;
  const api = environment.VITE_STAFF_API_URL || environment.VITE_API_BASE_URL;
  if (api && /^https?:\/\//i.test(api)) return new URL(api).origin;
  return environment.DEV ? 'http://localhost:5000' : origin || 'http://localhost:5000';
}
