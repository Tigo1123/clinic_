// Explicitly isolated test-only patient sign-up. Never use this for real identity verification.
// The database endpoint is pinned to the dedicated Neon copy created for clinic staging.
// All checks fail closed if the staging database/hosting configuration changes.
const STAGING_POOL_HOST = 'ep-solitary-dust-b4xeyh77-pooler.c-6.us-east-2.aws.neon.tech';
const STAGING_DIRECT_HOST = 'ep-solitary-dust-b4xeyh77.c-6.us-east-2.aws.neon.tech';
const TEST_WEB_ORIGIN = 'https://clinic-production-web-test.onrender.com';

export function stagingDemoRegistrationEnabled(env = process.env) {
  if (env.STAGING_DEMO_REGISTRATION !== 'true'
    || env.DEPLOYMENT_ENV !== 'staging'
    || env.NODE_ENV !== 'production'
    || env.VERIFICATION_PROVIDER !== 'disabled'
    || env.NOTIFICATIONS_DISABLED !== 'true') return false;
  try {
    const pooled = new URL(env.DATABASE_URL);
    const direct = new URL(env.SOCKET_REVOCATION_DATABASE_URL);
    return pooled.protocol === 'postgresql:'
      && pooled.hostname === STAGING_POOL_HOST
      && pooled.pathname === '/neondb'
      && direct.hostname === STAGING_DIRECT_HOST
      && direct.pathname === '/neondb'
      && (env.CORS_ALLOWED_ORIGINS || '').split(',').map(x => x.trim()).includes(TEST_WEB_ORIGIN);
  } catch {
    return false;
  }
}

// .invalid never receives email. +1 202-555-0100..0199 is reserved fictional numbering.
// Forbid real patient contacts because the staging database contains copied clinical data.
export function stagingDemoIdentityAllowed(email, normalizedPhone) {
  return /^qa\+[a-z0-9-]{2,24}@clinic-qa\.invalid$/i.test(String(email || '').trim())
    && /^\+120255501\d{2}$/.test(String(normalizedPhone || '').trim());
}
