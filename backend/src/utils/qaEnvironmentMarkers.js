// Only use for non-secret, case-insensitive QA environment markers.
// Credentials, connection URLs, and identity pins must retain their exact values.
export function normalizeQaMarker(value) {
  return String(value || '').trim().toLowerCase();
}

export function isStagingQaEnvironment(env = process.env) {
  return normalizeQaMarker(env.APP_ENV) === 'staging'
    && normalizeQaMarker(env.DEPLOYMENT_ENV) === 'staging';
}
